//! Stash: list, push, files, apply / pop / drop, and the graph's stash rows. Spec: specs/git-stash.md.

use super::{abs_path, blocking, combined, exec, has_head, has_unmerged, is_sha, parse_commit_files, run, run_text, GitCommitFile, GitGraphCommit};
use serde::Serialize;
use std::path::Path;
use std::process::{Command, Stdio};

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
pub(super) fn stash_ids(root: &Path) -> Vec<String> {
    match run_text(root, true, &["stash", "list", "--format=%H"]) {
        Ok(t) => t.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect(),
        Err(_) => Vec::new(),
    }
}

/// Every stash, newest first.
pub(super) fn stash_list(root: &Path) -> Result<Vec<GitStash>, String> {
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
pub(super) fn fold_stashes(commits: Vec<GitGraphCommit>, stashes: &[GitStash]) -> Vec<GitGraphCommit> {
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

// ---------- commands ----------

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

#[cfg(test)]
mod tests {
    use super::super::test_util::*;
    use super::super::*;
    use super::*;

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
}
