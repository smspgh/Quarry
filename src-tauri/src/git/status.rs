//! Status, file contents at a revision, and the index / work tree actions (stage, unstage, discard, commit, take a side of a conflict). Spec: specs/git.md.

use super::{abs_path, blocking, exec, find_root, git, has_head, history, nul_list, rel_path, rels, remote_list, run, run_text, stash_ids, GitRemote};
use crate::files;
use serde::Serialize;
use std::path::{Path, PathBuf};

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
    /// Edit History: how many parents the HEAD commit has (0 = the first commit, 2+ = a merge), so
    /// Undo Last Commit can be greyed out without asking git again. None before the first commit.
    pub head_parents: Option<u32>,
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

// ---------- status ----------

pub(super) fn operation(root: &Path) -> Option<String> {
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
pub(super) fn operation_message(root: &Path) -> Option<String> {
    let dir = run_text(root, true, &["rev-parse", "--absolute-git-dir"]).ok()?;
    let text = std::fs::read_to_string(PathBuf::from(dir.trim().replace('/', "\\")).join("MERGE_MSG")).ok()?;
    let msg = text.lines().filter(|l| !l.starts_with('#')).collect::<Vec<_>>().join("\n");
    let msg = msg.trim();
    (!msg.is_empty()).then(|| msg.to_string())
}

/// Where a rebase is: (current, total), from the files git keeps while it runs.
pub(super) fn operation_step(root: &Path) -> Option<(u32, u32)> {
    let dir = run_text(root, true, &["rev-parse", "--absolute-git-dir"]).ok()?;
    let dir = PathBuf::from(dir.trim().replace('/', "\\"));
    let num = |p: PathBuf| std::fs::read_to_string(p).ok()?.trim().parse::<u32>().ok();
    let merge = dir.join("rebase-merge");
    let apply = dir.join("rebase-apply");
    // Edit History: the `exec` lines that set a message are not commits (git/history.rs).
    if let Some(step) = history::rebase_step(&merge) {
        return Some(step);
    }
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
        head_parents: None,
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

pub(super) fn status(path: &Path) -> Result<Option<GitStatus>, String> {
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
    // Edit History: is the tip the first commit or a merge?
    if st.head.is_some() {
        st.head_parents = history::tip_parents(&root);
    }
    Ok(Some(st))
}

// ---------- file contents ----------

pub(super) fn decode_blob(bytes: &[u8]) -> GitBlob {
    let (enc, bom) = files::detect_encoding(bytes, None);
    let (text, _) = enc.decode_without_bom_handling(&bytes[bom..]);
    GitBlob { text: text.into_owned(), binary: files::looks_binary(bytes), encoding: enc.name().to_string() }
}

/// `rev`: "HEAD", a sha or branch, or "" / ":" for the index. The blob goes through the same
/// filters as a checkout (`cat-file --filters`: line endings, smudge), so it compares with the
/// file on disk.
pub(super) fn show(path: &str, rev: &str, rel: Option<String>) -> Result<Option<GitBlob>, String> {
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

pub(super) fn stage(root: &Path, paths: &[String]) -> Result<(), String> {
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
pub(super) fn resolve_side(root: &Path, path: &str, side: &str) -> Result<String, String> {
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

pub(super) fn unstage(root: &Path, paths: &[String]) -> Result<(), String> {
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
pub(super) fn ls_files(root: &Path, flags: &[&str], rels: &[String]) -> Result<Vec<String>, String> {
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

pub(super) fn commit(root: &Path, message: &str, amend: bool) -> Result<GitCommitResult, String> {
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

// ---------- commands ----------

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
pub async fn git_resolve_side(root: String, path: String, side: String) -> Result<String, String> {
    blocking(move || resolve_side(Path::new(&root), &path, &side)).await
}

#[cfg(test)]
mod tests {
    use super::super::test_util::*;
    use super::super::*;
    use super::*;

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
}
