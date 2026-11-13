//! Terminal tabs: the real `claude` command line in a ConPTY (portable-pty), drawn by xterm.js in
//! the UI. Output goes to the UI as `pty:data` events (UTF-8, never split inside a character), then
//! one `pty:exit`.

use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
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

/// Start `claude` in a terminal in `cwd` (`resume`: continue that conversation), or, with
/// `command`, that command line through cmd.exe (installing a language server). Returns its id.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn pty_start(app: AppHandle, state: State<'_, crate::AppState>, exe: String, cwd: String, cols: u16, rows: u16, resume: Option<String>, command: Option<String>) -> Result<u32, String> {
    if !Path::new(&cwd).is_dir() {
        return Err(format!("{cwd} is not a folder"));
    }
    let mut cmd = if let Some(line) = command.filter(|c| !c.trim().is_empty()) {
        let mut c = CommandBuilder::new("cmd.exe");
        c.args(["/d", "/s", "/c", &line]);
        c
    } else {
        claude_command(&exe, resume)?
    };
    cmd.cwd(&cwd);
    for v in crate::claude::SESSION_ENV {
        cmd.env_remove(v);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    spawn(app, state, cmd, cols, rows)
}

fn claude_command(exe: &str, resume: Option<String>) -> Result<CommandBuilder, String> {
    let exe = crate::claude::find_exe(exe).ok_or("Claude Code was not found. Install it, or set its location in Settings › Claude Code.")?;
    let is_cmd = exe.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("cmd"));
    let mut cmd = if is_cmd {
        let mut c = CommandBuilder::new("cmd.exe");
        c.args(["/d", "/c"]);
        c.arg(&exe);
        c
    } else {
        CommandBuilder::new(&exe)
    };
    if let Some(id) = resume_id(resume) {
        cmd.args(["--resume", &id]);
    }
    Ok(cmd)
}

/// The conversation to resume, when it is a session id (the same check as Claude tabs).
fn resume_id(resume: Option<String>) -> Option<String> {
    resume.filter(|s| crate::claude::is_session_id(s))
}

fn spawn(app: AppHandle, state: State<'_, crate::AppState>, cmd: CommandBuilder, cols: u16, rows: u16) -> Result<u32, String> {
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| e.to_string())?;
    let child = pair.slave.spawn_command(cmd).map_err(|e| format!("could not start Claude Code: {e}"))?;
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
    fn only_session_ids_are_resumed() {
        let id = "8a472df2-81a0-47b8-8720-b17e2df22a0d";
        assert_eq!(resume_id(Some(id.into())).as_deref(), Some(id));
        assert_eq!(resume_id(Some("--dangerously-skip-permissions".into())), None);
        assert_eq!(resume_id(Some(String::new())), None);
        assert_eq!(resume_id(Some("a".repeat(65))), None);
        assert_eq!(resume_id(None), None);
    }
}
