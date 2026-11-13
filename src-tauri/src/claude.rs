//! Claude Code sessions: one headless `claude` process per Claude tab, talking stream-json over
//! stdin / stdout. Rust only starts, feeds and stops the process; each stdout line is forwarded to
//! the UI as-is (`claude:out`), which parses the events (src/lib/claudeProtocol.ts).

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct Sessions {
    next_id: AtomicU32,
    procs: Mutex<HashMap<u32, Proc>>,
}

struct Proc {
    child: Arc<Mutex<Child>>,
    stdin: crate::writer::ChannelWriter,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartArgs {
    /// The `claude` executable from Settings; empty = look it up (see `find_exe`).
    #[serde(default)]
    pub exe: String,
    pub cwd: String,
    #[serde(default)]
    pub model: String,
    /// `default` (ask before edits) or `acceptEdits`.
    #[serde(default)]
    pub permission_mode: String,
    /// Session id to continue (`--resume`).
    #[serde(default)]
    pub resume: Option<String>,
}

#[derive(Clone, Serialize)]
struct OutLine {
    id: u32,
    line: String,
}

#[derive(Clone, Serialize)]
struct Exit {
    id: u32,
    code: Option<i32>,
    /// The end of what the process wrote to stderr (why it failed to start, usually).
    stderr: String,
}

#[derive(Serialize)]
pub struct Detected {
    pub path: String,
    pub version: String,
}

/// Command-line arguments for a session. Permission prompts (and AskUserQuestion, which the tab
/// answers with the user's choices) come to us as `can_use_tool` control requests
/// (`--permission-prompt-tool stdio`).
pub fn build_args(a: &StartArgs) -> Vec<String> {
    let mut args: Vec<String> = [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--permission-prompt-tool",
        "stdio",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    let mode = match a.permission_mode.as_str() {
        "default" => "default",
        _ => "acceptEdits",
    };
    args.extend(["--permission-mode".into(), mode.into()]);
    let model = a.model.trim();
    if !model.is_empty() {
        args.extend(["--model".into(), model.into()]);
    }
    if let Some(id) = a.resume.as_deref().filter(|s| is_session_id(s)) {
        args.extend(["--resume".into(), id.into()]);
    }
    args
}

/// Session ids are UUIDs; anything else is not passed on the command line.
pub(crate) fn is_session_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// `claude` on PATH (claude.exe from the native installer, or npm's claude.cmd), then the usual
/// install folders, which a GUI app's PATH may not include.
pub fn find_exe(hint: &str) -> Option<PathBuf> {
    let hint = hint.trim().trim_matches('"');
    if !hint.is_empty() {
        let p = PathBuf::from(hint);
        return p.is_file().then_some(p);
    }
    let names = ["claude.exe", "claude.cmd"];
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            for n in names {
                let p = dir.join(n);
                if p.is_file() {
                    return Some(p);
                }
            }
        }
    }
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from);
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from);
    [home.map(|h| h.join(".local").join("bin").join("claude.exe")), appdata.map(|a| a.join("npm").join("claude.cmd"))]
        .into_iter()
        .flatten()
        .find(|p| p.is_file())
}

/// Variables a running Claude Code session sets for the programs it starts. When Quarry itself was
/// started from one (a dev build run by Claude), the sessions Quarry starts would otherwise think
/// they are nested in it (and, for example, stop saving their transcripts). User configuration
/// such as CLAUDE_CODE_USE_BEDROCK is kept.
pub const SESSION_ENV: &[&str] = &[
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_SSE_PORT",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_SESSION_ATTENDED",
    "CLAUDE_CODE_BRIDGE_SESSION_ID",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_CODE_EXECPATH",
    "CLAUDE_PID",
    "CLAUDE_EFFORT",
    "AI_AGENT",
];

fn command(exe: &Path) -> Command {
    let mut cmd = Command::new(exe);
    for v in SESSION_ENV {
        cmd.env_remove(v);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

/// Where `claude` is and its version, for Settings.
#[tauri::command]
pub async fn claude_detect(exe: String) -> Result<Detected, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = find_exe(&exe).ok_or_else(|| {
            if exe.trim().is_empty() { "Claude Code was not found on PATH".to_string() } else { format!("{} does not exist", exe.trim()) }
        })?;
        let out = command(&path).arg("--version").stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
        let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
        Ok(Detected { path: path.to_string_lossy().into_owned(), version })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Start a session in `cwd`; returns its id. Output arrives as `claude:out` events, one per line,
/// then a single `claude:exit`.
#[tauri::command]
pub fn claude_start(app: AppHandle, state: State<'_, crate::AppState>, args: StartArgs) -> Result<u32, String> {
    let exe = find_exe(&args.exe).ok_or_else(|| {
        if args.exe.trim().is_empty() {
            "Claude Code was not found. Install it, or set its location in Settings › Claude Code.".to_string()
        } else {
            format!("Claude Code was not found at {}. Check Settings › Claude Code.", args.exe.trim())
        }
    })?;
    if !Path::new(&args.cwd).is_dir() {
        return Err(format!("{} is not a folder", args.cwd));
    }
    let mut child = command(&exe)
        .args(build_args(&args))
        .current_dir(&args.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start Claude Code ({}): {e}", exe.display()))?;
    let sessions = &state.claude;
    let id = sessions.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    let stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let mut stderr = child.stderr.take().ok_or("no stderr")?;
    let child = Arc::new(Mutex::new(child));
    sessions.procs.lock().insert(id, Proc { child: child.clone(), stdin: crate::writer::ChannelWriter::spawn(stdin, "claude-stdin") });

    let err_tail = Arc::new(Mutex::new(String::new()));
    let tail = err_tail.clone();
    let err_reader = std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while let Ok(n) = stderr.read(&mut buf) {
            if n == 0 {
                break;
            }
            let mut t = tail.lock();
            t.push_str(&String::from_utf8_lossy(&buf[..n]));
            if t.len() > 8192 {
                let cut = t.len() - 4096;
                let cut = (cut..t.len()).find(|&i| t.is_char_boundary(i)).unwrap_or(t.len());
                t.drain(..cut);
            }
        }
    });

    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = Vec::new();
        loop {
            line.clear();
            match reader.read_until(b'\n', &mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let text = String::from_utf8_lossy(&line);
                    let text = text.trim_end();
                    if !text.is_empty() {
                        let _ = app.emit("claude:out", OutLine { id, line: text.to_string() });
                    }
                }
            }
        }
        // stdout closes when the process ends; wait for it so the exit code is known.
        let code = loop {
            if let Ok(Some(st)) = child.lock().try_wait() {
                break st.code();
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        };
        let _ = err_reader.join();
        let stderr = err_tail.lock().trim().to_string();
        if let Some(state) = tauri::Manager::try_state::<crate::AppState>(&app) {
            state.claude.procs.lock().remove(&id);
        }
        let _ = app.emit("claude:exit", Exit { id, code, stderr });
    });
    Ok(id)
}

/// Write one JSON message (a line) to a session's stdin.
#[tauri::command]
pub fn claude_send(state: State<'_, crate::AppState>, id: u32, line: String) -> Result<(), String> {
    let procs = state.claude.procs.lock();
    let p = procs.get(&id).ok_or("the Claude Code session has ended")?;
    let mut bytes = line.into_bytes();
    bytes.retain(|&b| b != b'\n' && b != b'\r');
    bytes.push(b'\n');
    p.stdin.send(bytes).map_err(|_| "the Claude Code session has stopped reading".to_string())
}

/// End a session: the process and anything it started (a running shell command).
#[tauri::command]
pub fn claude_stop(state: State<'_, crate::AppState>, id: u32) {
    let p = state.claude.procs.lock().remove(&id);
    // taskkill takes a moment; don't hold up the window for it.
    if let Some(p) = p {
        std::thread::spawn(move || kill_tree(&p.child));
    }
}

/// End every session (the window is closing).
#[tauri::command]
pub fn claude_stop_all(state: State<'_, crate::AppState>) {
    let all: Vec<Proc> = state.claude.procs.lock().drain().map(|(_, p)| p).collect();
    crate::writer::run_all(all, |p| kill_tree(&p.child));
}

// ---------- conversation history (Claude Code's own transcripts) ----------

/// `~/.claude` (or `CLAUDE_CONFIG_DIR`), where Claude Code keeps a JSONL transcript per conversation
/// under `projects/<folder slug>/<session id>.jsonl`.
fn config_dir() -> Option<PathBuf> {
    std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).or_else(|| std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join(".claude")))
}

/// Claude Code's folder name for a working directory: every character other than a letter or a
/// digit becomes `-` (`C:\a_b` → `C--a-b`).
pub fn project_slug(cwd: &str) -> String {
    cwd.trim_end_matches(['\\', '/']).chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub modified_ms: u64,
    /// The first thing the user asked (what the list shows).
    pub title: String,
    pub size: u64,
}

const TITLE_SCAN: usize = 512 * 1024;

/// Text of a transcript line's user prompt, if it is one (not a tool result, meta line or sub-agent).
pub fn prompt_text(v: &serde_json::Value) -> Option<String> {
    if v.get("type")?.as_str()? != "user" || v.get("isMeta").and_then(|x| x.as_bool()) == Some(true) || v.get("isSidechain").and_then(|x| x.as_bool()) == Some(true) {
        return None;
    }
    let content = v.get("message")?.get("content")?;
    let text = match content {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(blocks) => {
            if blocks.iter().any(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_result")) {
                return None;
            }
            let texts: Vec<&str> = blocks.iter().filter_map(|b| b.get("text").and_then(|t| t.as_str())).filter(|t| !t.starts_with('<')).collect();
            if texts.is_empty() && blocks.iter().any(|b| b.get("type").and_then(|t| t.as_str()) == Some("image")) {
                return Some("(image)".into());
            }
            texts.join(" ")
        }
        _ => return None,
    };
    let t = text.trim();
    (!t.is_empty() && !t.starts_with('<') && !t.starts_with("[Request interrupted")).then(|| t.to_string())
}

fn conversation(path: &Path) -> Option<Conversation> {
    let meta = std::fs::metadata(path).ok()?;
    let id = path.file_stem()?.to_str()?.to_string();
    if !is_session_id(&id) {
        return None;
    }
    let modified_ms = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as u64;
    let mut head = Vec::new();
    std::fs::File::open(path).ok()?.take(TITLE_SCAN as u64).read_to_end(&mut head).ok()?;
    let title = String::from_utf8_lossy(&head)
        .lines()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .find_map(|v| prompt_text(&v))?;
    let title: String = title.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(160).collect();
    Some(Conversation { id, modified_ms, title, size: meta.len() })
}

/// Past conversations in a folder, newest first (those with no prompt, such as aborted starts, are left out).
#[tauri::command]
pub async fn claude_conversations(cwd: String) -> Result<Vec<Conversation>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(dir) = config_dir().map(|d| d.join("projects").join(project_slug(&cwd))) else { return Ok(vec![]) };
        let Ok(entries) = std::fs::read_dir(&dir) else { return Ok(vec![]) };
        let mut files: Vec<(std::time::SystemTime, PathBuf)> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("jsonl"))
            .filter_map(|p| Some((std::fs::metadata(&p).ok()?.modified().ok()?, p)))
            .collect();
        files.sort_by_key(|f| std::cmp::Reverse(f.0));
        Ok(files.iter().take(60).filter_map(|(_, p)| conversation(p)).collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct History {
    /// The transcript's user / assistant lines (main thread only), oldest first.
    pub lines: Vec<String>,
    /// Older lines were left out (very long conversations).
    pub truncated: bool,
}

const HISTORY_MAX: usize = 24 * 1024 * 1024;

/// The messages of a past conversation, for showing it again (resumed tabs, the history list).
#[tauri::command]
pub async fn claude_history(cwd: String, id: String) -> Result<History, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !is_session_id(&id) {
            return Err("invalid conversation id".to_string());
        }
        let projects = config_dir().ok_or("no home folder")?.join("projects");
        let file = format!("{id}.jsonl");
        let mut path = projects.join(project_slug(&cwd)).join(&file);
        if !path.is_file() {
            // The folder may have been spelled differently when the conversation started.
            path = std::fs::read_dir(&projects).map_err(|e| e.to_string())?.flatten().map(|e| e.path().join(&file)).find(|p| p.is_file()).ok_or("this conversation is no longer in Claude Code's history")?;
        }
        let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let mut lines: Vec<&str> = text
            .lines()
            .filter(|l| l.contains("\"type\":\"user\"") || l.contains("\"type\":\"assistant\""))
            .filter(|l| {
                serde_json::from_str::<serde_json::Value>(l)
                    .map(|v| matches!(v.get("type").and_then(|t| t.as_str()), Some("user" | "assistant")) && v.get("isSidechain").and_then(|x| x.as_bool()) != Some(true) && v.get("isMeta").and_then(|x| x.as_bool()) != Some(true))
                    .unwrap_or(false)
            })
            .collect();
        let mut total = 0;
        let mut keep = lines.len();
        while keep > 0 && total + lines[keep - 1].len() <= HISTORY_MAX {
            total += lines[keep - 1].len();
            keep -= 1;
        }
        let truncated = keep > 0;
        lines.drain(..keep);
        Ok(History { lines: lines.into_iter().map(String::from).collect(), truncated })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageData {
    pub media_type: String,
    /// Base64 of the file.
    pub data: String,
}

/// Larger files are refused: the tab scales pictures down before sending them anyway.
const IMAGE_MAX: u64 = 40 * 1024 * 1024;

/// An image file to attach to a message (picked with Browse or dropped on the tab).
#[tauri::command]
pub async fn claude_read_image(path: String) -> Result<ImageData, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = Path::new(&path);
        let media_type = image_type(p).ok_or("not a PNG, JPEG, GIF or WebP image")?;
        let len = std::fs::metadata(p).map_err(|e| e.to_string())?.len();
        if len > IMAGE_MAX {
            return Err(format!("the image is too large ({} MB)", len / (1024 * 1024)));
        }
        let bytes = std::fs::read(p).map_err(|e| e.to_string())?;
        Ok(ImageData { media_type: media_type.to_string(), data: base64(&bytes) })
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn image_type(p: &Path) -> Option<&'static str> {
    match p.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

pub fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

fn kill_tree(child: &Arc<Mutex<Child>>) {
    let mut c = child.lock();
    if let Ok(Some(_)) = c.try_wait() {
        return;
    }
    #[cfg(windows)]
    {
        let pid = c.id().to_string();
        let mut tk = Command::new("taskkill");
        tk.args(["/T", "/F", "/PID", &pid]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        use std::os::windows::process::CommandExt;
        tk.creation_flags(0x0800_0000);
        if tk.status().map(|s| s.success()).unwrap_or(false) {
            return;
        }
    }
    let _ = c.kill();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(mode: &str, model: &str, resume: Option<&str>) -> Vec<String> {
        build_args(&StartArgs { exe: String::new(), cwd: ".".into(), model: model.into(), permission_mode: mode.into(), resume: resume.map(String::from) })
    }

    fn after<'a>(a: &'a [String], flag: &str) -> Option<&'a str> {
        a.iter().position(|x| x == flag).map(|i| a[i + 1].as_str())
    }

    #[test]
    fn headless_stream_json_with_host_permission_prompts() {
        let a = args("", "", None);
        assert_eq!(after(&a, "--input-format"), Some("stream-json"));
        assert_eq!(after(&a, "--output-format"), Some("stream-json"));
        assert_eq!(after(&a, "--permission-prompt-tool"), Some("stdio"));
        assert!(a.contains(&"--include-partial-messages".to_string()));
        assert!(!a.contains(&"--model".to_string()));
        assert!(!a.contains(&"--resume".to_string()));
    }

    #[test]
    fn permission_mode_defaults_to_accept_edits() {
        assert_eq!(after(&args("", "", None), "--permission-mode"), Some("acceptEdits"));
        assert_eq!(after(&args("default", "", None), "--permission-mode"), Some("default"));
        // Nothing else (bypassPermissions) gets through.
        assert_eq!(after(&args("bypassPermissions", "", None), "--permission-mode"), Some("acceptEdits"));
    }

    #[test]
    fn model_and_resume() {
        let a = args("acceptEdits", " sonnet ", Some("8a472df2-81a0-47b8-8720-b17e2df22a0d"));
        assert_eq!(after(&a, "--model"), Some("sonnet"));
        assert_eq!(after(&a, "--resume"), Some("8a472df2-81a0-47b8-8720-b17e2df22a0d"));
        assert!(!args("", "", Some("--dangerously-skip-permissions")).contains(&"--resume".to_string()));
    }

    #[test]
    fn base64_matches_the_standard_alphabet_and_padding() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(&[0xff, 0xfe, 0x00, 0x10]), "//4AEA==");
        assert_eq!(image_type(Path::new("a.PNG")), Some("image/png"));
        assert_eq!(image_type(Path::new("a.txt")), None);
    }

    #[test]
    fn project_folder_names_match_claude_code() {
        assert_eq!(project_slug(r"C:\coding_projects\Quarry"), "C--coding-projects-Quarry");
        assert_eq!(project_slug(r"C:\Users\me\My Stuff\"), "C--Users-me-My-Stuff");
    }

    #[test]
    fn titles_come_from_real_prompts_only() {
        let v = |s: &str| serde_json::from_str::<serde_json::Value>(s).unwrap();
        assert_eq!(prompt_text(&v(r#"{"type":"user","message":{"content":[{"type":"text","text":"Fix the bug"}]}}"#)), Some("Fix the bug".into()));
        assert_eq!(prompt_text(&v(r#"{"type":"user","message":{"content":"plain"}}"#)), Some("plain".into()));
        assert_eq!(prompt_text(&v(r#"{"type":"user","isMeta":true,"message":{"content":"x"}}"#)), None);
        assert_eq!(prompt_text(&v(r#"{"type":"user","message":{"content":[{"type":"tool_result","content":"x"}]}}"#)), None);
        assert_eq!(prompt_text(&v(r#"{"type":"user","message":{"content":[{"type":"image"}]}}"#)), Some("(image)".into()));
        assert_eq!(prompt_text(&v(r#"{"type":"assistant","message":{"content":"x"}}"#)), None);
    }

    #[test]
    fn explicit_exe_must_exist() {
        assert!(find_exe(r"C:\definitely\not\here\claude.exe").is_none());
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join("claude.exe");
        std::fs::write(&exe, b"").unwrap();
        assert_eq!(find_exe(&format!("\"{}\"", exe.display())), Some(exe));
    }
}
