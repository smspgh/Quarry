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

// Staging / unstaging / discarding part of a file (git/staging.rs, specs/git-staging.md).
pub mod staging;

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
    /// Stash: the commit `refs/stash` points at (the newest stash) and how many stashes there are.
    /// Together they change whenever a stash is made, popped or dropped.
    pub stash: Option<String>,
    pub stash_count: u32,
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
        stash: None,
        stash_count: 0,
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
    // Stash: the newest stash's id and the count.
    let stashes = stash_ids(&root);
    st.stash_count = stashes.len() as u32;
    st.stash = stashes.into_iter().next();
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
        // Force Push (MERGE-009): its own lease and error wording.
        "push-force" => return force_push(root),
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
    /// Stash: this row is a stash (its only parent is the commit it was made on), not a commit.
    pub stash: bool,
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
            stash: false,
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
    // Stash: with `all`, the commit each stash was made on is walked too (it may be on no branch
    // any more), and every stash becomes one row above that commit (`fold_stashes`).
    let stashes = if all { stash_list(root).unwrap_or_default() } else { Vec::new() };
    args.extend(stashes.iter().map(|s| s.base.as_str()));
    let out = run(root, true, &args, None)?;
    Ok(fold_stashes(parse_graph(&out), &stashes))
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

// ---------- start a merge or rebase, force push (specs/git-merge-rebase.md) ----------

/// A commit named in a dialog: id, short id, subject.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitRef {
    pub sha: String,
    pub short: String,
    pub summary: String,
}

/// The commits of a range that are already on a remote (see `pushed_commits`).
#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitPushed {
    /// How many commits of the range are reachable from a remote-tracking branch.
    pub count: u32,
    /// A remote branch that holds them (the current branch's upstream when it does), e.g. `origin/main`.
    pub on: Option<String>,
    /// Those commits, newest first (at most `PUSHED_LISTED`).
    pub commits: Vec<GitCommitRef>,
}

/// What a merge of / rebase onto a ref would do, read before asking.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitMergePreview {
    /// What git is given: the full ref name (`refs/heads/feature`) or the commit id.
    pub target: String,
    /// "branch" | "remote" | "tag" | "commit".
    pub kind: String,
    /// The commit the target points at.
    pub sha: String,
    pub short: String,
    pub summary: String,
    /// Commits HEAD has that the target lacks (a rebase replays these).
    pub ahead: u32,
    /// Commits the target has that HEAD lacks (a merge brings these in).
    pub behind: u32,
    /// How many of `ahead` are merge commits (a rebase does not keep them).
    pub merges: u32,
    /// How many of `ahead` are already on a remote branch, where, and which.
    pub pushed: u32,
    pub pushed_on: Option<String>,
    pub pushed_commits: Vec<GitCommitRef>,
}

/// What Force Push would replace: the commits that are only on the upstream.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitForcePushPreview {
    pub branch: String,
    /// `origin/main`.
    pub upstream: String,
    /// Commits on the upstream (as last fetched) that the branch lacks.
    pub lost: u32,
    /// Those commits, newest first (at most `PUSHED_LISTED`).
    pub commits: Vec<GitCommitRef>,
}

/// Commits listed by name in a preview (the dialogs show fewer).
const PUSHED_LISTED: usize = 50;

fn count_revs(root: &Path, args: &[&str]) -> Result<u32, String> {
    let mut a = vec!["rev-list", "--count"];
    a.extend_from_slice(args);
    Ok(run_text(root, true, &a)?.trim().parse().unwrap_or(0))
}

/// Up to `max` commits of `revs` (rev-list arguments), newest first.
fn commit_refs(root: &Path, revs: &[&str], max: usize) -> Result<Vec<GitCommitRef>, String> {
    let n = format!("--max-count={max}");
    let mut a = vec!["log", "--format=%H%x00%h%x00%s", n.as_str()];
    a.extend_from_slice(revs);
    Ok(run_text(root, true, &a)?
        .lines()
        .filter_map(|l| {
            let mut f = l.splitn(3, '\0');
            Some(GitCommitRef { sha: f.next()?.to_string(), short: f.next()?.to_string(), summary: f.next().unwrap_or("").to_string() })
        })
        .collect())
}

/// The one "already pushed" helper (merge / rebase previews, Edit History): the commits of `range`
/// (`<base>..HEAD`) that are reachable from any remote-tracking branch as last fetched, and a
/// remote branch that holds them. Not `unpushed`, which only looks at the upstream.
fn pushed_commits(root: &Path, range: &str) -> Result<GitPushed, String> {
    if range.starts_with('-') {
        return Err("not a commit range".into());
    }
    let all = count_revs(root, &[range])?;
    let local = count_revs(root, &[range, "--not", "--remotes"])?;
    let count = all.saturating_sub(local);
    if count == 0 {
        return Ok(GitPushed::default());
    }
    // The pushed commits are the range minus the ones no remote has.
    let only_local: std::collections::HashSet<String> = run_text(root, true, &["rev-list", range, "--not", "--remotes"])?.lines().map(|l| l.trim().to_string()).collect();
    let mut commits = Vec::new();
    for c in commit_refs(root, &[range], 100_000)? {
        if !only_local.contains(&c.sha) {
            commits.push(c);
            if commits.len() == PUSHED_LISTED {
                break;
            }
        }
    }
    // Which remote branch: one that contains the newest pushed commit, the upstream first.
    let mut on = None;
    if let Some(newest) = commits.first() {
        let upstream = run_text(root, true, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).ok().map(|s| s.trim().to_string());
        let holders: Vec<String> = run_text(root, true, &["for-each-ref", "--format=%(refname)", "--contains", &newest.sha, "refs/remotes"])?
            .lines()
            .filter_map(|l| l.trim().strip_prefix("refs/remotes/"))
            .filter(|n| !n.ends_with("/HEAD"))
            .map(str::to_string)
            .collect();
        on = upstream.filter(|u| holders.contains(u)).or_else(|| holders.first().cloned());
    }
    Ok(GitPushed { count, on, commits })
}

/// What a name given to merge / rebase means: (what git is given, kind, commit id). A branch, a
/// remote branch or a tag is used by its full ref name (so the same name as a tag and a branch is
/// not ambiguous, and the merge message names the branch); anything else must be a commit.
fn resolve_target(root: &Path, name: &str) -> Result<(String, &'static str, String), String> {
    let name = name.trim();
    let missing = || format!("\"{name}\" is not a branch or commit in this repository.");
    if name.is_empty() || name.starts_with('-') {
        return Err(missing());
    }
    let mut found: Option<(String, &'static str)> = None;
    for (prefix, kind) in [("refs/heads/", "branch"), ("refs/remotes/", "remote"), ("refs/tags/", "tag")] {
        let full = if name.starts_with(prefix) { name.to_string() } else { format!("{prefix}{name}") };
        if ref_exists(root, &full) {
            found = Some((full, kind));
            break;
        }
    }
    let rev = found.as_ref().map(|(f, _)| f.as_str()).unwrap_or(name);
    let sha = run_text(root, true, &["rev-parse", "--verify", "-q", &format!("{rev}^{{commit}}")]).map_err(|_| missing())?.trim().to_string();
    if !is_sha(&sha) {
        return Err(missing());
    }
    Ok(match found {
        Some((full, kind)) => (full, kind, sha),
        None => (sha.clone(), "commit", sha),
    })
}

fn merge_preview(root: &Path, target: &str) -> Result<GitMergePreview, String> {
    if !has_head(root) {
        return Err("This repository has no commits yet.".into());
    }
    let (arg, kind, sha) = resolve_target(root, target)?;
    let counts = run_text(root, true, &["rev-list", "--left-right", "--count", &format!("HEAD...{sha}")])?;
    let mut n = counts.split_whitespace().map(|s| s.parse::<u32>().unwrap_or(0));
    let (ahead, behind) = (n.next().unwrap_or(0), n.next().unwrap_or(0));
    let range = format!("{sha}..HEAD");
    let merges = if ahead > 0 { count_revs(root, &["--merges", &range])? } else { 0 };
    let pushed = if ahead > 0 { pushed_commits(root, &range)? } else { GitPushed::default() };
    let this = commit_refs(root, &["--no-walk", &sha], 1)?.into_iter().next().ok_or("not a commit")?;
    Ok(GitMergePreview { target: arg, kind: kind.into(), sha, short: this.short, summary: this.summary, ahead, behind, merges, pushed: pushed.count, pushed_on: pushed.on, pushed_commits: pushed.commits })
}

/// Why a merge or rebase may not start now: something is in progress, or tracked files have
/// uncommitted changes (Abort could then not bring everything back). The UI checks first; this is
/// the second look, right before git runs.
fn start_guard(root: &Path, what: &str) -> Result<(), String> {
    if let Some(op) = operation(root) {
        return Err(format!("A {op} is in progress. Finish or abort it first."));
    }
    let changed = run_text(root, true, &["status", "--porcelain", "--untracked-files=no"])?;
    if !changed.trim().is_empty() {
        return Err(format!("There are uncommitted changes to tracked files. Commit or discard them first: a {what} is only started from a clean state."));
    }
    Ok(())
}

/// Merge `target` into the current branch (or detached HEAD) without asking for a message.
/// `mode`: "ff-only" (refuses when a fast-forward is not possible), "no-ff" (always a merge
/// commit) or "auto". A conflict stops the merge: the error is git's output (CONFLICT lines).
fn start_merge(root: &Path, target: &str, mode: &str) -> Result<String, String> {
    start_guard(root, "merge")?;
    let (full, kind, sha) = resolve_target(root, target)?;
    // By its short name when that means the same commit, so the message reads "Merge branch
    // 'feature'" (git does not shorten a full ref name there); the full name when a tag and a
    // branch share the name.
    let short = ["refs/heads/", "refs/remotes/", "refs/tags/"].iter().find_map(|p| full.strip_prefix(p)).unwrap_or(&full);
    let same = kind != "commit" && run_text(root, true, &["rev-parse", "--verify", "-q", &format!("{short}^{{commit}}")]).is_ok_and(|s| s.trim() == sha);
    let arg = if same { short.to_string() } else { full.clone() };
    let mut args = vec!["merge", "--no-edit"];
    match mode {
        "ff-only" => args.push("--ff-only"),
        "no-ff" => args.push("--no-ff"),
        "auto" => {}
        _ => return Err(format!("unknown merge mode {mode}")),
    }
    args.push(&arg);
    let mut cmd = git(root, false);
    cmd.env("GIT_EDITOR", "true").args(&args);
    let out = exec(cmd, None)?;
    if out.ok { Ok(combined(&out)) } else { Err(combined(&out)) }
}

/// Rebase the current branch onto `target` (plain `git rebase`: merge commits are not kept, no
/// automatic stash, no editor). Refused on a detached HEAD. A conflict stops the rebase: the error
/// is git's output.
fn start_rebase(root: &Path, target: &str) -> Result<String, String> {
    start_guard(root, "rebase")?;
    if run(root, true, &["symbolic-ref", "-q", "HEAD"], None).is_err() {
        return Err("Switch to a branch first: a rebase moves a branch.".into());
    }
    let (arg, _, _) = resolve_target(root, target)?;
    let mut cmd = git(root, false);
    cmd.env("GIT_EDITOR", "true").args(["-c", "rebase.autoStash=false", "-c", "rebase.rebaseMerges=false", "-c", "rebase.updateRefs=false", "rebase", arg.as_str()]);
    let out = exec(cmd, None)?;
    if out.ok { Ok(combined(&out)) } else { Err(combined(&out)) }
}

/// The current branch, its upstream's remote and branch there, and the upstream's tip as last
/// fetched: (branch, remote, remote branch, tip id).
fn upstream_parts(root: &Path) -> Result<(String, String, String, String), String> {
    let branch = run_text(root, true, &["symbolic-ref", "-q", "--short", "HEAD"]).map_err(|_| "You are not on a branch.".to_string())?.trim().to_string();
    let none = || format!("{branch} has no remote branch to replace.");
    let get = |key: &str| run_text(root, true, &["config", "--get", &format!("branch.{branch}.{key}")]).map(|s| s.trim().to_string()).map_err(|_| none());
    let remote = get("remote")?;
    let merge = get("merge")?;
    let there = merge.strip_prefix("refs/heads/").ok_or_else(none)?.to_string();
    let tip = run_text(root, true, &["rev-parse", "--verify", "-q", &format!("refs/remotes/{remote}/{there}^{{commit}}")]).map_err(|_| none())?.trim().to_string();
    Ok((branch, remote, there, tip))
}

fn force_push_preview(root: &Path) -> Result<GitForcePushPreview, String> {
    let (branch, remote, there, tip) = upstream_parts(root)?;
    let range = format!("HEAD..{tip}");
    Ok(GitForcePushPreview { branch, upstream: format!("{remote}/{there}"), lost: count_revs(root, &[&range])?, commits: commit_refs(root, &[&range], PUSHED_LISTED)? })
}

/// Replace the upstream branch with the current one: `push --force-with-lease` against the
/// upstream's tip as last fetched (never a bare `--force`, never another branch). When the remote
/// branch has moved since that fetch the push is refused and nothing there changes.
fn force_push(root: &Path) -> Result<String, String> {
    if let Some(op) = operation(root) {
        return Err(format!("A {op} is in progress. Finish or abort it first."));
    }
    let (branch, remote, there, tip) = upstream_parts(root)?;
    let lease = format!("--force-with-lease=refs/heads/{there}:{tip}");
    let spec = format!("refs/heads/{branch}:refs/heads/{there}");
    let mut cmd = git(root, false);
    cmd.args(["push", lease.as_str(), remote.as_str(), spec.as_str()]);
    let out = exec(cmd, None)?;
    let text = combined(&out);
    if out.ok {
        Ok(if text.is_empty() { "Done.".into() } else { text })
    } else if text.contains("stale info") {
        Err(format!("{remote}/{there} has commits you have not fetched. Fetch and look at them first."))
    } else {
        Err(if text.is_empty() { "git push failed".into() } else { text })
    }
}

// ---------- stash ----------

/// One stash. A stash is a commit whose first parent is the commit it was made on; its second
/// parent holds what was staged and a third, when there is one, the untracked files.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitStash {
    pub sha: String,
    pub short: String,
    /// The commit the stash was made on.
    pub base: String,
    pub author: String,
    pub email: String,
    /// When it was made, unix seconds.
    pub time: i64,
    /// git's subject: "On main: <message>", or "WIP on main: 1a2b3c4 <last commit>" without one.
    pub subject: String,
    /// It holds untracked files.
    pub untracked: bool,
}

/// `git -C <dir>` for the stash commands that change things. Unlike `git()` it leaves out
/// `--literal-pathspecs`: `stash push --include-untracked` removes the untracked files with an
/// internal `git clean :/`, which that option turns into a file literally named ":/", so the files
/// would be stashed and left in the folder as well. No stash command here takes a path.
fn git_stash(dir: &Path) -> Command {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(dir);
    cmd.args(["-c", "core.quotepath=off", "-c", "color.ui=false"]);
    cmd.env("GIT_TERMINAL_PROMPT", "0").env_remove("GIT_LITERAL_PATHSPECS").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

/// Ids of the stashes, newest first (`stash@{0}` first). Empty when there are none.
fn stash_ids(root: &Path) -> Vec<String> {
    match run_text(root, true, &["stash", "list", "--format=%H"]) {
        Ok(t) => t.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect(),
        Err(_) => Vec::new(),
    }
}

/// Every stash, newest first.
fn stash_list(root: &Path) -> Result<Vec<GitStash>, String> {
    let out = run(root, true, &["stash", "list", "-z", "--format=%x1e%H%x00%h%x00%P%x00%an%x00%ae%x00%ct%x00%s"], None)?;
    let text = String::from_utf8_lossy(&out);
    let mut list = Vec::new();
    for rec in text.split('\x1e').filter(|r| !r.is_empty()) {
        let f: Vec<&str> = rec.split('\0').collect();
        if f.len() < 7 {
            continue;
        }
        let parents: Vec<&str> = f[2].split(' ').filter(|p| !p.is_empty()).collect();
        let Some(base) = parents.first() else { continue };
        list.push(GitStash {
            sha: f[0].trim().to_string(),
            short: f[1].to_string(),
            base: base.to_string(),
            author: f[3].to_string(),
            email: f[4].to_string(),
            time: f[5].parse().unwrap_or(0),
            subject: f[6].trim_end_matches(['\n', '\r']).to_string(),
            untracked: parents.len() > 2,
        });
    }
    Ok(list)
}

/// Put the uncommitted changes aside: staged and unstaged changes to tracked files, and with
/// `untracked` the untracked files too (never ignored ones). Returns the new stash's id.
fn stash_push(root: &Path, message: &str, untracked: bool) -> Result<String, String> {
    if !has_head(root) {
        return Err("Make a first commit before stashing.".into());
    }
    let before = stash_ids(root);
    let mut cmd = git_stash(root);
    cmd.args(["stash", "push"]);
    if untracked {
        cmd.arg("--include-untracked");
    }
    let msg = message.trim();
    if !msg.is_empty() {
        cmd.arg(format!("--message={msg}"));
    }
    let out = exec(cmd, None)?;
    if !out.ok {
        return Err(if out.stderr.is_empty() { combined(&out) } else { out.stderr });
    }
    // git exits 0 with "No local changes to save" when there was nothing to take.
    match stash_ids(root).into_iter().next() {
        Some(id) if before.first() != Some(&id) => Ok(id),
        _ => Err("There are no uncommitted changes to stash.".into()),
    }
}

/// Repo-relative paths of the untracked files a stash holds (the tree of its third parent).
fn stash_untracked(root: &Path, sha: &str) -> Vec<String> {
    let third = format!("{sha}^3");
    match run(root, true, &["ls-tree", "-r", "-z", "--name-only", &third], None) {
        Ok(out) => String::from_utf8_lossy(&out).split('\0').filter(|r| !r.is_empty()).map(str::to_string).collect(),
        Err(_) => Vec::new(), // no third parent
    }
}

/// The files a stash holds: what it changed against the commit it was made on (staged or not),
/// then its untracked files, with the status letter "?".
fn stash_files(root: &Path, sha: &str) -> Result<Vec<GitCommitFile>, String> {
    if !is_sha(sha) {
        return Err("not a commit id".into());
    }
    let base = format!("{sha}^1");
    let out = run(root, true, &["diff", "--name-status", "-z", "-M", &base, sha], None)?;
    let mut list = parse_commit_files(&out, root);
    for rel in stash_untracked(root, sha) {
        list.push(GitCommitFile { path: abs_path(root, &rel), rel, status: "?".into(), orig_rel: None });
    }
    Ok(list)
}

fn has_unmerged(root: &Path) -> bool {
    run(root, true, &["ls-files", "-u"], None).map(|o| !o.is_empty()).unwrap_or(false)
}

/// Apply, pop or drop the stash whose commit is `sha`. The stash is found by its id, never by a
/// position the caller remembered, so a list that went stale cannot hit the wrong one; an id that
/// is no longer a stash is an error. Nothing that was staged is staged again. Returns "ok", or
/// "conflicts" when an apply / pop left conflicted files (git keeps the stash then, also for a pop).
fn stash_op(root: &Path, sha: &str, op: &str) -> Result<String, String> {
    if !matches!(op, "apply" | "pop" | "drop") {
        return Err(format!("unknown stash action {op}"));
    }
    let Some(n) = stash_ids(root).iter().position(|id| id == sha) else {
        return Err("That stash no longer exists.".into());
    };
    let untracked = if op == "drop" { Vec::new() } else { stash_untracked(root, sha) };
    if !untracked.is_empty() {
        // A stash with untracked files is not applied all-or-nothing by git: it restores the
        // untracked files it can, then gives up on one that is in the way (after applying the
        // tracked changes), or on a tracked file with changes of its own (leaving the untracked
        // files behind, so the next try fails on those). Refuse both first, in git's own words.
        let existing: Vec<&String> = untracked.iter().filter(|rel| root.join(rel.replace('/', "\\")).exists()).collect();
        if !existing.is_empty() {
            let mut lines: Vec<String> = existing.iter().map(|r| format!("{r} already exists, no checkout")).collect();
            lines.push("error: could not restore untracked files from stash".into());
            return Err(lines.join("\n"));
        }
        let names = |args: &[&str]| -> Vec<String> {
            run(root, true, args, None).map(|o| String::from_utf8_lossy(&o).split('\0').filter(|r| !r.is_empty()).map(str::to_string).collect()).unwrap_or_default()
        };
        let base = format!("{sha}^1");
        let mine = names(&["diff", "--name-only", "-z"]);
        let both: Vec<String> = names(&["diff", "--name-only", "-z", &base, sha]).into_iter().filter(|f| mine.contains(f)).collect();
        if !both.is_empty() {
            let mut lines = vec!["error: Your local changes to the following files would be overwritten by merge:".to_string()];
            lines.extend(both.iter().map(|f| format!("\t{f}")));
            lines.push("Please commit your changes or stash them before you merge.".into());
            return Err(lines.join("\n"));
        }
    }
    let had = has_unmerged(root);
    let name = format!("stash@{{{n}}}");
    let mut cmd = git_stash(root);
    cmd.args(["stash", op, &name]);
    let out = exec(cmd, None)?;
    if out.ok {
        return Ok("ok".into());
    }
    if op != "drop" && !had && has_unmerged(root) {
        return Ok("conflicts".into());
    }
    // On a refusal git prints a whole `status` to stdout; its reason is on stderr.
    Err(if out.stderr.is_empty() { combined(&out) } else { out.stderr })
}

/// The graph's stash rows: each stash goes right above the commit it was made on (newest first
/// when several share one), as a row whose only parent is that commit. The helper commits git
/// keeps behind a stash (the staged snapshot, the untracked files) are never walked, so paging
/// by commits stays exact.
fn fold_stashes(commits: Vec<GitGraphCommit>, stashes: &[GitStash]) -> Vec<GitGraphCommit> {
    if stashes.is_empty() {
        return commits;
    }
    let mut out = Vec::with_capacity(commits.len() + stashes.len());
    for c in commits {
        for s in stashes.iter().filter(|s| s.base == c.sha) {
            out.push(GitGraphCommit {
                sha: s.sha.clone(),
                short: s.short.clone(),
                parents: vec![s.base.clone()],
                author: s.author.clone(),
                email: s.email.clone(),
                time: s.time,
                refs: vec!["refs/stash".to_string()],
                summary: s.subject.clone(),
                stash: true,
            });
        }
        out.push(c);
    }
    out
}

// ---------- compare commits (specs/git-compare-commits.md) ----------

/// What differs between two commits, or between a commit and the working tree.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitCompare {
    pub left: GitGraphCommit,
    /// None: the working tree (tracked files as they are on disk, staged or not).
    pub right: Option<GitGraphCommit>,
    /// Working tree: short id of the commit the files are on (None before the first commit).
    pub head: Option<String>,
    /// Letters read left to right (A: only in the right side); "U" marks a conflicted file.
    pub files: Vec<GitCommitFile>,
    pub insertions: u32,
    pub deletions: u32,
    /// Commits the right side (the current commit, for the working tree) has that the left lacks,
    /// and the other way round. `behind == 0` means the left commit is an ancestor of the right.
    pub ahead: u32,
    pub behind: u32,
    /// Working tree: untracked files, which are not compared.
    pub untracked: u32,
}

/// git for a comparison: read-only commands only, with `GIT_OPTIONAL_LOCKS=0`. `index`: a scratch
/// copy of the index to use instead of the repository's (see `scratch_index`).
fn compare_git(root: &Path, args: &[&str], index: Option<&Path>) -> Result<Vec<u8>, String> {
    let mut cmd = git(root, true);
    cmd.env("GIT_OPTIONAL_LOCKS", "0").args(args);
    if let Some(i) = index {
        cmd.env("GIT_INDEX_FILE", i);
    }
    let out = exec(cmd, None)?;
    if out.ok {
        Ok(out.stdout)
    } else if out.stderr.is_empty() {
        Err(format!("git {} failed", args.first().copied().unwrap_or("")))
    } else {
        Err(out.stderr)
    }
}

/// The commit one side of a comparison names: a commit id, "HEAD", or a local / remote branch
/// name. Anything else is refused before git is given it, so a name can never be read as an option.
fn compare_side(root: &Path, name: &str) -> Result<String, String> {
    let name = name.trim();
    let rev = if is_sha(name) || name == "HEAD" {
        name.to_string()
    } else {
        if !valid_ref_name(root, name) {
            return Err(format!("\"{name}\" is not a valid branch name."));
        }
        ["refs/heads/", "refs/remotes/"]
            .iter()
            .map(|p| format!("{p}{name}"))
            .find(|full| ref_exists(root, full))
            .ok_or_else(|| format!("\"{name}\" is not a branch in this repository."))?
    };
    let missing = || format!("\"{name}\" is not a commit in this repository.");
    let sha = compare_git(root, &["rev-parse", "--verify", "-q", &format!("{rev}^{{commit}}")], None).map(|b| String::from_utf8_lossy(&b).trim().to_string()).map_err(|_| missing())?;
    if is_sha(&sha) {
        Ok(sha)
    } else {
        Err(missing())
    }
}

/// A copy of the repository's index outside `.git`, for comparing with the working tree: `git diff`
/// rewrites the index it reads when it finds files whose cached times are stale (even with
/// optional locks off), and a comparison must not write inside `.git`. None when there is no index.
fn scratch_index(root: &Path) -> Result<Option<(tempfile::TempDir, PathBuf)>, String> {
    let rel = String::from_utf8_lossy(&compare_git(root, &["rev-parse", "--git-path", "index"], None)?).trim().to_string();
    let index = root.join(rel);
    if !index.is_file() {
        return Ok(None);
    }
    let dir = tempfile::tempdir().map_err(|e| format!("could not compare: {e}"))?;
    let copy = dir.path().join("index");
    std::fs::copy(&index, &copy).map_err(|e| format!("could not compare: {e}"))?;
    Ok(Some((dir, copy)))
}

fn compare_commit(root: &Path, sha: &str) -> Result<GitGraphCommit, String> {
    let out = compare_git(root, &["log", "-z", "--no-walk", "--decorate=full", GRAPH_FORMAT, sha], None)?;
    parse_graph(&out).into_iter().next().ok_or_else(|| "not a commit".to_string())
}

/// The files that differ between `left` and `right` (the direct difference of the two snapshots,
/// `git diff A B`, renames detected), or between `left` and the working tree when `right` is None.
/// Read-only: nothing is checked out, staged or written.
fn diff_files(root: &Path, left: &str, right: Option<&str>) -> Result<GitCompare, String> {
    let l = compare_side(root, left)?;
    let r = match right {
        Some(name) => Some(compare_side(root, name)?),
        None => None,
    };
    let scratch = if r.is_none() { scratch_index(root)? } else { None };
    let index = scratch.as_ref().map(|(_, p)| p.as_path());
    let diff = |how: &[&'static str]| {
        let mut a: Vec<&str> = vec!["diff"];
        a.extend_from_slice(how);
        a.extend(["-M", "--no-ext-diff", "--no-textconv", l.as_str()]);
        a.extend(r.as_deref());
        a.push("--");
        compare_git(root, &a, index)
    };
    let mut files = parse_commit_files(&diff(&["--name-status", "-z"])?, root);
    if r.is_none() {
        // Working tree: a conflicted file (unmerged in the index) is marked "U" instead of its letter.
        let out = compare_git(root, &["ls-files", "-u", "-z"], index)?;
        let unmerged: std::collections::HashSet<&str> = std::str::from_utf8(&out).unwrap_or("").split('\0').filter_map(|e| e.split_once('\t')).map(|(_, path)| path).collect();
        for f in files.iter_mut().filter(|f| unmerged.contains(f.rel.as_str())) {
            f.status = "U".into();
        }
    }
    let stat = String::from_utf8_lossy(&diff(&["--shortstat"])?).into_owned();
    let count = |word: &str| stat.split(',').find(|p| p.contains(word)).and_then(|p| p.split_whitespace().next()).and_then(|n| n.parse::<u32>().ok()).unwrap_or(0);
    let head = if r.is_none() && has_head(root) { Some(compare_side(root, "HEAD")?) } else { None };
    let (mut ahead, mut behind) = (0, 0);
    if let Some(other) = r.as_ref().or(head.as_ref()) {
        let counts = String::from_utf8_lossy(&compare_git(root, &["rev-list", "--left-right", "--count", &format!("{l}...{other}")], None)?).into_owned();
        let mut n = counts.split_whitespace().map(|s| s.parse::<u32>().unwrap_or(0));
        behind = n.next().unwrap_or(0);
        ahead = n.next().unwrap_or(0);
    }
    let untracked = if r.is_none() { compare_git(root, &["ls-files", "--others", "--exclude-standard", "-z"], index)?.iter().filter(|b| **b == 0).count() as u32 } else { 0 };
    Ok(GitCompare {
        left: compare_commit(root, &l)?,
        right: match &r {
            Some(sha) => Some(compare_commit(root, sha)?),
            None => None,
        },
        head: match &head {
            Some(sha) => Some(compare_commit(root, sha)?.short),
            None => None,
        },
        files,
        insertions: count("insertion"),
        deletions: count("deletion"),
        ahead,
        behind,
        untracked,
    })
}

// ---------- branch and tag housekeeping (specs/git-branches.md) ----------

/// What `ref_action("branch-delete")` fails with when git's safe delete refuses because the branch
/// has commits that are not in its upstream (or, without one, in HEAD). The UI then asks again.
const NOT_MERGED: &str = "NOT_MERGED";

/// A tag, for the Delete Tag… / Push Tag… lists.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitTag {
    pub name: String,
    /// Short id of the commit it points at (through an annotated tag's own object).
    pub sha: String,
    /// When the tag was made (an annotated tag) or its commit's date, unix seconds.
    pub time: i64,
    pub summary: String,
}

/// What the ref menus need besides the status: each local branch's upstream as configured
/// (`origin/main`), and each remote's default branch (what `refs/remotes/<remote>/HEAD` points to).
#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitRefInfo {
    pub upstreams: std::collections::BTreeMap<String, String>,
    pub defaults: std::collections::BTreeMap<String, String>,
}

/// A ref about to be deleted, read right before the question is asked.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchInfo {
    pub name: String,
    /// Short and full id of the commit it points at.
    pub sha: String,
    pub full_sha: String,
    /// A local branch: it is the one checked out.
    pub current: bool,
    /// A local branch: its upstream, when that remote branch still exists.
    pub upstream: Option<String>,
    /// A local branch: what "merged" is measured against, as git's safe delete does: the upstream,
    /// else the current branch; None on a detached HEAD (then `base_sha` is that commit).
    pub base: Option<String>,
    pub base_sha: Option<String>,
    /// A local branch: commits that are not in `base`. A remote branch: commits in no local branch.
    pub unmerged: u32,
    /// A remote branch: it is its remote's default branch.
    pub default_branch: bool,
}

/// What a push of one branch or tag, or the delete of a remote branch, did.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitPushRef {
    pub remote: String,
    /// The branch on the remote (it can differ from the local name), or the tag.
    pub branch: String,
    /// The remote already had everything.
    pub up_to_date: bool,
    /// The branch had no upstream and now tracks this (`origin/feature`).
    pub tracking: Option<String>,
    /// A deleted remote branch: the short id it was on (as last fetched).
    pub was: Option<String>,
    /// A delete: the branch was already gone on the remote (only the stale label was dropped).
    pub gone: bool,
}

fn tags(root: &Path) -> Result<Vec<GitTag>, String> {
    let fmt = "--format=%(refname)%00%(objectname:short)%00%(*objectname:short)%00%(creatordate:unix)%00%(contents:subject)%1e";
    let out = run_text(root, true, &["for-each-ref", "--sort=-creatordate", fmt, "refs/tags"])?;
    Ok(out
        .split('\x1e')
        .filter_map(|rec| {
            let f: Vec<&str> = rec.trim_start_matches(['\n', '\r']).splitn(5, '\0').collect();
            if f.len() < 5 {
                return None;
            }
            let sha = if f[2].is_empty() { f[1] } else { f[2] };
            Some(GitTag { name: f[0].strip_prefix("refs/tags/")?.to_string(), sha: sha.to_string(), time: f[3].parse().unwrap_or(0), summary: f[4].to_string() })
        })
        .collect())
}

fn ref_info(root: &Path) -> Result<GitRefInfo, String> {
    let mut info = GitRefInfo::default();
    for line in run_text(root, true, &["for-each-ref", "--format=%(refname)%00%(upstream:short)", "refs/heads"])?.lines() {
        if let Some((name, up)) = line.split_once('\0')
            && let Some(name) = name.strip_prefix("refs/heads/")
            && !up.is_empty()
        {
            info.upstreams.insert(name.to_string(), up.to_string());
        }
    }
    for remote in remotes(root)? {
        if let Some(branch) = default_branch(root, &remote) {
            info.defaults.insert(remote, branch);
        }
    }
    Ok(info)
}

/// A remote's default branch as this repository knows it (`refs/remotes/<remote>/HEAD`).
fn default_branch(root: &Path, remote: &str) -> Option<String> {
    let head = run_text(root, true, &["symbolic-ref", "-q", &format!("refs/remotes/{remote}/HEAD")]).ok()?;
    head.trim().strip_prefix(&format!("refs/remotes/{remote}/")).map(str::to_string)
}

/// `origin/feature/login` → ("origin", "feature/login"): the longest remote name that fits.
fn split_remote(root: &Path, name: &str) -> Option<(String, String)> {
    remotes(root)
        .ok()?
        .into_iter()
        .filter_map(|r| name.strip_prefix(r.as_str()).and_then(|s| s.strip_prefix('/')).filter(|b| !b.is_empty()).map(|b| (r.clone(), b.to_string())))
        .max_by_key(|(r, _)| r.len())
}

fn short_sha(root: &Path, rev: &str) -> Result<String, String> {
    Ok(run_text(root, true, &["rev-parse", "--short", "--verify", "-q", &format!("{rev}^{{commit}}")])?.trim().to_string())
}

fn current_branch(root: &Path) -> Option<String> {
    run_text(root, true, &["symbolic-ref", "-q", "--short", "HEAD"]).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// The full ref name of a local branch / remote branch / tag given by its short name, when it
/// exists. A name is never passed to git as anything but a ref that was found here.
fn known_ref(root: &Path, kind: &str, name: &str) -> Result<String, String> {
    let (prefix, what) = match kind {
        "branch" => ("refs/heads/", "branch"),
        "remote" => ("refs/remotes/", "remote branch"),
        "tag" => ("refs/tags/", "tag"),
        _ => return Err(format!("unknown kind of ref {kind}")),
    };
    let full = format!("{prefix}{name}");
    if name.is_empty() || name.starts_with('-') || !ref_exists(root, &full) {
        return Err(format!("The {what} \"{name}\" was not found."));
    }
    Ok(full)
}

/// `kind`: "branch" (local), "remote" (`origin/topic`) or "tag".
fn branch_info(root: &Path, kind: &str, name: &str) -> Result<GitBranchInfo, String> {
    let full = known_ref(root, kind, name)?;
    let full_sha = run_text(root, true, &["rev-parse", "--verify", "-q", &format!("{full}^{{commit}}")])?.trim().to_string();
    let mut info = GitBranchInfo { name: name.to_string(), sha: short_sha(root, &full)?, full_sha, current: false, upstream: None, base: None, base_sha: None, unmerged: 0, default_branch: false };
    match kind {
        "branch" => {
            let here = current_branch(root);
            info.current = here.as_deref() == Some(name);
            // The upstream only counts while its remote branch exists (git falls back to HEAD too).
            let up_full = run_text(root, true, &["for-each-ref", "--format=%(upstream)", &full]).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty() && ref_exists(root, s));
            if let Some(up) = &up_full {
                let short = up.strip_prefix("refs/remotes/").or_else(|| up.strip_prefix("refs/heads/")).unwrap_or(up).to_string();
                info.upstream = Some(short.clone());
                info.base = Some(short);
                info.base_sha = short_sha(root, up).ok();
                info.unmerged = count_revs(root, &[&full, "--not", up])?;
            } else if has_head(root) {
                info.base = here;
                info.base_sha = short_sha(root, "HEAD").ok();
                info.unmerged = count_revs(root, &[&full, "--not", "HEAD"])?;
            } else {
                info.unmerged = count_revs(root, &[&full])?;
            }
        }
        "remote" => {
            info.unmerged = count_revs(root, &[&full, "--not", "--branches"])?;
            if let Some((remote, branch)) = split_remote(root, name) {
                info.default_branch = default_branch(root, &remote).as_deref() == Some(branch.as_str());
            }
        }
        _ => {}
    }
    Ok(info)
}

/// A local change to a branch or tag (nothing here talks to a remote):
/// - "branch-delete": `branch -d`; fails with `NOT_MERGED` when git's safe delete refuses.
/// - "branch-delete-force": `branch -D`, only while the branch still points at `arg` (the commit
///   the "lose N commits" question was about).
/// - "branch-rename": `branch -m <name> <arg>`, never `-M`: an existing name is not overwritten.
///   Resolves with the upstream the branch still tracks ("" for none).
/// - "upstream-set": `arg` = the remote branch (`origin/feature`); "upstream-unset".
/// - "tag-delete": `tag -d`.
/// The deletes resolve with the short id the ref was on.
fn ref_action(root: &Path, action: &str, name: &str, arg: Option<&str>) -> Result<String, String> {
    let name = name.trim();
    let arg = arg.map(str::trim).unwrap_or("");
    let finish = |args: &[&str]| -> Result<String, String> {
        let mut cmd = git(root, false);
        cmd.env("GIT_EDITOR", "true").args(args);
        let out = exec(cmd, None)?;
        if out.ok { Ok(combined(&out)) } else { Err(combined(&out)) }
    };
    match action {
        "branch-delete" | "branch-delete-force" => {
            let full = known_ref(root, "branch", name)?;
            if current_branch(root).as_deref() == Some(name) {
                return Err(format!("You are on {name}. Switch to another branch first."));
            }
            let was = short_sha(root, &full)?;
            if action == "branch-delete" {
                return match finish(&["branch", "-d", name]) {
                    Ok(_) => Ok(was),
                    Err(e) if e.contains("not fully merged") => Err(NOT_MERGED.into()),
                    Err(e) => Err(e),
                };
            }
            let tip = run_text(root, true, &["rev-parse", "--verify", "-q", &format!("{full}^{{commit}}")])?.trim().to_string();
            if !is_sha(arg) || tip != arg {
                return Err(format!("\"{name}\" changed while the question was open. Nothing was deleted."));
            }
            finish(&["branch", "-D", name]).map(|_| was)
        }
        "branch-rename" => {
            known_ref(root, "branch", name)?;
            if !valid_ref_name(root, arg) {
                return Err(format!("\"{arg}\" is not a valid name"));
            }
            if arg == name {
                return Err(format!("The branch is already called \"{name}\"."));
            }
            // A change of letter case only is the same ref file on Windows, not a taken name.
            let case_only = arg.eq_ignore_ascii_case(name);
            if !case_only && ref_exists(root, &format!("refs/heads/{arg}")) {
                return Err(format!("A branch named \"{arg}\" already exists."));
            }
            if case_only {
                // git refuses `-m Feature feature` where file names ignore case: go through a free name.
                let via = (0..100).map(|i| format!("{arg}-renaming-{i}")).find(|n| !ref_exists(root, &format!("refs/heads/{n}"))).ok_or("no free temporary name")?;
                finish(&["branch", "-m", name, &via])?;
                if let Err(e) = finish(&["branch", "-m", &via, arg]) {
                    let _ = finish(&["branch", "-m", &via, name]);
                    return Err(e);
                }
            } else {
                finish(&["branch", "-m", name, arg])?;
            }
            Ok(run_text(root, true, &["for-each-ref", "--format=%(upstream:short)", &format!("refs/heads/{arg}")]).map(|s| s.trim().to_string()).unwrap_or_default())
        }
        "upstream-set" => {
            known_ref(root, "branch", name)?;
            if arg.is_empty() || arg.starts_with('-') {
                return Err("Choose a remote branch to track.".into());
            }
            // By its full name: `origin/x` could also be a local branch of that name.
            finish(&["branch", &format!("--set-upstream-to=refs/remotes/{arg}"), name])
        }
        "upstream-unset" => {
            known_ref(root, "branch", name)?;
            finish(&["branch", "--unset-upstream", name])
        }
        "tag-delete" => {
            let full = known_ref(root, "tag", name)?;
            let was = short_sha(root, &full).unwrap_or_default();
            finish(&["tag", "-d", name]).map(|_| was)
        }
        _ => Err(format!("unknown action {action}")),
    }
}

/// Where a push with no upstream goes: `origin`, else the first remote (the rule of `remote_op`).
fn default_remote(root: &Path) -> Result<String, String> {
    let remotes = remotes(root)?;
    remotes.iter().find(|r| *r == "origin").or(remotes.first()).cloned().ok_or_else(|| "this repository has no remote to push to".to_string())
}

/// One ref to or from a remote, never forced:
/// - "branch": `push <remote> refs/heads/<name>:refs/heads/<upstream's name>`, to the branch's
///   upstream; without one to `origin` (else the first remote) under its own name, with `--set-upstream`.
/// - "tag": `push <remote> refs/tags/<name>` (that tag only, never `--tags`).
/// - "delete": `name` = a remote branch (`origin/topic`) this repository knows: `push <remote>
///   --delete refs/heads/<branch>`. A remote's default branch is refused. A branch that is already
///   gone there is not an error: the stale remote-tracking branch is pruned.
fn push_ref(root: &Path, kind: &str, name: &str) -> Result<GitPushRef, String> {
    let name = name.trim();
    let push = |args: &[&str]| -> Result<String, String> {
        let mut cmd = git(root, false);
        cmd.arg("push").args(args);
        let out = exec(cmd, None)?;
        let text = combined(&out);
        if out.ok { Ok(text) } else { Err(if text.is_empty() { "git push failed".into() } else { text }) }
    };
    match kind {
        "branch" => {
            known_ref(root, "branch", name)?;
            let get = |key: &str| run_text(root, true, &["config", "--get", &format!("branch.{name}.{key}")]).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
            // An upstream on a remote (not another local branch, whose "remote" is ".").
            let tracked = match (get("remote"), get("merge")) {
                (Some(remote), Some(merge)) if remote != "." => merge.strip_prefix("refs/heads/").map(|there| (remote, there.to_string())),
                _ => None,
            };
            let (remote, there, set) = match tracked {
                Some((remote, there)) => (remote, there, false),
                None => (default_remote(root)?, name.to_string(), true),
            };
            let spec = format!("refs/heads/{name}:refs/heads/{there}");
            let text = if set { push(&["--set-upstream", &remote, &spec])? } else { push(&[&remote, &spec])? };
            Ok(GitPushRef { up_to_date: text.contains("Everything up-to-date"), tracking: set.then(|| format!("{remote}/{there}")), remote, branch: there, was: None, gone: false })
        }
        "tag" => {
            let full = known_ref(root, "tag", name)?;
            let remote = default_remote(root)?;
            let text = push(&[&remote, &full])?;
            Ok(GitPushRef { up_to_date: text.contains("Everything up-to-date"), tracking: None, remote, branch: name.to_string(), was: None, gone: false })
        }
        "delete" => {
            let full = known_ref(root, "remote", name)?;
            let (remote, branch) = split_remote(root, name).ok_or_else(|| format!("\"{name}\" is not a branch on a remote of this repository."))?;
            if default_branch(root, &remote).as_deref() == Some(branch.as_str()) {
                return Err(format!("{branch} is {remote}'s default branch."));
            }
            let was = short_sha(root, &full).ok();
            let done = |gone: bool| GitPushRef { remote: remote.clone(), branch: branch.clone(), up_to_date: false, tracking: None, was: was.clone(), gone };
            // Someone deleted it already: git says so in a warning (the push still "works") or
            // refuses with "remote ref does not exist". Either way only our label is stale.
            let missing = |text: &str| text.contains("non-existent ref") || text.contains("remote ref does not exist");
            match push(&[&remote, "--delete", &format!("refs/heads/{branch}")]) {
                Ok(text) if !missing(&text) => Ok(done(false)),
                Err(e) if !missing(&e) => Err(e),
                _ => {
                    let _ = run(root, false, &["fetch", "--prune", &remote], None);
                    if ref_exists(root, &full) {
                        let _ = run(root, false, &["update-ref", "-d", &full], None);
                    }
                    Ok(done(true))
                }
            }
        }
        _ => Err(format!("unknown kind of push {kind}")),
    }
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

// Start a merge or rebase, force push (specs/git-merge-rebase.md).
#[tauri::command]
pub async fn git_merge_preview(root: String, target: String) -> Result<GitMergePreview, String> {
    blocking(move || merge_preview(Path::new(&root), &target)).await
}

#[tauri::command]
pub async fn git_merge(root: String, target: String, mode: String) -> Result<String, String> {
    blocking(move || start_merge(Path::new(&root), &target, &mode)).await
}

#[tauri::command]
pub async fn git_rebase(root: String, target: String) -> Result<String, String> {
    blocking(move || start_rebase(Path::new(&root), &target)).await
}

#[tauri::command]
pub async fn git_force_push_preview(root: String) -> Result<GitForcePushPreview, String> {
    blocking(move || force_push_preview(Path::new(&root))).await
}

// Stash commands.
#[tauri::command]
pub async fn git_stash_list(root: String) -> Result<Vec<GitStash>, String> {
    blocking(move || stash_list(Path::new(&root))).await
}

#[tauri::command]
pub async fn git_stash_push(root: String, message: String, untracked: bool) -> Result<String, String> {
    blocking(move || stash_push(Path::new(&root), &message, untracked)).await
}

#[tauri::command]
pub async fn git_stash_files(root: String, sha: String) -> Result<Vec<GitCommitFile>, String> {
    blocking(move || stash_files(Path::new(&root), &sha)).await
}

#[tauri::command]
pub async fn git_stash_op(root: String, sha: String, op: String) -> Result<String, String> {
    blocking(move || stash_op(Path::new(&root), &sha, &op)).await
}

// Compare commits (specs/git-compare-commits.md).
#[tauri::command]
pub async fn git_diff_files(root: String, left: String, right: Option<String>) -> Result<GitCompare, String> {
    blocking(move || diff_files(Path::new(&root), &left, right.as_deref())).await
}

// ----- branch and tag housekeeping (specs/git-branches.md) -----

#[tauri::command]
pub async fn git_tags(root: String) -> Result<Vec<GitTag>, String> {
    blocking(move || tags(Path::new(&root))).await
}

#[tauri::command]
pub async fn git_ref_info(root: String) -> Result<GitRefInfo, String> {
    blocking(move || ref_info(Path::new(&root))).await
}

#[tauri::command]
pub async fn git_branch_info(root: String, kind: String, name: String) -> Result<GitBranchInfo, String> {
    blocking(move || branch_info(Path::new(&root), &kind, &name)).await
}

#[tauri::command]
pub async fn git_ref_action(root: String, action: String, name: String, arg: Option<String>) -> Result<String, String> {
    blocking(move || ref_action(Path::new(&root), &action, &name, arg.as_deref())).await
}

#[tauri::command]
pub async fn git_push_ref(root: String, kind: String, name: String) -> Result<GitPushRef, String> {
    blocking(move || push_ref(Path::new(&root), &kind, &name)).await
}
// ----- end -----

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh repository with a local identity, or None when git cannot run here (test skipped).
    pub(super) fn repo() -> Option<(tempfile::TempDir, PathBuf)> {
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

    pub(super) fn write(root: &Path, rel: &str, text: &str) -> String {
        let p = root.join(rel);
        std::fs::write(&p, text).unwrap();
        p.to_string_lossy().into_owned()
    }

    pub(super) fn git_ok(root: &Path, args: &[&str]) {
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
    fn a_stopped_patch_series_is_reported_as_am_and_can_be_skipped_or_aborted() {
        let Some((_d, root)) = repo() else { return };
        write(&root, "a.txt", "base\n");
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "base"]);
        git_ok(&root, &["switch", "-qc", "side"]);
        write(&root, "a.txt", "from the patch\n");
        git_ok(&root, &["commit", "-qam", "patch one"]);
        write(&root, "b.txt", "second patch\n");
        git_ok(&root, &["add", "b.txt"]);
        git_ok(&root, &["commit", "-qm", "patch two"]);
        let patches = tempfile::tempdir().unwrap();
        let out_dir = patches.path().to_string_lossy().into_owned();
        git_ok(&root, &["format-patch", "-q", "-o", &out_dir, "main..side"]);
        let mut files: Vec<String> = std::fs::read_dir(patches.path()).unwrap().map(|e| e.unwrap().path().to_string_lossy().into_owned()).collect();
        files.sort();
        assert_eq!(files.len(), 2);
        git_ok(&root, &["switch", "-q", "main"]);
        write(&root, "a.txt", "changed on main\n");
        git_ok(&root, &["commit", "-qam", "on main"]);
        let head = graph(&root, false, 0, 1).unwrap()[0].sha.clone();

        let am = |root: &Path| {
            let mut args = vec!["am", "-q"];
            args.extend(files.iter().map(|s| s.as_str()));
            run(root, false, &args, None)
        };
        assert!(am(&root).is_err());
        let st = status(&root).unwrap().unwrap();
        assert_eq!(st.operation.as_deref(), Some("am"));
        assert_eq!(st.operation_step, Some((1, 2)));
        assert_eq!(abort_operation(&root).unwrap(), "am");
        assert!(operation(&root).is_none());
        assert_eq!(graph(&root, false, 0, 1).unwrap()[0].sha, head);

        // Skip the patch that does not apply: the second one goes on, and the series is finished.
        assert!(am(&root).is_err());
        assert_eq!(continue_operation(&root, "skip").unwrap(), "am");
        assert!(operation(&root).is_none());
        assert_eq!(graph(&root, false, 0, 1).unwrap()[0].summary, "patch two");
        assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "changed on main\n");
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

    // ---------- start a merge or rebase, force push (specs/git-merge-rebase.md) ----------

    fn commit_file(root: &Path, rel: &str, text: &str, message: &str) {
        write(root, rel, text);
        git_ok(root, &["add", "."]);
        git_ok(root, &["commit", "-qm", message]);
    }

    fn rev(root: &Path, what: &str) -> String {
        run_text(root, true, &["rev-parse", what]).unwrap().trim().to_string()
    }

    fn subjects(root: &Path, what: &str) -> Vec<String> {
        run_text(root, true, &["log", "--format=%s", what]).unwrap().lines().map(str::to_string).collect()
    }

    /// main: init; feature: init + f1 + f2 (other files). Left on main.
    fn repo_with_feature() -> Option<(tempfile::TempDir, PathBuf)> {
        let (d, root) = repo()?;
        commit_file(&root, "a.txt", "one\n", "init");
        git_ok(&root, &["switch", "-qc", "feature"]);
        commit_file(&root, "f1.txt", "1\n", "f1");
        commit_file(&root, "f2.txt", "2\n", "f2");
        git_ok(&root, &["switch", "-q", "main"]);
        Some((d, root))
    }

    #[test]
    fn merge_preview_counts_both_sides_and_names_the_target() {
        let Some((_d, root)) = repo_with_feature() else { return };
        let p = merge_preview(&root, "feature").unwrap();
        assert_eq!((p.kind.as_str(), p.target.as_str(), p.ahead, p.behind, p.merges, p.pushed), ("branch", "refs/heads/feature", 0, 2, 0, 0));
        assert_eq!((p.sha.as_str(), p.summary.as_str()), (rev(&root, "feature").as_str(), "f2"));
        // By id, by tag, and something that is neither.
        let sha = rev(&root, "feature~1");
        let p = merge_preview(&root, &sha).unwrap();
        assert_eq!((p.kind.as_str(), p.target.as_str(), p.behind, p.summary.as_str()), ("commit", sha.as_str(), 1, "f1"));
        git_ok(&root, &["tag", "v1.2.0", "feature"]);
        assert_eq!(merge_preview(&root, "v1.2.0").unwrap().kind, "tag");
        for bad in ["no-such-branch", "", "--upload-pack=x", "-h"] {
            assert!(merge_preview(&root, bad).unwrap_err().contains("is not a branch or commit in this repository"), "{bad}");
        }
        // Both sides have commits; and the other way round nothing is left to merge.
        commit_file(&root, "m1.txt", "m\n", "m1");
        let p = merge_preview(&root, "feature").unwrap();
        assert_eq!((p.ahead, p.behind), (1, 2));
        git_ok(&root, &["switch", "-q", "feature"]);
        git_ok(&root, &["merge", "-q", "--no-edit", "main"]);
        assert_eq!(merge_preview(&root, "main").unwrap().behind, 0);
        // The merge commit on feature is one of the commits a rebase onto main would replay.
        git_ok(&root, &["switch", "-q", "main"]);
        commit_file(&root, "m2.txt", "m\n", "m2");
        git_ok(&root, &["switch", "-q", "feature"]);
        let p = merge_preview(&root, "main").unwrap();
        assert_eq!((p.ahead, p.behind, p.merges), (3, 1, 1));
    }

    #[test]
    fn merge_fast_forwards_or_makes_a_merge_commit_as_asked() {
        let Some((_d, root)) = repo_with_feature() else { return };
        let init = rev(&root, "HEAD");
        let feature = rev(&root, "feature");
        // Fast-forward: main is at feature, no merge commit.
        start_merge(&root, "feature", "ff-only").unwrap();
        assert_eq!(rev(&root, "HEAD"), feature);
        assert_eq!(subjects(&root, "HEAD"), ["f2", "f1", "init"]);
        // Always a merge commit, with feature as the second parent and no message asked for.
        git_ok(&root, &["reset", "-q", "--hard", &init]);
        start_merge(&root, "feature", "no-ff").unwrap();
        assert!(subjects(&root, "HEAD")[0].starts_with("Merge branch 'feature'"), "{:?}", subjects(&root, "HEAD"));
        assert_eq!(rev(&root, "HEAD^2"), feature);
        assert_eq!(rev(&root, "HEAD^1"), init);
        // Both sides have commits: "auto" joins them with a merge commit; feature itself is unchanged.
        git_ok(&root, &["reset", "-q", "--hard", &init]);
        commit_file(&root, "m1.txt", "m\n", "m1");
        let before = rev(&root, "HEAD");
        // A fast-forward is no longer possible: refused, and no merge commit is made instead.
        assert!(start_merge(&root, "feature", "ff-only").is_err());
        assert_eq!(rev(&root, "HEAD"), before);
        assert!(operation(&root).is_none());
        start_merge(&root, "feature", "auto").unwrap();
        assert_eq!((rev(&root, "HEAD^1"), rev(&root, "HEAD^2"), rev(&root, "feature")), (before, feature.clone(), feature));
        assert!(status(&root).unwrap().unwrap().files.is_empty());
        assert!(start_merge(&root, "feature", "sideways").is_err());
        // A remote-style or unknown name never becomes an option.
        assert!(start_merge(&root, "--abort", "auto").unwrap_err().contains("is not a branch or commit"));
        // A detached HEAD can merge too.
        git_ok(&root, &["checkout", "-q", "--detach", &init]);
        start_merge(&root, "feature", "ff-only").unwrap();
        assert_eq!(rev(&root, "HEAD"), rev(&root, "feature"));
    }

    #[test]
    fn a_conflicting_merge_stops_in_the_existing_flow_and_can_be_aborted() {
        let Some((_d, root)) = repo() else { return };
        commit_file(&root, "notes.txt", "1\n2\n3\n4\n", "init");
        git_ok(&root, &["switch", "-qc", "feature"]);
        commit_file(&root, "notes.txt", "1\n2\n3\nfeature\n", "theirs");
        git_ok(&root, &["switch", "-q", "main"]);
        commit_file(&root, "notes.txt", "1\n2\n3\nmain\n", "ours");
        let before = rev(&root, "HEAD");
        let err = start_merge(&root, "feature", "auto").unwrap_err();
        assert!(err.contains("CONFLICT") && err.contains("notes.txt"), "{err}");
        let st = status(&root).unwrap().unwrap();
        assert_eq!(st.operation.as_deref(), Some("merge"));
        assert!(st.operation_message.as_ref().unwrap().starts_with("Merge branch 'feature'"));
        assert!(file(&st, &root, "notes.txt").conflicted);
        // Nothing else starts on top of it.
        assert!(start_merge(&root, "feature", "auto").unwrap_err().contains("in progress"));
        assert!(start_rebase(&root, "feature").unwrap_err().contains("in progress"));
        assert!(force_push(&root).unwrap_err().contains("in progress"));
        assert_eq!(abort_operation(&root).unwrap(), "merge");
        assert_eq!(rev(&root, "HEAD"), before);
        let st = status(&root).unwrap().unwrap();
        assert!(st.operation.is_none() && st.files.is_empty());
        assert_eq!(std::fs::read_to_string(root.join("notes.txt")).unwrap(), "1\n2\n3\nmain\n");
    }

    #[test]
    fn merge_and_rebase_refuse_uncommitted_tracked_changes_but_not_untracked_files() {
        let Some((_d, root)) = repo_with_feature() else { return };
        let before = rev(&root, "HEAD");
        // An unstaged change to a tracked file.
        write(&root, "a.txt", "edited\n");
        assert!(start_merge(&root, "feature", "auto").unwrap_err().contains("uncommitted changes"));
        // A staged one: still staged after the refusal.
        git_ok(&root, &["add", "a.txt"]);
        assert!(start_rebase(&root, "feature").unwrap_err().contains("uncommitted changes"));
        let st = status(&root).unwrap().unwrap();
        assert_eq!(xy(file(&st, &root, "a.txt")), ("M", "."));
        assert_eq!(rev(&root, "HEAD"), before);
        git_ok(&root, &["reset", "-q", "--hard"]);
        // An untracked file the other side adds too: git refuses, names it, nothing is in progress.
        write(&root, "f1.txt", "mine\n");
        let err = start_merge(&root, "feature", "auto").unwrap_err();
        assert!(err.contains("f1.txt"), "{err}");
        assert!(operation(&root).is_none());
        assert_eq!(rev(&root, "HEAD"), before);
        assert_eq!(std::fs::read_to_string(root.join("f1.txt")).unwrap(), "mine\n");
        std::fs::remove_file(root.join("f1.txt")).unwrap();
        // An untracked file that is not in the way does not block, and is still there after.
        write(&root, "scratch.txt", "x\n");
        start_merge(&root, "feature", "ff-only").unwrap();
        let st = status(&root).unwrap().unwrap();
        assert!(file(&st, &root, "scratch.txt").untracked);
        assert_eq!(rev(&root, "HEAD"), rev(&root, "feature"));
    }

    #[test]
    fn unrelated_histories_are_refused_by_git_with_nothing_left_in_progress() {
        let Some((_d, root)) = repo() else { return };
        commit_file(&root, "a.txt", "one\n", "init");
        git_ok(&root, &["checkout", "-q", "--orphan", "imported"]);
        git_ok(&root, &["rm", "-rqf", "."]);
        commit_file(&root, "b.txt", "two\n", "other root");
        git_ok(&root, &["switch", "-q", "main"]);
        let before = rev(&root, "HEAD");
        assert_eq!({ let p = merge_preview(&root, "imported").unwrap(); (p.ahead, p.behind) }, (1, 1));
        let err = start_merge(&root, "imported", "auto").unwrap_err();
        assert!(err.contains("unrelated histories"), "{err}");
        assert!(operation(&root).is_none());
        assert_eq!(rev(&root, "HEAD"), before);
    }

    #[test]
    fn rebase_replays_the_branch_on_top_of_the_target() {
        let Some((_d, root)) = repo_with_feature() else { return };
        commit_file(&root, "m1.txt", "m\n", "m1");
        commit_file(&root, "m2.txt", "m\n", "m2");
        let feature = rev(&root, "feature");
        let p = merge_preview(&root, "feature").unwrap();
        assert_eq!((p.ahead, p.behind, p.merges, p.pushed), (2, 2, 0, 0));
        start_rebase(&root, "feature").unwrap();
        assert_eq!(subjects(&root, "HEAD"), ["m2", "m1", "f2", "f1", "init"]);
        assert_eq!(rev(&root, "feature"), feature, "the target itself does not move");
        let st = status(&root).unwrap().unwrap();
        assert_eq!(st.branch.as_deref(), Some("main"));
        assert!(st.operation.is_none() && st.files.is_empty());
        assert_eq!(merge_preview(&root, "feature").unwrap().behind, 0);
        // Not on a branch: there is nothing to move.
        git_ok(&root, &["checkout", "-q", "--detach"]);
        assert!(start_rebase(&root, "feature").unwrap_err().contains("Switch to a branch first"));
    }

    #[test]
    fn a_conflicting_rebase_stops_with_its_step_and_abort_restores_the_branch() {
        let Some((_d, root)) = repo() else { return };
        commit_file(&root, "notes.txt", "1\n2\n3\n4\n", "init");
        git_ok(&root, &["switch", "-qc", "feature"]);
        commit_file(&root, "notes.txt", "1\n2\n3\nfeature\n", "theirs");
        git_ok(&root, &["switch", "-q", "main"]);
        commit_file(&root, "notes.txt", "1\n2\n3\nmain\n", "mine 1");
        commit_file(&root, "other.txt", "x\n", "mine 2");
        let before = rev(&root, "HEAD");
        let err = start_rebase(&root, "feature").unwrap_err();
        assert!(err.contains("CONFLICT") && err.contains("notes.txt"), "{err}");
        let st = status(&root).unwrap().unwrap();
        assert_eq!(st.operation.as_deref(), Some("rebase"));
        assert_eq!(st.operation_step, Some((1, 2)));
        assert!(file(&st, &root, "notes.txt").conflicted);
        assert!(start_merge(&root, "feature", "auto").unwrap_err().contains("in progress"));
        assert_eq!(abort_operation(&root).unwrap(), "rebase");
        let st = status(&root).unwrap().unwrap();
        assert_eq!(st.branch.as_deref(), Some("main"));
        assert!(st.operation.is_none() && st.files.is_empty());
        assert_eq!(rev(&root, "HEAD"), before, "the original commits, ids unchanged");

        // Resolved and continued: both commits end up on top of feature.
        start_rebase(&root, "feature").unwrap_err();
        write(&root, "notes.txt", "1\n2\n3\nboth\n");
        git_ok(&root, &["add", "notes.txt"]);
        assert_eq!(continue_operation(&root, "continue").unwrap(), "rebase");
        assert!(operation(&root).is_none());
        assert_eq!(subjects(&root, "HEAD"), ["mine 2", "mine 1", "theirs", "init"]);
    }

    #[test]
    fn pushed_commits_are_those_any_remote_branch_holds() {
        let Some((_d, root)) = repo_with_feature() else { return };
        commit_file(&root, "c1.txt", "1\n", "c1");
        let bare = tempfile::tempdir().unwrap();
        git_ok(bare.path(), &["init", "-q", "--bare"]);
        add_remote(&root, "origin", &bare.path().to_string_lossy()).unwrap();
        remote_op(&root, "push").unwrap();
        // Nothing local yet: every commit of the range is on origin/main.
        let all = pushed_commits(&root, "feature..HEAD").unwrap();
        assert_eq!((all.count, all.on.as_deref()), (1, Some("origin/main")));
        commit_file(&root, "c2.txt", "2\n", "c2");
        commit_file(&root, "c3.txt", "3\n", "c3");
        let p = merge_preview(&root, "feature").unwrap();
        assert_eq!((p.ahead, p.pushed, p.pushed_on.as_deref()), (3, 1, Some("origin/main")));
        assert_eq!(p.pushed_commits.iter().map(|c| c.summary.as_str()).collect::<Vec<_>>(), ["c1"]);
        assert_eq!(p.pushed_commits[0].sha, rev(&root, "HEAD~2"));
        // A branch with no upstream is protected just the same (git_unpushed would say nothing).
        git_ok(&root, &["switch", "-qc", "work"]);
        assert!(unpushed(&root).is_empty());
        let p = pushed_commits(&root, "feature..HEAD").unwrap();
        assert_eq!((p.count, p.on.as_deref()), (1, Some("origin/main")));
        // Nothing of feature's own commits was pushed.
        let none = pushed_commits(&root, "main..feature").unwrap();
        assert_eq!((none.count, none.on, none.commits.len()), (0, None, 0));
        assert!(pushed_commits(&root, "--all").is_err());
    }

    #[test]
    fn force_push_replaces_only_the_upstream_and_the_lease_refuses_when_it_moved() {
        let Some((_d, root)) = repo() else { return };
        commit_file(&root, "a.txt", "one\n", "init");
        commit_file(&root, "b.txt", "two\n", "c1");
        let bare = tempfile::tempdir().unwrap();
        git_ok(bare.path(), &["init", "-q", "--bare"]);
        add_remote(&root, "origin", &bare.path().to_string_lossy()).unwrap();
        remote_op(&root, "push").unwrap();
        git_ok(&root, &["push", "-q", "origin", "main:release"]);
        let release = rev(bare.path(), "refs/heads/release");
        // A colleague's clone, made before the rewrite.
        let other = tempfile::tempdir().unwrap();
        git_ok(other.path(), &["clone", "-q", "-b", "main", &bare.path().to_string_lossy(), "."]);

        // Nothing to replace yet.
        assert_eq!(force_push_preview(&root).unwrap().lost, 0);
        // Rewrite the pushed commit.
        git_ok(&root, &["commit", "-q", "--amend", "-m", "c1 reworded"]);
        let st = status(&root).unwrap().unwrap();
        assert_eq!((st.ahead, st.behind), (1, 1));
        let p = force_push_preview(&root).unwrap();
        assert_eq!((p.branch.as_str(), p.upstream.as_str(), p.lost), ("main", "origin/main", 1));
        assert_eq!(p.commits.iter().map(|c| c.summary.as_str()).collect::<Vec<_>>(), ["c1"]);
        // The plain push never forces.
        assert!(remote_op(&root, "push").is_err());
        assert_eq!(subjects(bare.path(), "refs/heads/main"), ["c1", "init"]);

        // The colleague pushes after our last fetch: the lease refuses, their commit stays.
        git_ok(other.path(), &["-c", "user.name=o", "-c", "user.email=o@o", "commit", "-q", "--allow-empty", "-m", "theirs"]);
        git_ok(other.path(), &["push", "-q"]);
        let err = remote_op(&root, "push-force").unwrap_err();
        assert_eq!(err, "origin/main has commits you have not fetched. Fetch and look at them first.");
        assert_eq!(subjects(bare.path(), "refs/heads/main"), ["theirs", "c1", "init"]);

        // After a fetch the dialog would list both; the force push then goes through.
        remote_op(&root, "fetch").unwrap();
        let p = force_push_preview(&root).unwrap();
        assert_eq!(p.commits.iter().map(|c| c.summary.as_str()).collect::<Vec<_>>(), ["theirs", "c1"]);
        remote_op(&root, "push-force").unwrap();
        assert_eq!(rev(bare.path(), "refs/heads/main"), rev(&root, "HEAD"));
        assert_eq!(rev(bare.path(), "refs/heads/release"), release, "no other branch on the remote changes");
        let st = status(&root).unwrap().unwrap();
        assert_eq!((st.ahead, st.behind), (0, 0));

        // No upstream, or not on a branch: nothing to replace.
        git_ok(&root, &["switch", "-qc", "solo"]);
        assert!(remote_op(&root, "push-force").unwrap_err().contains("no remote branch to replace"));
        git_ok(&root, &["checkout", "-q", "--detach"]);
        assert!(remote_op(&root, "push-force").unwrap_err().contains("not on a branch"));
    }

    // ---------- stash ----------

    /// A repository with app.ts, store.ts and old.ts committed as "Fix tab order".
    fn stash_repo() -> Option<(tempfile::TempDir, PathBuf)> {
        let (d, root) = repo()?;
        write(&root, "app.ts", "one\n");
        write(&root, "store.ts", "state\n");
        write(&root, "old.ts", "old\n");
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "Fix tab order"]);
        Some((d, root))
    }

    fn read(root: &Path, rel: &str) -> String {
        std::fs::read_to_string(root.join(rel)).unwrap()
    }

    #[test]
    fn stash_push_takes_tracked_changes_and_untracked_only_when_asked() {
        let Some((_d, root)) = stash_repo() else { return };
        let st = status(&root).unwrap().unwrap();
        assert_eq!((st.stash.clone(), st.stash_count), (None, 0));
        assert!(stash_list(&root).unwrap().is_empty());
        // Nothing to stash is an error, not a silent success.
        assert!(stash_push(&root, "x", true).unwrap_err().contains("no uncommitted changes"));

        std::fs::write(root.join(".gitignore"), "build/\n").unwrap();
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "ignore build"]);
        std::fs::create_dir(root.join("build")).unwrap();
        write(&root, "build/out.log", "ignored\n");
        write(&root, "app.ts", "two\n");
        write(&root, "store.ts", "staged\n");
        git_ok(&root, &["add", "store.ts"]);
        write(&root, "notes.txt", "scratch\n");

        // Without untracked files: they stay, the tracked changes (staged or not) go.
        let first = stash_push(&root, "WIP parser", false).unwrap();
        let st = status(&root).unwrap().unwrap();
        assert_eq!(st.files.len(), 1, "{:?}", st.files);
        assert!(file(&st, &root, "notes.txt").untracked);
        assert_eq!(read(&root, "app.ts"), "one\n");
        assert_eq!((st.stash.as_deref(), st.stash_count), (Some(first.as_str()), 1));
        let list = stash_list(&root).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!((list[0].sha.as_str(), list[0].subject.as_str(), list[0].untracked), (first.as_str(), "On main: WIP parser", false));
        assert_eq!(list[0].base, run_text(&root, true, &["rev-parse", "HEAD"]).unwrap().trim());
        assert_eq!(list[0].author, "Test User");
        assert!(list[0].time > 0);

        // With them, and without a message: git's own "WIP on" subject. Ignored files stay.
        let second = stash_push(&root, "  ", true).unwrap();
        assert!(status(&root).unwrap().unwrap().files.is_empty());
        assert!(!root.join("notes.txt").exists());
        assert!(root.join("build").join("out.log").exists());
        let list = stash_list(&root).unwrap();
        assert_eq!(list.iter().map(|s| s.sha.as_str()).collect::<Vec<_>>(), vec![second.as_str(), first.as_str()]);
        assert!(list[0].subject.starts_with("WIP on main: "), "{}", list[0].subject);
        assert!(list[0].subject.ends_with("ignore build"));
        assert!(list[0].untracked);
        assert_eq!(status(&root).unwrap().unwrap().stash_count, 2);
    }

    #[test]
    fn stash_push_needs_a_commit() {
        let Some((_d, root)) = repo() else { return };
        write(&root, "a.txt", "one\n");
        assert_eq!(stash_push(&root, "x", true).unwrap_err(), "Make a first commit before stashing.");
        assert!(root.join("a.txt").exists());
    }

    #[test]
    fn stash_files_lists_changes_and_untracked_and_show_reads_them() {
        let Some((_d, root)) = stash_repo() else { return };
        write(&root, "app.ts", "two\n");
        write(&root, "lexer.ts", "new\n");
        git_ok(&root, &["add", "lexer.ts"]);
        git_ok(&root, &["rm", "-q", "old.ts"]);
        let notes = write(&root, "notes.txt", "scratch\n");
        let sha = stash_push(&root, "WIP parser", true).unwrap();
        let files = stash_files(&root, &sha).unwrap();
        let got: Vec<(&str, &str)> = files.iter().map(|f| (f.status.as_str(), f.rel.as_str())).collect();
        assert_eq!(got, vec![("M", "app.ts"), ("A", "lexer.ts"), ("D", "old.ts"), ("?", "notes.txt")]);
        assert_eq!(files[3].path, notes);
        // Looking changes nothing.
        assert!(status(&root).unwrap().unwrap().files.is_empty());
        assert_eq!(stash_list(&root).unwrap().len(), 1);
        // The stashed text of a tracked file is in the stash commit, an untracked one in its third parent.
        let app = abs_path(&root, "app.ts");
        assert_eq!(show(&app, &sha, None).unwrap().unwrap().text, "two\n");
        assert_eq!(show(&app, &format!("{sha}^1"), None).unwrap().unwrap().text, "one\n");
        assert_eq!(show(&notes, &format!("{sha}^3"), None).unwrap().unwrap().text, "scratch\n");
        assert!(show(&notes, &sha, None).unwrap().is_none());
        assert!(stash_files(&root, "stash@{0}").is_err());
    }

    #[test]
    fn stash_apply_keeps_the_stash_and_pop_removes_it() {
        let Some((_d, root)) = stash_repo() else { return };
        write(&root, "app.ts", "two\n");
        git_ok(&root, &["add", "app.ts"]);
        write(&root, "notes.txt", "scratch\n");
        let sha = stash_push(&root, "WIP parser", true).unwrap();

        // Apply on top of an unrelated change: both are there, what was staged comes back unstaged.
        write(&root, "store.ts", "mine\n");
        assert_eq!(stash_op(&root, &sha, "apply").unwrap(), "ok");
        let st = status(&root).unwrap().unwrap();
        assert_eq!(xy(file(&st, &root, "app.ts")), (".", "M"));
        assert_eq!(xy(file(&st, &root, "store.ts")), (".", "M"));
        assert!(file(&st, &root, "notes.txt").untracked);
        assert_eq!(read(&root, "store.ts"), "mine\n");
        assert_eq!(stash_list(&root).unwrap().len(), 1);

        git_ok(&root, &["checkout", "-q", "."]);
        std::fs::remove_file(root.join("notes.txt")).unwrap();
        assert_eq!(stash_op(&root, &sha, "pop").unwrap(), "ok");
        assert_eq!(read(&root, "app.ts"), "two\n");
        assert!(root.join("notes.txt").exists());
        assert!(stash_list(&root).unwrap().is_empty());
        // It is gone now: a second pop says so and changes nothing.
        assert_eq!(stash_op(&root, &sha, "pop").unwrap_err(), "That stash no longer exists.");
        assert_eq!(stash_op(&root, &sha, "drop").unwrap_err(), "That stash no longer exists.");
        assert!(stash_op(&root, &sha, "clear").is_err());
    }

    #[test]
    fn stash_actions_go_by_commit_id_not_by_position() {
        let Some((_d, root)) = stash_repo() else { return };
        let mut ids = Vec::new();
        for (i, text) in ["first\n", "second\n", "third\n"].iter().enumerate() {
            write(&root, "app.ts", text);
            ids.push(stash_push(&root, &format!("stash {i}"), false).unwrap());
        }
        // ids[0] is the oldest: it is stash@{2} now. A caller that still thinks it is the newest
        // (a stale list) gets the right one all the same.
        assert_eq!(stash_op(&root, &ids[0], "pop").unwrap(), "ok");
        assert_eq!(read(&root, "app.ts"), "first\n");
        let left: Vec<String> = stash_list(&root).unwrap().into_iter().map(|s| s.sha).collect();
        assert_eq!(left, vec![ids[2].clone(), ids[1].clone()]);
        git_ok(&root, &["checkout", "-q", "."]);
        // Drop the older of the two that are left: the newer one stays, files untouched.
        assert_eq!(stash_op(&root, &ids[1], "drop").unwrap(), "ok");
        let left: Vec<String> = stash_list(&root).unwrap().into_iter().map(|s| s.sha).collect();
        assert_eq!(left, vec![ids[2].clone()]);
        assert_eq!(read(&root, "app.ts"), "one\n");
        let st = status(&root).unwrap().unwrap();
        assert_eq!((st.stash.as_deref(), st.stash_count), (Some(ids[2].as_str()), 1));
    }

    #[test]
    fn stash_that_cannot_start_changes_nothing_and_is_kept() {
        let Some((_d, root)) = stash_repo() else { return };
        write(&root, "app.ts", "two\n");
        write(&root, "store.ts", "stashed\n");
        write(&root, "notes.txt", "scratch\n");
        write(&root, "draft.ts", "draft\n");
        let sha = stash_push(&root, "WIP parser", true).unwrap();

        // My own change to a file the stash changes: git refuses and names the file.
        write(&root, "app.ts", "mine\n");
        for op in ["apply", "pop"] {
            let err = stash_op(&root, &sha, op).unwrap_err();
            assert!(err.contains("would be overwritten") && err.contains("app.ts"), "{err}");
            assert_eq!(read(&root, "app.ts"), "mine\n");
            assert_eq!(read(&root, "store.ts"), "state\n");
            assert!(!root.join("notes.txt").exists());
            assert_eq!(stash_list(&root).unwrap().len(), 1);
        }
        git_ok(&root, &["checkout", "-q", "."]);

        // An untracked file of the stash already exists: refused before anything is restored
        // (git alone would apply the tracked changes and the other untracked file first).
        write(&root, "notes.txt", "my own notes\n");
        for op in ["apply", "pop"] {
            let err = stash_op(&root, &sha, op).unwrap_err();
            assert!(err.contains("notes.txt already exists") && !err.contains("draft.ts"), "{err}");
            assert_eq!(read(&root, "notes.txt"), "my own notes\n");
            assert_eq!(read(&root, "app.ts"), "one\n");
            assert!(!root.join("draft.ts").exists());
            assert_eq!(stash_list(&root).unwrap().len(), 1);
        }
    }

    #[test]
    fn stash_pop_that_conflicts_keeps_the_stash_and_records_no_operation() {
        let Some((_d, root)) = stash_repo() else { return };
        write(&root, "app.ts", "stashed\n");
        write(&root, "store.ts", "stashed too\n");
        let sha = stash_push(&root, "WIP parser", false).unwrap();
        write(&root, "app.ts", "committed since\n");
        git_ok(&root, &["commit", "-qam", "change the same line"]);
        let git_dir: Vec<String> = std::fs::read_dir(root.join(".git")).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();

        assert_eq!(stash_op(&root, &sha, "pop").unwrap(), "conflicts");
        let st = status(&root).unwrap().unwrap();
        assert!(file(&st, &root, "app.ts").conflicted);
        assert_eq!(read(&root, "store.ts"), "stashed too\n");
        assert_eq!(st.operation, None);
        assert_eq!(st.operation_message, None);
        // The stash is still there, and nothing but git's own files was added to .git.
        assert_eq!(stash_list(&root).unwrap().iter().map(|s| s.sha.as_str()).collect::<Vec<_>>(), vec![sha.as_str()]);
        for e in std::fs::read_dir(root.join(".git")).unwrap() {
            let name = e.unwrap().file_name().to_string_lossy().into_owned();
            assert!(git_dir.contains(&name) || name == "AUTO_MERGE" || name == "ORIG_HEAD", "unexpected .git/{name}");
        }
        // While files are in conflict another apply is refused by git, as an error.
        assert!(stash_op(&root, &sha, "apply").is_err());

        // "Current" keeps the file as it was before the pop; the stash can then be dropped.
        assert_eq!(resolve_side(&root, &abs_path(&root, "app.ts"), "ours").unwrap(), "kept");
        assert_eq!(read(&root, "app.ts"), "committed since\n");
        let st = status(&root).unwrap().unwrap();
        assert!(st.files.iter().all(|f| !f.conflicted));
        assert_eq!(stash_op(&root, &sha, "drop").unwrap(), "ok");
        assert!(stash_list(&root).unwrap().is_empty());

        // An apply that conflicts reports the same.
        git_ok(&root, &["reset", "-q", "--hard"]);
        write(&root, "app.ts", "stashed again\n");
        let sha = stash_push(&root, "", false).unwrap();
        write(&root, "app.ts", "and committed again\n");
        git_ok(&root, &["commit", "-qam", "again"]);
        assert_eq!(stash_op(&root, &sha, "apply").unwrap(), "conflicts");
        assert_eq!(stash_list(&root).unwrap().len(), 1);
    }

    #[test]
    fn graph_shows_one_row_per_stash_above_its_base_only_for_all_branches() {
        let Some((_d, root)) = stash_repo() else { return };
        let base = run_text(&root, true, &["rev-parse", "HEAD"]).unwrap().trim().to_string();
        // Two stashes on the same commit; the first holds staged changes and an untracked file,
        // so git keeps three commits for it.
        write(&root, "app.ts", "two\n");
        git_ok(&root, &["add", "app.ts"]);
        write(&root, "notes.txt", "scratch\n");
        let first = stash_push(&root, "WIP parser", true).unwrap();
        write(&root, "store.ts", "other\n");
        let second = stash_push(&root, "", false).unwrap();
        for i in 0..3 {
            write(&root, "app.ts", &format!("commit {i}\n"));
            git_ok(&root, &["commit", "-qam", &format!("later {i}")]);
        }

        let all = graph(&root, true, 0, 300).unwrap();
        let subjects: Vec<String> = all.iter().map(|c| c.summary.clone()).collect();
        assert_eq!(all.len(), 6, "{subjects:?}");
        assert!(subjects.iter().all(|s| !s.starts_with("index on") && !s.starts_with("untracked files on")), "{subjects:?}");
        // later 2, later 1, later 0, then the stashes (newest first) right above their base.
        assert_eq!(all.iter().map(|c| c.sha.as_str()).skip(3).collect::<Vec<_>>(), vec![second.as_str(), first.as_str(), base.as_str()]);
        for c in &all[3..5] {
            assert!(c.stash);
            assert_eq!(c.parents, vec![base.clone()]);
            assert_eq!(c.refs, vec!["refs/stash".to_string()]);
            assert_eq!(c.author, "Test User");
        }
        assert_eq!(all[4].summary, "On main: WIP parser");
        assert!(all.iter().filter(|c| !c.stash).all(|c| !c.refs.iter().any(|r| r == "refs/stash")));

        // Paging counts commits only: the second page of 2 starts at the third commit.
        let page = graph(&root, true, 2, 2).unwrap();
        assert_eq!(page.iter().filter(|c| !c.stash).count(), 2);
        assert_eq!(page.iter().map(|c| c.summary.as_str()).collect::<Vec<_>>(), vec!["later 0", subjects[3].as_str(), "On main: WIP parser", "Fix tab order"]);

        // The current-branch view and the whole-history search leave stashes out.
        let current = graph(&root, false, 0, 300).unwrap();
        assert_eq!(current.len(), 4);
        assert!(current.iter().all(|c| !c.stash));
        assert!(graph_search(&root, true, "parser", 50).unwrap().is_empty());

        // A stash whose base no branch reaches any more still shows, with that commit.
        git_ok(&root, &["reset", "-q", "--hard", "HEAD~1"]);
        write(&root, "app.ts", "on a commit that goes away\n");
        git_ok(&root, &["commit", "-qam", "orphan"]);
        write(&root, "app.ts", "stashed on the orphan\n");
        let orphaned = stash_push(&root, "on orphan", false).unwrap();
        git_ok(&root, &["reset", "-q", "--hard", "HEAD~1"]);
        let all = graph(&root, true, 0, 300).unwrap();
        let at = all.iter().position(|c| c.sha == orphaned).expect("the stash on the orphaned commit");
        assert_eq!(all[at + 1].summary, "orphan");

        // No stashes: the graph is what it was.
        for id in [orphaned, second, first] {
            stash_op(&root, &id, "drop").unwrap();
        }
        let all = graph(&root, true, 0, 300).unwrap();
        assert!(all.iter().all(|c| !c.stash));
        assert_eq!(all.len(), graph(&root, false, 0, 300).unwrap().len());
    }

    // ---------- compare commits (specs/git-compare-commits.md) ----------

    fn compared(c: &GitCompare) -> Vec<(String, String, Option<String>)> {
        let mut got: Vec<_> = c.files.iter().map(|f| (f.status.clone(), f.rel.clone(), f.orig_rel.clone())).collect();
        got.sort();
        got
    }

    fn row(status: &str, rel: &str, orig: Option<&str>) -> (String, String, Option<String>) {
        (status.to_string(), rel.to_string(), orig.map(str::to_string))
    }

    /// Everything a comparison must leave alone: branch, commit, status, refs, stashes, and every
    /// file inside .git (size and time; the index byte for byte).
    fn repo_state(root: &Path) -> String {
        fn walk(dir: &Path, out: &mut Vec<String>) {
            let mut entries: Vec<_> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().path()).collect();
            entries.sort();
            for p in entries {
                if p.is_dir() {
                    walk(&p, out);
                } else {
                    let m = std::fs::metadata(&p).unwrap();
                    out.push(format!("{} {} {:?}", p.display(), m.len(), m.modified().unwrap()));
                }
            }
        }
        let mut inside = Vec::new();
        walk(&root.join(".git"), &mut inside);
        let index = std::fs::read(root.join(".git").join("index")).unwrap();
        let mut state = String::new();
        for args in [&["status", "--porcelain=v2", "--branch"][..], &["for-each-ref"], &["stash", "list"]] {
            state.push_str(&run_text(root, true, args).unwrap());
        }
        format!("{state}\n{}\n{index:?}", inside.join("\n"))
    }

    #[test]
    fn compare_lists_added_modified_deleted_and_renamed_files_between_two_commits() {
        let Some((_d, root)) = repo() else { return };
        write(&root, "util.ts", "one\ntwo\nthree\nfour\nfive\nsix\n");
        write(&root, "old.ts", "x\n");
        write(&root, "store.ts", "a\nb\n");
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "first"]);
        let first = rev(&root, "HEAD");
        std::fs::create_dir_all(root.join("lib")).unwrap();
        git_ok(&root, &["mv", "util.ts", "lib/helpers.ts"]);
        write(&root, "lib/helpers.ts", "one\ntwo\nthree\nfour\nfive\nSIX\n");
        git_ok(&root, &["rm", "-q", "old.ts"]);
        write(&root, "store.ts", "a\nb\nc\n");
        write(&root, "new.ts", "n\n");
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "second"]);
        let second = rev(&root, "HEAD");

        let c = diff_files(&root, &first, Some(&second)).unwrap();
        assert_eq!(compared(&c), [row("A", "new.ts", None), row("D", "old.ts", None), row("M", "store.ts", None), row("R", "lib/helpers.ts", Some("util.ts"))]);
        assert_eq!((c.insertions, c.deletions), (3, 2));
        // The left commit is an ancestor of the right one: 1 commit ahead, none behind.
        assert_eq!((c.ahead, c.behind, c.untracked), (1, 0, 0));
        assert_eq!((c.left.sha.as_str(), c.left.summary.as_str()), (first.as_str(), "first"));
        let right = c.right.as_ref().unwrap();
        assert_eq!(right.sha, second);
        assert!(right.refs.contains(&"refs/heads/main".to_string()) && right.refs.contains(&"HEAD".to_string()));
        assert!(c.head.is_none());
        assert!(c.files.iter().all(|f| f.path.starts_with(&*root.to_string_lossy())));

        // The other way round the letters read the other way too.
        let back = diff_files(&root, &second, Some(&first)).unwrap();
        assert_eq!(compared(&back), [row("A", "old.ts", None), row("D", "new.ts", None), row("M", "store.ts", None), row("R", "util.ts", Some("lib/helpers.ts"))]);
        assert_eq!((back.insertions, back.deletions, back.ahead, back.behind), (2, 3, 0, 1));

        // Two different commits with identical files: a commit and the revert of its revert.
        git_ok(&root, &["revert", "--no-edit", "HEAD"]);
        git_ok(&root, &["revert", "--no-edit", "HEAD"]);
        let again = rev(&root, "HEAD");
        assert_ne!(again, second);
        let before = repo_state(&root);
        let same = diff_files(&root, &second, Some(&again)).unwrap();
        assert!(same.files.is_empty());
        assert_eq!((same.insertions, same.deletions, same.ahead, same.behind), (0, 0, 2, 0));

        // Nothing moved and nothing inside .git was written by any of the comparisons.
        let _ = diff_files(&root, &first, Some(&second)).unwrap();
        let _ = diff_files(&root, &first, None).unwrap();
        assert!(repo_state(&root) == before, "a comparison changed the repository");
        assert!(diff_files(&root, "HEAD; rm -rf", Some(&second)).is_err());
    }

    #[test]
    fn compare_commits_on_two_branches_counts_both_sides_and_takes_branch_names() {
        let Some((_d, root)) = repo_with_feature() else { return };
        commit_file(&root, "m.txt", "m\n", "on main");
        let main = rev(&root, "main");
        let feature = rev(&root, "feature");
        let c = diff_files(&root, &main, Some(&feature)).unwrap();
        // The direct difference of the two snapshots: what changed only on main shows too (as deleted).
        assert_eq!(compared(&c), [row("A", "f1.txt", None), row("A", "f2.txt", None), row("D", "m.txt", None)]);
        assert_eq!((c.ahead, c.behind), (2, 1));

        // A branch name and HEAD are resolved to their commits; nothing is checked out.
        let named = diff_files(&root, "HEAD", Some("feature")).unwrap();
        assert_eq!((named.left.sha.as_str(), named.right.as_ref().unwrap().sha.as_str()), (main.as_str(), feature.as_str()));
        assert_eq!(compared(&named), compared(&c));
        let own = diff_files(&root, "HEAD", Some("main")).unwrap();
        assert!(own.files.is_empty());
        assert_eq!((own.ahead, own.behind), (0, 0));
        assert_eq!(run_text(&root, true, &["branch", "--show-current"]).unwrap().trim(), "main");
        assert_eq!((rev(&root, "main"), rev(&root, "feature")), (main.clone(), feature));

        // A name that looks like an option is refused before git is run with it.
        let err = diff_files(&root, &main, Some("--output=x")).unwrap_err();
        assert!(err.contains("not a valid branch name"), "{err}");
        assert!(!root.join("x").exists());
        assert!(diff_files(&root, "-h", Some("main")).unwrap_err().contains("not a valid branch name"));
        assert!(diff_files(&root, &main, Some("no-such-branch")).unwrap_err().contains("is not a branch in this repository"));
        assert!(diff_files(&root, &"0".repeat(40), Some("main")).unwrap_err().contains("is not a commit"));
    }

    #[test]
    fn compare_with_the_working_tree_lists_staged_and_unstaged_changes_and_touches_nothing() {
        let Some((_d, root)) = repo() else { return };
        write(&root, "app.ts", "one\n");
        write(&root, "store.ts", "one\n");
        write(&root, "old.ts", "x\n");
        write(&root, "same.ts", "same\n");
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "first"]);
        let first = rev(&root, "HEAD");
        commit_file(&root, "later.ts", "l\n", "second");
        let second = rev(&root, "HEAD");

        // A clean folder matches the commit it is on.
        let clean = diff_files(&root, &second, None).unwrap();
        assert!(clean.files.is_empty() && clean.right.is_none());
        assert_eq!((clean.ahead, clean.behind, clean.untracked), (0, 0, 0));

        write(&root, "app.ts", "one\nstaged\n");
        git_ok(&root, &["add", "app.ts"]);
        write(&root, "store.ts", "one\nunstaged\n");
        std::fs::remove_file(root.join("old.ts")).unwrap();
        write(&root, "scratch.txt", "untracked\n");
        // Written again with the same text: the index's cached file time is now stale, which a
        // plain `git status` would refresh by rewriting the index.
        std::thread::sleep(std::time::Duration::from_millis(1100));
        write(&root, "same.ts", "same\n");
        let before = repo_state(&root);

        let c = diff_files(&root, &first, None).unwrap();
        assert_eq!(compared(&c), [row("A", "later.ts", None), row("D", "old.ts", None), row("M", "app.ts", None), row("M", "store.ts", None)]);
        assert_eq!((c.ahead, c.behind, c.untracked), (1, 0, 1));
        assert!(second.starts_with(c.head.as_deref().unwrap()));
        assert_eq!(c.left.sha, first);
        // Against the current commit only the uncommitted work shows.
        let own = diff_files(&root, &second, None).unwrap();
        assert_eq!(compared(&own), [row("D", "old.ts", None), row("M", "app.ts", None), row("M", "store.ts", None)]);

        // No file inside .git changed, not even the index; the same change is staged, the same
        // one unstaged, the file still untracked, on the same branch and commit.
        assert!(repo_state(&root) == before, "a comparison with the working tree changed the repository");
        let st = status(&root).unwrap().unwrap();
        assert_eq!(xy(file(&st, &root, "app.ts")), ("M", "."));
        assert_eq!(xy(file(&st, &root, "store.ts")), (".", "M"));
        assert!(file(&st, &root, "scratch.txt").untracked);
        assert_eq!((st.branch.as_deref(), rev(&root, "HEAD")), (Some("main"), second));
    }

    #[test]
    fn compare_with_the_working_tree_marks_a_conflicted_file_once() {
        let Some((_d, root)) = repo() else { return };
        commit_file(&root, "notes.txt", "1\n2\n3\n4\n", "init");
        let init = rev(&root, "HEAD");
        git_ok(&root, &["switch", "-qc", "feature"]);
        commit_file(&root, "notes.txt", "1\n2\n3\nfeature\n", "theirs");
        git_ok(&root, &["switch", "-q", "main"]);
        commit_file(&root, "notes.txt", "1\n2\n3\nmain\n", "ours");
        assert!(start_merge(&root, "feature", "auto").is_err());
        let c = diff_files(&root, &init, None).unwrap();
        assert_eq!(compared(&c), [row("U", "notes.txt", None)]);
        // The merge is still stopped, with the same conflicted file.
        let st = status(&root).unwrap().unwrap();
        assert_eq!(st.operation.as_deref(), Some("merge"));
        assert!(file(&st, &root, "notes.txt").conflicted);
    }

    // ---------- branch and tag housekeeping (specs/git-branches.md) ----------

    /// `repo_with_feature` plus a bare "origin" that has main.
    fn repo_with_origin() -> Option<(tempfile::TempDir, PathBuf, tempfile::TempDir)> {
        let (d, root) = repo_with_feature()?;
        let bare = tempfile::tempdir().unwrap();
        git_ok(bare.path(), &["init", "-q", "--bare", "-b", "main"]);
        add_remote(&root, "origin", &bare.path().to_string_lossy()).unwrap();
        remote_op(&root, "push").unwrap();
        Some((d, root, bare))
    }

    fn has_ref(root: &Path, full: &str) -> bool {
        ref_exists(root, full)
    }

    #[test]
    fn deleting_a_branch_is_safe_first_and_forced_only_for_the_commit_asked_about() {
        let Some((_d, root)) = repo_with_feature() else { return };
        write(&root, "wip.txt", "uncommitted\n");
        // Unmerged: measured against the branch I am on.
        let info = branch_info(&root, "branch", "feature").unwrap();
        assert_eq!((info.unmerged, info.base.as_deref(), info.current, info.upstream.is_none()), (2, Some("main"), false, true));
        assert_eq!(info.sha, short_sha(&root, "feature").unwrap());
        assert_eq!(ref_action(&root, "branch-delete", "feature", None).unwrap_err(), NOT_MERGED);
        assert!(has_ref(&root, "refs/heads/feature"), "the safe delete never forces");
        // The forced delete only goes through for the commit the question named.
        let stale = rev(&root, "main");
        assert!(ref_action(&root, "branch-delete-force", "feature", Some(&stale)).unwrap_err().contains("changed while the question was open"));
        assert!(ref_action(&root, "branch-delete-force", "feature", None).is_err());
        assert!(has_ref(&root, "refs/heads/feature"));
        let was = ref_action(&root, "branch-delete-force", "feature", Some(&info.full_sha)).unwrap();
        assert_eq!(was, info.sha);
        assert!(!has_ref(&root, "refs/heads/feature"));

        // Merged: one step, and the files and the current branch are left alone.
        git_ok(&root, &["branch", "done"]);
        assert_eq!(branch_info(&root, "branch", "done").unwrap().unmerged, 0);
        assert_eq!(ref_action(&root, "branch-delete", "done", None).unwrap(), short_sha(&root, "HEAD").unwrap());
        let st = status(&root).unwrap().unwrap();
        assert_eq!(st.branch.as_deref(), Some("main"));
        assert_eq!(st.files.len(), 1);

        // The branch I am on, a name that is no branch, an option instead of a name.
        assert!(branch_info(&root, "branch", "main").unwrap().current);
        for action in ["branch-delete", "branch-delete-force"] {
            assert_eq!(ref_action(&root, action, "main", Some(&rev(&root, "main"))).unwrap_err(), "You are on main. Switch to another branch first.");
            assert!(ref_action(&root, action, "nope", None).unwrap_err().contains("was not found"));
            assert!(ref_action(&root, action, "-D", None).unwrap_err().contains("was not found"));
        }
        assert!(has_ref(&root, "refs/heads/main"));
        assert!(ref_action(&root, "branch-explode", "main", None).is_err());
    }

    #[test]
    fn a_branch_with_an_upstream_is_measured_against_it_and_a_detached_head_against_its_commit() {
        let Some((_d, root, bare)) = repo_with_origin() else { return };
        // review: pushed and tracking, not merged into main.
        git_ok(&root, &["switch", "-qc", "review"]);
        commit_file(&root, "r.txt", "r\n", "r1");
        push_ref(&root, "branch", "review").unwrap();
        git_ok(&root, &["switch", "-q", "main"]);
        let info = branch_info(&root, "branch", "review").unwrap();
        assert_eq!((info.unmerged, info.base.as_deref(), info.upstream.as_deref()), (0, Some("origin/review"), Some("origin/review")));
        // One unpushed commit counts as unmerged, against the upstream.
        git_ok(&root, &["switch", "-q", "review"]);
        commit_file(&root, "r.txt", "r2\n", "r2");
        git_ok(&root, &["switch", "-q", "main"]);
        assert_eq!(branch_info(&root, "branch", "review").unwrap().unmerged, 1);
        assert_eq!(ref_action(&root, "branch-delete", "review", None).unwrap_err(), NOT_MERGED);
        push_ref(&root, "branch", "review").unwrap();
        // Deleting the local branch leaves the remote one, here and there.
        ref_action(&root, "branch-delete", "review", None).unwrap();
        assert!(has_ref(&root, "refs/remotes/origin/review"));
        assert!(has_ref(bare.path(), "refs/heads/review"));

        // Detached: no base branch, the commit instead.
        git_ok(&root, &["checkout", "-q", "--detach"]);
        let info = branch_info(&root, "branch", "feature").unwrap();
        assert_eq!((info.unmerged, info.base, info.base_sha), (2, None, Some(short_sha(&root, "HEAD").unwrap())));
    }

    #[test]
    fn a_branch_checked_out_in_another_worktree_is_kept() {
        let Some((_d, root)) = repo_with_feature() else { return };
        git_ok(&root, &["merge", "-q", "feature"]);
        let other = tempfile::tempdir().unwrap();
        git_ok(&root, &["worktree", "add", "-q", &other.path().join("wt").to_string_lossy(), "feature"]);
        let err = ref_action(&root, "branch-delete", "feature", None).unwrap_err();
        assert_ne!(err, NOT_MERGED);
        assert!(has_ref(&root, "refs/heads/feature"), "{err}");
    }

    #[test]
    fn a_branch_being_rebased_is_neither_renamed_nor_deleted() {
        let Some((_d, root)) = repo() else { return };
        commit_file(&root, "a.txt", "one\n", "init");
        git_ok(&root, &["switch", "-qc", "fix"]);
        commit_file(&root, "a.txt", "fix\n", "fix it");
        git_ok(&root, &["switch", "-q", "main"]);
        commit_file(&root, "a.txt", "main\n", "main moves");
        git_ok(&root, &["switch", "-q", "fix"]);
        assert!(start_rebase(&root, "main").is_err(), "stops on the conflict");
        assert_eq!(status(&root).unwrap().unwrap().operation.as_deref(), Some("rebase"));
        let tip = rev(&root, "refs/heads/fix");
        assert!(ref_action(&root, "branch-rename", "fix", Some("fix-2")).is_err());
        assert!(ref_action(&root, "branch-delete", "fix", None).is_err());
        assert!(ref_action(&root, "branch-delete-force", "fix", Some(&tip)).is_err());
        assert!(has_ref(&root, "refs/heads/fix") && !has_ref(&root, "refs/heads/fix-2"));
        assert_eq!(rev(&root, "refs/heads/fix"), tip);
        abort_operation(&root).unwrap();
        assert_eq!(status(&root).unwrap().unwrap().branch.as_deref(), Some("fix"));
    }

    #[test]
    fn rename_keeps_the_commit_and_the_upstream_and_never_overwrites() {
        let Some((_d, root, bare)) = repo_with_origin() else { return };
        let tip = rev(&root, "feature");
        assert_eq!(ref_action(&root, "branch-rename", "feature", Some("feature-login")).unwrap(), "");
        assert!(!has_ref(&root, "refs/heads/feature"));
        assert_eq!(rev(&root, "feature-login"), tip);
        // A taken name, the same name, invalid names: nothing moves.
        let main = rev(&root, "main");
        assert_eq!(ref_action(&root, "branch-rename", "feature-login", Some("main")).unwrap_err(), "A branch named \"main\" already exists.");
        assert!(ref_action(&root, "branch-rename", "feature-login", Some("feature-login")).is_err());
        for bad in ["bad name", "-D", "a..b", "wip.lock", ""] {
            assert!(ref_action(&root, "branch-rename", "feature-login", Some(bad)).unwrap_err().contains("is not a valid name"), "{bad}");
        }
        assert!(ref_action(&root, "branch-rename", "nope", Some("x")).unwrap_err().contains("was not found"));
        assert_eq!((rev(&root, "main"), rev(&root, "feature-login")), (main, tip.clone()));
        // Only the letter case.
        ref_action(&root, "branch-rename", "feature-login", Some("Feature-Login")).unwrap();
        let names: Vec<String> = branches(&root).unwrap().into_iter().filter(|b| !b.remote).map(|b| b.name).collect();
        assert!(names.contains(&"Feature-Login".to_string()) && !names.contains(&"feature-login".to_string()), "{names:?}");
        assert_eq!(rev(&root, "refs/heads/Feature-Login"), tip);

        // The branch I am on, with an uncommitted change and an upstream: both survive, the remote keeps its name.
        write(&root, "a.txt", "changed\n");
        assert_eq!(ref_action(&root, "branch-rename", "main", Some("trunk")).unwrap(), "origin/main");
        let st = status(&root).unwrap().unwrap();
        assert_eq!((st.branch.as_deref(), st.upstream.as_deref(), st.files.len()), (Some("trunk"), Some("origin/main"), 1));
        assert!(has_ref(bare.path(), "refs/heads/main") && !has_ref(bare.path(), "refs/heads/trunk"));
    }

    #[test]
    fn upstream_is_set_changed_and_cleared_without_touching_the_remote() {
        let Some((_d, root, bare)) = repo_with_origin() else { return };
        git_ok(&root, &["push", "-q", "origin", "feature:feature"]);
        assert!(ref_info(&root).unwrap().upstreams.get("feature").is_none());
        ref_action(&root, "upstream-set", "feature", Some("origin/feature")).unwrap();
        let info = ref_info(&root).unwrap();
        assert_eq!(info.upstreams.get("feature").map(String::as_str), Some("origin/feature"));
        assert_eq!(info.upstreams.get("main").map(String::as_str), Some("origin/main"));
        ref_action(&root, "upstream-set", "feature", Some("origin/main")).unwrap();
        assert_eq!(ref_info(&root).unwrap().upstreams.get("feature").map(String::as_str), Some("origin/main"));
        // The status follows for the branch I am on.
        git_ok(&root, &["switch", "-q", "feature"]);
        let st = status(&root).unwrap().unwrap();
        assert_eq!((st.upstream.as_deref(), st.ahead, st.behind), (Some("origin/main"), 2, 0));
        ref_action(&root, "upstream-unset", "feature", None).unwrap();
        assert!(status(&root).unwrap().unwrap().upstream.is_none());
        assert!(has_ref(&root, "refs/remotes/origin/feature") && has_ref(bare.path(), "refs/heads/feature"));
        // A remote branch that is not there (any more), no name, an unknown branch.
        assert!(ref_action(&root, "upstream-set", "feature", Some("origin/gone")).is_err());
        assert!(ref_action(&root, "upstream-set", "feature", None).is_err());
        assert!(ref_action(&root, "upstream-set", "nope", Some("origin/main")).is_err());
        assert!(status(&root).unwrap().unwrap().upstream.is_none());
    }

    #[test]
    fn push_branch_goes_to_its_upstream_or_publishes_and_never_forces() {
        let Some((_d, root, bare)) = repo_with_origin() else { return };
        let backup = tempfile::tempdir().unwrap();
        git_ok(backup.path(), &["init", "-q", "--bare"]);
        add_remote(&root, "backup", &backup.path().to_string_lossy()).unwrap();
        // No upstream: origin (not the first remote by name), under its own name, tracking from then on.
        let r = push_ref(&root, "branch", "feature").unwrap();
        assert_eq!((r.remote.as_str(), r.branch.as_str(), r.tracking.as_deref(), r.up_to_date), ("origin", "feature", Some("origin/feature"), false));
        assert_eq!(rev(bare.path(), "refs/heads/feature"), rev(&root, "feature"));
        assert_eq!(rev(&root, "refs/remotes/origin/feature"), rev(&root, "feature"));
        assert!(!has_ref(backup.path(), "refs/heads/feature"));
        assert_eq!(status(&root).unwrap().unwrap().branch.as_deref(), Some("main"), "pushed without switching");
        // Again: nothing to push.
        let r = push_ref(&root, "branch", "feature").unwrap();
        assert!(r.up_to_date && r.tracking.is_none());

        // An upstream with another name: the commits go there, no branch of the local name appears.
        git_ok(&root, &["push", "-q", "origin", "main:review"]);
        git_ok(&root, &["fetch", "-q", "origin"]);
        git_ok(&root, &["branch", "-q", "topic", "main"]);
        ref_action(&root, "upstream-set", "topic", Some("origin/review")).unwrap();
        git_ok(&root, &["switch", "-q", "topic"]);
        commit_file(&root, "t.txt", "t\n", "t1");
        git_ok(&root, &["switch", "-q", "main"]);
        let r = push_ref(&root, "branch", "topic").unwrap();
        assert_eq!((r.remote.as_str(), r.branch.as_str(), r.tracking), ("origin", "review", None));
        assert_eq!(rev(bare.path(), "refs/heads/review"), rev(&root, "topic"));
        assert!(!has_ref(bare.path(), "refs/heads/topic"));

        // The remote has a commit the branch lacks: refused, nothing forced.
        let other = tempfile::tempdir().unwrap();
        git_ok(other.path(), &["clone", "-q", "-b", "feature", &bare.path().to_string_lossy(), "."]);
        git_ok(other.path(), &["-c", "user.name=o", "-c", "user.email=o@o", "commit", "-q", "--allow-empty", "-m", "theirs"]);
        git_ok(other.path(), &["push", "-q"]);
        git_ok(&root, &["switch", "-q", "feature"]);
        commit_file(&root, "f3.txt", "3\n", "f3");
        git_ok(&root, &["switch", "-q", "main"]);
        let err = push_ref(&root, "branch", "feature").unwrap_err();
        assert!(err.contains("[rejected]"), "{err}");
        assert_eq!(subjects(bare.path(), "refs/heads/feature")[0], "theirs");

        // Unknown branch; no remote at all.
        assert!(push_ref(&root, "branch", "nope").unwrap_err().contains("was not found"));
        assert!(push_ref(&root, "sideways", "main").is_err());
        let Some((_d2, lone)) = repo_with_feature() else { return };
        assert!(push_ref(&lone, "branch", "feature").unwrap_err().contains("no remote"));
        git_ok(&lone, &["tag", "v1"]);
        assert!(push_ref(&lone, "tag", "v1").unwrap_err().contains("no remote"));
    }

    #[test]
    fn push_tag_sends_that_tag_only_and_never_moves_a_tag_on_the_remote() {
        let Some((_d, root, bare)) = repo_with_origin() else { return };
        git_ok(&root, &["tag", "v1.2.0"]);
        git_ok(&root, &["tag", "wip-test"]);
        commit_file(&root, "later.txt", "x\n", "after the tag");
        let main_there = rev(bare.path(), "refs/heads/main");
        let r = push_ref(&root, "tag", "v1.2.0").unwrap();
        assert_eq!((r.remote.as_str(), r.branch.as_str(), r.up_to_date), ("origin", "v1.2.0", false));
        assert_eq!(rev(bare.path(), "refs/tags/v1.2.0"), rev(&root, "refs/tags/v1.2.0"));
        assert!(!has_ref(bare.path(), "refs/tags/wip-test"), "only the tag asked for");
        assert_eq!(rev(bare.path(), "refs/heads/main"), main_there, "no branch moves");
        assert!(push_ref(&root, "tag", "v1.2.0").unwrap().up_to_date);
        // The remote's tag is on another commit: refused, not overwritten.
        let there = rev(bare.path(), "refs/tags/v1.2.0");
        git_ok(&root, &["tag", "-f", "v1.2.0", "HEAD"]);
        let err = push_ref(&root, "tag", "v1.2.0").unwrap_err();
        assert!(err.contains("[rejected]") && err.contains("already exists"), "{err}");
        assert_eq!(rev(bare.path(), "refs/tags/v1.2.0"), there);
        assert!(push_ref(&root, "tag", "nope").unwrap_err().contains("was not found"));
    }

    #[test]
    fn deleting_a_remote_branch_names_its_remote_and_tolerates_one_already_gone() {
        let Some((_d, root, bare)) = repo_with_origin() else { return };
        let backup = tempfile::tempdir().unwrap();
        git_ok(backup.path(), &["init", "-q", "--bare"]);
        add_remote(&root, "backup", &backup.path().to_string_lossy()).unwrap();
        for remote in ["origin", "backup"] {
            git_ok(&root, &["push", "-q", remote, "feature:feature/login", "main:topic"]);
        }
        git_ok(&root, &["fetch", "-q", "--all"]);
        git_ok(&root, &["branch", "-q", "--track", "topic", "origin/topic"]);

        // Commits only on the remote branch are counted; a merged one has none.
        git_ok(&root, &["branch", "-q", "-D", "feature"]);
        assert_eq!(branch_info(&root, "remote", "backup/feature/login").unwrap().unmerged, 2);
        assert_eq!(branch_info(&root, "remote", "origin/topic").unwrap().unmerged, 0);

        // The right remote and the whole branch name.
        let was = short_sha(&root, "refs/remotes/backup/feature/login").unwrap();
        let r = push_ref(&root, "delete", "backup/feature/login").unwrap();
        assert_eq!((r.remote.as_str(), r.branch.as_str(), r.was.as_deref(), r.gone), ("backup", "feature/login", Some(was.as_str()), false));
        assert!(!has_ref(backup.path(), "refs/heads/feature/login") && !has_ref(&root, "refs/remotes/backup/feature/login"));
        assert!(has_ref(bare.path(), "refs/heads/feature/login") && has_ref(&root, "refs/remotes/origin/feature/login"));

        // The local branch that tracked it is kept; its upstream shows as gone.
        git_ok(&root, &["switch", "-q", "topic"]);
        push_ref(&root, "delete", "origin/topic").unwrap();
        let st = status(&root).unwrap().unwrap();
        assert_eq!((st.branch.as_deref(), st.upstream.as_deref(), st.upstream_gone), (Some("topic"), Some("origin/topic"), true));
        assert!(has_ref(&root, "refs/heads/topic"));
        git_ok(&root, &["switch", "-q", "main"]);

        // Already deleted by someone else: the stale label goes, no error.
        git_ok(bare.path(), &["update-ref", "-d", "refs/heads/feature/login"]);
        assert!(has_ref(&root, "refs/remotes/origin/feature/login"));
        let r = push_ref(&root, "delete", "origin/feature/login").unwrap();
        assert!(r.gone);
        assert!(!has_ref(&root, "refs/remotes/origin/feature/login"));

        // A remote's default branch is refused; so is a name this repository does not know.
        git_ok(&root, &["remote", "set-head", "origin", "main"]);
        assert_eq!(ref_info(&root).unwrap().defaults.get("origin").map(String::as_str), Some("main"));
        assert!(branch_info(&root, "remote", "origin/main").unwrap().default_branch);
        assert_eq!(push_ref(&root, "delete", "origin/main").unwrap_err(), "main is origin's default branch.");
        assert!(has_ref(bare.path(), "refs/heads/main"));
        assert!(push_ref(&root, "delete", "origin/never-seen").unwrap_err().contains("was not found"));
        assert!(push_ref(&root, "delete", "main").unwrap_err().contains("was not found"));
        assert!(has_ref(&root, "refs/heads/main"));
    }

    #[test]
    fn tags_are_listed_newest_first_and_deleted_locally_only() {
        let Some((_d, root, bare)) = repo_with_origin() else { return };
        let dated = |date: &str, args: &[&str]| {
            let mut cmd = git(&root, false);
            cmd.env("GIT_COMMITTER_DATE", date).args(args);
            assert!(exec(cmd, None).unwrap().ok);
        };
        dated("2024-01-01T00:00:00Z", &["tag", "-a", "v1.0", "-m", "First release", "feature"]);
        dated("2024-06-01T00:00:00Z", &["tag", "-a", "v2.0", "-m", "Second release", "main"]);
        git_ok(&root, &["tag", "release", "main"]);
        git_ok(&root, &["branch", "release", "feature"]);
        let list = tags(&root).unwrap();
        let names: Vec<&str> = list.iter().map(|t| t.name.as_str()).collect();
        let (a, b) = (names.iter().position(|n| *n == "v2.0").unwrap(), names.iter().position(|n| *n == "v1.0").unwrap());
        assert!(a < b, "{names:?}");
        assert_eq!(list[b].sha, short_sha(&root, "feature").unwrap(), "an annotated tag shows its commit");
        assert_eq!(list[a].summary, "Second release");

        // Deleting a tag: an annotated one like any other, the branch of the same name is safe, the remote keeps its copy.
        push_ref(&root, "tag", "v2.0").unwrap();
        assert_eq!(branch_info(&root, "tag", "v2.0").unwrap().sha, short_sha(&root, "main").unwrap());
        assert_eq!(ref_action(&root, "tag-delete", "v2.0", None).unwrap(), short_sha(&root, "main").unwrap());
        assert!(!has_ref(&root, "refs/tags/v2.0") && has_ref(bare.path(), "refs/tags/v2.0"));
        let branch_tip = rev(&root, "refs/heads/release");
        ref_action(&root, "tag-delete", "release", None).unwrap();
        assert!(!has_ref(&root, "refs/tags/release"));
        assert_eq!(rev(&root, "refs/heads/release"), branch_tip);
        // Already gone.
        assert_eq!(ref_action(&root, "tag-delete", "v2.0", None).unwrap_err(), "The tag \"v2.0\" was not found.");
        assert!(branch_info(&root, "tag", "v2.0").is_err());
        assert_eq!(tags(&root).unwrap().len(), 1);
    }
}
