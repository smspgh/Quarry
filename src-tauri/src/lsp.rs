//! Language servers for code intelligence: each one runs as a child process speaking LSP over
//! stdio. Rust only frames messages (`Content-Length` headers) and passes the JSON through; the
//! client is `@codemirror/lsp-client` in the UI (src/lib/lsp.ts). Messages arrive as `lsp:msg`
//! events, then one `lsp:exit`.

use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct Servers {
    next_id: AtomicU32,
    procs: Mutex<HashMap<u32, Server>>,
}

struct Server {
    child: Arc<Mutex<Child>>,
    stdin: crate::writer::ChannelWriter,
}

#[derive(Clone, Serialize)]
struct Msg {
    id: u32,
    msg: String,
}

#[derive(Clone, Serialize)]
struct Exit {
    id: u32,
    code: Option<i32>,
    stderr: String,
}

/// A program on PATH the way Windows finds it from a command prompt: `name` as given if it has an
/// extension, else with each PATHEXT extension (`.exe`, `.cmd`, ...). npm installs servers as `.cmd`.
pub fn which(name: &str) -> Option<PathBuf> {
    let name = name.trim().trim_matches('"');
    if name.is_empty() {
        return None;
    }
    let p = Path::new(name);
    let exts: Vec<String> = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into()).split(';').filter(|e| !e.is_empty()).map(|e| e.to_ascii_lowercase()).collect();
    let candidates = |base: &Path| -> Vec<PathBuf> {
        if base.extension().is_some() && base.is_file() {
            return vec![base.to_path_buf()];
        }
        exts.iter().map(|e| PathBuf::from(format!("{}{e}", base.display()))).filter(|c| c.is_file()).collect()
    };
    if p.is_absolute() || name.contains(['\\', '/']) {
        return candidates(p).into_iter().next();
    }
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|v| std::env::split_paths(&v).collect()).unwrap_or_default();
    // Where npm, cargo, go and dotnet put tools, in case Quarry's PATH predates their install.
    for (var, sub) in [("APPDATA", "npm"), ("USERPROFILE", ".cargo\\bin"), ("USERPROFILE", "go\\bin"), ("USERPROFILE", ".dotnet\\tools")] {
        if let Some(base) = std::env::var_os(var) {
            dirs.push(PathBuf::from(base).join(sub));
        }
    }
    dirs.iter().find_map(|d| candidates(&d.join(name)).into_iter().next())
}

/// The project folder for a file: the nearest folder above it containing one of `markers`
/// (`package.json`, `Cargo.toml`, ...; a leading `*` matches by suffix, as in `*.csproj`), else
/// `fallback` (the open folder) when the file is inside it, else the file's folder. The search
/// stops at the open folder, and never picks a drive root or the user's home folder (a server
/// would index the whole disk).
pub fn find_root(file: &Path, markers: &[String], fallback: Option<&Path>) -> PathBuf {
    let start = file.parent().unwrap_or(file);
    let lower = |p: &Path| p.to_string_lossy().to_lowercase().trim_end_matches(['\\', '/']).to_string();
    let inside = fallback.filter(|f| lower(start).starts_with(&lower(f)));
    let home = std::env::var_os("USERPROFILE").map(|h| lower(Path::new(&h)));
    let too_wide = |d: &Path| d.parent().is_none() || home.as_deref() == Some(lower(d).as_str());
    let matches = |dir: &Path| -> bool {
        markers.iter().any(|m| {
            if let Some(ext) = m.strip_prefix('*') {
                std::fs::read_dir(dir).map(|rd| rd.flatten().any(|e| e.file_name().to_string_lossy().to_ascii_lowercase().ends_with(&ext.to_ascii_lowercase()))).unwrap_or(false)
            } else {
                dir.join(m).exists()
            }
        })
    };
    for dir in start.ancestors() {
        if too_wide(dir) {
            break;
        }
        if matches(dir) {
            return dir.to_path_buf();
        }
        if inside.is_some_and(|f| lower(dir) == lower(f)) {
            break;
        }
    }
    match inside {
        Some(f) if !too_wide(f) => f.to_path_buf(),
        _ => start.to_path_buf(),
    }
}

/// Read one LSP message (headers, blank line, `Content-Length` bytes of JSON). None at end of input.
pub fn read_message(r: &mut impl BufRead) -> std::io::Result<Option<String>> {
    let mut len: Option<usize> = None;
    let mut line = String::new();
    loop {
        line.clear();
        if r.read_line(&mut line)? == 0 {
            return Ok(None);
        }
        let l = line.trim_end();
        if l.is_empty() {
            if len.is_some() {
                break;
            }
            continue; // stray blank line before the headers
        }
        if let Some((k, v)) = l.split_once(':')
            && k.trim().eq_ignore_ascii_case("content-length")
        {
            len = v.trim().parse().ok();
        }
    }
    let mut body = vec![0u8; len.unwrap_or(0)];
    r.read_exact(&mut body)?;
    Ok(Some(String::from_utf8_lossy(&body).into_owned()))
}

pub fn frame(msg: &str) -> Vec<u8> {
    let mut out = format!("Content-Length: {}\r\n\r\n", msg.len()).into_bytes();
    out.extend_from_slice(msg.as_bytes());
    out
}

/// Where a server program is (for Settings), or None.
#[tauri::command]
pub fn lsp_which(command: String) -> Option<String> {
    which(&command).map(|p| p.to_string_lossy().into_owned())
}

#[derive(Serialize, Debug, PartialEq)]
pub struct TsSetup {
    /// The server program and its arguments.
    pub command: String,
    pub args: Vec<String>,
    /// For typescript-language-server: the TypeScript `lib` folder to use when the project has none.
    pub tsserver: Option<String>,
}

/// How to run TypeScript's language server for a project. TypeScript 7 (the native compiler) has
/// one built in (`tsc --lsp --stdio`); earlier versions need typescript-language-server, which
/// drives their `tsserver.js`. The project's own TypeScript wins over the global one.
pub fn typescript_setup(root: &Path, global: Option<&Path>, tsls: Option<PathBuf>) -> Option<TsSetup> {
    let tsls_with = |tsserver: Option<&Path>| {
        tsls.as_ref().map(|p| TsSetup { command: p.to_string_lossy().into_owned(), args: vec!["--stdio".into()], tsserver: tsserver.map(|t| t.to_string_lossy().into_owned()) })
    };
    let native = |tsc: PathBuf| TsSetup { command: tsc.to_string_lossy().into_owned(), args: vec!["--lsp".into(), "--stdio".into()], tsserver: None };
    let local = root.join("node_modules").join("typescript").join("lib");
    if local.join("tsserver.js").is_file()
        && let Some(s) = tsls_with(None)
    {
        return Some(s);
    }
    if local.join("getExePath.js").is_file() {
        let bin = root.join("node_modules").join(".bin");
        if let Some(tsc) = ["tsc.cmd", "tsc.exe"].iter().map(|n| bin.join(n)).find(|p| p.is_file()) {
            return Some(native(tsc));
        }
    }
    let global = global?;
    let lib = global.join("lib");
    if lib.join("tsserver.js").is_file() {
        return tsls_with(Some(&lib));
    }
    if lib.join("getExePath.js").is_file() {
        // The tsc next to that package (npm's global folder), not whichever tsc is first on PATH.
        let npm_dir = global.parent().and_then(Path::parent);
        let tsc = npm_dir.and_then(|d| ["tsc.cmd", "tsc.exe"].iter().map(|n| d.join(n)).find(|p| p.is_file()));
        return tsc.or_else(|| which("tsc")).map(native);
    }
    None
}

#[tauri::command]
pub fn lsp_typescript(root: String) -> Option<TsSetup> {
    let global = std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("npm").join("node_modules").join("typescript"));
    typescript_setup(Path::new(&root), global.as_deref(), which("typescript-language-server"))
}

#[tauri::command]
pub async fn lsp_find_root(file: String, markers: Vec<String>, fallback: Option<String>) -> String {
    tauri::async_runtime::spawn_blocking(move || find_root(Path::new(&file), &markers, fallback.as_deref().map(Path::new)).to_string_lossy().into_owned())
        .await
        .unwrap_or_default()
}

/// Start a language server in `cwd`. Returns its id.
#[tauri::command]
pub fn lsp_start(app: AppHandle, state: State<'_, crate::AppState>, command: String, args: Vec<String>, cwd: String) -> Result<u32, String> {
    let exe = which(&command).ok_or_else(|| format!("{command} is not installed (not found on PATH)"))?;
    let is_script = exe.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"));
    let mut cmd = if is_script {
        let mut c = Command::new("cmd.exe");
        c.arg("/d").arg("/c").arg(&exe);
        c
    } else {
        Command::new(&exe)
    };
    cmd.args(&args).current_dir(&cwd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    for v in crate::claude::SESSION_ENV {
        cmd.env_remove(v);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| format!("could not start {}: {e}", exe.display()))?;
    let stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let mut stderr = child.stderr.take().ok_or("no stderr")?;
    let child = Arc::new(Mutex::new(child));
    let id = state.lsp.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    state.lsp.procs.lock().insert(id, Server { child: child.clone(), stdin: crate::writer::ChannelWriter::spawn(stdin, "lsp-stdin") });

    let tail = Arc::new(Mutex::new(String::new()));
    let t = tail.clone();
    let err_thread = std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while let Ok(n) = stderr.read(&mut buf) {
            if n == 0 {
                break;
            }
            let mut s = t.lock();
            s.push_str(&String::from_utf8_lossy(&buf[..n]));
            if s.len() > 8192 {
                let cut = s.len() - 4096;
                let cut = (cut..s.len()).find(|&i| s.is_char_boundary(i)).unwrap_or(s.len());
                s.drain(..cut);
            }
        }
    });
    std::thread::spawn(move || {
        let mut r = BufReader::new(stdout);
        while let Ok(Some(msg)) = read_message(&mut r) {
            let _ = app.emit("lsp:msg", Msg { id, msg });
        }
        let code = loop {
            match child.lock().try_wait() {
                Ok(Some(st)) => break st.code(),
                Ok(None) => {}
                Err(_) => break None,
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        };
        let _ = err_thread.join();
        if let Some(st) = tauri::Manager::try_state::<crate::AppState>(&app) {
            st.lsp.procs.lock().remove(&id);
        }
        let stderr = tail.lock().trim().to_string();
        let _ = app.emit("lsp:exit", Exit { id, code, stderr });
    });
    Ok(id)
}

#[tauri::command]
pub fn lsp_send(state: State<'_, crate::AppState>, id: u32, msg: String) -> Result<(), String> {
    let procs = state.lsp.procs.lock();
    let s = procs.get(&id).ok_or("the language server has stopped")?;
    s.stdin.send(frame(&msg)).map_err(|_| "the language server has stopped reading".to_string())
}

fn kill(s: Server) {
    drop(s.stdin);
    let mut c = s.child.lock();
    if let Ok(Some(_)) = c.try_wait() {
        return;
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let ok = Command::new("taskkill")
            .args(["/T", "/F", "/PID", &c.id().to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x0800_0000)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok {
            return;
        }
    }
    let _ = c.kill();
}

#[tauri::command]
pub fn lsp_stop(state: State<'_, crate::AppState>, id: u32) {
    let s = state.lsp.procs.lock().remove(&id);
    if let Some(s) = s {
        std::thread::spawn(move || kill(s));
    }
}

#[tauri::command]
pub fn lsp_stop_all(state: State<'_, crate::AppState>) {
    let all: Vec<Server> = state.lsp.procs.lock().drain().map(|(_, s)| s).collect();
    crate::writer::run_all(all, kill);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_round_trip() {
        let a = r#"{"jsonrpc":"2.0","id":1,"result":"é"}"#;
        let b = r#"{"jsonrpc":"2.0","method":"x"}"#;
        let mut bytes = frame(a);
        bytes.extend(b"Content-Type: application/vscode-jsonrpc; charset=utf-8\r\n");
        bytes.extend(frame(b));
        let mut r = std::io::Cursor::new(bytes);
        assert_eq!(read_message(&mut r).unwrap().as_deref(), Some(a));
        assert_eq!(read_message(&mut r).unwrap().as_deref(), Some(b));
        assert_eq!(read_message(&mut r).unwrap(), None);
    }

    #[test]
    fn roots_come_from_marker_files() {
        let dir = tempfile::tempdir().unwrap();
        let proj = dir.path().join("proj");
        let src = proj.join("src").join("deep");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(proj.join("package.json"), "{}").unwrap();
        std::fs::write(proj.join("App.csproj"), "").unwrap();
        let file = src.join("a.ts");
        assert_eq!(find_root(&file, &["package.json".into()], None), proj);
        assert_eq!(find_root(&file, &["*.csproj".into()], None), proj);
        // No marker: the open folder when the file is inside it, else the file's folder.
        assert_eq!(find_root(&file, &["nothing.here".into()], Some(dir.path())), dir.path());
        assert_eq!(find_root(&file, &["nothing.here".into()], None), src);
        // The search stops at the open folder: a marker above it doesn't count.
        std::fs::write(dir.path().join("pyproject.toml"), "").unwrap();
        assert_eq!(find_root(&src.join("x.py"), &["pyproject.toml".into()], Some(&proj)), proj);
        // A marker in the drive root (C:\Windows exists) never makes the whole drive the project.
        let deep = Path::new(r"C:\Users\nobody-here\x\a.py");
        assert_eq!(find_root(deep, &["Windows".into()], None), Path::new(r"C:\Users\nobody-here\x"));
    }

    #[test]
    fn typescript_server_follows_the_installed_version() {
        let dir = tempfile::tempdir().unwrap();
        let proj = dir.path().join("p");
        let global = dir.path().join("g");
        std::fs::create_dir_all(proj.join("node_modules").join(".bin")).unwrap();
        std::fs::create_dir_all(global.join("lib")).unwrap();
        let tsls = Some(PathBuf::from(r"C:\npm\typescript-language-server.cmd"));
        // Nothing installed.
        assert_eq!(typescript_setup(&proj, Some(&global), tsls.clone()), None);
        // Global TypeScript 5: typescript-language-server with the global tsserver.
        std::fs::write(global.join("lib").join("tsserver.js"), "").unwrap();
        let s = typescript_setup(&proj, Some(&global), tsls.clone()).unwrap();
        assert_eq!(s.args, vec!["--stdio"]);
        assert_eq!(s.tsserver.as_deref(), Some(global.join("lib").to_string_lossy().as_ref()));
        // ... but not without typescript-language-server.
        assert_eq!(typescript_setup(&proj, Some(&global), None), None);
        // The project's TypeScript 7 wins: its own tsc --lsp.
        let lib = proj.join("node_modules").join("typescript").join("lib");
        std::fs::create_dir_all(&lib).unwrap();
        std::fs::write(lib.join("getExePath.js"), "").unwrap();
        std::fs::write(proj.join("node_modules").join(".bin").join("tsc.cmd"), "").unwrap();
        let s = typescript_setup(&proj, Some(&global), tsls).unwrap();
        assert!(s.command.ends_with("tsc.cmd"));
        assert_eq!(s.args, vec!["--lsp", "--stdio"]);
    }

    #[test]
    fn which_finds_cmd_shims() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("tool.cmd"), "@echo off").unwrap();
        let found = which(&dir.path().join("tool").to_string_lossy()).unwrap();
        assert!(found.to_string_lossy().to_lowercase().ends_with("tool.cmd"));
        assert!(which(&dir.path().join("missing").to_string_lossy()).is_none());
    }
}
