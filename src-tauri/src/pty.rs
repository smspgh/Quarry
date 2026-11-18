//! Terminal tabs: a shell (PowerShell, Command Prompt, Git Bash, ...) or a one-off command
//! line in a ConPTY (portable-pty), drawn by xterm.js in the UI. Output goes to the UI as `pty:data` events (UTF-8, never split inside a character), then
//! one `pty:exit`.

use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct Terminals {
    next_id: AtomicU32,
    terms: Arc<Mutex<HashMap<u32, Term>>>,
}

struct Term {
    master: Box<dyn MasterPty + Send>,
    writer: crate::writer::ChannelWriter,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Clone, Serialize)]
struct Data {
    id: u32,
    data: String,
}

#[derive(Clone, Serialize)]
struct Exit {
    id: u32,
    /// Always known: the watcher only reports a child it saw exit (a killed tab reports nothing).
    code: u32,
}

/// Split `buf` into the longest prefix that is complete UTF-8 and the bytes of a character that
/// continues in the next read. Invalid bytes are replaced (not carried over).
pub fn take_utf8(buf: &mut Vec<u8>) -> String {
    match std::str::from_utf8(buf) {
        Ok(s) => {
            let out = s.to_string();
            buf.clear();
            out
        }
        Err(e) if e.error_len().is_none() => {
            let valid = e.valid_up_to();
            let out = String::from_utf8_lossy(&buf[..valid]).into_owned();
            buf.drain(..valid);
            out
        }
        Err(_) => {
            let out = String::from_utf8_lossy(buf).into_owned();
            buf.clear();
            out
        }
    }
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.clamp(2, 1000), cols: cols.clamp(10, 2000), pixel_width: 0, pixel_height: 0 }
}

/// A shell a terminal tab can run, as `pty_shells` found it on this computer.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Shell {
    /// "pwsh" | "powershell" | "cmd" | "gitbash".
    pub id: String,
    pub name: String,
    pub program: String,
    pub args: Vec<String>,
}

fn on_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).map(|d| d.join(name)).find(|p| p.is_file())
}

fn env_dir(var: &str) -> Option<PathBuf> {
    std::env::var_os(var).map(PathBuf::from)
}

/// Git Bash beside the `git.exe` on PATH (`<Git>\cmd\git.exe` -> `<Git>\bin\bash.exe`), then the usual
/// install folders. Never a `bash.exe` from PATH: in System32 that is WSL's launcher.
fn git_bash() -> Option<PathBuf> {
    let beside_git = on_path("git.exe").and_then(|g| Some(g.parent()?.parent()?.join("bin").join("bash.exe")));
    let installed = ["ProgramFiles", "ProgramFiles(x86)"].into_iter().filter_map(env_dir).map(|d| d.join("Git").join("bin").join("bash.exe"));
    let per_user = env_dir("LOCALAPPDATA").map(|d| d.join("Programs").join("Git").join("bin").join("bash.exe"));
    beside_git.into_iter().chain(installed).chain(per_user).find(|p| p.is_file())
}

/// The shells installed here, best first: the first one is what "Automatic" starts.
pub fn shells() -> Vec<Shell> {
    let system = env_dir("SystemRoot").unwrap_or_else(|| PathBuf::from(r"C:\Windows")).join("System32");
    let pwsh = on_path("pwsh.exe").or_else(|| env_dir("ProgramFiles").map(|d| d.join("PowerShell").join("7").join("pwsh.exe")).filter(|p| p.is_file()));
    let powershell = Some(system.join("WindowsPowerShell").join("v1.0").join("powershell.exe")).filter(|p| p.is_file());
    let cmd = Some(system.join("cmd.exe")).filter(|p| p.is_file());
    let found = [
        ("pwsh", "PowerShell 7", pwsh, vec!["-NoLogo"]),
        ("powershell", "Windows PowerShell", powershell, vec!["-NoLogo"]),
        ("cmd", "Command Prompt", cmd, vec![]),
        ("gitbash", "Git Bash", git_bash(), vec!["--login", "-i"]),
    ];
    found
        .into_iter()
        .filter_map(|(id, name, program, args)| Some(Shell { id: id.into(), name: name.into(), program: program?.to_string_lossy().into_owned(), args: args.into_iter().map(String::from).collect() }))
        .collect()
}

#[tauri::command]
pub fn pty_shells() -> Vec<Shell> {
    shells()
}

/// The command for a shell tab: `argv` is the program and its arguments (one of `pty_shells`, or the
/// user's own command line from Settings).
fn shell_command(argv: &[String]) -> Result<CommandBuilder, String> {
    let program = argv.first().map(|p| p.trim()).filter(|p| !p.is_empty()).ok_or("No shell is set. Choose one in Settings > Terminal.")?;
    let mut c = CommandBuilder::new(program);
    c.args(&argv[1..]);
    // A login bash (Git Bash, MSYS2) changes to the home folder unless told to stay.
    if Path::new(program).file_stem().and_then(|s| s.to_str()).is_some_and(|s| s.eq_ignore_ascii_case("bash")) {
        c.env("CHERE_INVOKING", "1");
    }
    Ok(c)
}

/// Start a program in a terminal in `cwd` and return its id: with `command`, that command line
/// through cmd.exe (installing a language server); otherwise `shell` (program + arguments).
#[tauri::command]
pub fn pty_start(app: AppHandle, state: State<'_, crate::AppState>, cwd: String, cols: u16, rows: u16, command: Option<String>, shell: Option<Vec<String>>) -> Result<u32, String> {
    if !Path::new(&cwd).is_dir() {
        return Err(format!("{cwd} is not a folder"));
    }
    let (mut cmd, what) = if let Some(line) = command.filter(|c| !c.trim().is_empty()) {
        let mut c = CommandBuilder::new("cmd.exe");
        c.args(["/d", "/s", "/c", &line]);
        (c, "the command")
    } else {
        (shell_command(&shell.unwrap_or_default())?, "the shell")
    };
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    spawn(app, state, cmd, cols, rows, what)
}

fn spawn(app: AppHandle, state: State<'_, crate::AppState>, cmd: CommandBuilder, cols: u16, rows: u16, what: &str) -> Result<u32, String> {
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| e.to_string())?;
    let child = pair.slave.spawn_command(cmd).map_err(|e| format!("could not start {what}: {e}"))?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let id = state.terminals.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    state.terminals.terms.lock().insert(id, Term { master: pair.master, writer: crate::writer::ChannelWriter::spawn(writer, "pty-input"), child });

    let out = app.clone();
    std::thread::spawn(move || {
        let mut chunk = [0u8; 16 * 1024];
        let mut pending = Vec::new();
        loop {
            match reader.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.extend_from_slice(&chunk[..n]);
                    let data = take_utf8(&mut pending);
                    if !data.is_empty() {
                        let _ = out.emit("pty:data", Data { id, data });
                    }
                }
            }
        }
    });

    // ConPTY keeps its output pipe open after the program ends, so watch the process itself; ending
    // the pseudo console (dropping the master) then lets the reader finish.
    let terms = state.terminals.terms.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(150));
        let mut map = terms.lock();
        let Some(t) = map.get_mut(&id) else { break };
        if let Ok(Some(status)) = t.child.try_wait() {
            drop(map);
            std::thread::sleep(std::time::Duration::from_millis(120)); // let the last output through
            terms.lock().remove(&id);
            let _ = app.emit("pty:exit", Exit { id, code: status.exit_code() });
            break;
        }
    });
    Ok(id)
}

#[tauri::command]
pub fn pty_write(state: State<'_, crate::AppState>, id: u32, data: String) -> Result<(), String> {
    let map = state.terminals.terms.lock();
    let t = map.get(&id).ok_or("the terminal has ended")?;
    t.writer.send(data.into_bytes()).map_err(|_| "the terminal has ended".to_string())
}

#[tauri::command]
pub fn pty_resize(state: State<'_, crate::AppState>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let map = state.terminals.terms.lock();
    let t = map.get(&id).ok_or("the terminal has ended")?;
    t.master.resize(size(cols, rows)).map_err(|e| e.to_string())
}

fn kill(mut t: Term) {
    #[cfg(windows)]
    if let Some(pid) = t.child.process_id() {
        use std::os::windows::process::CommandExt;
        let ok = std::process::Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .creation_flags(0x0800_0000)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok {
            return;
        }
    }
    let _ = t.child.kill();
}

/// End a terminal and everything running in it (the tab closed).
#[tauri::command]
pub fn pty_kill(state: State<'_, crate::AppState>, id: u32) {
    let t = state.terminals.terms.lock().remove(&id);
    if let Some(t) = t {
        std::thread::spawn(move || kill(t));
    }
}

#[tauri::command]
pub fn pty_kill_all(state: State<'_, crate::AppState>) {
    let all: Vec<Term> = state.terminals.terms.lock().drain().map(|(_, t)| t).collect();
    crate::writer::run_all(all, kill);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_split_across_reads_is_kept_for_the_next_read() {
        let euro = "€".as_bytes(); // 3 bytes
        let mut buf = b"ab".to_vec();
        buf.extend_from_slice(&euro[..2]);
        assert_eq!(take_utf8(&mut buf), "ab");
        assert_eq!(buf, &euro[..2]);
        buf.extend_from_slice(&euro[2..]);
        assert_eq!(take_utf8(&mut buf), "€");
        assert!(buf.is_empty());
        let mut bad = vec![b'x', 0xff, b'y'];
        assert_eq!(take_utf8(&mut bad), "x\u{fffd}y");
        assert!(bad.is_empty());
    }

    #[test]
    fn the_shells_of_this_computer_exist_and_command_prompt_is_one() {
        let all = shells();
        assert!(all.iter().any(|s| s.id == "cmd"), "{all:?}");
        for s in &all {
            assert!(Path::new(&s.program).is_file(), "{s:?}");
        }
        // Never WSL's launcher for Git Bash.
        assert!(all.iter().all(|s| s.id != "gitbash" || !s.program.to_lowercase().contains("system32")));
        let ids: Vec<&str> = all.iter().map(|s| s.id.as_str()).collect();
        let mut sorted = ids.clone();
        sorted.sort_by_key(|id| ["pwsh", "powershell", "cmd", "gitbash"].iter().position(|x| x == id));
        assert_eq!(ids, sorted);
    }

    #[test]
    fn a_shell_needs_a_program_and_bash_keeps_its_folder() {
        assert!(shell_command(&[]).is_err());
        assert!(shell_command(&["  ".into()]).is_err());
        let bash = shell_command(&[r"C:\Program Files\Git\bin\bash.exe".into(), "--login".into(), "-i".into()]).unwrap();
        assert_eq!(bash.get_env("CHERE_INVOKING").and_then(|v| v.to_str()), Some("1"));
        assert_eq!(bash.get_argv().len(), 3);
        let cmd = shell_command(&["cmd.exe".into()]).unwrap();
        assert!(cmd.get_env("CHERE_INVOKING").is_none());
    }
}
