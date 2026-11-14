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
    /// One-off requests of the git helpers (`claude_oneshot`), by the id the UI gave them.
    oneshots: Mutex<HashMap<u32, Arc<Mutex<Child>>>>,
    /// Requests stopped before their process was started.
    oneshot_cancelled: Mutex<std::collections::HashSet<u32>>,
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
    // A running git-helper request ends with them.
    let oneshots: Vec<Arc<Mutex<Child>>> = state.claude.oneshots.lock().drain().map(|(_, c)| c).collect();
    for c in &oneshots {
        kill_tree(c);
    }
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

// ---------- one-off requests (the Claude git helpers, specs/git-claude.md) ----------

/// What every one-off request is told first. It stays one line without quotes or percent signs:
/// npm's `claude.cmd` is a batch file, and such an argument passes through cmd.exe unchanged.
pub const ONESHOT_SYSTEM: &str = "You are a git assistant built into the Quarry text editor. Work only from the text in the message: you have no tools and cannot read files or run commands. Reply with exactly what the message asks for and nothing else.";

/// Command-line arguments of a one-off request, checked against Claude Code 2.1.325: print mode
/// with one JSON result, every built-in tool off (`--tools ""`), no MCP servers, no skills or
/// commands, no CLAUDE.md / hooks / plugins (`--safe-mode`, which leaves sign-in and model choice
/// alone; `--bare` would not use the user's login), nothing saved to the conversation history, and
/// Quarry's own short system prompt. With no tools there is nothing to take a second turn for, so
/// no turn limit is passed. The prompt itself goes in on stdin.
pub fn oneshot_args(model: &str) -> Vec<String> {
    let mut args: Vec<String> =
        ["-p", "--output-format", "json", "--tools", "", "--strict-mcp-config", "--disable-slash-commands", "--safe-mode", "--no-session-persistence", "--system-prompt", ONESHOT_SYSTEM].iter().map(|s| s.to_string()).collect();
    let model = model.trim();
    // A model alias or name only: nothing that could be read as another option.
    if !model.is_empty() && !model.starts_with('-') && model.chars().all(|c| c.is_ascii_alphanumeric() || "-._:[]".contains(c)) {
        args.extend(["--model".into(), model.into()]);
    }
    args
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OneshotArgs {
    /// The UI's id for this request (what `claude_oneshot_cancel` names).
    pub id: u32,
    /// The `claude` executable from Settings; empty = look it up.
    #[serde(default)]
    pub exe: String,
    #[serde(default)]
    pub model: String,
    pub prompt: String,
    pub timeout_secs: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OneshotResult {
    pub stdout: String,
    /// The end of what the process wrote to stderr.
    pub stderr: String,
    pub code: Option<i32>,
    /// It was ended because it ran longer than the time limit.
    pub timed_out: bool,
    /// It was ended by `claude_oneshot_cancel` (or the window closing).
    pub cancelled: bool,
}

/// An empty folder of Quarry's own to run one-off requests in, so Claude Code is never started
/// inside the repository (nothing of it is read, and nothing lands in its conversation history).
fn oneshot_dir() -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("quarry-claude-git");
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    Ok(dir)
}

fn read_all(mut r: impl Read + Send + 'static) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut out = Vec::new();
        let _ = r.read_to_end(&mut out);
        out
    })
}

/// Start `exe` with `args` in `cwd`, write `prompt` to its stdin, and wait for it to end, for at
/// most `timeout`. The child is in `sessions.oneshots` under `id` while it runs.
pub fn run_oneshot(sessions: &Sessions, id: u32, exe: &Path, args: &[String], cwd: &Path, prompt: String, timeout: std::time::Duration) -> Result<OneshotResult, String> {
    use std::io::Write;
    let mut child = command(exe)
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start Claude Code ({}): {e}", exe.display()))?;
    let mut stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = read_all(child.stdout.take().ok_or("no stdout")?);
    let stderr = read_all(child.stderr.take().ok_or("no stderr")?);
    // From its own thread: a long prompt must not wait on a process that is not reading yet.
    std::thread::spawn(move || {
        let _ = stdin.write_all(prompt.as_bytes());
    });
    let child = Arc::new(Mutex::new(child));
    sessions.oneshots.lock().insert(id, child.clone());
    let deadline = std::time::Instant::now() + timeout;
    let mut timed_out = false;
    let code = loop {
        if let Ok(Some(st)) = child.lock().try_wait() {
            break st.code();
        }
        // Stopped before the process existed: end it now.
        if sessions.oneshot_cancelled.lock().contains(&id) {
            kill_tree(&child);
        } else if !timed_out && std::time::Instant::now() >= deadline {
            timed_out = true;
            kill_tree(&child);
        }
        std::thread::sleep(std::time::Duration::from_millis(40));
    };
    // Still listed = it ended by itself; `cancel_oneshot` takes it out before ending it.
    let listed = sessions.oneshots.lock().remove(&id).is_some();
    let cancelled = sessions.oneshot_cancelled.lock().remove(&id) || (!listed && !timed_out);
    let stdout = String::from_utf8_lossy(&stdout.join().unwrap_or_default()).into_owned();
    let err = String::from_utf8_lossy(&stderr.join().unwrap_or_default()).trim().to_string();
    let tail = err.len().saturating_sub(4096);
    let tail = (tail..err.len()).find(|&i| err.is_char_boundary(i)).unwrap_or(err.len());
    Ok(OneshotResult { stdout, stderr: err[tail..].to_string(), code, timed_out, cancelled })
}

/// One prompt, one answer, then the process ends: no tools, no conversation, not in the repository.
#[tauri::command]
pub async fn claude_oneshot(app: AppHandle, args: OneshotArgs) -> Result<OneshotResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = tauri::Manager::state::<crate::AppState>(&app);
        let sessions = &state.claude;
        if sessions.oneshot_cancelled.lock().remove(&args.id) {
            return Ok(OneshotResult { stdout: String::new(), stderr: String::new(), code: None, timed_out: false, cancelled: true });
        }
        // The same wording as `claude_start`.
        let exe = find_exe(&args.exe).ok_or_else(|| {
            if args.exe.trim().is_empty() {
                "Claude Code was not found. Install it, or set its location in Settings › Claude Code.".to_string()
            } else {
                format!("Claude Code was not found at {}. Check Settings › Claude Code.", args.exe.trim())
            }
        })?;
        let cwd = oneshot_dir()?;
        run_oneshot(sessions, args.id, &exe, &oneshot_args(&args.model), &cwd, args.prompt, std::time::Duration::from_secs(args.timeout_secs.clamp(1, 900)))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// End a one-off request at once (Stop, or the tab or folder it belonged to went away).
#[tauri::command]
pub fn claude_oneshot_cancel(state: State<'_, crate::AppState>, id: u32) {
    cancel_oneshot(&state.claude, id);
}

pub fn cancel_oneshot(sessions: &Sessions, id: u32) {
    match sessions.oneshots.lock().remove(&id) {
        Some(child) => {
            std::thread::spawn(move || kill_tree(&child));
        }
        // Not started yet: `claude_oneshot` / `run_oneshot` sees the mark and sends nothing.
        None => {
            sessions.oneshot_cancelled.lock().insert(id);
        }
    }
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

    // ----- one-off requests (specs/git-claude.md) -----

    #[test]
    fn oneshot_is_toolless_single_answer_and_not_saved() {
        let a = oneshot_args("");
        assert_eq!(a[0], "-p");
        assert_eq!(after(&a, "--output-format"), Some("json"));
        // Every built-in tool off, no MCP servers, no skills, no project or user customisation.
        assert_eq!(after(&a, "--tools"), Some(""));
        for flag in ["--strict-mcp-config", "--disable-slash-commands", "--safe-mode", "--no-session-persistence"] {
            assert!(a.contains(&flag.to_string()), "{flag}");
        }
        assert_eq!(after(&a, "--system-prompt"), Some(ONESHOT_SYSTEM));
        // Nothing of a Claude tab: no streaming input, no permission prompts, no resume, no --bare (it would skip the login).
        for flag in ["--input-format", "--permission-prompt-tool", "--permission-mode", "--resume", "--bare", "--model", "--dangerously-skip-permissions"] {
            assert!(!a.contains(&flag.to_string()), "{flag}");
        }
        // Safe as a batch-file argument (npm's claude.cmd).
        assert!(!ONESHOT_SYSTEM.contains(['"', '%', '\n', '\r', '^', '&', '|', '<', '>']));
    }

    #[test]
    fn oneshot_model_is_passed_unless_empty_or_odd() {
        assert_eq!(after(&oneshot_args(" haiku "), "--model"), Some("haiku"));
        assert_eq!(after(&oneshot_args("claude-sonnet-4-5[1m]"), "--model"), Some("claude-sonnet-4-5[1m]"));
        assert!(!oneshot_args("").contains(&"--model".to_string()));
        assert!(!oneshot_args("--dangerously-skip-permissions").contains(&"--model".to_string()));
        assert!(!oneshot_args("haiku --resume x").contains(&"--model".to_string()));
    }

    /// The real thing, by hand only (`cargo test real_claude_oneshot -- --ignored --nocapture`): one
    /// tiny request on the cheapest model through the installed, signed-in Claude Code, to check
    /// the flags of `oneshot_args` against the CLI that is really there. Never part of a normal run.
    #[test]
    #[ignore = "makes one real Claude Code request; run by hand"]
    fn real_claude_oneshot() {
        let exe = find_exe("").expect("Claude Code is not installed");
        let s = Sessions::default();
        let r = run_oneshot(&s, 1, &exe, &oneshot_args("haiku"), &oneshot_dir().unwrap(), "Reply with the single word: ok".into(), std::time::Duration::from_secs(120)).unwrap();
        println!("exit {:?}\nstdout: {}\nstderr: {}", r.code, r.stdout, r.stderr);
        let v: serde_json::Value = serde_json::from_str(r.stdout.trim()).expect("one JSON object on stdout");
        assert_eq!(v["type"], "result");
        assert_eq!(v["is_error"], false);
        assert_eq!(v["num_turns"], 1);
        assert!(v["result"].as_str().unwrap().to_lowercase().contains("ok"));
    }

    /// A stand-in for `claude`: a batch file (what npm installs is one too).
    fn fake(dir: &Path, body: &str) -> PathBuf {
        let exe = dir.join("claude.cmd");
        std::fs::write(&exe, format!("@echo off\r\n{body}\r\n")).unwrap();
        exe
    }

    #[test]
    fn oneshot_feeds_the_prompt_on_stdin_and_returns_the_answer() {
        let dir = tempfile::tempdir().unwrap();
        // Echo stdin, then the working folder and whether a session marker got through.
        let exe = fake(dir.path(), "findstr \"^\"\r\necho cwd=%CD%\r\necho marker=[%CLAUDECODE%]\r\necho oops 1>&2\r\nexit /b 3");
        let cwd = tempfile::tempdir().unwrap();
        // Every marker of a surrounding Claude Code session is taken out of the child's environment.
        let cmd = command(&exe);
        for v in SESSION_ENV {
            assert!(cmd.get_envs().any(|(k, val)| k == std::ffi::OsStr::new(v) && val.is_none()), "{v}");
        }
        let s = Sessions::default();
        let r = run_oneshot(&s, 7, &exe, &oneshot_args("haiku"), cwd.path(), "diff --git a/x b/x\n+one \"quoted\" line\n".into(), std::time::Duration::from_secs(30)).unwrap();
        assert!(r.stdout.contains("diff --git a/x b/x"), "{:?}", r);
        assert!(r.stdout.contains("+one \"quoted\" line"));
        assert!(r.stdout.to_lowercase().contains(&format!("cwd={}", cwd.path().display()).to_lowercase()), "{:?}", r.stdout);
        // SESSION_ENV is stripped.
        assert!(r.stdout.contains("marker=[]"), "{:?}", r.stdout);
        assert_eq!(r.stderr, "oops");
        assert_eq!(r.code, Some(3));
        assert!(!r.timed_out && !r.cancelled);
        assert!(s.oneshots.lock().is_empty());
    }

    #[test]
    fn oneshot_ends_at_the_time_limit() {
        let dir = tempfile::tempdir().unwrap();
        let exe = fake(dir.path(), "ping -n 30 127.0.0.1 >nul");
        let s = Sessions::default();
        let started = std::time::Instant::now();
        let r = run_oneshot(&s, 1, &exe, &[], dir.path(), "x".into(), std::time::Duration::from_millis(400)).unwrap();
        assert!(r.timed_out && !r.cancelled);
        assert!(started.elapsed() < std::time::Duration::from_secs(15));
    }

    #[test]
    fn oneshot_can_be_stopped_while_running_or_before_it_starts() {
        let dir = tempfile::tempdir().unwrap();
        let exe = fake(dir.path(), "ping -n 30 127.0.0.1 >nul");
        let s = Arc::new(Sessions::default());
        let (s2, exe2, cwd) = (s.clone(), exe.clone(), dir.path().to_path_buf());
        let run = std::thread::spawn(move || run_oneshot(&s2, 5, &exe2, &[], &cwd, "x".into(), std::time::Duration::from_secs(60)).unwrap());
        let started = std::time::Instant::now();
        while s.oneshots.lock().is_empty() && started.elapsed() < std::time::Duration::from_secs(10) {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        cancel_oneshot(&s, 5);
        let r = run.join().unwrap();
        assert!(r.cancelled && !r.timed_out);
        assert!(started.elapsed() < std::time::Duration::from_secs(20));

        // Stopped first: the process is ended as soon as it exists.
        cancel_oneshot(&s, 6);
        let r = run_oneshot(&s, 6, &exe, &[], dir.path(), "x".into(), std::time::Duration::from_secs(60)).unwrap();
        assert!(r.cancelled);
        assert!(s.oneshot_cancelled.lock().is_empty());
    }
}
