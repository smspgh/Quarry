// The engines are public so `examples/bench.rs` (bench/README.md) can time them directly.
pub mod bigfile;
mod claude;
mod git;
mod lsp;
mod pty;
mod fileops;
mod files;
pub mod json_tools;
pub mod json_tree;
pub mod search;
mod watch;
mod writer;

use bigfile::{BigDoc, BigDocInfo, BigSearchResult, IndexProgress, LinesChunk, SearchOpts};
use files::{DirEntry, FileStat, TextFile, WriteOptions};
use json_tools::JsonResult;
use parking_lot::{Mutex, RwLock};
use search::{FileMatch, ReplaceFileResult, SearchDone, SearchQuery};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
struct AppState {
    next_id: AtomicU32,
    /// Each document is behind a read-write lock: reading lines, info and Find share it, so a long
    /// search no longer blocks scrolling the same document; edits, replace-all and save take it exclusively.
    docs: Mutex<HashMap<u32, Arc<RwLock<BigDoc>>>>,
    searches: Mutex<HashMap<u32, Arc<AtomicBool>>>,
    folder_watch: Mutex<Option<watch::FolderWatcher>>,
    /// The filter view's line set per large document (one filter per tab).
    filters: Mutex<HashMap<u32, bigfile::LineFilter>>,
    /// Claude Code sessions (one process per Claude tab).
    claude: claude::Sessions,
    /// Terminal tabs running the `claude` command line.
    terminals: pty::Terminals,
    /// Language servers (code intelligence).
    lsp: lsp::Servers,
}

fn progress_emitter(app: AppHandle) -> impl Fn(IndexProgress) + Send + 'static {
    move |p| {
        let _ = app.emit("bigfile:progress", p);
    }
}

fn get_doc(state: &AppState, id: u32) -> Result<Arc<RwLock<BigDoc>>, String> {
    state.docs.lock().get(&id).cloned().ok_or_else(|| format!("large document {id} is not open"))
}

// ---------- regular files ----------

#[tauri::command]
fn fs_stat(path: String) -> Result<FileStat, String> {
    files::stat(Path::new(&path))
}

#[tauri::command]
fn fs_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
fn fs_normalize(path: String) -> String {
    files::normalize(&path).to_string_lossy().into_owned()
}

#[tauri::command]
async fn fs_read_text(path: String, encoding: Option<String>) -> Result<TextFile, String> {
    tauri::async_runtime::spawn_blocking(move || files::read_text(Path::new(&path), encoding.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn fs_write_text(path: String, content: String, options: Option<WriteOptions>) -> Result<FileStat, String> {
    tauri::async_runtime::spawn_blocking(move || {
        files::write_text(Path::new(&path), &content, &options.unwrap_or_default())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn fs_list_dir(path: String, show_hidden: Option<bool>) -> Result<Vec<DirEntry>, String> {
    files::list_dir(Path::new(&path), show_hidden.unwrap_or(false))
}

#[tauri::command]
fn fs_create_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_rename(from: String, to: String) -> Result<(), String> {
    std::fs::rename(&from, &to).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_delete(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        std::fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(p).map_err(|e| e.to_string())
    }
}

/// Move a file or folder to the Recycle Bin (user-initiated deletes, so they can be restored).
#[tauri::command]
async fn fs_trash(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || trash::delete(&path).map_err(|e| e.to_string())).await.map_err(|e| e.to_string())?
}

/// Put files on the Windows clipboard (`cut`: pasting moves them).
#[tauri::command]
async fn files_to_clipboard(paths: Vec<String>, cut: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || fileops::set_clipboard(&paths, cut)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn files_from_clipboard() -> Result<fileops::ClipboardFiles, String> {
    tauri::async_runtime::spawn_blocking(fileops::get_clipboard).await.map_err(|e| e.to_string())?
}

/// Copy or move files and folders into `dest`. After a move the clipboard is emptied, as File
/// Explorer does after pasting a cut.
#[tauri::command]
async fn files_paste(sources: Vec<String>, dest: String, mv: bool) -> Result<Vec<fileops::PasteResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let res = fileops::paste(&sources, Path::new(&dest), mv);
        if mv {
            fileops::clear_clipboard();
        }
        res
    })
    .await
    .map_err(|e| e.to_string())
}

// ---------- app data (settings, macros, scripts, session) ----------

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn safe_name(name: &str) -> Result<&str, String> {
    if name.is_empty() || name.contains(['/', '\\', ':']) || name.contains("..") {
        return Err("invalid app data file name".into());
    }
    Ok(name)
}

#[tauri::command]
fn app_read(app: AppHandle, name: String) -> Result<Option<String>, String> {
    let p = app_data_dir(&app)?.join(safe_name(&name)?);
    match std::fs::read_to_string(&p) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn app_write(app: AppHandle, name: String, content: String) -> Result<(), String> {
    let p = app_data_dir(&app)?.join(safe_name(&name)?);
    files::write_text(&p, &content, &WriteOptions::default()).map(|_| ())
}

#[tauri::command]
fn app_data_path(app: AppHandle) -> Result<String, String> {
    Ok(app_data_dir(&app)?.to_string_lossy().into_owned())
}

// ---------- JSON ----------

/// JSON: Validate for a large-file tab, reading its memory mapping in place (any size).
#[tauri::command]
async fn big_json_validate(state: State<'_, AppState>, id: u32, jsonc: bool) -> Result<JsonResult, String> {
    let doc = get_doc(&state, id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let d = doc.read();
        if d.info().encoding != "UTF-8" {
            return Err("this file is UTF-16; JSON must be UTF-8".to_string());
        }
        let bytes = d.unedited_bytes().ok_or("save your changes first: validation checks the file as saved")?;
        Ok(json_tools::validate_bytes(bytes, jsonc))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Runs `f` on a large-file tab's bytes as saved (the JSON tree reads the memory mapping).
async fn with_unedited<T: Send + 'static>(state: State<'_, AppState>, id: u32, f: impl FnOnce(&BigDoc, &[u8]) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    let doc = get_doc(&state, id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let d = doc.read();
        if d.info().encoding != "UTF-8" {
            return Err("this file is UTF-16; JSON must be UTF-8".to_string());
        }
        let bytes = d.unedited_bytes().ok_or("save your changes first: the tree reads the file as saved")?;
        f(&d, bytes)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A JSON tree problem as text, with the line it is on.
fn tree_error(d: &BigDoc, (at, msg): json_tree::Fail) -> String {
    match d.line_of_offset(at) {
        Some(line) => format!("{msg} (line {line})"),
        None => msg,
    }
}

/// The JSON tree's root for a large-file tab.
#[tauri::command]
async fn big_json_root(state: State<'_, AppState>, id: u32) -> Result<json_tree::TreeNode, String> {
    with_unedited(state, id, |d, b| json_tree::root(b).map_err(|e| tree_error(d, e))).await
}

/// One page of the children of the object / array at byte `start` (see `json_tree::children`).
#[tauri::command]
async fn big_json_children(state: State<'_, AppState>, id: u32, start: u64, resume: Option<u64>, first_index: u64, limit: usize) -> Result<json_tree::TreePage, String> {
    with_unedited(state, id, move |d, b| json_tree::children(b, start, resume, first_index, limit.clamp(1, 5000)).map_err(|e| tree_error(d, e))).await
}

/// How many children the object / array at byte `start` has (reads all of it).
#[tauri::command]
async fn big_json_count(state: State<'_, AppState>, id: u32, start: u64) -> Result<u64, String> {
    with_unedited(state, id, move |d, b| json_tree::count(b, start).map_err(|e| tree_error(d, e))).await
}

/// 1-based line of a byte offset (the JSON tree jumps to a node's line).
#[tauri::command]
async fn big_line_of_offset(state: State<'_, AppState>, id: u32, offset: u64) -> Result<u64, String> {
    with_unedited(state, id, move |d, _| d.line_of_offset(offset).ok_or_else(|| "the file has changed".to_string())).await
}

#[tauri::command]
async fn json_validate(text: String, jsonc: Option<bool>) -> JsonResult {
    tauri::async_runtime::spawn_blocking(move || json_tools::validate(&text, jsonc.unwrap_or(false))).await.unwrap()
}

#[tauri::command]
async fn json_format(text: String, indent: Option<usize>, use_tabs: Option<bool>) -> JsonResult {
    tauri::async_runtime::spawn_blocking(move || json_tools::format(&text, indent.unwrap_or(2), use_tabs.unwrap_or(false)))
        .await
        .unwrap()
}

#[tauri::command]
async fn json_minify(text: String) -> JsonResult {
    tauri::async_runtime::spawn_blocking(move || json_tools::minify(&text)).await.unwrap()
}

// ---------- large files ----------

#[tauri::command]
async fn big_open(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<BigDocInfo, String> {
    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    let emitter = progress_emitter(app.clone());
    let doc = tauri::async_runtime::spawn_blocking(move || BigDoc::open(id, Path::new(&path), emitter))
        .await
        .map_err(|e| e.to_string())??;
    let info = doc.info();
    state.docs.lock().insert(id, Arc::new(RwLock::new(doc)));
    Ok(info)
}

#[tauri::command]
fn big_close(state: State<'_, AppState>, id: u32) {
    state.filters.lock().remove(&id);
    let doc = state.docs.lock().remove(&id);
    if let Some(d) = doc {
        std::thread::spawn(move || drop(d));
    }
}

/// Filter view: keep the lines matching (or with `invert`, not matching) the search. Returns how many.
#[tauri::command]
async fn big_filter(app: AppHandle, id: u32, query: BigSearchArgs, invert: bool) -> Result<u64, String> {
    let state = app.state::<AppState>();
    let doc = get_doc(&state, id)?;
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let f = doc.read().filter_lines(&query.pattern, query.is_regex, query.case_sensitive, query.whole_word, invert)?;
        let total = f.lines.total();
        app2.state::<AppState>().filters.lock().insert(id, f);
        Ok(total)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn big_filter_clear(state: State<'_, AppState>, id: u32) {
    state.filters.lock().remove(&id);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FilterLines {
    total: u64,
    /// `(line number, text)` of filtered lines `start..start + count`.
    lines: Vec<(u64, String)>,
}

/// Lines `start..start + count` of the filter view (positions in the filtered set, not file lines).
#[tauri::command]
async fn big_filter_lines(app: AppHandle, id: u32, start: u64, count: u64) -> Result<FilterLines, String> {
    let doc = get_doc(&app.state::<AppState>(), id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let filters = state.filters.lock();
        let f = filters.get(&id).ok_or("no filter")?;
        let d = doc.read();
        let mut lines = Vec::new();
        for k in start..(start + count.min(1000)).min(f.lines.total()) {
            let n = f.lines.line_at(k).unwrap_or(0);
            let text = d.get_lines(n, 1).lines.into_iter().next().unwrap_or_default();
            lines.push((n, text));
        }
        Ok(FilterLines { total: f.lines.total(), lines })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FollowResult {
    appended: bigfile::Appended,
    info: BigDocInfo,
    /// The filter view's new size when a filter is active and the file grew.
    filter_total: Option<u64>,
}

/// Follow mode tick: pick up lines appended to the file since the last call.
#[tauri::command]
async fn big_follow(app: AppHandle, id: u32) -> Result<FollowResult, String> {
    let doc = get_doc(&app.state::<AppState>(), id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut d = doc.write();
        let appended = d.follow_appended()?;
        let mut filter_total = None;
        if appended == bigfile::Appended::Grew {
            let state = app.state::<AppState>();
            let mut filters = state.filters.lock();
            if let Some(f) = filters.get_mut(&id) {
                d.extend_filter(f)?;
                filter_total = Some(f.lines.total());
            }
        }
        Ok(FollowResult { appended, info: d.info(), filter_total })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn big_info(state: State<'_, AppState>, id: u32) -> Result<BigDocInfo, String> {
    Ok(get_doc(&state, id)?.read().info())
}

#[tauri::command]
async fn big_lines(state: State<'_, AppState>, id: u32, start: u64, count: u64) -> Result<LinesChunk, String> {
    let doc = get_doc(&state, id)?;
    tauri::async_runtime::spawn_blocking(move || doc.read().get_lines(start, count))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn big_replace_line(state: State<'_, AppState>, id: u32, line: u64, text: String) -> Result<BigDocInfo, String> {
    let doc = get_doc(&state, id)?;
    let mut d = doc.write();
    d.replace_line(line, &text)?;
    Ok(d.info())
}

#[tauri::command]
fn big_delete_lines(state: State<'_, AppState>, id: u32, from: u64, to: u64) -> Result<BigDocInfo, String> {
    let doc = get_doc(&state, id)?;
    let mut d = doc.write();
    d.delete_lines(from, to)?;
    Ok(d.info())
}

#[tauri::command]
fn big_insert_lines(state: State<'_, AppState>, id: u32, at: u64, text: String) -> Result<BigDocInfo, String> {
    let doc = get_doc(&state, id)?;
    let mut d = doc.write();
    d.insert_lines(at, &text)?;
    Ok(d.info())
}

#[tauri::command]
fn big_undo(state: State<'_, AppState>, id: u32) -> Result<BigDocInfo, String> {
    let doc = get_doc(&state, id)?;
    let mut d = doc.write();
    d.undo();
    Ok(d.info())
}

#[tauri::command]
fn big_redo(state: State<'_, AppState>, id: u32) -> Result<BigDocInfo, String> {
    let doc = get_doc(&state, id)?;
    let mut d = doc.write();
    d.redo();
    Ok(d.info())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BigSearchArgs {
    pattern: String,
    is_regex: bool,
    case_sensitive: bool,
    whole_word: bool,
    dot_all: bool,
    max_results: Option<usize>,
    /// Replace All only: Preserve Case.
    #[serde(default)]
    preserve_case: bool,
}

#[tauri::command]
async fn big_search(state: State<'_, AppState>, id: u32, query: BigSearchArgs) -> Result<BigSearchResult, String> {
    let doc = get_doc(&state, id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let opts = SearchOpts {
            pattern: &query.pattern,
            is_regex: query.is_regex,
            case_sensitive: query.case_sensitive,
            whole_word: query.whole_word,
            dot_all: query.dot_all,
            max_results: query.max_results.unwrap_or(10_000),
        };
        doc.read().search(&opts)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn big_replace_all(
    app: AppHandle,
    state: State<'_, AppState>,
    id: u32,
    query: BigSearchArgs,
    replacement: String,
) -> Result<u64, String> {
    let doc = get_doc(&state, id)?;
    let emitter = progress_emitter(app);
    tauri::async_runtime::spawn_blocking(move || {
        let opts = SearchOpts {
            pattern: &query.pattern,
            is_regex: query.is_regex,
            case_sensitive: query.case_sensitive,
            whole_word: query.whole_word,
            dot_all: query.dot_all,
            max_results: usize::MAX,
        };
        // `replace_all` expands `$` only in regex mode; plain text is written as typed.
        doc.write().replace_all(&opts, &replacement, query.preserve_case, emitter)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn big_save(app: AppHandle, state: State<'_, AppState>, id: u32, path: Option<String>) -> Result<BigDocInfo, String> {
    let doc = get_doc(&state, id)?;
    let emitter = progress_emitter(app);
    tauri::async_runtime::spawn_blocking(move || {
        let mut d = doc.write();
        d.save(path.as_deref().map(Path::new), emitter)?;
        Ok(d.info())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------- find in files ----------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SearchBatch {
    search_id: u32,
    matches: Vec<FileMatch>,
}

#[tauri::command]
fn search_start(app: AppHandle, state: State<'_, AppState>, search_id: u32, roots: Vec<String>, query: SearchQuery) -> Result<(), String> {
    let cancel = Arc::new(AtomicBool::new(false));
    state.searches.lock().insert(search_id, cancel.clone());
    std::thread::spawn(move || {
        let emit_app = app.clone();
        let result = search::search_paths(search_id, &roots, &query, cancel, |matches| {
            let _ = emit_app.emit("search:results", SearchBatch { search_id, matches });
        });
        match result {
            Ok(done) => {
                let _ = app.emit("search:done", done);
            }
            Err(e) => {
                let _ = app.emit("search:error", serde_json::json!({ "searchId": search_id, "error": e }));
                let _ = app.emit(
                    "search:done",
                    SearchDone { search_id, files_searched: 0, matches: 0, truncated: false, cancelled: true, capped_paths: Vec::new() },
                );
            }
        }
        if let Some(st) = app.try_state::<AppState>() {
            st.searches.lock().remove(&search_id);
        }
    });
    Ok(())
}

#[tauri::command]
fn search_cancel(state: State<'_, AppState>, search_id: u32) {
    if let Some(c) = state.searches.lock().get(&search_id) {
        c.store(true, Ordering::Relaxed);
    }
}

/// Compile `pattern` with the engine the search uses; returns the one-line error or null.
#[tauri::command]
fn validate_regex(pattern: String, case_sensitive: bool, whole_word: bool, dot_all: bool) -> Option<String> {
    search::validate_regex(&pattern, case_sensitive, whole_word, dot_all).err()
}

// ---------- folder watcher (Explorer) ----------

/// Watch `path` recursively and emit `fs-changed` (Vec<String> of changed paths, debounced ~300 ms).
/// Replaces any previous watcher.
#[tauri::command]
fn watch_start(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<(), String> {
    let mut slot = state.folder_watch.lock();
    if slot.as_ref().map(|w| w.root == path).unwrap_or(false) {
        return Ok(());
    }
    *slot = None;
    let w = watch::start(&path, move |paths| {
        let _ = app.emit("fs-changed", paths);
    })?;
    *slot = Some(w);
    Ok(())
}

#[tauri::command]
fn watch_stop(state: State<'_, AppState>) {
    *state.folder_watch.lock() = None;
}

#[tauri::command]
async fn replace_in_files(app: tauri::AppHandle, files: Vec<search::ReplaceTarget>, query: SearchQuery, replacement: String) -> Result<Vec<ReplaceFileResult>, String> {
    // Only the latest Replace in Files can be undone: start each one with an empty backup folder.
    let backup_dir = undo_dir(&app).and_then(|d| {
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).ok().map(|_| d)
    });
    tauri::async_runtime::spawn_blocking(move || search::replace_in_files(&files, &query, &replacement, backup_dir.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

/// Folder holding the originals of the last Replace in Files (cleared at startup).
fn undo_dir(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_cache_dir().ok().map(|d| d.join("replace-undo"))
}

/// If the previous run panicked, move its report aside (so it is shown once) and return its path.
#[tauri::command]
fn take_crash_report(app: tauri::AppHandle) -> Option<String> {
    let dir = app.path().app_log_dir().ok()?;
    let log = dir.join("crash.log");
    if !log.exists() {
        return None;
    }
    let seen = dir.join("crash-last.log");
    std::fs::rename(&log, &seen).ok()?;
    Some(seen.to_string_lossy().into_owned())
}

#[tauri::command]
async fn undo_replace_in_files(entries: Vec<search::UndoEntry>) -> Result<Vec<ReplaceFileResult>, String> {
    tauri::async_runtime::spawn_blocking(move || search::undo_replace(&entries)).await.map_err(|e| e.to_string())
}

/// Quick Open's file list: up to `max` files under `root` as `/`-separated relative paths. Hidden
/// files are included; `.git`, `node_modules` and `target` are skipped, and so is whatever the
/// repository's `.gitignore` / `.ignore` files exclude (inside a git repository).
fn walk_files(root: &str, max: usize) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut ob = ignore::overrides::OverrideBuilder::new(root);
    for noise in ["!**/.git/**", "!**/node_modules/**", "!**/target/**"] {
        ob.add(noise).ok();
    }
    let walk = ignore::WalkBuilder::new(root)
        .hidden(false)
        .overrides(ob.build().map_err(|e| e.to_string())?)
        .build();
    let root_path = Path::new(root);
    for ent in walk.flatten() {
        if out.len() >= max {
            break;
        }
        if ent.file_type().map(|t| t.is_file()).unwrap_or(false) {
            let rel = ent.path().strip_prefix(root_path).unwrap_or(ent.path());
            out.push(rel.to_string_lossy().replace('\\', "/"));
        }
    }
    Ok(out)
}

#[tauri::command]
async fn fs_walk(root: String, max: Option<usize>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || walk_files(&root, max.unwrap_or(30_000)))
        .await
        .map_err(|e| e.to_string())?
}

/// Existing paths among command-line arguments (program name already skipped). Explorer passes a
/// drive root as `"C:\"`, which Windows argument parsing reads as `C:"`; turn that back into `C:\`.
/// File / folder arguments that exist. Relative ones are taken from `cwd`: the folder the launch
/// came from, which for a second launch forwarded to this instance is not this process's own.
fn cli_paths(args: impl Iterator<Item = String>, cwd: &Path) -> Vec<String> {
    args.filter(|a| !a.starts_with('-'))
        .map(|a| match a.strip_suffix('"') {
            Some(p) => format!("{p}\\"),
            None => a,
        })
        .map(|a| if Path::new(&a).is_relative() { cwd.join(&a).to_string_lossy().into_owned() } else { a })
        .filter(|a| Path::new(a).exists())
        .collect()
}

/// Paths passed on the command line (Explorer "Open with", drag onto the exe).
#[tauri::command]
fn startup_paths() -> Vec<String> {
    cli_paths(std::env::args().skip(1), &std::env::current_dir().unwrap_or_default())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalFormatResult {
    ok: bool,
    output: String,
    error: String,
    not_found: bool,
}

/// Pipe `text` through an external formatter (rustfmt, gofmt, ...) and return its stdout.
/// `cwd` is the document's folder, so the tool finds project config files (rustfmt.toml, ...).
#[tauri::command]
async fn format_external(tool: String, args: Vec<String>, text: String, cwd: Option<String>) -> ExternalFormatResult {
    tauri::async_runtime::spawn_blocking(move || run_formatter(&tool, &args, text, cwd.as_deref()))
        .await
        .unwrap_or_else(|e| ExternalFormatResult { ok: false, output: String::new(), error: e.to_string(), not_found: false })
}

/// The blocking part of `format_external`.
fn run_formatter(tool: &str, args: &[String], text: String, cwd: Option<&str>) -> ExternalFormatResult {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let mut cmd = Command::new(tool);
    cmd.args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(dir) = cwd.map(Path::new).filter(|d| d.is_dir()) {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return ExternalFormatResult { ok: false, output: String::new(), error: e.to_string(), not_found: e.kind() == std::io::ErrorKind::NotFound };
        }
    };
    // Feed stdin from another thread: a tool that writes output before it has read all of its
    // input would otherwise fill the stdout pipe and deadlock with us on large documents.
    let feeder = child.stdin.take().map(|mut stdin| std::thread::spawn(move || {
        let _ = stdin.write_all(text.as_bytes());
    }));
    let output = child.wait_with_output();
    if let Some(f) = feeder {
        let _ = f.join();
    }
    match output {
        Ok(out) if out.status.success() => ExternalFormatResult { ok: true, output: String::from_utf8_lossy(&out.stdout).into_owned(), error: String::new(), not_found: false },
        Ok(out) => {
            // Some tools (dotnet) report failures on stdout; fall back to it when stderr is empty.
            let err = if out.stderr.iter().all(u8::is_ascii_whitespace) { &out.stdout } else { &out.stderr };
            ExternalFormatResult { ok: false, output: String::new(), error: String::from_utf8_lossy(err).into_owned(), not_found: false }
        }
        Err(e) => ExternalFormatResult { ok: false, output: String::new(), error: e.to_string(), not_found: false },
    }
}

/// Release builds abort on panic; record what happened in `<app log dir>/crash.log` first so a
/// sudden exit leaves something to report. The previous hook still runs (stderr in dev builds).
fn install_crash_log(dir: std::path::PathBuf) {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let _ = std::fs::create_dir_all(&dir);
        let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let entry = format!(
            "--- Quarry {} panic at unix time {secs}\n{info}\n{}\n",
            env!("CARGO_PKG_VERSION"),
            std::backtrace::Backtrace::force_capture()
        );
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("crash.log")) {
            let _ = std::io::Write::write_all(&mut f, entry.as_bytes());
        }
        prev(info);
    }));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first: a second launch (e.g. double-clicking a file in Explorer while
        // Quarry is open) forwards its arguments to the running instance instead of starting a
        // second process, which would fail because both share one WebView2 profile.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            use tauri::{Emitter, Manager};
            let paths = cli_paths(args.into_iter().skip(1), Path::new(&cwd));
            let _ = app.emit("open-paths", paths);
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(AppState::default())
        .setup(|app| {
            if let Some(d) = undo_dir(app.handle()) {
                let _ = std::fs::remove_dir_all(d);
            }
            if let Ok(dir) = app.path().app_log_dir() {
                install_crash_log(dir);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fs_stat,
            fs_exists,
            fs_normalize,
            fs_read_text,
            fs_write_text,
            fs_trash,
            files_to_clipboard,
            files_from_clipboard,
            files_paste,
            fs_list_dir,
            fs_create_dir,
            fs_rename,
            fs_delete,
            app_read,
            app_write,
            app_data_path,
            json_validate,
            big_json_validate,
            big_filter,
            big_filter_clear,
            big_filter_lines,
            big_follow,
            big_json_root,
            big_json_children,
            big_json_count,
            big_line_of_offset,
            json_format,
            json_minify,
            big_open,
            big_close,
            big_info,
            big_lines,
            big_replace_line,
            big_delete_lines,
            big_insert_lines,
            big_undo,
            big_redo,
            big_search,
            big_replace_all,
            big_save,
            search_start,
            search_cancel,
            replace_in_files,
            undo_replace_in_files,
            take_crash_report,
            validate_regex,
            watch_start,
            watch_stop,
            fs_walk,
            startup_paths,
            format_external,
            claude::claude_detect,
            claude::claude_start,
            claude::claude_send,
            claude::claude_stop,
            claude::claude_stop_all,
            claude::claude_read_image,
            claude::claude_conversations,
            claude::claude_history,
            pty::pty_start,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_kill_all,
            lsp::lsp_which,
            lsp::lsp_find_root,
            lsp::lsp_typescript,
            lsp::lsp_start,
            lsp::lsp_send,
            lsp::lsp_stop,
            lsp::lsp_stop_all,
            git::git_available,
            git::git_status,
            git::git_show,
            git::git_stage,
            git::git_unstage,
            git::git_discard,
            git::git_commit,
            git::git_branches,
            git::git_checkout,
            git::git_remote,
            git::git_add_remote,
            git::git_set_remote_url,
            git::git_identity,
            git::git_set_identity,
            git::github_create_repo,
            git::github_accounts_list,
            git::github_repo,
            git::github_sign_in,
            git::git_blame,
            git::git_log,
            git::git_commit_files,
            git::git_unpushed,
            git::git_continue,
            git::git_resolve_side,
            git::git_abort,
            git::git_graph,
            git::git_graph_search,
            git::git_graph_indexed,
            git::git_graph_index,
            git::git_commit_detail,
            git::git_commit_action,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::run_formatter;

    fn args(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn formatter_output_is_its_stdout_even_for_large_input() {
        // findstr echoes every line of stdin; 4 MB is far more than a pipe buffer holds.
        let text = "line of text\r\n".repeat(300_000);
        let r = run_formatter("findstr", &args(&["^"]), text.clone(), None);
        assert!(r.ok, "{}", r.error);
        assert_eq!(r.output.len(), text.len());
    }

    #[test]
    fn a_missing_formatter_is_reported_as_not_found() {
        let r = run_formatter("quarry-no-such-formatter", &[], String::new(), None);
        assert!(!r.ok);
        assert!(r.not_found);
    }

    #[test]
    fn a_failing_formatter_reports_stderr_or_else_stdout() {
        let r = run_formatter("cmd", &args(&["/C", "echo bad input 1>&2 & exit 1"]), String::new(), None);
        assert!(!r.ok && !r.not_found);
        assert_eq!(r.error.trim(), "bad input");
        let r = run_formatter("cmd", &args(&["/C", "echo said on stdout & exit 2"]), String::new(), None);
        assert!(!r.ok);
        assert_eq!(r.error.trim(), "said on stdout");
    }

    #[test]
    fn the_formatter_runs_in_the_given_folder() {
        let dir = tempfile::tempdir().unwrap();
        let r = run_formatter("cmd", &args(&["/C", "cd"]), String::new(), dir.path().to_str());
        assert!(r.ok);
        let shown = std::path::PathBuf::from(r.output.trim()).canonicalize().unwrap();
        assert_eq!(shown, dir.path().canonicalize().unwrap());
    }

    #[test]
    fn panics_are_written_to_the_crash_log() {
        let dir = tempfile::tempdir().unwrap();
        super::install_crash_log(dir.path().to_path_buf());
        let r = std::panic::catch_unwind(|| panic!("crash-log probe"));
        let _ = std::panic::take_hook(); // restore the default hook for other tests
        assert!(r.is_err());
        let log = std::fs::read_to_string(dir.path().join("crash.log")).unwrap();
        assert!(log.contains("crash-log probe"), "{log}");
        assert!(log.contains(env!("CARGO_PKG_VERSION")));
    }

    #[test]
    fn cli_paths_keeps_existing_paths_resolves_relative_ones_and_repairs_quoted_roots() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("notes.txt"), "x").unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        let abs_sub = dir.path().join("sub").to_string_lossy().into_owned();
        let args = [
            "--flag".to_string(),
            "notes.txt".to_string(),
            abs_sub.clone(),
            "missing.txt".to_string(),
            // `quarry.exe "C:\"` arrives as `C:"`; `"C:\work\"` as `C:\work"`.
            "C:\"".to_string(),
            format!("{abs_sub}\""),
        ];
        let got = super::cli_paths(args.into_iter(), dir.path());
        assert_eq!(
            got,
            vec![
                dir.path().join("notes.txt").to_string_lossy().into_owned(),
                abs_sub.clone(),
                "C:\\".to_string(),
                format!("{abs_sub}\\"),
            ]
        );
    }

    #[test]
    fn walk_files_skips_noise_folders_and_gitignored_files_and_stops_at_max() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        for d in [".git", "node_modules/pkg", "target/debug", "src", "build"] {
            std::fs::create_dir_all(root.join(d)).unwrap();
        }
        for f in [".git/config", "node_modules/pkg/index.js", "target/debug/app.exe", "src/main.rs", "build/out.js", ".env"] {
            std::fs::write(root.join(f), "x").unwrap();
        }
        std::fs::write(root.join(".gitignore"), "build/\n").unwrap();
        let mut got = super::walk_files(&root.to_string_lossy(), 30_000).unwrap();
        got.sort();
        assert_eq!(got, vec![".env", ".gitignore", "src/main.rs"]);
        assert_eq!(super::walk_files(&root.to_string_lossy(), 2).unwrap().len(), 2);
    }
}
