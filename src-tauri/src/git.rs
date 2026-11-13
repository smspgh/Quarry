//! Git integration: every operation shells out to the `git` executable on PATH (no libgit2), with
//! no console window, no terminal prompts (credentials go through Git Credential Manager's own
//! window) and paths quoted as UTF-8. Paths cross the boundary as absolute Windows paths in the
//! same form as the rest of the app (`files::normalize`); git itself sees repo-relative `/` paths.
//! All commands are async and run git on a blocking thread, so a slow fetch or a big status never
//! stalls the UI.

use crate::files;
use encoding_rs::{Encoding, UTF_8};
use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub root: String,
    /// None when HEAD is detached.
    pub branch: Option<String>,
    /// Short sha of HEAD; None on an unborn branch (no commits yet).
    pub head: Option<String>,
    pub upstream: Option<String>,
    /// The upstream is set but its remote-tracking branch is not there (deleted on the remote and
    /// pruned, or the remote repository was replaced): ahead / behind mean nothing then.
    pub upstream_gone: bool,
    pub ahead: u32,
    pub behind: u32,
    /// "merge" | "rebase" | "am" | "cherry-pick" | "revert" while one is in progress.
    pub operation: Option<String>,
    /// The message git prepared for the commit that finishes the operation (`MERGE_MSG` without
    /// its comment lines): the picked commit's message, "Merge branch ...", "Revert ...".
    pub operation_message: Option<String>,
    /// A rebase's progress: the commit being replayed and how many there are ("2 of 5").
    pub operation_step: Option<(u32, u32)>,
    pub files: Vec<GitFile>,
    pub remotes: Vec<GitRemote>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitRemote {
    pub name: String,
    /// The fetch URL.
    pub url: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitFile {
    pub path: String,
    /// The old path of a rename or copy.
    pub orig_path: Option<String>,
    /// Porcelain status letter of the index (X) and work tree (Y); "." when unchanged.
    pub index: String,
    pub worktree: String,
    pub conflicted: bool,
    pub untracked: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitBlob {
    pub text: String,
    pub binary: bool,
    pub encoding: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitResult {
    pub sha: String,
    pub summary: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    /// `main` for a local branch, `origin/main` for a remote one.
    pub name: String,
    pub remote: bool,
    pub current: bool,
    pub upstream: Option<String>,
    pub sha: String,
    /// Committer time of the tip, unix seconds.
    pub time: i64,
    pub summary: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitInfo {
    pub sha: String,
    pub short: String,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub summary: String,
    /// The line is not committed yet (all-zero sha).
    pub uncommitted: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitBlame {
    pub commits: Vec<GitCommitInfo>,
    /// One entry per line of the file: an index into `commits`.
    pub lines: Vec<u32>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitLogEntry {
    pub sha: String,
    pub short: String,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub summary: String,
    /// The file's repo-relative path (`/`-separated) at this commit; "" for a repository log.
    pub rel: String,
    pub root: String,
}

// ---------- running git ----------

/// `git -C <dir>` with the options every call uses. `read_only` adds `--no-optional-locks` so a
/// background status never fights the user's own git commands for `index.lock`.
fn git(dir: &Path, read_only: bool) -> Command {
    let mut cmd = Command::new("git");
    if read_only {
        cmd.arg("--no-optional-locks");
    }
    // Literal pathspecs: a file named `*.txt` or `:x` means that file, not a pattern.
    cmd.arg("--literal-pathspecs").arg("-C").arg(dir);
    cmd.args(["-c", "core.quotepath=off", "-c", "i18n.logOutputEncoding=UTF-8", "-c", "color.ui=false", "-c", "log.showSignature=false"]);
    cmd.env("GIT_TERMINAL_PROMPT", "0").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

struct Output {
    ok: bool,
    stdout: Vec<u8>,
    stderr: String,
}

/// Run `cmd`, writing `input` to its stdin from a separate thread (a large input and a large
/// output would otherwise deadlock on full pipes).
fn exec(mut cmd: Command, input: Option<Vec<u8>>) -> Result<Output, String> {
    if input.is_some() {
        cmd.stdin(Stdio::piped());
    }
    let mut child = cmd.spawn().map_err(|e| format!("could not run git: {e}"))?;
    let writer = match (input, child.stdin.take()) {
        (Some(bytes), Some(mut stdin)) => Some(std::thread::spawn(move || {
            let _ = stdin.write_all(&bytes);
        })),
        _ => None,
    };
    let out = child.wait_with_output().map_err(|e| format!("git: {e}"))?;
    if let Some(w) = writer {
        let _ = w.join();
    }
    Ok(Output { ok: out.status.success(), stdout: out.stdout, stderr: String::from_utf8_lossy(&out.stderr).trim().to_string() })
}

/// Run git and return its stdout; a failure is git's stderr (or the exit status if it said nothing).
fn run(dir: &Path, read_only: bool, args: &[&str], input: Option<Vec<u8>>) -> Result<Vec<u8>, String> {
    let mut cmd = git(dir, read_only);
    cmd.args(args);
    let out = exec(cmd, input)?;
    if out.ok {
        Ok(out.stdout)
    } else if out.stderr.is_empty() {
        Err(format!("git {} failed", args.first().copied().unwrap_or("")))
    } else {
        Err(out.stderr)
    }
}

fn run_text(dir: &Path, read_only: bool, args: &[&str]) -> Result<String, String> {
    run(dir, read_only, args, None).map(|b| String::from_utf8_lossy(&b).into_owned())
}

/// NUL-separated paths for `--pathspec-from-file=- --pathspec-file-nul` (no command-line limit).
fn nul_list(rels: &[String]) -> Vec<u8> {
    let mut v = Vec::new();
    for r in rels {
        v.extend_from_slice(r.as_bytes());
        v.push(0);
    }
    v
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

// ---------- paths ----------

/// The nearest existing folder at or above `path` (a deleted file's folder may be gone too).
fn existing_dir(path: &Path) -> Option<PathBuf> {
    let mut p = Some(path);
    while let Some(d) = p {
        if d.is_dir() {
            return Some(d.to_path_buf());
        }
        p = d.parent();
    }
    None
}

/// The work tree containing `path` (normalized, backslashes); None when it is not in one.
/// A repository git refuses to use (another user's folder: `safe.directory`) is an error, so the
/// UI can say why instead of silently showing nothing.
fn find_root(path: &Path) -> Result<Option<PathBuf>, String> {
    let Some(dir) = existing_dir(path) else { return Ok(None) };
    match run_text(&dir, true, &["rev-parse", "--show-toplevel"]) {
        Ok(s) => {
            let top = s.trim();
            if top.is_empty() {
                return Ok(None); // inside the .git folder
            }
            Ok(Some(files::normalize(&top.replace('/', "\\"))))
        }
        // ...unless it is a drive root (a stray `C:\.git` would otherwise break every folder).
        Err(e) if e.contains("dubious ownership") && !dubious_drive_root(&e) => Err(e),
        Err(_) => Ok(None),
    }
}

/// "detected dubious ownership in repository at 'C:/'": the repository is a whole drive.
fn dubious_drive_root(err: &str) -> bool {
    err.split_once("repository at '").and_then(|(_, rest)| rest.split_once('\'')).is_some_and(|(p, _)| {
        let p = p.trim_end_matches(['/', '\\']);
        p.len() == 2 && p.ends_with(':')
    })
}

/// `path` relative to `root`, `/`-separated ("" for the root itself). Compared case-insensitively;
/// a path that only matches once canonicalized (a different spelling, a symlink) is retried that way.
fn rel_path(root: &Path, path: &str) -> Result<String, String> {
    let strip = |p: &str| -> Option<String> {
        let root_s = root.to_string_lossy();
        let root_s = root_s.trim_end_matches(['\\', '/']);
        let p = p.trim_end_matches(['\\', '/']);
        if p.len() < root_s.len() || !p.is_char_boundary(root_s.len()) || !p[..root_s.len()].eq_ignore_ascii_case(root_s) {
            return None;
        }
        let rest = &p[root_s.len()..];
        if !rest.is_empty() && !rest.starts_with(['\\', '/']) {
            return None;
        }
        Some(rest.trim_start_matches(['\\', '/']).replace('\\', "/"))
    };
    strip(path)
        .or_else(|| strip(&files::normalize(path).to_string_lossy()))
        .ok_or_else(|| format!("{path} is not inside the repository {}", root.display()))
}

fn abs_path(root: &Path, rel: &str) -> String {
    root.join(rel.replace('/', "\\")).to_string_lossy().into_owned()
}

fn rels(root: &Path, paths: &[String]) -> Result<Vec<String>, String> {
    paths.iter().map(|p| rel_path(root, p)).collect()
}

/// Whether HEAD points at a commit (false on a fresh repository before the first commit).
fn has_head(root: &Path) -> bool {
    run(root, true, &["rev-parse", "--verify", "-q", "HEAD"], None).is_ok()
}

// ---------- status ----------

fn operation(root: &Path) -> Option<String> {
    let dir = run_text(root, true, &["rev-parse", "--absolute-git-dir"]).ok()?;
    let dir = PathBuf::from(dir.trim().replace('/', "\\"));
    let op = if dir.join("rebase-merge").is_dir() {
        "rebase"
    } else if dir.join("rebase-apply").is_dir() {
        if dir.join("rebase-apply").join("applying").exists() { "am" } else { "rebase" }
    } else if dir.join("MERGE_HEAD").is_file() {
        "merge"
    } else if dir.join("CHERRY_PICK_HEAD").is_file() {
        "cherry-pick"
    } else if dir.join("REVERT_HEAD").is_file() {
        "revert"
    } else {
        return None;
    };
    Some(op.to_string())
}

/// Git's prepared message for the operation in progress, without the `#` comment lines (the
/// "# Conflicts:" list) it adds.
fn operation_message(root: &Path) -> Option<String> {
    let dir = run_text(root, true, &["rev-parse", "--absolute-git-dir"]).ok()?;
    let text = std::fs::read_to_string(PathBuf::from(dir.trim().replace('/', "\\")).join("MERGE_MSG")).ok()?;
    let msg = text.lines().filter(|l| !l.starts_with('#')).collect::<Vec<_>>().join("\n");
    let msg = msg.trim();
    (!msg.is_empty()).then(|| msg.to_string())
}

/// Where a rebase is: (current, total), from the files git keeps while it runs.
fn operation_step(root: &Path) -> Option<(u32, u32)> {
    let dir = run_text(root, true, &["rev-parse", "--absolute-git-dir"]).ok()?;
    let dir = PathBuf::from(dir.trim().replace('/', "\\"));
    let num = |p: PathBuf| std::fs::read_to_string(p).ok()?.trim().parse::<u32>().ok();
    let merge = dir.join("rebase-merge");
    let apply = dir.join("rebase-apply");
    if merge.is_dir() { Some((num(merge.join("msgnum"))?, num(merge.join("end"))?)) } else if apply.is_dir() { Some((num(apply.join("next"))?, num(apply.join("last"))?)) } else { None }
}

/// Parse `status --porcelain=v2 --branch -z`.
fn parse_status(root: &Path, out: &[u8]) -> GitStatus {
    let text = String::from_utf8_lossy(out);
    let mut st = GitStatus {
        root: root.to_string_lossy().into_owned(),
        branch: None,
        head: None,
        upstream: None,
        upstream_gone: false,
        ahead: 0,
        behind: 0,
        operation: None,
        operation_message: None,
        operation_step: None,
        files: Vec::new(),
        remotes: Vec::new(),
    };
    let mut saw_ab = false;
    let mut recs = text.split('\0');
    let xy = |s: &str| -> (String, String) {
        let mut c = s.chars();
        (c.next().unwrap_or('.').to_string(), c.next().unwrap_or('.').to_string())
    };
    while let Some(rec) = recs.next() {
        if let Some(h) = rec.strip_prefix("# ") {
            let (k, v) = h.split_once(' ').unwrap_or((h, ""));
            match k {
                "branch.oid" if v != "(initial)" => st.head = Some(v.chars().take(7).collect()),
                "branch.head" if v != "(detached)" => st.branch = Some(v.to_string()),
                "branch.upstream" => st.upstream = Some(v.to_string()),
                "branch.ab" => {
                    saw_ab = true;
                    for part in v.split(' ') {
                        if let Some(n) = part.strip_prefix('+') {
                            st.ahead = n.parse().unwrap_or(0);
                        } else if let Some(n) = part.strip_prefix('-') {
                            st.behind = n.parse().unwrap_or(0);
                        }
                    }
                }
                _ => {}
            }
            continue;
        }
        let Some((kind, rest)) = rec.split_once(' ') else { continue };
        match kind {
            // 1 XY sub mH mI mW hH hI path
            "1" => {
                let f: Vec<&str> = rest.splitn(8, ' ').collect();
                if f.len() == 8 {
                    let (i, w) = xy(f[0]);
                    st.files.push(GitFile { path: abs_path(root, f[7]), orig_path: None, index: i, worktree: w, conflicted: false, untracked: false });
                }
            }
            // 2 XY sub mH mI mW hH hI Xscore path, then the original path as the next record
            "2" => {
                let f: Vec<&str> = rest.splitn(9, ' ').collect();
                let orig = recs.next();
                if f.len() == 9 {
                    let (i, w) = xy(f[0]);
                    st.files.push(GitFile { path: abs_path(root, f[8]), orig_path: orig.map(|o| abs_path(root, o)), index: i, worktree: w, conflicted: false, untracked: false });
                }
            }
            // u XY sub m1 m2 m3 mW h1 h2 h3 path
            "u" => {
                let f: Vec<&str> = rest.splitn(10, ' ').collect();
                if f.len() == 10 {
                    let (i, w) = xy(f[0]);
                    st.files.push(GitFile { path: abs_path(root, f[9]), orig_path: None, index: i, worktree: w, conflicted: true, untracked: false });
                }
            }
            "?" => st.files.push(GitFile { path: abs_path(root, rest), orig_path: None, index: "?".into(), worktree: "?".into(), conflicted: false, untracked: true }),
            _ => {} // "!" ignored (not requested anyway)
        }
    }
    // git leaves out branch.ab when the upstream's remote-tracking branch is missing.
    st.upstream_gone = st.upstream.is_some() && !saw_ab;
    st
}

fn status(path: &Path) -> Result<Option<GitStatus>, String> {
    let Some(root) = find_root(path)? else { return Ok(None) };
    let out = run(&root, true, &["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"], None)?;
    let mut st = parse_status(&root, &out);
    st.operation = operation(&root);
    if st.operation.is_some() {
        st.operation_message = operation_message(&root);
        st.operation_step = operation_step(&root);
    }
    st.remotes = remote_list(&root)?;
    Ok(Some(st))
}

// ---------- file contents ----------

fn decode_blob(bytes: &[u8]) -> GitBlob {
    let (enc, bom) = files::detect_encoding(bytes, None);
    let (text, _) = enc.decode_without_bom_handling(&bytes[bom..]);
    GitBlob { text: text.into_owned(), binary: files::looks_binary(bytes), encoding: enc.name().to_string() }
}

/// `rev`: "HEAD", a sha or branch, or "" / ":" for the index. The blob goes through the same
/// filters as a checkout (`cat-file --filters`: line endings, smudge), so it compares with the
/// file on disk.
fn show(path: &str, rev: &str, rel: Option<String>) -> Result<Option<GitBlob>, String> {
    let Some(root) = find_root(Path::new(path))? else { return Ok(None) };
    let rel = match rel {
        Some(r) => r.replace('\\', "/"),
        None => rel_path(&root, path)?,
    };
    let rev = rev.trim();
    let spec = if rev.is_empty() || rev == ":" { format!(":{rel}") } else { format!("{rev}:{rel}") };
    match run(&root, true, &["cat-file", "--filters", &spec], None) {
        Ok(bytes) => Ok(Some(decode_blob(&bytes))),
        Err(e) => match run_text(&root, true, &["cat-file", "-t", &spec]) {
            Ok(t) if t.trim() == "blob" => Err(e),
            _ => Ok(None), // not at that revision (or a folder there)
        },
    }
}

// ---------- index and work tree ----------

fn stage(root: &Path, paths: &[String]) -> Result<(), String> {
    let rels = rels(root, paths)?;
    if rels.is_empty() {
        return Ok(());
    }
    // -A: a deleted file stages its deletion.
    run(root, false, &["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"], Some(nul_list(&rels))).map(|_| ())
}

/// Resolve a conflicted file by taking one whole side: "ours" (the branch you are on) or
/// "theirs" (what is being merged / picked in). When that side deleted the file, it is deleted.
/// Returns "kept" or "deleted".
fn resolve_side(root: &Path, path: &str, side: &str) -> Result<String, String> {
    let flag = match side {
        "ours" => "--ours",
        "theirs" => "--theirs",
        _ => return Err(format!("unknown side {side}")),
    };
    let rel = rel_path(root, path)?;
    // Stage 2 is ours, 3 is theirs: is the file there on that side?
    let stage = if side == "ours" { "2" } else { "3" };
    let listed = run_text(root, true, &["ls-files", "-u", "--", &rel])?;
    let has_side = listed.lines().any(|l| l.split_whitespace().nth(2) == Some(stage));
    if has_side {
        run(root, false, &["checkout", flag, "--", &rel], None)?;
        run(root, false, &["add", "--", &rel], None)?;
        Ok("kept".into())
    } else {
        run(root, false, &["rm", "-f", "--quiet", "--", &rel], None)?;
        Ok("deleted".into())
    }
}

fn unstage(root: &Path, paths: &[String]) -> Result<(), String> {
    let rels = rels(root, paths)?;
    if rels.is_empty() {
        return Ok(());
    }
    if has_head(root) {
        run(root, false, &["restore", "--staged", "--pathspec-from-file=-", "--pathspec-file-nul"], Some(nul_list(&rels))).map(|_| ())
    } else {
        // Nothing to restore from before the first commit: take the paths out of the index.
        run(root, false, &["rm", "--cached", "-r", "-q", "--ignore-unmatch", "--pathspec-from-file=-", "--pathspec-file-nul"], Some(nul_list(&rels))).map(|_| ())
    }
}

/// `ls-files -z <flags>` limited to `rels`, in batches that keep the command line short.
fn ls_files(root: &Path, flags: &[&str], rels: &[String]) -> Result<Vec<String>, String> {
    let mut found = Vec::new();
    let mut i = 0;
    while i < rels.len() {
        let mut args: Vec<&str> = vec!["ls-files", "-z"];
        args.extend_from_slice(flags);
        args.push("--");
        let mut len = 0;
        while i < rels.len() && (len == 0 || len + rels[i].len() < 24_000) {
            len += rels[i].len() + 3;
            args.push(&rels[i]);
            i += 1;
        }
        let out = run_text(root, true, &args)?;
        found.extend(out.split('\0').filter(|s| !s.is_empty()).map(str::to_string));
    }
    Ok(found)
}

/// Throw away work-tree changes: tracked files go back to their staged (index) version; untracked
/// files (and untracked files inside a given folder) go to the Recycle Bin.
fn discard(root: &Path, paths: &[String]) -> Result<(), String> {
    let rels = rels(root, paths)?;
    if rels.is_empty() {
        return Ok(());
    }
    let tracked = ls_files(root, &["--cached"], &rels)?;
    let untracked = ls_files(root, &["--others", "--exclude-standard"], &rels)?;
    if !tracked.is_empty() {
        let mut uniq = tracked;
        uniq.dedup(); // conflicted files are listed once per stage
        run(root, false, &["restore", "--worktree", "--pathspec-from-file=-", "--pathspec-file-nul"], Some(nul_list(&uniq)))?;
    }
    if !untracked.is_empty() {
        let abs: Vec<String> = untracked.iter().map(|r| abs_path(root, r)).collect();
        trash::delete_all(&abs).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn commit(root: &Path, message: &str, amend: bool) -> Result<GitCommitResult, String> {
    // Amending with no message keeps the last commit's.
    let keep = amend && message.trim().is_empty();
    let mut args = if keep { vec!["commit", "--no-edit"] } else { vec!["commit", "-F", "-"] };
    if amend {
        args.push("--amend");
    }
    let mut cmd = git(root, false);
    cmd.args(&args);
    let out = exec(cmd, if keep { None } else { Some(message.as_bytes().to_vec()) })?;
    if !out.ok {
        // "nothing to commit" is printed on stdout.
        let msg = if out.stderr.is_empty() { String::from_utf8_lossy(&out.stdout).trim().to_string() } else { out.stderr };
        return Err(if msg.is_empty() { "git commit failed".into() } else { msg });
    }
    let info = run_text(root, true, &["log", "-1", "--format=%h%x00%s"])?;
    let (sha, summary) = info.trim_end().split_once('\0').unwrap_or((info.trim(), ""));
    Ok(GitCommitResult { sha: sha.to_string(), summary: summary.to_string() })
}

// ---------- branches ----------

fn branches(root: &Path) -> Result<Vec<GitBranch>, String> {
    let fmt = "--format=%(refname)%00%(HEAD)%00%(upstream:short)%00%(objectname:short)%00%(committerdate:unix)%00%(symref)%00%(contents:subject)%1e";
    let out = run_text(root, true, &["for-each-ref", fmt, "refs/heads", "refs/remotes"])?;
    let mut list: Vec<GitBranch> = out
        .split('\x1e')
        .filter_map(|rec| {
            let f: Vec<&str> = rec.trim_start_matches(['\n', '\r']).splitn(7, '\0').collect();
            if f.len() < 7 || !f[5].is_empty() {
                return None; // incomplete, or a symbolic ref such as origin/HEAD
            }
            let (name, remote) = if let Some(n) = f[0].strip_prefix("refs/heads/") {
                (n, false)
            } else {
                (f[0].strip_prefix("refs/remotes/")?, true)
            };
            Some(GitBranch {
                name: name.to_string(),
                remote,
                current: f[1] == "*",
                upstream: Some(f[2]).filter(|u| !u.is_empty()).map(str::to_string),
                sha: f[3].to_string(),
                time: f[4].parse().unwrap_or(0),
                summary: f[6].to_string(),
            })
        })
        .collect();
    list.sort_by(|a, b| a.remote.cmp(&b.remote).then(b.time.cmp(&a.time)));
    Ok(list)
}

fn ref_exists(root: &Path, full: &str) -> bool {
    run(root, true, &["show-ref", "--verify", "-q", full], None).is_ok()
}

fn remotes(root: &Path) -> Result<Vec<String>, String> {
    Ok(run_text(root, true, &["remote"])?.lines().map(str::trim).filter(|l| !l.is_empty()).map(str::to_string).collect())
}

/// `remote -v`: one fetch and one push line per remote; the fetch URL is the one shown.
fn remote_list(root: &Path) -> Result<Vec<GitRemote>, String> {
    let mut list: Vec<GitRemote> = Vec::new();
    for line in run_text(root, true, &["remote", "-v"])?.lines() {
        let Some((name, rest)) = line.split_once('\t') else { continue };
        let Some(url) = rest.strip_suffix(" (fetch)") else { continue };
        list.push(GitRemote { name: name.to_string(), url: url.to_string() });
    }
    Ok(list)
}

fn add_remote(root: &Path, name: &str, url: &str) -> Result<(), String> {
    let (name, url) = (name.trim(), url.trim());
    if name.is_empty() || url.is_empty() {
        return Err("a remote needs a name and a URL".into());
    }
    // "--" so a name or URL starting with "-" is never read as an option.
    run(root, false, &["remote", "add", "--", name, url], None).map(|_| ())
}

/// Point a remote at another URL. Its remote-tracking branches belonged to the old repository, so
/// they go (offline: no fetch); the next push publishes the branch there and tracks it again.
fn set_remote_url(root: &Path, name: &str, url: &str) -> Result<(), String> {
    let (name, url) = (name.trim(), url.trim());
    if name.is_empty() || url.is_empty() {
        return Err("a remote needs a name and a URL".into());
    }
    run(root, false, &["remote", "set-url", "--", name, url], None)?;
    let refs = run_text(root, true, &["for-each-ref", "--format=%(refname)", &format!("refs/remotes/{name}/")])?;
    let script: String = refs.lines().filter(|l| !l.is_empty()).map(|r| format!("delete {r}\n")).collect();
    if !script.is_empty() {
        // --no-deref: `origin/HEAD` is a symref to `origin/main`; following it would delete
        // `origin/main` twice in one transaction, which git refuses.
        run(root, false, &["update-ref", "--no-deref", "--stdin"], Some(script.into_bytes()))?;
    }
    Ok(())
}

// ---------- identity ----------

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitIdentity {
    pub name: Option<String>,
    pub email: Option<String>,
    /// Where each value comes from: "local" (this repository), "global", "system"…
    pub name_scope: Option<String>,
    pub email_scope: Option<String>,
}

/// `config --show-scope --get`: (value, scope), both None when unset.
fn config_value(root: &Path, key: &str) -> (Option<String>, Option<String>) {
    let Ok(text) = run_text(root, true, &["config", "--show-scope", "--get", key]) else { return (None, None) };
    let text = text.trim_end_matches(['\r', '\n']);
    match text.split_once('\t') {
        Some((scope, v)) if !v.trim().is_empty() => (Some(v.to_string()), Some(scope.to_string())),
        _ => (None, None),
    }
}

fn identity(root: &Path) -> GitIdentity {
    let (name, name_scope) = config_value(root, "user.name");
    let (email, email_scope) = config_value(root, "user.email");
    GitIdentity { name, email, name_scope, email_scope }
}

/// Set the name and email commits are made with, for every repository (`global`) or this one. A
/// global save also drops this repository's own values, which would otherwise still win here.
fn set_identity(root: &Path, name: &str, email: &str, global: bool) -> Result<(), String> {
    let (name, email) = (name.trim(), email.trim());
    if name.is_empty() || email.is_empty() {
        return Err("commits need both a name and an email".into());
    }
    let scope = if global { "--global" } else { "--local" };
    run(root, false, &["config", scope, "user.name", name], None)?;
    run(root, false, &["config", scope, "user.email", email], None)?;
    if global {
        for key in ["user.name", "user.email"] {
            let _ = run(root, false, &["config", "--local", "--unset-all", key], None);
        }
    }
    Ok(())
}

// ---------- creating a GitHub repository ----------

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GithubRepo {
    /// `owner/name`.
    pub full_name: String,
    pub clone_url: String,
    pub html_url: String,
    /// The account already had a repository with this name (nothing was created).
    pub existed: bool,
    /// It has no commits yet (always true for a new one).
    pub empty: bool,
    pub private: bool,
}

const GITHUB_API: &str = "https://api.github.com";

/// GitHub's own rule for repository names.
fn valid_repo_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 100 && name != "." && name != ".." && name.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
}

/// `key=value` lines of the git credential protocol.
fn credential_field<'a>(text: &'a str, key: &str) -> Option<&'a str> {
    text.lines().find_map(|l| l.strip_prefix(key)?.strip_prefix('='))
}

/// `git credential <action>`; the credential goes on stdin, never the command line.
fn credential(root: &Path, action: &str, input: &str) -> Result<Output, String> {
    let mut cmd = git(root, true);
    cmd.args(["credential", action]);
    exec(cmd, Some(input.as_bytes().to_vec()))
}

/// A stored github.com token for `account`, without ever showing a sign-in window (None if there
/// is none).
fn stored_github_token(root: &Path, account: &str) -> Option<String> {
    if account.is_empty() || account.contains(['\n', '\r']) {
        return None;
    }
    let mut cmd = git(root, true);
    cmd.args(["credential", "fill"]).env("GCM_INTERACTIVE", "never");
    let out = exec(cmd, Some(format!("protocol=https\nhost=github.com\nusername={account}\n\n").into_bytes())).ok()?;
    let text = String::from_utf8_lossy(&out.stdout).into_owned();
    credential_field(&text, "password").filter(|t| out.ok && !t.is_empty()).map(str::to_string)
}

/// Windows' own curl (not Git's or another one on PATH).
fn curl() -> Command {
    let sys = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    let exe = sys.join("System32").join("curl.exe");
    let mut cmd = Command::new(if exe.is_file() { exe } else { PathBuf::from("curl") });
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

enum CreateError {
    /// GitHub turned the token down (401): forget it so the next try signs in again.
    Unauthorized,
    Other(String),
}

/// One GitHub API call with `token` ("" for none): (HTTP status, JSON body). The token reaches
/// curl through its config on stdin, so it is never on a command line.
fn github_api(api: &str, token: &str, method: &str, path: &str, body: Option<&str>) -> Result<(u16, serde_json::Value), CreateError> {
    let mut cmd = curl();
    cmd.args(["-sS", "--max-time", "60", "-K", "-", "-X", method]);
    cmd.args(["-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2022-11-28"]);
    if let Some(body) = body {
        cmd.args(["-H", "Content-Type: application/json", "--data-raw", body]);
    }
    cmd.args(["-w", "\n%{http_code}", &format!("{api}{path}")]);
    let config = if token.is_empty() { String::new() } else { format!("header = \"Authorization: Bearer {token}\"\n") };
    let out = exec(cmd, Some(config.into_bytes())).map_err(|e| CreateError::Other(e.replace("git", "curl")))?;
    let text = String::from_utf8_lossy(&out.stdout);
    let (json, code) = text.rsplit_once('\n').unwrap_or(("", &text));
    let code: u16 = code.trim().parse().unwrap_or(0);
    if code == 0 || !out.ok {
        return Err(CreateError::Other(format!("could not reach GitHub: {}", if out.stderr.is_empty() { "no response" } else { &out.stderr })));
    }
    if code == 401 {
        return Err(CreateError::Unauthorized);
    }
    Ok((code, serde_json::from_str(json).unwrap_or(serde_json::Value::Null)))
}

fn repo_from(v: &serde_json::Value, existed: bool) -> GithubRepo {
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    // `size` (KB) is 0 until the first push.
    let empty = !existed || v.get("size").and_then(|x| x.as_u64()) == Some(0);
    let private = v.get("private").and_then(|x| x.as_bool()).unwrap_or(false);
    GithubRepo { full_name: s("full_name"), clone_url: s("clone_url"), html_url: s("html_url"), existed, empty, private }
}

/// `(owner, name)` of a github.com remote URL (https or ssh), or None for any other host.
fn github_slug(url: &str) -> Option<(String, String)> {
    let u = url.trim();
    let at = u.find("github.com")?;
    // github.com itself, not e.g. notgithub.com: preceded by "//" or "user@".
    if !(u[..at].ends_with("//") || u[..at].ends_with('@')) {
        return None;
    }
    let rest = &u[at + "github.com".len()..];
    let rest = rest.strip_prefix(':').or_else(|| rest.strip_prefix('/'))?.trim_end_matches('/');
    let rest = rest.strip_suffix(".git").unwrap_or(rest);
    let (owner, name) = rest.split_once('/')?;
    let owner_ok = !owner.is_empty() && owner.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-');
    (owner_ok && valid_repo_name(name)).then(|| (owner.to_string(), name.to_string()))
}

/// GET /repos/{owner}/{name}: the repository, or None when this token (or none) can't see it.
fn repo_info_request(api: &str, token: &str, owner: &str, name: &str) -> Result<Option<GithubRepo>, String> {
    match github_api(api, token, "GET", &format!("/repos/{owner}/{name}"), None) {
        Ok((200, v)) => Ok(Some(repo_from(&v, true))),
        Ok(_) | Err(CreateError::Unauthorized) => Ok(None),
        Err(CreateError::Other(e)) => Err(e),
    }
}

/// A github.com remote's repository (for its Private / Public badge), with `account`'s stored
/// sign-in when there is one, else without any (which only sees public repositories). Never opens
/// a sign-in window. None for other hosts or a repository that can't be seen.
fn github_repo_info(root: &Path, url: &str, account: Option<&str>) -> Result<Option<GithubRepo>, String> {
    let Some((owner, name)) = github_slug(url) else { return Ok(None) };
    if let Some(token) = account.and_then(|a| stored_github_token(root, a.trim()))
        && let Some(repo) = repo_info_request(GITHUB_API, &token, &owner, &name)?
    {
        return Ok(Some(repo));
    }
    repo_info_request(GITHUB_API, "", &owner, &name)
}

/// The signed-in account's repository `name`, when there is one.
fn existing_repo(api: &str, token: &str, name: &str) -> Option<GithubRepo> {
    let (code, user) = github_api(api, token, "GET", "/user", None).ok()?;
    let login = user.get("login")?.as_str().filter(|_| code == 200)?.to_string();
    let (code, v) = github_api(api, token, "GET", &format!("/repos/{login}/{name}"), None).ok()?;
    (code == 200).then(|| repo_from(&v, true))
}

/// POST /user/repos. When the name is taken on the account, that repository is returned instead
/// (`existed`), for the caller to offer.
fn create_repo_request(api: &str, token: &str, name: &str, private: bool) -> Result<GithubRepo, CreateError> {
    let body = serde_json::json!({ "name": name, "private": private }).to_string();
    let (code, v) = github_api(api, token, "POST", "/user/repos", Some(&body))?;
    if code == 201 {
        return Ok(repo_from(&v, false));
    }
    // 422 explains itself in `errors` ("name already exists on this account").
    let detail = v.get("errors").and_then(|e| e.as_array()).and_then(|a| a.iter().find_map(|e| e.get("message")?.as_str())).map(str::to_string);
    let msg = detail.unwrap_or_else(|| v.get("message").and_then(|m| m.as_str()).unwrap_or("").to_string());
    if code == 422
        && msg.contains("already exists")
        && let Some(repo) = existing_repo(api, token, name)
    {
        return Ok(repo);
    }
    Err(CreateError::Other(match code {
        403 | 404 => format!("GitHub refused to create the repository ({code}: {msg}). Your sign-in may not be allowed to create repositories."),
        _ => format!("GitHub could not create the repository ({code}): {msg}"),
    }))
}

/// Accounts in `git credential-manager github list` output, one per line.
fn account_lines(text: &str) -> Vec<String> {
    text.lines().map(str::trim).filter(|l| !l.is_empty()).map(str::to_string).collect()
}

/// The GitHub accounts Git Credential Manager is signed in to (no window, no network). An error
/// when GCM isn't there (Git without it, or another credential helper).
fn github_accounts(root: &Path) -> Result<Vec<String>, String> {
    Ok(account_lines(&run_text(root, true, &["credential-manager", "github", "list"])?))
}

/// Sign in to (another) GitHub account in Git Credential Manager's own window; the accounts after.
fn github_login(root: &Path) -> Result<Vec<String>, String> {
    run(root, false, &["credential-manager", "github", "login"], None)?;
    github_accounts(root)
}

/// Create a repository on a GitHub account (`account`, or the one Git Credential Manager picks),
/// with the sign-in Git already keeps for github.com (GCM opens its sign-in window when there is none).
fn github_create(root: &Path, name: &str, private: bool, account: Option<&str>) -> Result<GithubRepo, String> {
    let name = name.trim();
    if !valid_repo_name(name) {
        return Err("a GitHub repository name can only use letters, digits, '-', '_' and '.'".into());
    }
    let user = account.map(str::trim).filter(|a| !a.is_empty() && !a.contains(['\n', '\r'])).map(|a| format!("username={a}\n")).unwrap_or_default();
    let ask = format!("protocol=https\nhost=github.com\n{user}\n");
    let filled = credential(root, "fill", &ask)?;
    let cred = String::from_utf8_lossy(&filled.stdout).into_owned();
    let Some(token) = credential_field(&cred, "password").filter(|t| filled.ok && !t.is_empty()) else {
        return Err(format!("no GitHub sign-in: {}", if filled.stderr.is_empty() { "Git Credential Manager did not return one" } else { &filled.stderr }));
    };
    // The protocol's answer, ending in a blank line, is what approve / reject take back.
    let back = format!("{}\n\n", cred.trim_end());
    match create_repo_request(GITHUB_API, token, name, private) {
        Ok(repo) => {
            let _ = credential(root, "approve", &back);
            Ok(repo)
        }
        Err(CreateError::Unauthorized) => {
            let _ = credential(root, "reject", &back);
            Err("GitHub did not accept your sign-in. Try again to sign in afresh.".into())
        }
        Err(CreateError::Other(e)) => Err(e),
    }
}

fn checkout(root: &Path, name: &str, create: bool) -> Result<(), String> {
    if create {
        return run(root, false, &["switch", "-c", name], None).map(|_| ());
    }
    if !ref_exists(root, &format!("refs/heads/{name}")) && ref_exists(root, &format!("refs/remotes/{name}")) {
        // A remote branch: use its local branch if there is one, else create a tracking branch.
        let local = remotes(root)?
            .iter()
            .filter_map(|r| name.strip_prefix(r.as_str()).and_then(|s| s.strip_prefix('/')))
            .min_by_key(|s| s.len()) // the longest matching remote name
            .map(str::to_string);
        if let Some(local) = local
            && ref_exists(root, &format!("refs/heads/{local}"))
        {
            return run(root, false, &["switch", &local], None).map(|_| ());
        }
        return run(root, false, &["switch", "--track", name], None).map(|_| ());
    }
    run(root, false, &["switch", name], None).map(|_| ())
}

// ---------- remotes ----------

fn combined(out: &Output) -> String {
    let stdout = String::from_utf8_lossy(&out.stdout);
    [stdout.trim(), out.stderr.as_str()].iter().filter(|s| !s.is_empty()).copied().collect::<Vec<_>>().join("\n")
}

/// `-c` options for a background check: never wait on an SSH passphrase (unless the user set their
/// own ssh command), and give up on a stalled HTTP transfer.
fn quiet_options(root: &Path) -> Vec<String> {
    let mut v: Vec<String> = ["-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=20"].map(String::from).to_vec();
    if std::env::var_os("GIT_SSH_COMMAND").is_none() && run(root, true, &["config", "--get", "core.sshCommand"], None).is_err() {
        v.extend(["-c".into(), "core.sshCommand=ssh -o BatchMode=yes -o ConnectTimeout=15".into()]);
    }
    v
}

/// fetch / pull / push, and:
/// - "check": the panel's background fetch of the branch's remote, which must never prompt
///   (no sign-in window, no SSH passphrase); it only updates remote-tracking branches.
/// - "pull-merge" / "pull-rebase": a pull that says how to join diverged branches (a plain pull
///   refuses to choose when `pull.rebase` / `pull.ff` aren't set).
fn remote_op(root: &Path, op: &str) -> Result<String, String> {
    let mut quiet = false;
    let args: Vec<String> = match op {
        "fetch" => vec!["fetch".into(), "--all".into(), "--prune".into()],
        "check" => {
            quiet = true;
            let mut v = quiet_options(root);
            v.extend(["fetch".into(), "--prune".into(), "--quiet".into()]);
            v
        }
        "pull" => vec!["pull".into()],
        "pull-merge" => vec!["pull".into(), "--no-rebase".into()],
        "pull-rebase" => vec!["pull".into(), "--rebase".into()],
        "push" => {
            let has_upstream = run(root, true, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], None).is_ok();
            if has_upstream {
                vec!["push".into()]
            } else {
                let remotes = remotes(root)?;
                let remote = remotes.iter().find(|r| *r == "origin").or(remotes.first()).ok_or("this repository has no remote to push to")?;
                vec!["push".into(), "--set-upstream".into(), remote.clone(), "HEAD".into()]
            }
        }
        _ => return Err(format!("unknown remote operation {op}")),
    };
    let mut cmd = git(root, false);
    cmd.args(&args);
    if quiet {
        cmd.env("GCM_INTERACTIVE", "never");
    }
    let out = exec(cmd, None)?;
    let text = combined(&out);
    if out.ok {
        Ok(if text.is_empty() { "Done.".into() } else { text })
    } else {
        Err(if text.is_empty() { format!("git {op} failed") } else { text })
    }
}

// ---------- blame ----------

fn is_sha(s: &str) -> bool {
    (s.len() == 40 || s.len() == 64) && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Parse `blame --porcelain`: a header `<sha> <orig> <final> [<count>]`, the commit's details the
/// first time it appears, then the line itself prefixed by a tab.
fn parse_blame(out: &[u8]) -> GitBlame {
    let mut commits: Vec<GitCommitInfo> = Vec::new();
    let mut index: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    let mut lines: Vec<u32> = Vec::new();
    let mut cur: Option<u32> = None;
    for raw in out.split(|&b| b == b'\n') {
        if raw.first() == Some(&b'\t') {
            cur = None; // the line's text
            continue;
        }
        let line = String::from_utf8_lossy(raw);
        if cur.is_none() {
            let mut parts = line.split(' ');
            let (Some(sha), _, Some(fin)) = (parts.next(), parts.next(), parts.next()) else { continue };
            if !is_sha(sha) {
                continue;
            }
            let id = *index.entry(sha.to_string()).or_insert_with(|| {
                commits.push(GitCommitInfo {
                    sha: sha.to_string(),
                    short: sha[..7].to_string(),
                    author: String::new(),
                    email: String::new(),
                    time: 0,
                    summary: String::new(),
                    uncommitted: sha.bytes().all(|b| b == b'0'),
                });
                commits.len() as u32 - 1
            });
            let fin: usize = fin.parse().unwrap_or(0);
            if fin >= 1 {
                if lines.len() < fin {
                    lines.resize(fin, 0);
                }
                lines[fin - 1] = id;
            }
            cur = Some(id);
            continue;
        }
        let c = &mut commits[cur.unwrap() as usize];
        let (k, v) = line.split_once(' ').unwrap_or((&line, ""));
        match k {
            "author" => c.author = v.to_string(),
            "author-mail" => c.email = v.trim_start_matches('<').trim_end_matches('>').to_string(),
            "author-time" => c.time = v.parse().unwrap_or(0),
            "summary" => c.summary = v.to_string(),
            _ => {}
        }
    }
    GitBlame { commits, lines }
}

/// The bytes git should see for an unsaved buffer: the file's encoding, its BOM if the file on
/// disk has one, and its line endings (`eol`, else those of the file on disk; the editor's buffer
/// uses `\n`), so unchanged lines match their committed version.
fn buffer_bytes(path: &Path, contents: &str, encoding: Option<&str>, eol: Option<&str>) -> Result<Vec<u8>, String> {
    let enc: &'static Encoding = encoding.and_then(|l| Encoding::for_label(l.as_bytes())).unwrap_or(UTF_8);
    let head: Vec<u8> = std::fs::File::open(path)
        .ok()
        .map(|f| {
            let mut buf = Vec::new();
            let _ = std::io::Read::read_to_end(&mut std::io::Read::take(f, 64 * 1024), &mut buf);
            buf
        })
        .unwrap_or_default();
    let bom = Encoding::for_bom(&head).is_some_and(|(e, _)| e == enc);
    let crlf = match eol {
        Some(e) => e.eq_ignore_ascii_case("CRLF"),
        None => {
            let (disk_enc, bom_len) = files::detect_encoding(&head, Some(enc.name()));
            disk_enc.decode_without_bom_handling(&head[bom_len..]).0.contains("\r\n")
        }
    };
    let cr = eol.is_some_and(|e| e.eq_ignore_ascii_case("CR"));
    let text: std::borrow::Cow<str> = if contents.contains('\r') {
        contents.into()
    } else if crlf {
        contents.replace('\n', "\r\n").into()
    } else if cr {
        contents.replace('\n', "\r").into()
    } else {
        contents.into()
    };
    files::encode_text(&text, enc, bom)
}

fn blame(path: &str, contents: Option<String>, encoding: Option<String>, eol: Option<String>) -> Result<Option<GitBlame>, String> {
    let file = Path::new(path);
    let Some(root) = find_root(file)? else { return Ok(None) };
    let rel = rel_path(&root, path)?;
    if !has_head(&root) || ls_files(&root, &["--cached"], std::slice::from_ref(&rel))?.is_empty() {
        return Ok(None); // untracked, or nothing committed yet
    }
    let input = match &contents {
        Some(c) => Some(buffer_bytes(file, c, encoding.as_deref(), eol.as_deref())?),
        None => None,
    };
    let mut args = vec!["blame", "--porcelain"];
    if input.is_some() {
        args.extend(["--contents", "-"]);
    }
    args.extend(["--", &rel]);
    match run(&root, true, &args, input) {
        Ok(out) => Ok(Some(parse_blame(&out))),
        Err(e) if e.contains("no such path") => Ok(None), // staged as new, not in HEAD
        Err(e) => Err(e),
    }
}

// ---------- log ----------

fn parse_log(out: &[u8], root: &Path, start_rel: &str, follow: bool) -> Vec<GitLogEntry> {
    let text = String::from_utf8_lossy(out);
    let root_s = root.to_string_lossy().into_owned();
    let mut rel = start_rel.to_string();
    let mut list = Vec::new();
    for rec in text.split('\x1e').filter(|r| !r.is_empty()) {
        let f: Vec<&str> = rec.split('\0').collect();
        if f.len() < 6 {
            continue;
        }
        if follow {
            // After the fields: the file's name in this commit (missing for a merge: keep the newer one).
            if let Some(name) = f[6..].iter().map(|s| s.trim_matches(['\n', '\r'])).find(|s| !s.is_empty()) {
                rel = name.to_string();
            }
        }
        list.push(GitLogEntry {
            sha: f[0].to_string(),
            short: f[1].to_string(),
            author: f[2].to_string(),
            email: f[3].to_string(),
            time: f[4].parse().unwrap_or(0),
            summary: f[5].trim_end_matches(['\n', '\r']).to_string(),
            rel: rel.clone(),
            root: root_s.clone(),
        });
    }
    list
}

/// History of a file (following renames) or a folder (the repository root: every commit).
fn log(path: &str, skip: u32, limit: u32) -> Result<Vec<GitLogEntry>, String> {
    let p = Path::new(path);
    let Some(root) = find_root(p)? else { return Ok(Vec::new()) };
    if !has_head(&root) {
        return Ok(Vec::new());
    }
    let rel = rel_path(&root, path)?;
    let follow = !rel.is_empty() && !p.is_dir();
    let skip_arg = format!("--skip={skip}");
    let limit_arg = format!("--max-count={}", limit.max(1));
    let mut args = vec!["log", "-z", "--format=%x1e%H%x00%h%x00%an%x00%ae%x00%at%x00%s", &skip_arg, &limit_arg];
    if follow {
        args.extend(["--follow", "--name-only"]);
    }
    if !rel.is_empty() {
        args.extend(["--", &rel]);
    }
    let out = run(&root, true, &args, None)?;
    Ok(parse_log(&out, &root, &rel, follow))
}

/// A file a commit changed (against its first parent; everything for the first commit).
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitFile {
    /// Where the file is (or would be) in the work tree.
    pub path: String,
    /// Repo-relative path (`/`-separated) at this commit.
    pub rel: String,
    /// A (added), M (modified), D (deleted), R (renamed), ...: git's status letter.
    pub status: String,
    /// The path before the commit, for a rename or copy.
    pub orig_rel: Option<String>,
}

fn parse_commit_files(out: &[u8], root: &Path) -> Vec<GitCommitFile> {
    let text = String::from_utf8_lossy(out);
    let mut parts = text.split('\0').map(|s| s.trim_start_matches(['\n', '\r'])).filter(|s| !s.is_empty());
    let mut list = Vec::new();
    while let Some(code) = parts.next() {
        let status: String = code.chars().take(1).collect();
        let two = matches!(status.as_str(), "R" | "C");
        let Some(first) = parts.next() else { break };
        let (orig_rel, rel) = if two {
            let Some(to) = parts.next() else { break };
            (Some(first.to_string()), to.to_string())
        } else {
            (None, first.to_string())
        };
        list.push(GitCommitFile { path: abs_path(root, &rel), rel, status, orig_rel });
    }
    list
}

/// The files `sha` changed.
fn commit_files(root: &Path, sha: &str) -> Result<Vec<GitCommitFile>, String> {
    if !is_sha(sha) {
        return Err("not a commit id".into());
    }
    let out = run(root, true, &["show", "--format=", "--name-status", "-z", "-M", "--diff-merges=first-parent", sha], None)?;
    Ok(parse_commit_files(&out, root))
}

/// Commits on the current branch that its upstream does not have yet (newest first, at most 500).
/// Empty when there is no upstream.
fn unpushed(root: &Path) -> Vec<String> {
    match run_text(root, true, &["rev-list", "--max-count=500", "@{upstream}..HEAD"]) {
        Ok(t) => t.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect(),
        Err(_) => Vec::new(),
    }
}

// ---------- commit graph ----------

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitGraphCommit {
    pub sha: String,
    pub short: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub time: i64,
    /// Full ref names pointing here: `HEAD`, `refs/heads/main`, `refs/remotes/origin/main`,
    /// `refs/tags/v1` (a `HEAD -> x` decoration becomes `HEAD` and `x`).
    pub refs: Vec<String>,
    pub summary: String,
}

fn parse_graph(out: &[u8]) -> Vec<GitGraphCommit> {
    let text = String::from_utf8_lossy(out);
    let mut list = Vec::new();
    for rec in text.split('\x1e').filter(|r| !r.is_empty()) {
        let f: Vec<&str> = rec.split('\0').collect();
        if f.len() < 8 {
            continue;
        }
        let mut refs = Vec::new();
        for d in f[6].split(", ").map(str::trim).filter(|d| !d.is_empty()) {
            if let Some(target) = d.strip_prefix("HEAD -> ") {
                refs.push("HEAD".to_string());
                refs.push(target.to_string());
            } else {
                refs.push(d.strip_prefix("tag: ").unwrap_or(d).to_string());
            }
        }
        list.push(GitGraphCommit {
            sha: f[0].to_string(),
            short: f[1].to_string(),
            parents: f[2].split(' ').filter(|p| !p.is_empty()).map(str::to_string).collect(),
            author: f[3].to_string(),
            email: f[4].to_string(),
            time: f[5].parse().unwrap_or(0),
            refs,
            summary: f[7].trim_end_matches(['\n', '\r']).to_string(),
        });
    }
    list
}

/// One page of the commit graph, children before parents. `all`: every branch and
/// tag; otherwise the current branch and its upstream (so commits to pull show too).
fn graph(root: &Path, all: bool, skip: u32, limit: u32) -> Result<Vec<GitGraphCommit>, String> {
    if !has_head(root) {
        return Ok(Vec::new());
    }
    let skip_arg = format!("--skip={skip}");
    let limit_arg = format!("--max-count={}", limit.clamp(1, 5000));
    // Topological order: a branch's commits stay together, which keeps the graph several times
    // narrower than date order on histories with many merged branches.
    let mut args = vec!["log", "-z", "--topo-order", "--decorate=full", GRAPH_FORMAT, &skip_arg, &limit_arg];
    args.extend(graph_scope(root, all));
    let out = run(root, true, &args, None)?;
    Ok(parse_graph(&out))
}

const GRAPH_FORMAT: &str = "--format=%x1e%H%x00%h%x00%P%x00%an%x00%ae%x00%at%x00%D%x00%s";

/// The revisions the graph covers: everything, or the current branch and its upstream.
fn graph_scope(root: &Path, all: bool) -> Vec<&'static str> {
    if all {
        return vec!["--exclude=refs/stash", "--all", "HEAD"];
    }
    let mut v = vec!["HEAD"];
    if run(root, true, &["rev-parse", "--verify", "--quiet", "@{upstream}"], None).is_ok() {
        v.push("@{upstream}");
    }
    v
}

/// Search the whole history (not just the pages loaded): commits whose message or author
/// contains `query` (ignoring case), that a branch or tag whose name contains it points at, or
/// the commit `query` is an id of. Newest first.
fn graph_search(root: &Path, all: bool, query: &str, limit: u32) -> Result<Vec<GitGraphCommit>, String> {
    let q = query.trim();
    if q.is_empty() || !has_head(root) {
        return Ok(Vec::new());
    }
    let limit_arg = format!("--max-count={}", limit.clamp(1, 1000));
    let scope = graph_scope(root, all);
    let mut found: Vec<GitGraphCommit> = Vec::new();
    for filter in [format!("--grep={q}"), format!("--author={q}")] {
        let mut args = vec!["log", "-z", "--decorate=full", GRAPH_FORMAT, &limit_arg, "-i", "--fixed-strings", &filter];
        args.extend(scope.iter().copied());
        found.extend(parse_graph(&run(root, true, &args, None)?));
    }
    // Branches and tags whose name contains the text (ignoring case): the commits they point at,
    // when those are in the scope (`--simplify-by-decoration` keeps only commits the given refs decorate).
    let lower = q.to_lowercase();
    let refs: Vec<String> = run_text(root, true, &["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes", "refs/tags"])?
        .lines()
        .map(str::trim)
        .filter(|r| !r.is_empty() && !r.ends_with("/HEAD"))
        .filter(|r| ["refs/heads/", "refs/remotes/", "refs/tags/"].iter().find_map(|p| r.strip_prefix(p)).is_some_and(|n| n.to_lowercase().contains(&lower)))
        .take(200)
        .map(String::from)
        .collect();
    if !refs.is_empty() {
        let filters: Vec<String> = refs.iter().map(|r| format!("--decorate-refs={r}")).collect();
        let mut args = vec!["log", "-z", "--decorate=full", GRAPH_FORMAT, &limit_arg, "--simplify-by-decoration"];
        args.extend(filters.iter().map(String::as_str));
        args.extend(scope.iter().copied());
        // The simplification also keeps root commits: only those a matching ref points at count.
        let shas: Vec<String> = parse_graph(&run(root, true, &args, None)?).into_iter().filter(|c| c.refs.iter().any(|r| refs.contains(r))).map(|c| c.sha).take(200).collect();
        if !shas.is_empty() {
            // Again with every label (the filter above hid the others).
            let mut args = vec!["log", "-z", "--decorate=full", GRAPH_FORMAT, "--no-walk"];
            args.extend(shas.iter().map(String::as_str));
            found.extend(parse_graph(&run(root, true, &args, None)?));
        }
    }
    if (4..=64).contains(&q.len()) && q.bytes().all(|b| b.is_ascii_hexdigit()) {
        let spec = format!("{q}^{{commit}}");
        if let Ok(sha) = run_text(root, true, &["rev-parse", "--verify", "--quiet", &spec]) {
            let sha = sha.trim().to_string();
            if let Ok(out) = run(root, true, &["log", "-z", "--decorate=full", GRAPH_FORMAT, "-1", &sha], None) {
                found.extend(parse_graph(&out));
            }
        }
    }
    found.sort_by(|a, b| b.time.cmp(&a.time));
    let mut seen = std::collections::HashSet::new();
    found.retain(|c| seen.insert(c.sha.clone()));
    found.truncate(limit.clamp(1, 1000) as usize);
    Ok(found)
}

/// Has git written its commit-graph file for this repository? With it, a page of the graph costs
/// the same however deep the history; without it, git walks the whole history for every page.
fn has_commit_graph(root: &Path) -> bool {
    let Ok(dir) = run_text(root, true, &["rev-parse", "--git-common-dir"]) else { return false };
    let dir = root.join(dir.trim().replace('/', "\\"));
    let info = dir.join("objects").join("info");
    info.join("commit-graph").is_file() || info.join("commit-graphs").join("commit-graph-chain").is_file()
}

/// Write git's commit-graph file (what `git gc` does): an index of the history inside `.git`.
fn write_commit_graph(root: &Path) -> Result<(), String> {
    run(root, false, &["commit-graph", "write", "--reachable"], None).map(|_| ())
}

/// Everything the details pane shows for one commit.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitDetail {
    pub sha: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub committer: String,
    pub committer_email: String,
    pub commit_time: i64,
    /// The whole message (subject and body).
    pub message: String,
    /// git's summary line: "3 files changed, 10 insertions(+), 2 deletions(-)" ("" when nothing changed).
    pub stat: String,
    pub files: Vec<GitCommitFile>,
}

fn commit_detail(root: &Path, sha: &str) -> Result<GitCommitDetail, String> {
    if !is_sha(sha) {
        return Err("not a commit id".into());
    }
    let head = run_text(root, true, &["show", "-s", "--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%B", sha])?;
    let f: Vec<&str> = head.splitn(9, '\0').collect();
    if f.len() < 9 {
        return Err("unexpected output from git show".into());
    }
    let stat = run_text(root, true, &["show", "--format=", "--shortstat", "--diff-merges=first-parent", sha]).unwrap_or_default();
    Ok(GitCommitDetail {
        sha: f[0].trim().to_string(),
        parents: f[1].split(' ').filter(|p| !p.is_empty()).map(str::to_string).collect(),
        author: f[2].to_string(),
        email: f[3].to_string(),
        time: f[4].parse().unwrap_or(0),
        committer: f[5].to_string(),
        committer_email: f[6].to_string(),
        commit_time: f[7].parse().unwrap_or(0),
        message: f[8].trim_end().to_string(),
        stat: stat.trim().to_string(),
        files: commit_files(root, sha)?,
    })
}

/// A valid new branch / tag name (git's own rules), not starting with `-`.
fn valid_ref_name(root: &Path, name: &str) -> bool {
    !name.is_empty() && !name.starts_with('-') && run(root, true, &["check-ref-format", "--branch", name], None).is_ok()
}

/// An action on a commit from the graph. `name`: the new branch / tag for those actions.
/// Returns git's output (shown when it says something useful).
fn commit_action(root: &Path, action: &str, sha: &str, name: Option<&str>) -> Result<String, String> {
    if !is_sha(sha) {
        return Err("not a commit id".into());
    }
    let named = || -> Result<&str, String> {
        let n = name.map(str::trim).unwrap_or("");
        if valid_ref_name(root, n) { Ok(n) } else { Err(format!("\"{n}\" is not a valid name")) }
    };
    // A merge is picked / reverted against its first parent.
    let merge = run_text(root, true, &["rev-list", "--parents", "-n", "1", sha]).map(|t| t.split_whitespace().count() > 2).unwrap_or(false);
    let args: Vec<&str> = match action {
        "checkout" => vec!["checkout", "--detach", sha],
        "branch" => vec!["branch", named()?, sha],
        "branch-switch" => vec!["switch", "-c", named()?, sha],
        "tag" => vec!["tag", named()?, sha],
        "cherry-pick" if merge => vec!["cherry-pick", "-m", "1", sha],
        "cherry-pick" => vec!["cherry-pick", sha],
        "revert" if merge => vec!["revert", "--no-edit", "-m", "1", sha],
        "revert" => vec!["revert", "--no-edit", sha],
        "reset-soft" => vec!["reset", "--soft", sha],
        "reset-mixed" => vec!["reset", "--mixed", sha],
        "reset-hard" => vec!["reset", "--hard", sha],
        _ => return Err(format!("unknown action {action}")),
    };
    let mut cmd = git(root, false);
    // Never wait on an editor (a conflict stops with a message instead).
    cmd.env("GIT_EDITOR", "true").args(&args);
    let out = exec(cmd, None)?;
    if out.ok { Ok(combined(&out)) } else { Err(combined(&out)) }
}

/// Carry on with the operation in progress once its conflicts are resolved (`how` = "continue"),
/// or leave out the commit it stopped on ("skip"). A rebase then replays its remaining commits,
/// and may stop again on the next conflict (an error whose text says so).
fn continue_operation(root: &Path, how: &str) -> Result<String, String> {
    let Some(op) = operation(root) else { return Err("Nothing is in progress.".into()) };
    let flag = match how {
        "continue" => "--continue",
        "skip" if op != "merge" => "--skip",
        "skip" => return Err("A merge has nothing to skip. Abort it instead.".into()),
        _ => return Err(format!("unknown step {how}")),
    };
    let mut cmd = git(root, false);
    // Each commit keeps its own message: never wait on an editor.
    cmd.env("GIT_EDITOR", "true").args([op.as_str(), flag]);
    let out = exec(cmd, None)?;
    if out.ok { Ok(op) } else { Err(combined(&out)) }
}

/// Abandon the merge / rebase / cherry-pick / revert in progress: back to how things were before it.
fn abort_operation(root: &Path) -> Result<String, String> {
    let Some(op) = operation(root) else { return Err("Nothing is in progress.".into()) };
    let out = exec(
        {
            let mut cmd = git(root, false);
            cmd.args([op.as_str(), "--abort"]);
            cmd
        },
        None,
    )?;
    if out.ok { Ok(op) } else { Err(combined(&out)) }
}

// ---------- commands ----------

/// The git version (`git version 2.53.0.windows.2`), or None when git cannot be run.
#[tauri::command]
pub async fn git_available() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut cmd = git(&std::env::temp_dir(), true);
        cmd.arg("--version");
        let out = exec(cmd, None).ok()?;
        out.ok.then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
pub async fn git_status(path: String) -> Result<Option<GitStatus>, String> {
    blocking(move || status(Path::new(&path))).await
}

#[tauri::command]
pub async fn git_show(path: String, rev: String, rel: Option<String>) -> Result<Option<GitBlob>, String> {
    blocking(move || show(&path, &rev, rel)).await
}

#[tauri::command]
pub async fn git_stage(root: String, paths: Vec<String>) -> Result<(), String> {
    blocking(move || stage(Path::new(&root), &paths)).await
}

#[tauri::command]
pub async fn git_unstage(root: String, paths: Vec<String>) -> Result<(), String> {
    blocking(move || unstage(Path::new(&root), &paths)).await
}

#[tauri::command]
pub async fn git_discard(root: String, paths: Vec<String>) -> Result<(), String> {
    blocking(move || discard(Path::new(&root), &paths)).await
}

#[tauri::command]
pub async fn git_commit(root: String, message: String, amend: bool) -> Result<GitCommitResult, String> {
    blocking(move || commit(Path::new(&root), &message, amend)).await
}

#[tauri::command]
pub async fn git_branches(root: String) -> Result<Vec<GitBranch>, String> {
    blocking(move || branches(Path::new(&root))).await
}

#[tauri::command]
pub async fn git_checkout(root: String, name: String, create: bool) -> Result<(), String> {
    blocking(move || checkout(Path::new(&root), &name, create)).await
}

/// "fetch" | "pull" | "push"; returns git's output.
#[tauri::command]
pub async fn git_remote(root: String, op: String) -> Result<String, String> {
    blocking(move || remote_op(Path::new(&root), &op)).await
}

#[tauri::command]
pub async fn git_add_remote(root: String, name: String, url: String) -> Result<(), String> {
    blocking(move || add_remote(Path::new(&root), &name, &url)).await
}

#[tauri::command]
pub async fn git_set_remote_url(root: String, name: String, url: String) -> Result<(), String> {
    blocking(move || set_remote_url(Path::new(&root), &name, &url)).await
}

#[tauri::command]
pub async fn git_identity(root: String) -> Result<GitIdentity, String> {
    blocking(move || Ok(identity(Path::new(&root)))).await
}

#[tauri::command]
pub async fn git_set_identity(root: String, name: String, email: String, global: bool) -> Result<(), String> {
    blocking(move || set_identity(Path::new(&root), &name, &email, global)).await
}

#[tauri::command]
pub async fn github_create_repo(root: String, name: String, private: bool, account: Option<String>) -> Result<GithubRepo, String> {
    blocking(move || github_create(Path::new(&root), &name, private, account.as_deref())).await
}

#[tauri::command]
pub async fn github_repo(root: String, url: String, account: Option<String>) -> Result<Option<GithubRepo>, String> {
    blocking(move || github_repo_info(Path::new(&root), &url, account.as_deref())).await
}

#[tauri::command]
pub async fn github_accounts_list(root: String) -> Result<Vec<String>, String> {
    blocking(move || github_accounts(Path::new(&root))).await
}

#[tauri::command]
pub async fn github_sign_in(root: String) -> Result<Vec<String>, String> {
    blocking(move || github_login(Path::new(&root))).await
}

#[tauri::command]
pub async fn git_blame(path: String, contents: Option<String>, encoding: Option<String>, eol: Option<String>) -> Result<Option<GitBlame>, String> {
    blocking(move || blame(&path, contents, encoding, eol)).await
}

#[tauri::command]
pub async fn git_log(path: String, skip: u32, limit: u32) -> Result<Vec<GitLogEntry>, String> {
    blocking(move || log(&path, skip, limit)).await
}

#[tauri::command]
pub async fn git_commit_files(root: String, sha: String) -> Result<Vec<GitCommitFile>, String> {
    blocking(move || commit_files(Path::new(&root), &sha)).await
}

#[tauri::command]
pub async fn git_graph(root: String, all: bool, skip: u32, limit: u32) -> Result<Vec<GitGraphCommit>, String> {
    blocking(move || graph(Path::new(&root), all, skip, limit)).await
}

#[tauri::command]
pub async fn git_graph_search(root: String, all: bool, query: String, limit: u32) -> Result<Vec<GitGraphCommit>, String> {
    blocking(move || graph_search(Path::new(&root), all, &query, limit)).await
}

#[tauri::command]
pub async fn git_graph_indexed(root: String) -> Result<bool, String> {
    blocking(move || Ok(has_commit_graph(Path::new(&root)))).await
}

#[tauri::command]
pub async fn git_graph_index(root: String) -> Result<(), String> {
    blocking(move || write_commit_graph(Path::new(&root))).await
}

#[tauri::command]
pub async fn git_commit_detail(root: String, sha: String) -> Result<GitCommitDetail, String> {
    blocking(move || commit_detail(Path::new(&root), &sha)).await
}

#[tauri::command]
pub async fn git_commit_action(root: String, action: String, sha: String, name: Option<String>) -> Result<String, String> {
    blocking(move || commit_action(Path::new(&root), &action, &sha, name.as_deref())).await
}

#[tauri::command]
pub async fn git_abort(root: String) -> Result<String, String> {
    blocking(move || abort_operation(Path::new(&root))).await
}

#[tauri::command]
pub async fn git_resolve_side(root: String, path: String, side: String) -> Result<String, String> {
    blocking(move || resolve_side(Path::new(&root), &path, &side)).await
}

#[tauri::command]
pub async fn git_continue(root: String, how: String) -> Result<String, String> {
    blocking(move || continue_operation(Path::new(&root), &how)).await
}

#[tauri::command]
pub async fn git_unpushed(root: String) -> Result<Vec<String>, String> {
    blocking(move || Ok(unpushed(Path::new(&root)))).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh repository with a local identity, or None when git cannot run here (test skipped).
    fn repo() -> Option<(tempfile::TempDir, PathBuf)> {
        let ok = Command::new("git").arg("--version").output().is_ok_and(|o| o.status.success());
        if !ok {
            eprintln!("git is not runnable: skipping");
            return None;
        }
        let dir = tempfile::tempdir().unwrap();
        let root = files::normalize(&dir.path().to_string_lossy());
        for args in [&["init", "-q", "-b", "main"][..], &["config", "user.name", "Test User"], &["config", "user.email", "test@example.com"], &["config", "core.autocrlf", "false"], &["config", "commit.gpgsign", "false"]] {
            run(&root, false, args, None).unwrap();
        }
        Some((dir, root))
    }

    fn write(root: &Path, rel: &str, text: &str) -> String {
        let p = root.join(rel);
        std::fs::write(&p, text).unwrap();
        p.to_string_lossy().into_owned()
    }

    fn git_ok(root: &Path, args: &[&str]) {
        run(root, false, args, None).unwrap();
    }

    fn file<'a>(st: &'a GitStatus, root: &Path, rel: &str) -> &'a GitFile {
        let p = abs_path(root, rel);
        st.files.iter().find(|f| f.path == p).unwrap_or_else(|| panic!("{rel} not in {:?}", st.files))
    }

    fn xy(f: &GitFile) -> (&str, &str) {
        (f.index.as_str(), f.worktree.as_str())
    }

    #[test]
    fn status_lists_modified_staged_untracked_and_renamed() {
        let Some((_d, root)) = repo() else { return };
        // Before the first commit: unborn branch, no head.
        let st = status(&root).unwrap().unwrap();
        assert_eq!(st.branch.as_deref(), Some("main"));
        assert_eq!(st.head, None);

        write(&root, "a.txt", "one\n");
        write(&root, "b.txt", "two\n");
        write(&root, "old.txt", "rename me please\nlong enough to match\n");
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "init"]);

        write(&root, "a.txt", "one changed\n");
        write(&root, "b.txt", "two staged\n");
        git_ok(&root, &["add", "b.txt"]);
        write(&root, "new file.txt", "fresh\n");
        git_ok(&root, &["mv", "old.txt", "renamed.txt"]);

        let st = status(&root.join("a.txt")).unwrap().unwrap();
        assert_eq!(st.root, root.to_string_lossy());
        assert_eq!(st.head.as_ref().map(|h| h.len()), Some(7));
        assert_eq!(st.operation, None);
        assert_eq!(xy(file(&st, &root, "a.txt")), (".", "M"));
        assert_eq!(xy(file(&st, &root, "b.txt")), ("M", "."));
        assert!(file(&st, &root, "new file.txt").untracked);
        let r = file(&st, &root, "renamed.txt");
        assert_eq!(r.index, "R");
        assert_eq!(r.orig_path.as_deref(), Some(abs_path(&root, "old.txt").as_str()));

        // Not a repository at all.
        let other = tempfile::tempdir().unwrap();
        assert!(status(other.path()).unwrap().is_none());
    }

    #[test]
    fn show_reads_head_and_index() {
        let Some((_d, root)) = repo() else { return };
        let p = write(&root, "f.txt", "committed\n");
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "init"]);
        write(&root, "f.txt", "staged\n");
        git_ok(&root, &["add", "."]);
        write(&root, "f.txt", "on disk\n");

        assert_eq!(show(&p, "HEAD", None).unwrap().unwrap().text, "committed\n");
        assert_eq!(show(&p, "", None).unwrap().unwrap().text, "staged\n");
        assert_eq!(show(&p, ":", None).unwrap().unwrap().text, "staged\n");
        assert!(show(&abs_path(&root, "nope.txt"), "HEAD", None).unwrap().is_none());
        let bin = write(&root, "b.bin", "a\0b\0c");
        git_ok(&root, &["add", "b.bin"]);
        assert!(show(&bin, ":", None).unwrap().unwrap().binary);
        assert!(show(&bin, "HEAD", None).unwrap().is_none());
    }

    #[test]
    fn stage_unstage_discard_and_commit() {
        let Some((_d, root)) = repo() else { return };
        let a = write(&root, "a.txt", "one\n");
        let one = [a.clone()];
        // Unstaging before the first commit takes the file out of the index.
        stage(&root, &one).unwrap();
        assert_eq!(file(&status(&root).unwrap().unwrap(), &root, "a.txt").index, "A");
        unstage(&root, &one).unwrap();
        assert!(file(&status(&root).unwrap().unwrap(), &root, "a.txt").untracked);

        stage(&root, &one).unwrap();
        let c = commit(&root, "first commit\n\nbody", false).unwrap();
        assert_eq!(c.summary, "first commit");
        assert!(!c.sha.is_empty());
        assert!(commit(&root, "nothing", false).is_err());

        write(&root, "a.txt", "two\n");
        stage(&root, &one).unwrap();
        assert_eq!(file(&status(&root).unwrap().unwrap(), &root, "a.txt").index, "M");
        unstage(&root, &one).unwrap();
        assert_eq!(xy(file(&status(&root).unwrap().unwrap(), &root, "a.txt")), (".", "M"));

        discard(&root, &one).unwrap();
        assert_eq!(std::fs::read_to_string(&a).unwrap(), "one\n");
        assert!(status(&root).unwrap().unwrap().files.is_empty());

        assert_eq!(commit(&root, "first, amended", true).unwrap().summary, "first, amended");

        // Staging a deletion.
        std::fs::remove_file(&a).unwrap();
        stage(&root, &one).unwrap();
        assert_eq!(file(&status(&root).unwrap().unwrap(), &root, "a.txt").index, "D");
    }

    #[test]
    fn discard_sends_untracked_files_to_the_recycle_bin() {
        let Some((_d, root)) = repo() else { return };
        write(&root, "keep.txt", "x\n");
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "init"]);
        let u = write(&root, "scratch-quarry-git-test.txt", "throw away\n");
        discard(&root, std::slice::from_ref(&u)).unwrap();
        assert!(!Path::new(&u).exists());
    }

    #[test]
    fn branches_and_checkout() {
        let Some((_d, root)) = repo() else { return };
        write(&root, "a.txt", "one\n");
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "init"]);
        checkout(&root, "feature/x", true).unwrap();
        assert_eq!(status(&root).unwrap().unwrap().branch.as_deref(), Some("feature/x"));
        let list = branches(&root).unwrap();
        assert_eq!(list.len(), 2);
        let cur = list.iter().find(|b| b.current).unwrap();
        assert_eq!(cur.name, "feature/x");
        assert_eq!(cur.summary, "init");
        assert!(cur.time > 0 && !cur.remote && cur.upstream.is_none());
        checkout(&root, "main", false).unwrap();
        assert_eq!(status(&root).unwrap().unwrap().branch.as_deref(), Some("main"));
        assert!(checkout(&root, "does-not-exist", false).is_err());
        assert!(remote_op(&root, "push").unwrap_err().contains("no remote"));
    }

    #[test]
    fn remote_branches_track_and_push_sets_upstream() {
        let Some((_d, root)) = repo() else { return };
        write(&root, "a.txt", "one\n");
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "init"]);
        let bare = tempfile::tempdir().unwrap();
        git_ok(bare.path(), &["init", "-q", "--bare"]);
        assert!(status(&root).unwrap().unwrap().remotes.is_empty());
        let url = bare.path().to_string_lossy().into_owned();
        assert!(add_remote(&root, " ", &url).is_err());
        add_remote(&root, " origin ", &url).unwrap();
        assert!(add_remote(&root, "origin", &url).is_err(), "a second remote with the same name");
        let remotes = status(&root).unwrap().unwrap().remotes;
        assert_eq!(remotes.len(), 1);
        assert_eq!((remotes[0].name.as_str(), remotes[0].url.as_str()), ("origin", url.as_str()));
        remote_op(&root, "push").unwrap();
        let st = status(&root).unwrap().unwrap();
        assert_eq!(st.upstream.as_deref(), Some("origin/main"));
        assert_eq!((st.ahead, st.behind), (0, 0));

        git_ok(&root, &["push", "-q", "origin", "main:topic"]);
        remote_op(&root, "fetch").unwrap();
        let list = branches(&root).unwrap();
        assert!(!list[0].remote);
        assert!(list.iter().any(|b| b.remote && b.name == "origin/topic"));
        checkout(&root, "origin/topic", false).unwrap();
        let st = status(&root).unwrap().unwrap();
        assert_eq!(st.branch.as_deref(), Some("topic"));
        assert_eq!(st.upstream.as_deref(), Some("origin/topic"));
        git_ok(&root, &["switch", "-q", "main"]);
        checkout(&root, "origin/topic", false).unwrap(); // the local branch exists now
        assert_eq!(status(&root).unwrap().unwrap().branch.as_deref(), Some("topic"));
    }

    #[test]
    fn blame_marks_unsaved_lines_uncommitted() {
        let Some((_d, root)) = repo() else { return };
        let p = write(&root, "f.txt", "alpha\r\nbeta\r\n");
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "add f"]);

        let b = blame(&p, None, None, None).unwrap().unwrap();
        assert_eq!(b.lines.len(), 2);
        assert_eq!(b.commits.len(), 1);
        assert_eq!(b.commits[0].summary, "add f");
        assert_eq!(b.commits[0].author, "Test User");
        assert_eq!(b.commits[0].email, "test@example.com");
        assert!(b.commits[0].time > 0);

        // The editor's buffer uses \n; the file's CRLF is applied so unchanged lines still match.
        let b = blame(&p, Some("alpha\nnew line\nbeta\n".into()), Some("UTF-8".into()), None).unwrap().unwrap();
        assert_eq!(b.lines.len(), 3);
        let c = |i: usize| &b.commits[b.lines[i] as usize];
        assert!(!c(0).uncommitted && c(1).uncommitted && !c(2).uncommitted);

        let u = write(&root, "untracked.txt", "x\n");
        assert!(blame(&u, None, None, None).unwrap().is_none());
    }

    #[test]
    fn log_follows_a_rename() {
        let Some((_d, root)) = repo() else { return };
        write(&root, "old.txt", "line one\nline two\nline three\n");
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "create"]);
        git_ok(&root, &["mv", "old.txt", "new.txt"]);
        git_ok(&root, &["commit", "-qm", "rename"]);
        let p = write(&root, "new.txt", "line one\nline two\nline three\nfour\n");
        git_ok(&root, &["commit", "-qam", "edit: odd \"chars\" | ; %"]);

        let entries = log(&p, 0, 50).unwrap();
        let got: Vec<(&str, &str)> = entries.iter().map(|e| (e.summary.as_str(), e.rel.as_str())).collect();
        assert_eq!(got, [("edit: odd \"chars\" | ; %", "new.txt"), ("rename", "new.txt"), ("create", "old.txt")]);
        assert_eq!(entries[2].author, "Test User");
        assert_eq!(entries[2].root, root.to_string_lossy());
        // The old name reads its contents at that commit.
        let first = show(&p, &entries[2].sha, Some(entries[2].rel.clone())).unwrap().unwrap();
        assert_eq!(first.text, "line one\nline two\nline three\n");

        let page = log(&p, 1, 1).unwrap();
        assert_eq!(page.len(), 1);
        assert_eq!(page[0].summary, "rename");

        let repo_log = log(&root.to_string_lossy(), 0, 10).unwrap();
        assert_eq!(repo_log.len(), 3);
        assert!(repo_log.iter().all(|e| e.rel.is_empty()));
    }

    #[test]
    fn commit_files_lists_what_a_commit_changed() {
        let Some((_d, root)) = repo() else { return };
        write(&root, "keep.txt", "one\ntwo\nthree\nfour\n");
        write(&root, "gone.txt", "x\n");
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "first"]);
        std::fs::create_dir_all(root.join("sub dir")).unwrap();
        git_ok(&root, &["mv", "keep.txt", "sub dir/kept.txt"]);
        git_ok(&root, &["rm", "-q", "gone.txt"]);
        write(&root, "new.txt", "n\n");
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "second"]);

        let entries = log(&root.to_string_lossy(), 0, 10).unwrap();
        let second = commit_files(&root, &entries[0].sha).unwrap();
        let mut got: Vec<(String, String, Option<String>)> = second.iter().map(|f| (f.status.clone(), f.rel.clone(), f.orig_rel.clone())).collect();
        got.sort();
        assert_eq!(
            got,
            [
                ("A".to_string(), "new.txt".to_string(), None),
                ("D".to_string(), "gone.txt".to_string(), None),
                ("R".to_string(), "sub dir/kept.txt".to_string(), Some("keep.txt".to_string())),
            ]
        );
        assert!(second.iter().all(|f| f.path.starts_with(&*root.to_string_lossy())));
        // The first commit has no parent: everything in it is added.
        let first = commit_files(&root, &entries[1].sha).unwrap();
        assert_eq!(first.len(), 2);
        assert!(first.iter().all(|f| f.status == "A"));
        assert!(commit_files(&root, "HEAD; rm -rf").is_err());
        // No upstream: nothing is known to be unpushed.
        assert!(unpushed(&root).is_empty());
    }

    #[test]
    fn graph_lists_parents_and_refs_and_actions_move_the_branch() {
        let Some((_d, root)) = repo() else { return };
        write(&root, "a.txt", "1\n");
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "base"]);
        git_ok(&root, &["switch", "-qc", "feature"]);
        write(&root, "b.txt", "feature\n");
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "on feature\n\nA body line."]);
        git_ok(&root, &["switch", "-q", "main"]);
        write(&root, "a.txt", "1\n2\n");
        git_ok(&root, &["commit", "-qam", "on main"]);
        git_ok(&root, &["tag", "v1"]);

        // Current branch only: feature's commit is not listed.
        let mine = graph(&root, false, 0, 50).unwrap();
        assert_eq!(mine.iter().map(|c| c.summary.as_str()).collect::<Vec<_>>(), ["on main", "base"]);
        assert_eq!(mine[0].parents, [mine[1].sha.clone()]);
        assert!(mine[1].parents.is_empty());
        assert_eq!(mine[0].refs, ["HEAD", "refs/heads/main", "refs/tags/v1"]);

        let all = graph(&root, true, 0, 50).unwrap();
        assert_eq!(all.len(), 3);
        let feature = all.iter().find(|c| c.summary == "on feature").unwrap();
        assert_eq!(feature.refs, ["refs/heads/feature"]);
        assert_eq!(graph(&root, true, 1, 1).unwrap().len(), 1);

        // Whole-history search: message (any case), author, and an id prefix.
        let hits = |q: &str, all: bool| graph_search(&root, all, q, 50).unwrap().into_iter().map(|c| c.summary).collect::<Vec<_>>();
        assert_eq!(hits("ON FEATURE", true), ["on feature"]);
        assert!(hits("on feature", false).is_empty()); // not on the current branch
        assert_eq!(hits("test user", true).len(), 3);
        assert_eq!(hits(&feature.sha[..8], false), ["on feature"]);
        // Branch and tag names (any case), only within the scope.
        assert_eq!(hits("FEAT", true), ["on feature"]);
        assert!(hits("feat", false).is_empty()); // feature is not on the current branch
        assert_eq!(hits("v1", false), ["on main"]);
        let tagged = graph_search(&root, false, "v1", 50).unwrap();
        assert_eq!(tagged[0].refs, ["HEAD", "refs/heads/main", "refs/tags/v1"]); // every label, not just the match
        assert_eq!(hits("main", false), ["on main"]);
        assert!(hits("no such thing", true).is_empty());
        assert!(hits("  ", true).is_empty());
        assert!(!has_commit_graph(&root));
        write_commit_graph(&root).unwrap();
        assert!(has_commit_graph(&root));
        assert_eq!(graph(&root, true, 0, 50).unwrap().len(), 3);

        let d = commit_detail(&root, &feature.sha).unwrap();
        assert_eq!(d.message, "on feature\n\nA body line.");
        assert_eq!(d.author, "Test User");
        assert_eq!(d.parents.len(), 1);
        assert_eq!(d.files.len(), 1);
        assert!(d.stat.contains("1 file changed"));

        // Branch, tag, cherry-pick, revert and reset.
        commit_action(&root, "branch", &feature.sha, Some("copy")).unwrap();
        assert!(ref_exists(&root, "refs/heads/copy"));
        commit_action(&root, "tag", &feature.sha, Some("t1")).unwrap();
        assert!(ref_exists(&root, "refs/tags/t1"));
        assert!(commit_action(&root, "branch", &feature.sha, Some("-D")).is_err());
        assert!(commit_action(&root, "branch", &feature.sha, Some("bad name")).is_err());
        assert!(commit_action(&root, "nonsense", &feature.sha, None).is_err());

        commit_action(&root, "cherry-pick", &feature.sha, None).unwrap();
        assert!(root.join("b.txt").exists());
        let picked = graph(&root, false, 0, 1).unwrap().remove(0);
        assert_eq!(picked.summary, "on feature");
        commit_action(&root, "revert", &picked.sha, None).unwrap();
        assert!(!root.join("b.txt").exists());
        commit_action(&root, "reset-hard", &mine[0].sha, None).unwrap();
        assert_eq!(graph(&root, false, 0, 1).unwrap()[0].sha, mine[0].sha);
        commit_action(&root, "reset-soft", &mine[1].sha, None).unwrap();
        // Soft: the newer commit's change is still there, staged.
        assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "1\n2\n");
        commit_action(&root, "reset-hard", &mine[0].sha, None).unwrap();

        // A pick that conflicts stops; aborting puts everything back.
        git_ok(&root, &["switch", "-qc", "clash", &mine[1].sha]);
        write(&root, "a.txt", "different\n");
        git_ok(&root, &["commit", "-qam", "clash"]);
        assert!(abort_operation(&root).is_err());
        assert!(commit_action(&root, "cherry-pick", &mine[0].sha, None).is_err());
        assert_eq!(operation(&root).as_deref(), Some("cherry-pick"));
        // The picked commit's message is offered for the commit that finishes it, without git's comments.
        let st = status(&root).unwrap().unwrap();
        assert_eq!(st.operation_message.as_deref(), Some("on main"));
        assert!(st.files.iter().any(|f| f.conflicted));
        // git itself refuses to commit while a file is unmerged.
        assert!(commit(&root, "too early", false).is_err());
        assert_eq!(abort_operation(&root).unwrap(), "cherry-pick");
        assert!(operation(&root).is_none());

        // Taking a whole side resolves the file: ours keeps the branch's text, theirs the picked one.
        let a = root.join("a.txt").to_string_lossy().into_owned();
        assert!(commit_action(&root, "cherry-pick", &mine[0].sha, None).is_err());
        assert!(resolve_side(&root, &a, "sideways").is_err());
        assert_eq!(resolve_side(&root, &a, "ours").unwrap(), "kept");
        assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "different\n");
        assert!(!status(&root).unwrap().unwrap().files.iter().any(|f| f.conflicted));
        abort_operation(&root).unwrap();
        assert!(commit_action(&root, "cherry-pick", &mine[0].sha, None).is_err());
        assert_eq!(resolve_side(&root, &a, "theirs").unwrap(), "kept");
        assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "1\n2\n");
        abort_operation(&root).unwrap();

        // Deleted on our side, changed on theirs: ours deletes it, theirs brings it back.
        git_ok(&root, &["rm", "-q", "a.txt"]);
        git_ok(&root, &["commit", "-qm", "drop a"]);
        assert!(commit_action(&root, "cherry-pick", &mine[0].sha, None).is_err());
        assert_eq!(resolve_side(&root, &a, "ours").unwrap(), "deleted");
        assert!(!root.join("a.txt").exists());
        abort_operation(&root).unwrap();
        assert!(commit_action(&root, "cherry-pick", &mine[0].sha, None).is_err());
        assert_eq!(resolve_side(&root, &a, "theirs").unwrap(), "kept");
        assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "1\n2\n");
        abort_operation(&root).unwrap();
        git_ok(&root, &["reset", "-q", "--hard", "HEAD~1"]);
        assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "different\n");

        // The other way round: changed on our side, deleted by the commit coming in.
        // Ours keeps our text; theirs deletes the file.
        git_ok(&root, &["switch", "-qc", "dropper", &mine[1].sha]);
        git_ok(&root, &["rm", "-q", "a.txt"]);
        git_ok(&root, &["commit", "-qm", "drop a on the other side"]);
        let drop = graph(&root, false, 0, 1).unwrap().remove(0).sha;
        git_ok(&root, &["switch", "-q", "clash"]);
        assert!(commit_action(&root, "cherry-pick", &drop, None).is_err());
        assert!(status(&root).unwrap().unwrap().files.iter().any(|f| f.conflicted));
        assert_eq!(resolve_side(&root, &a, "ours").unwrap(), "kept");
        assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "different\n");
        assert!(!status(&root).unwrap().unwrap().files.iter().any(|f| f.conflicted));
        abort_operation(&root).unwrap();
        assert!(commit_action(&root, "cherry-pick", &drop, None).is_err());
        assert_eq!(resolve_side(&root, &a, "theirs").unwrap(), "deleted");
        assert!(!root.join("a.txt").exists());
        assert!(!status(&root).unwrap().unwrap().files.iter().any(|f| f.conflicted));
        abort_operation(&root).unwrap();
        assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "different\n");

        // A rebase that stops on a conflict: progress is reported, Continue is refused until the
        // file is resolved, then it finishes; Skip leaves the commit out instead.
        assert!(continue_operation(&root, "continue").is_err());
        let rebase = |root: &Path| run(root, false, &["rebase", "main"], None);
        assert!(rebase(&root).is_err());
        let st = status(&root).unwrap().unwrap();
        assert_eq!(st.operation.as_deref(), Some("rebase"));
        assert_eq!(st.operation_step, Some((1, 1)));
        assert!(continue_operation(&root, "continue").is_err());
        assert!(continue_operation(&root, "sideways").is_err());
        assert_eq!(resolve_side(&root, &a, "theirs").unwrap(), "kept"); // in a rebase, "theirs" is your commit
        assert_eq!(continue_operation(&root, "continue").unwrap(), "rebase");
        assert!(operation(&root).is_none());
        assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "different\n");
        assert_eq!(graph(&root, false, 0, 2).unwrap().iter().map(|c| c.summary.as_str()).collect::<Vec<_>>(), ["clash", "on main"]);
        // Again from the start, skipping the commit: the branch ends up equal to main.
        git_ok(&root, &["reset", "-q", "--hard", "ORIG_HEAD"]);
        assert!(rebase(&root).is_err());
        assert_eq!(continue_operation(&root, "skip").unwrap(), "rebase");
        assert!(operation(&root).is_none());
        assert_eq!(graph(&root, false, 0, 1).unwrap()[0].sha, mine[0].sha);
        git_ok(&root, &["reset", "-q", "--hard", "ORIG_HEAD"]);
        git_ok(&root, &["switch", "-q", "main"]);

        commit_action(&root, "checkout", &feature.sha, None).unwrap();
        assert!(status(&root).unwrap().unwrap().branch.is_none());
    }

    #[test]
    fn identity_is_read_and_set_for_this_repository() {
        let Some((_d, root)) = repo() else { return };
        let id = identity(&root);
        assert_eq!(id.name_scope.as_deref(), Some("local")); // repo() sets a local identity
        assert!(set_identity(&root, "  ", "a@b", false).is_err());
        set_identity(&root, " Ada ", "ada@example.com", false).unwrap();
        let id = identity(&root);
        assert_eq!((id.name.as_deref(), id.email.as_deref()), (Some("Ada"), Some("ada@example.com")));
        assert_eq!(id.email_scope.as_deref(), Some("local"));
        // (a global save is not tested: it would change this machine's own git configuration)
    }

    #[test]
    fn changing_a_remote_url_forgets_the_old_remote_branches() {
        let Some((_d, root)) = repo() else { return };
        write(&root, "a.txt", "one\n");
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "init"]);
        let (old, new) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        git_ok(old.path(), &["init", "-q", "--bare"]);
        git_ok(new.path(), &["init", "-q", "--bare"]);
        add_remote(&root, "origin", &old.path().to_string_lossy()).unwrap();
        remote_op(&root, "push").unwrap();
        assert!(ref_exists(&root, "refs/remotes/origin/main"));
        // As after a clone or fetch: origin/HEAD points at origin/main.
        git_ok(&root, &["remote", "set-head", "origin", "main"]);
        assert!(ref_exists(&root, "refs/remotes/origin/HEAD"));

        let url = new.path().to_string_lossy().into_owned();
        set_remote_url(&root, "origin", &url).unwrap();
        let st = status(&root).unwrap().unwrap();
        assert_eq!(st.remotes[0].url, url);
        assert!(!ref_exists(&root, "refs/remotes/origin/main"));
        assert!(!ref_exists(&root, "refs/remotes/origin/HEAD"));
        remote_op(&root, "push").unwrap(); // publishes to the new repository
        assert!(ref_exists(&root, "refs/remotes/origin/main"));
        assert!(run(new.path(), true, &["rev-parse", "--verify", "-q", "refs/heads/main"], None).is_ok());
        assert_eq!(status(&root).unwrap().unwrap().upstream.as_deref(), Some("origin/main"));
        assert!(set_remote_url(&root, "nope", &url).is_err());
    }

    #[test]
    fn github_repo_names_and_credential_fields() {
        assert!(valid_repo_name("my-repo_1.x"));
        for bad in ["", ".", "..", "has space", "a/b", "ü"] {
            assert!(!valid_repo_name(bad), "{bad}");
        }
        let cred = "protocol=https\nhost=github.com\nusername=ada\npassword=gho_abc=def\n";
        assert_eq!(credential_field(cred, "username"), Some("ada"));
        assert_eq!(credential_field(cred, "password"), Some("gho_abc=def"));
        assert_eq!(credential_field(cred, "path"), None);
        assert_eq!(account_lines("smspgh\r\n\r\nada\n"), vec!["smspgh", "ada"]);
    }

    /// HTTP exchanges on a local port, one connection per answer, in order: returns the requests
    /// as received (request line, headers, body).
    fn fake_github(answers: Vec<(&'static str, &'static str)>) -> (String, std::thread::JoinHandle<Vec<String>>) {
        use std::io::Read;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let api = format!("http://{}", listener.local_addr().unwrap());
        let h = std::thread::spawn(move || {
            let mut seen = Vec::new();
            for (status, body) in answers {
                let (mut s, _) = listener.accept().unwrap();
                let mut req = Vec::new();
                let mut buf = [0u8; 4096];
                // Read the headers, then the body by Content-Length.
                loop {
                    let n = s.read(&mut buf).unwrap();
                    req.extend_from_slice(&buf[..n]);
                    let text = String::from_utf8_lossy(&req).to_string();
                    if let Some(i) = text.find("\r\n\r\n") {
                        let len = text.lines().find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap())).unwrap_or(0);
                        if req.len() >= i + 4 + len {
                            break;
                        }
                    }
                    if n == 0 {
                        break;
                    }
                }
                let resp = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                s.write_all(resp.as_bytes()).unwrap();
                seen.push(String::from_utf8_lossy(&req).into_owned());
            }
            seen
        });
        (api, h)
    }

    const TAKEN: &str = r#"{"message":"Repository creation failed.","errors":[{"message":"name already exists on this account"}]}"#;

    #[test]
    fn github_create_request_sends_the_token_and_reads_the_answer() {
        let (api, h) = fake_github(vec![("201 Created", r#"{"full_name":"ada/demo","clone_url":"https://github.com/ada/demo.git","html_url":"https://github.com/ada/demo"}"#)]);
        let repo = create_repo_request(&api, "tok123", "demo", true).ok().unwrap();
        assert_eq!(repo, GithubRepo { full_name: "ada/demo".into(), clone_url: "https://github.com/ada/demo.git".into(), html_url: "https://github.com/ada/demo".into(), existed: false, empty: true, private: false });
        let req = &h.join().unwrap()[0];
        assert!(req.starts_with("POST /user/repos "), "{req}");
        assert!(req.contains("Authorization: Bearer tok123\r\n"), "{req}");
        assert!(req.ends_with(r#"{"name":"demo","private":true}"#), "{req}");

        let (api, h) = fake_github(vec![("401 Unauthorized", r#"{"message":"Bad credentials"}"#)]);
        assert!(matches!(create_repo_request(&api, "t", "demo", false), Err(CreateError::Unauthorized)));
        h.join().unwrap();

        let (api, h) = fake_github(vec![("422 Unprocessable Entity", r#"{"message":"Validation Failed","errors":[{"message":"name is too long"}]}"#)]);
        match create_repo_request(&api, "t", "demo", false) {
            Err(CreateError::Other(e)) => assert!(e.contains("name is too long"), "{e}"),
            _ => panic!("expected an error"),
        }
        h.join().unwrap();
    }

    #[test]
    fn a_taken_github_name_returns_the_existing_repository() {
        let (api, h) = fake_github(vec![
            ("422 Unprocessable Entity", TAKEN),
            ("200 OK", r#"{"login":"ada"}"#),
            ("200 OK", r#"{"full_name":"ada/demo","clone_url":"https://github.com/ada/demo.git","html_url":"https://github.com/ada/demo","size":0}"#),
        ]);
        let repo = create_repo_request(&api, "t", "demo", true).ok().unwrap();
        assert!(repo.existed && repo.empty);
        assert_eq!(repo.clone_url, "https://github.com/ada/demo.git");
        let reqs = h.join().unwrap();
        assert!(reqs[1].starts_with("GET /user "), "{}", reqs[1]);
        assert!(reqs[2].starts_with("GET /repos/ada/demo "), "{}", reqs[2]);

        // One with commits is offered too, marked not empty.
        let (api, h) = fake_github(vec![("422 Unprocessable Entity", TAKEN), ("200 OK", r#"{"login":"ada"}"#), ("200 OK", r#"{"full_name":"ada/demo","clone_url":"u","html_url":"w","size":12}"#)]);
        let repo = create_repo_request(&api, "t", "demo", true).ok().unwrap();
        assert!(repo.existed && !repo.empty);
        h.join().unwrap();

        // If it can't be looked up, the original message stays.
        let (api, h) = fake_github(vec![("422 Unprocessable Entity", TAKEN), ("200 OK", r#"{"login":"ada"}"#), ("404 Not Found", r#"{"message":"Not Found"}"#)]);
        match create_repo_request(&api, "t", "demo", false) {
            Err(CreateError::Other(e)) => assert!(e.contains("name already exists"), "{e}"),
            _ => panic!("expected an error"),
        }
        h.join().unwrap();
    }

    #[test]
    fn github_slugs_come_only_from_github_urls() {
        let slug = |u| github_slug(u).map(|(o, n)| format!("{o}/{n}"));
        assert_eq!(slug("https://github.com/smspgh/Quarry.git").as_deref(), Some("smspgh/Quarry"));
        assert_eq!(slug("https://ada@github.com/ada/demo/").as_deref(), Some("ada/demo"));
        assert_eq!(slug("git@github.com:ada/demo.git").as_deref(), Some("ada/demo"));
        assert_eq!(slug("ssh://git@github.com/ada/demo").as_deref(), Some("ada/demo"));
        for other in ["https://notgithub.com/a/b", "https://gitlab.com/a/b", "C:\\repos\\demo.git", "https://github.com/a", "https://github.com/a/b/c"] {
            assert_eq!(slug(other), None, "{other}");
        }
    }

    #[test]
    fn repo_info_reads_visibility_and_tolerates_unseen_repos() {
        let (api, h) = fake_github(vec![("200 OK", r#"{"full_name":"ada/demo","clone_url":"u","html_url":"w","size":3,"private":true}"#)]);
        let repo = repo_info_request(&api, "tok", "ada", "demo").unwrap().unwrap();
        assert!(repo.private && !repo.empty);
        let req = &h.join().unwrap()[0];
        assert!(req.starts_with("GET /repos/ada/demo "), "{req}");
        assert!(req.contains("Authorization: Bearer tok\r\n"), "{req}");

        // No token: no Authorization header at all; a 404 (private, or gone) is just "unknown".
        let (api, h) = fake_github(vec![("404 Not Found", r#"{"message":"Not Found"}"#)]);
        assert_eq!(repo_info_request(&api, "", "ada", "demo").unwrap(), None);
        let req = &h.join().unwrap()[0];
        assert!(!req.to_ascii_lowercase().contains("authorization"), "{req}");
    }

    #[test]
    fn check_sees_remote_commits_and_pull_joins_diverged_branches() {
        let Some((_d, root)) = repo() else { return };
        write(&root, "a.txt", "one\n");
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "init"]);
        let bare = tempfile::tempdir().unwrap();
        git_ok(bare.path(), &["init", "-q", "--bare"]);
        add_remote(&root, "origin", &bare.path().to_string_lossy()).unwrap();
        remote_op(&root, "push").unwrap();

        // Someone else pushes a commit.
        let other = tempfile::tempdir().unwrap();
        git_ok(other.path(), &["clone", "-q", "-b", "main", &bare.path().to_string_lossy(), "."]);
        git_ok(other.path(), &["-c", "user.name=o", "-c", "user.email=o@o", "commit", "-q", "--allow-empty", "-m", "theirs"]);
        git_ok(other.path(), &["push", "-q"]);
        // Locally nothing shows until the check fetches.
        assert_eq!(status(&root).unwrap().unwrap().behind, 0);
        remote_op(&root, "check").unwrap();
        let st = status(&root).unwrap().unwrap();
        assert_eq!((st.ahead, st.behind, st.upstream_gone), (0, 1, false));

        // A local commit too: diverged; pull with rebase joins them.
        write(&root, "b.txt", "mine\n");
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "mine"]);
        assert_eq!({ let st = status(&root).unwrap().unwrap(); (st.ahead, st.behind) }, (1, 1));
        remote_op(&root, "pull-rebase").unwrap();
        let st = status(&root).unwrap().unwrap();
        assert_eq!((st.ahead, st.behind), (1, 0));
        remote_op(&root, "push").unwrap();

        // The remote branch deleted elsewhere: after a check the upstream is gone.
        git_ok(other.path(), &["push", "-q", "origin", "--delete", "main"]);
        remote_op(&root, "check").unwrap();
        let st = status(&root).unwrap().unwrap();
        assert!(st.upstream_gone, "{st:?}");
        remote_op(&root, "push").unwrap(); // recreates it
        assert!(!status(&root).unwrap().unwrap().upstream_gone);
    }
}
