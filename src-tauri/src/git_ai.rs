//! What the Claude git helpers read from a repository (specs/git-claude.md): the diff about to be
//! committed and the commits and diff of a range, as per-file patches with hard size limits. A
//! child module of git.rs (`git::ai`); nothing here changes the repository.
//!
//! A patch is never held whole: git's output is streamed, the first `PATCH_MAX` characters of each
//! file are kept and the rest is only counted, so a 2 GB generated file costs time, not memory.

use super::{blocking, git, has_head, is_sha, run, run_text};
use serde::Serialize;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::Stdio;

/// Characters of one file's patch that are kept (the UI's per-file limit).
pub const PATCH_MAX: usize = 20_000;
/// Characters of patch text in one reply; files after that are listed with their counts only.
pub const REPLY_MAX: usize = 1_000_000;
/// git's id of the empty tree: what a first commit, or a range from the very start, is compared with.
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const FILE_HEADER: &[u8] = b"diff --git ";

#[derive(Serialize, Debug, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiffFile {
    /// Repo-relative path with `/`.
    pub rel: String,
    pub added: u32,
    pub removed: u32,
    /// git shows no text for it.
    pub binary: bool,
    /// A new file git does not track yet (sent whole, as an added file).
    pub untracked: bool,
    /// The start of the file's patch: at most `PATCH_MAX` characters ("" for a binary file, or once
    /// the reply is full).
    pub patch: String,
    /// Characters of the whole patch.
    pub size: usize,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommitDiff {
    pub files: Vec<DiffFile>,
    /// First lines of the last 10 commit messages, newest first.
    pub subjects: Vec<String>,
}

/// One file's patch while it streams past: the kept start and the size of all of it.
#[derive(Default)]
struct Kept {
    bytes: Vec<u8>,
    chars: usize,
}

impl Kept {
    fn push(&mut self, seg: &[u8]) {
        // Characters, not bytes: UTF-8 continuation bytes do not count.
        self.chars += seg.iter().filter(|&&b| (b & 0xC0) != 0x80).count();
        let room = (PATCH_MAX * 4).saturating_sub(self.bytes.len());
        self.bytes.extend_from_slice(&seg[..seg.len().min(room)]);
    }

    fn finish(self) -> (String, usize) {
        let text = String::from_utf8_lossy(&self.bytes);
        let patch: String = text.chars().take(PATCH_MAX).collect();
        (patch, self.chars)
    }
}

/// Split a `git diff` patch stream into its files (in git's order), keeping only the start of each.
pub fn split_patches(reader: impl Read) -> std::io::Result<Vec<(String, usize)>> {
    let mut r = BufReader::with_capacity(64 * 1024, reader);
    let mut files: Vec<Kept> = Vec::new();
    // The first bytes of the current line, until it is known whether it starts a new file. Lines
    // are not read whole: one line of a minified file can be the entire patch.
    let mut head: Vec<u8> = Vec::new();
    let mut deciding = true;
    loop {
        let buf = r.fill_buf()?;
        if buf.is_empty() {
            break;
        }
        let mut i = 0;
        while i < buf.len() {
            let end = buf[i..].iter().position(|&b| b == b'\n').map(|n| i + n + 1).unwrap_or(buf.len());
            let seg = &buf[i..end];
            let line_ends = seg.last() == Some(&b'\n');
            if deciding {
                head.extend_from_slice(seg);
                if head.len() >= FILE_HEADER.len() || line_ends {
                    if head.starts_with(FILE_HEADER) {
                        files.push(Kept::default());
                    }
                    if let Some(f) = files.last_mut() {
                        f.push(&head);
                    }
                    head.clear();
                    deciding = false;
                }
            } else if let Some(f) = files.last_mut() {
                f.push(seg);
            }
            if line_ends {
                deciding = true;
            }
            i = end;
        }
        let n = buf.len();
        r.consume(n);
    }
    if !head.is_empty() {
        if let Some(f) = files.last_mut() {
            f.push(&head);
        }
    }
    Ok(files.into_iter().map(Kept::finish).collect())
}

/// `--numstat -z` records: (added, removed, binary, path). Renames are off, so one path each.
fn parse_numstat(out: &[u8]) -> Vec<(u32, u32, bool, String)> {
    out.split(|&b| b == 0)
        .filter(|r| !r.is_empty())
        .filter_map(|r| {
            let text = String::from_utf8_lossy(r);
            let mut parts = text.splitn(3, '\t');
            let (a, d, path) = (parts.next()?, parts.next()?, parts.next()?);
            Some((a.parse().unwrap_or(0), d.parse().unwrap_or(0), a == "-", path.to_string()))
        })
        .collect()
}

/// Per-file counts and patches of `git diff <revs>`. Renames show as a removed and an added file,
/// and no external diff or textconv program is run.
fn diff_files(root: &Path, revs: &[&str]) -> Result<Vec<DiffFile>, String> {
    const COMMON: [&str; 4] = ["--no-renames", "--no-ext-diff", "--no-textconv", "--no-color"];
    let mut args = vec!["diff", "--numstat", "-z"];
    args.extend(COMMON);
    args.extend(revs);
    let stats = parse_numstat(&run(root, true, &args, None)?);
    if stats.is_empty() {
        return Ok(vec![]);
    }
    let mut cmd = git(root, true);
    cmd.arg("diff").args(COMMON).args(revs).stderr(Stdio::null());
    let mut child = cmd.spawn().map_err(|e| format!("could not run git: {e}"))?;
    let stdout = child.stdout.take().ok_or("git: no output")?;
    let patches = split_patches(stdout).map_err(|e| format!("git: {e}"));
    let status = child.wait().map_err(|e| format!("git: {e}"))?;
    let patches = patches?;
    if !status.success() {
        return Err("git diff failed".into());
    }
    // Both listings are in the same order; if they ever disagree, the files go by name only.
    let matched = patches.len() == stats.len();
    let mut kept = 0usize;
    let mut patches = patches.into_iter();
    Ok(stats
        .into_iter()
        .map(|(added, removed, binary, rel)| {
            let (patch, size) = if matched { patches.next().unwrap_or_default() } else { (String::new(), 0) };
            let full = kept >= REPLY_MAX || binary;
            if !full {
                kept += patch.chars().count();
            }
            DiffFile { rel, added, removed, binary, untracked: false, patch: if full { String::new() } else { patch }, size: if binary { 0 } else { size } }
        })
        .collect())
}

/// An untracked file as an added file: its text (the start of it) in patch form, its line count.
/// A file with a NUL byte near its start is binary, like git decides it.
fn untracked_file(root: &Path, rel: &str) -> Option<DiffFile> {
    let path = root.join(rel);
    let meta = std::fs::symlink_metadata(&path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let mut file = std::fs::File::open(&path).ok()?;
    let mut start: Vec<u8> = Vec::new();
    let (mut lines, mut chars, mut last) = (0u32, 0usize, b'\n');
    let mut buf = vec![0u8; 64 * 1024];
    let mut first = true;
    loop {
        let n = file.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        let chunk = &buf[..n];
        if first {
            first = false;
            if chunk[..n.min(8000)].contains(&0) {
                return Some(DiffFile { rel: rel.to_string(), binary: true, untracked: true, ..Default::default() });
            }
        }
        lines += chunk.iter().filter(|&&b| b == b'\n').count() as u32;
        chars += chunk.iter().filter(|&&b| (b & 0xC0) != 0x80).count();
        last = chunk[n - 1];
        let room = (PATCH_MAX * 4).saturating_sub(start.len());
        start.extend_from_slice(&chunk[..n.min(room)]);
    }
    if last != b'\n' {
        lines += 1; // a last line without a line break
    }
    let header = format!("diff --git a/{rel} b/{rel}\nnew file mode 100644\n--- /dev/null\n+++ b/{rel}\n@@ -0,0 +1,{lines} @@\n");
    let text = String::from_utf8_lossy(&start);
    let mut patch = header.clone();
    for line in text.split_inclusive('\n') {
        patch.push('+');
        patch.push_str(line);
    }
    let size = header.chars().count() + chars + lines as usize;
    let patch: String = patch.chars().take(PATCH_MAX).collect();
    Some(DiffFile { rel: rel.to_string(), added: lines, removed: 0, binary: false, untracked: true, patch, size })
}

/// What a commit made now would hold. `scope`: "staged" (the index against the last commit),
/// "all" (every change against the last commit plus the untracked files that are not ignored: what
/// Commit All takes when nothing is staged) or "amend" (the index against the commit before the
/// last one: the last commit together with what is staged).
pub fn commit_diff(root: &Path, scope: &str) -> Result<CommitDiff, String> {
    let head = has_head(root);
    let base = if head { "HEAD" } else { EMPTY_TREE };
    let mut files = match scope {
        "staged" => diff_files(root, &["--cached"])?,
        "amend" => {
            let parent = head && run(root, true, &["rev-parse", "--verify", "-q", "HEAD~1^{commit}"], None).is_ok();
            diff_files(root, &["--cached", if parent { "HEAD~1" } else { EMPTY_TREE }])?
        }
        "all" => {
            let mut files = diff_files(root, &[base])?;
            let mut kept: usize = files.iter().map(|f| f.patch.chars().count()).sum();
            let others = run(root, true, &["ls-files", "--others", "--exclude-standard", "-z"], None)?;
            for rel in others.split(|&b| b == 0).filter(|r| !r.is_empty()) {
                let rel = String::from_utf8_lossy(rel).into_owned();
                if let Some(mut f) = untracked_file(root, &rel) {
                    if kept >= REPLY_MAX {
                        f.patch.clear();
                    }
                    kept += f.patch.chars().count();
                    files.push(f);
                }
            }
            files
        }
        other => return Err(format!("unknown scope: {other}")),
    };
    files.sort_by(|a, b| a.rel.cmp(&b.rel));
    let subjects = if head { run_text(root, true, &["log", "-10", "--format=%s"]).unwrap_or_default().lines().map(str::to_string).filter(|l| !l.is_empty()).collect() } else { vec![] };
    Ok(CommitDiff { files, subjects })
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RangeCommit {
    pub sha: String,
    pub short: String,
    pub author: String,
    /// Author time, unix seconds.
    pub time: i64,
    /// Subject and body.
    pub message: String,
    /// "3 files changed, 10 insertions(+), 2 deletions(-)", or "" (a merge).
    pub stat: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RangeLog {
    /// How many commits the range really has (the list is empty when that is over `limit`).
    pub count: u32,
    /// Oldest first.
    pub commits: Vec<RangeCommit>,
}

/// The commit a branch, tag or id names; anything that could be read as an option is refused.
fn resolve_commit(root: &Path, name: &str) -> Result<String, String> {
    let name = name.trim();
    let missing = || format!("\"{name}\" is not a branch or commit in this repository.");
    if name.is_empty() || name.starts_with('-') {
        return Err(missing());
    }
    let sha = run_text(root, true, &["rev-parse", "--verify", "-q", &format!("{name}^{{commit}}")]).map_err(|_| missing())?.trim().to_string();
    if is_sha(&sha) { Ok(sha) } else { Err(missing()) }
}

/// `from..to` as git arguments; an empty `from` means everything up to `to`.
fn range_spec(root: &Path, from: &str, to: &str) -> Result<(Option<String>, String), String> {
    let to = resolve_commit(root, to)?;
    let from = if from.trim().is_empty() { None } else { Some(resolve_commit(root, from)?) };
    Ok((from, to))
}

/// The commits `to` has that `from` does not (`git log from..to`), oldest first, with the true count.
pub fn range_log(root: &Path, from: &str, to: &str, limit: u32) -> Result<RangeLog, String> {
    let (from, to) = range_spec(root, from, to)?;
    let range = match &from {
        Some(f) => format!("{f}..{to}"),
        None => to.clone(),
    };
    let count: u32 = run_text(root, true, &["rev-list", "--count", &range])?.trim().parse().unwrap_or(0);
    if count == 0 || count > limit {
        return Ok(RangeLog { count, commits: vec![] });
    }
    let out = run_text(root, true, &["log", "--reverse", "--shortstat", "--format=%x1e%H%x00%h%x00%an%x00%at%x00%B%x00", &range])?;
    let commits = out
        .split('\u{1e}')
        .filter(|r| !r.trim().is_empty())
        .filter_map(|r| {
            let f: Vec<&str> = r.splitn(6, '\0').collect();
            if f.len() < 6 {
                return None;
            }
            Some(RangeCommit { sha: f[0].to_string(), short: f[1].to_string(), author: f[2].to_string(), time: f[3].parse().unwrap_or(0), message: f[4].trim().to_string(), stat: f[5].trim().to_string() })
        })
        .collect();
    Ok(RangeLog { count, commits })
}

/// What the range changed, per file: `git diff from...to` (from where the two parted), or all of
/// `to` when `from` is empty.
pub fn range_diff(root: &Path, from: &str, to: &str) -> Result<Vec<DiffFile>, String> {
    let (from, to) = range_spec(root, from, to)?;
    match from {
        Some(f) => diff_files(root, &[&format!("{f}...{to}")]),
        None => diff_files(root, &[EMPTY_TREE, &to]),
    }
}

/// The remote's default branch as last fetched (`origin/main`), when the clone recorded one.
pub fn default_branch(root: &Path) -> Option<String> {
    let remotes = run_text(root, true, &["remote"]).ok()?;
    let mut names: Vec<&str> = remotes.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    names.sort_by_key(|n| *n != "origin");
    names.into_iter().find_map(|r| {
        let out = run_text(root, true, &["symbolic-ref", "-q", "--short", &format!("refs/remotes/{r}/HEAD")]).ok()?;
        let name = out.trim().to_string();
        (!name.is_empty()).then_some(name)
    })
}

#[tauri::command]
pub async fn git_commit_diff(root: String, scope: String) -> Result<CommitDiff, String> {
    blocking(move || commit_diff(Path::new(&root), &scope)).await
}

#[tauri::command]
pub async fn git_range_log(root: String, from: String, to: String, limit: u32) -> Result<RangeLog, String> {
    blocking(move || range_log(Path::new(&root), &from, &to, limit)).await
}

#[tauri::command]
pub async fn git_range_diff(root: String, from: String, to: String) -> Result<Vec<DiffFile>, String> {
    blocking(move || range_diff(Path::new(&root), &from, &to)).await
}

#[tauri::command]
pub async fn git_default_branch(root: String) -> Result<Option<String>, String> {
    blocking(move || Ok(default_branch(Path::new(&root)))).await
}
