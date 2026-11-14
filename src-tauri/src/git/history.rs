//! Edit History (specs/git-history-edit.md): Undo Last Commit, reword, drop, squash, and the Edit
//! History list. The UI sends a plan (`HistoryStep`s, oldest first); this module checks it against
//! the repository once more and runs it.
//!
//! A plan is an interactive rebase that never opens an editor: git is given a todo Quarry wrote
//! (`GIT_SEQUENCE_EDITOR` is a `cp` of a temporary file over git's own todo; git runs it through
//! its sh). A new message is applied by an `exec` line of that todo, which pipes the text into
//! `git commit --amend -F -`. The message is therefore carried by the todo inside the rebase's own
//! state: it is still applied when the rebase stopped on a conflict before reaching it and is
//! continued later (even by another program, or after Quarry was restarted), and nothing of
//! Quarry's has to be cleaned up afterwards.

use super::{abort_operation, blocking, combined, commit_refs, exec, git, has_head, has_unmerged, is_sha, operation, pushed_commits, run, run_text, GitCommitRef};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;

/// Start of the error when the branch is not where the UI saw it (a commit was made meanwhile).
pub const MOVED: &str = "quarry-moved";
/// Start of the error when a history edit stopped without a conflict (a commit could not be made,
/// e.g. signing failed) and was aborted: nothing was rewritten.
pub const HALTED: &str = "quarry-halted";
/// Start of the error when Continue stopped again on a new message (Quarry's `exec` line failed).
pub const MESSAGE_FAILED: &str = "quarry-message-failed";

/// Commits listed by `history_range` at most (the Edit History list takes fewer; see `total`).
const LISTED: usize = 1000;

/// A commit of the current branch, as the Edit History list and the confirmations show it.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHistoryCommit {
    pub sha: String,
    pub short: String,
    pub summary: String,
    /// Subject and body.
    pub message: String,
    pub author: String,
    pub email: String,
    /// Author time, unix seconds.
    pub time: i64,
    pub parents: Vec<String>,
    /// Reachable from a remote-tracking branch as last fetched (`pushed_commits`' definition).
    pub pushed: bool,
}

/// The commits from a commit up to the tip of the current branch.
#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitHistoryRange {
    /// The checked-out branch; None on a detached HEAD.
    pub branch: Option<String>,
    /// Full id of HEAD.
    pub tip: String,
    pub operation: Option<String>,
    /// The commit asked about is the tip or one of its ancestors.
    pub on_branch: bool,
    /// Newest first, from the tip down to the commit asked about (at most `LISTED`).
    pub commits: Vec<GitHistoryCommit>,
    /// How many commits the range has (more than `commits` when it was cut short).
    pub total: u32,
    /// The commit below the oldest one: it and everything before it stay as they are. None when
    /// the range goes down to the first commit.
    pub base: Option<GitCommitRef>,
    /// A remote branch that holds the pushed commits (the upstream when it does).
    pub pushed_on: Option<String>,
}

/// One line of a plan, oldest first. `action`: "pick", "fixup" (fold into the nearest earlier step
/// that is not dropped) or "drop". `message` (on a pick): the message that commit ends up with,
/// after everything folded into it; None keeps its own.
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HistoryStep {
    pub sha: String,
    pub action: String,
    pub message: Option<String>,
}

fn branch_of(root: &Path) -> Option<String> {
    run_text(root, true, &["symbolic-ref", "-q", "--short", "HEAD"]).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn head_sha(root: &Path) -> Result<String, String> {
    Ok(run_text(root, true, &["rev-parse", "--verify", "-q", "HEAD^{commit}"])?.trim().to_string())
}

/// Parents of a commit.
fn parents_of(root: &Path, sha: &str) -> Result<Vec<String>, String> {
    Ok(run_text(root, true, &["rev-list", "--parents", "-n", "1", sha])?.split_whitespace().skip(1).map(str::to_string).collect())
}

/// How many parents the HEAD commit has (`GitStatus.head_parents`).
pub(super) fn tip_parents(root: &Path) -> Option<u32> {
    parents_of(root, "HEAD").ok().map(|p| p.len() as u32)
}

/// The commits from `from` (a commit id) up to HEAD, with what the UI needs to decide what may be
/// edited: which are merges (several parents), which are pushed, what lies below. `from` may be
/// "HEAD" for the tip commit alone. Without `from`:
/// the commits of HEAD that no remote-tracking branch has (what "Edit History…" starts from).
/// Read-only.
pub(super) fn history_range(root: &Path, from: Option<&str>) -> Result<GitHistoryRange, String> {
    if !has_head(root) {
        return Err("This repository has no commits yet.".into());
    }
    let mut out = GitHistoryRange { branch: branch_of(root), tip: head_sha(root)?, operation: operation(root), ..Default::default() };
    let mut revs: Vec<String> = Vec::new();
    // "HEAD": the tip commit itself (Undo Last Commit asks about it without knowing its full id).
    let tip = out.tip.clone();
    let from = from.map(|f| if f == "HEAD" { tip.as_str() } else { f });
    match from {
        Some(sha) => {
            if !is_sha(sha) {
                return Err("not a commit id".into());
            }
            out.on_branch = run(root, true, &["merge-base", "--is-ancestor", sha, "HEAD"], None).is_ok();
            if !out.on_branch {
                return Ok(out);
            }
            match parents_of(root, sha)?.first() {
                Some(parent) => {
                    out.base = commit_refs(root, &["--no-walk", parent], 1)?.into_iter().next();
                    revs.push(format!("{sha}^..HEAD"));
                }
                None => revs.push("HEAD".into()),
            }
        }
        None => {
            out.on_branch = true;
            revs.extend(["HEAD".to_string(), "--not".into(), "--remotes".into()]);
        }
    }
    let revs: Vec<&str> = revs.iter().map(String::as_str).collect();
    let mut count = vec!["rev-list", "--count"];
    count.extend_from_slice(&revs);
    out.total = run_text(root, true, &count)?.trim().parse().unwrap_or(0);
    if out.total == 0 {
        return Ok(out);
    }
    // Which of them no remote has: the same definition as `pushed_commits` (which also says where).
    let mut local = vec!["rev-list"];
    local.extend_from_slice(&revs);
    if from.is_some() {
        local.extend_from_slice(&["--not", "--remotes"]);
    }
    let only_local: HashSet<String> = run_text(root, true, &local)?.lines().map(|l| l.trim().to_string()).collect();
    let max = format!("--max-count={LISTED}");
    let mut log = vec!["log", "--topo-order", "--format=%x1e%H%x00%h%x00%P%x00%an%x00%ae%x00%at%x00%B", max.as_str()];
    log.extend_from_slice(&revs);
    let text = run_text(root, true, &log)?;
    for rec in text.split('\x1e').skip(1) {
        let f: Vec<&str> = rec.splitn(7, '\0').collect();
        if f.len() < 7 {
            continue;
        }
        let message = f[6].trim_end().to_string();
        out.commits.push(GitHistoryCommit {
            sha: f[0].trim().to_string(),
            short: f[1].to_string(),
            summary: message.lines().next().unwrap_or("").to_string(),
            message,
            author: f[3].to_string(),
            email: f[4].to_string(),
            time: f[5].parse().unwrap_or(0),
            parents: f[2].split(' ').filter(|p| !p.is_empty()).map(str::to_string).collect(),
            pushed: !only_local.contains(f[0].trim()),
        });
    }
    if from.is_some() && out.commits.iter().any(|c| c.pushed) {
        out.pushed_on = pushed_commits(root, revs[0])?.on;
    }
    Ok(out)
}

/// The checks every history edit passes right before git runs (the UI made them too, on what it
/// saw then): nothing in progress, on a branch, and the branch still where the question said.
fn rewrite_guard(root: &Path, expected_tip: &str) -> Result<(), String> {
    if let Some(op) = operation(root) {
        return Err(format!("A {op} is in progress. Finish or abort it first."));
    }
    if branch_of(root).is_none() {
        return Err("You are not on a branch. Switch to a branch to edit its history.".into());
    }
    if !is_sha(expected_tip) || head_sha(root)? != expected_tip {
        return Err(format!("{MOVED}: the branch has changed since the question was asked. Nothing was rewritten."));
    }
    Ok(())
}

/// A message as one shell word per line, for `printf '%s\n' …` in an `exec` line of the todo
/// (a todo line cannot hold a line break; single quotes keep every other character as it is).
fn shell_words(message: &str) -> String {
    message.replace('\r', "").trim_end().split('\n').map(|l| format!("'{}'", l.replace('\'', "'\\''"))).collect::<Vec<_>>().join(" ")
}

/// A path as one single-quoted shell word.
fn shell_path(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"))
}

/// The todo for `steps` (oldest first): `pick` / `fixup` lines, a dropped commit is left out, and
/// after each group that gets a new message an `exec` that amends it.
pub(super) fn todo_text(steps: &[HistoryStep]) -> Result<String, String> {
    let mut lines: Vec<String> = Vec::new();
    let mut pending: Option<String> = None;
    let mut open = false; // a pick has been written that a fixup can fold into
    let flush = |lines: &mut Vec<String>, pending: &mut Option<String>| {
        if let Some(m) = pending.take() {
            lines.push(format!("exec printf '%s\\n' {} | git commit --amend --no-verify --cleanup=whitespace -q -F -", shell_words(&m)));
        }
    };
    for s in steps {
        if !is_sha(&s.sha) || s.sha.len() < 40 {
            return Err("not a commit id".into());
        }
        match s.action.as_str() {
            "pick" => {
                flush(&mut lines, &mut pending);
                lines.push(format!("pick {}", s.sha));
                open = true;
                if let Some(m) = &s.message {
                    if m.trim().is_empty() {
                        return Err("A commit needs a message.".into());
                    }
                    pending = Some(m.clone());
                }
            }
            "fixup" => {
                if !open {
                    return Err("There is no commit below to fold into.".into());
                }
                lines.push(format!("fixup {}", s.sha));
            }
            "drop" => {}
            other => return Err(format!("unknown step {other}")),
        }
    }
    flush(&mut lines, &mut pending);
    if lines.is_empty() {
        return Err("Every commit would be dropped: that is a reset, not a history edit.".into());
    }
    Ok(lines.join("\n") + "\n")
}

/// Progress of an interactive rebase without its `exec` lines (they are Quarry's way of setting a
/// message, not commits): (the commit being replayed, how many there are). `dir`: `.git/rebase-merge`.
pub(super) fn rebase_step(dir: &Path) -> Option<(u32, u32)> {
    let commands = |name: &str| -> Option<u32> {
        let text = std::fs::read_to_string(dir.join(name)).ok()?;
        Some(text.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#') && !l.starts_with("exec ") && !l.starts_with("x ")).count() as u32)
    };
    let done = commands("done")?;
    let left = commands("git-rebase-todo").unwrap_or(0);
    (done > 0).then_some((done, done + left))
}

/// Run a history edit on the current branch. `action`:
/// - "undo": take the tip commit back and keep its changes staged (`reset --soft HEAD~1`).
/// - "reword": a new `message` for the tip commit (`commit --amend --only`; staged changes stay staged).
/// - "plan": replay the commits after `base` (None: from the first commit) as `steps` say. Tracked
///   files must be clean, the steps must name exactly the commits of that range, and none of them
///   may be a merge.
/// `expected_tip`: the branch's commit when the user was asked; anything else refuses with `MOVED`.
/// A plan that stops on a conflict is an error with git's output (CONFLICT lines); the rebase is
/// then in progress and is finished with `continue_operation` / `abort_operation`.
pub(super) fn history_rewrite(root: &Path, action: &str, expected_tip: &str, base: Option<&str>, steps: &[HistoryStep], message: Option<&str>) -> Result<String, String> {
    rewrite_guard(root, expected_tip)?;
    let tip_parents = parents_of(root, "HEAD")?;
    match action {
        "undo" => {
            match tip_parents.len() {
                0 => return Err("This is the first commit: there is nothing to go back to.".into()),
                1 => {}
                _ => return Err("The last commit is a merge commit: it can't be undone here.".into()),
            }
            run(root, false, &["reset", "--soft", "HEAD~1"], None).map(|_| String::new())
        }
        "reword" => {
            let text = message.map(|m| m.replace('\r', "")).unwrap_or_default();
            if text.trim().is_empty() {
                return Err("A commit needs a message.".into());
            }
            if tip_parents.len() > 1 {
                return Err("A merge commit can't be edited here.".into());
            }
            let mut cmd = git(root, false);
            // `--only` with no paths: the commit keeps its own changes, whatever is staged now.
            cmd.env("GIT_EDITOR", "true").args(["commit", "--amend", "--only", "--no-verify", "--cleanup=whitespace", "-q", "-F", "-"]);
            let out = exec(cmd, Some(text.into_bytes()))?;
            if out.ok { Ok(combined(&out)) } else { Err(combined(&out)) }
        }
        "plan" => run_plan(root, base, steps),
        other => Err(format!("unknown action {other}")),
    }
}

fn run_plan(root: &Path, base: Option<&str>, steps: &[HistoryStep]) -> Result<String, String> {
    let changed = run_text(root, true, &["status", "--porcelain", "--untracked-files=no"])?;
    if !changed.trim().is_empty() {
        return Err("There are uncommitted changes to tracked files. Commit or discard them first: commits are only replayed from a clean state.".into());
    }
    let range = match base {
        Some(b) => {
            if !is_sha(b) || run(root, true, &["merge-base", "--is-ancestor", b, "HEAD"], None).is_err() {
                return Err("That commit is not on the current branch.".into());
            }
            format!("{b}..HEAD")
        }
        None => "HEAD".to_string(),
    };
    // The plan must be about exactly the commits that are there, each once, and no merge among them.
    let mut there: HashSet<String> = HashSet::new();
    for line in run_text(root, true, &["rev-list", "--parents", &range])?.lines() {
        let mut ids = line.split_whitespace();
        let Some(sha) = ids.next() else { continue };
        if ids.count() > 1 {
            return Err(format!("The merge commit {} is among these commits. Quarry does not rewrite across a merge.", &sha[..7.min(sha.len())]));
        }
        there.insert(sha.to_string());
    }
    let named: HashSet<String> = steps.iter().map(|s| s.sha.clone()).collect();
    if named.len() != steps.len() || named != there {
        return Err(format!("{MOVED}: the plan does not match the commits of the branch. Nothing was rewritten."));
    }
    // Dropping the tip commit alone replays nothing: the branch just moves back to its parent
    // (tracked files are clean, so nothing else is lost; untracked files stay).
    if let ([only], Some(b)) = (steps, base) {
        if only.action == "drop" {
            return run(root, false, &["reset", "--hard", b], None).map(|_| String::new());
        }
    }
    let todo = todo_text(steps)?;
    // The todo goes to a file of its own in a temporary folder (closed before git reads it).
    let dir = tempfile::tempdir().map_err(|e| format!("could not write the plan: {e}"))?;
    let file = dir.path().join("quarry-rebase-todo");
    std::fs::write(&file, todo).map_err(|e| format!("could not write the plan: {e}"))?;
    let mut cmd = git(root, false);
    cmd.env("GIT_EDITOR", "true").env("GIT_SEQUENCE_EDITOR", format!("cp {}", shell_path(&file)));
    // Configuration that would change what the plan does is switched off for this run.
    for c in ["rebase.autoStash=false", "rebase.rebaseMerges=false", "rebase.updateRefs=false", "rebase.autoSquash=false", "rebase.missingCommitsCheck=ignore", "rebase.abbreviateCommands=false"] {
        cmd.args(["-c", c]);
    }
    // A failed message step goes back on the todo, so Continue retries it rather than finishing
    // with the old message (the option is kept in the rebase's state for every later Continue).
    cmd.args(["rebase", "-i", "--empty=keep", "--reschedule-failed-exec"]);
    match base {
        Some(b) => cmd.arg(b),
        None => cmd.arg("--root"),
    };
    let out = exec(cmd, None)?;
    if out.ok {
        return Ok(combined(&out));
    }
    let text = combined(&out);
    // Stopped on a conflict: the user resolves it, then Continue / Skip / Abort.
    if operation(root).is_none() || has_unmerged(root) {
        return Err(text);
    }
    // Stopped without a conflict: a commit could not be made (signing, a hook of git's own, …).
    // Nothing to resolve, so put everything back rather than leave a half-done rewrite.
    let reason = failure_reason(&text);
    match abort_operation(root) {
        Ok(_) => Err(format!("{HALTED}: {reason}")),
        Err(e) => Err(format!("{text}\n{e}")),
    }
}

/// The lines of git's output that say why it stopped (its `error:` / `fatal:` lines, else the last
/// line), without the todo line it was running.
pub(super) fn failure_reason(text: &str) -> String {
    let lines: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let said: Vec<&str> = lines.iter().copied().filter(|l| l.starts_with("error:") || l.starts_with("fatal:")).collect();
    let pick = if said.is_empty() { lines.last().copied().into_iter().collect() } else { said };
    pick.join("\n")
}

/// After a Continue that failed with the rebase still stopped and nothing conflicted: was it one
/// of Quarry's message steps (rescheduled to the top of the todo)? `dir`: `.git/rebase-merge`.
pub(super) fn message_step_failed(dir: &Path) -> bool {
    let next = std::fs::read_to_string(dir.join("git-rebase-todo")).unwrap_or_default();
    let first = next.lines().map(str::trim).find(|l| !l.is_empty() && !l.starts_with('#')).unwrap_or("");
    first.starts_with("exec printf ") && first.contains("git commit --amend --no-verify --cleanup=whitespace -q -F -")
}

#[tauri::command]
pub async fn git_history_range(root: String, from: Option<String>) -> Result<GitHistoryRange, String> {
    blocking(move || history_range(Path::new(&root), from.as_deref())).await
}

#[tauri::command]
pub async fn git_history_rewrite(root: String, action: String, expected_tip: String, base: Option<String>, steps: Vec<HistoryStep>, message: Option<String>) -> Result<String, String> {
    blocking(move || history_rewrite(Path::new(&root), &action, &expected_tip, base.as_deref(), &steps, message.as_deref())).await
}

#[cfg(test)]
mod tests {
    use super::super::tests::{git_ok, repo, write};
    use super::super::{abort_operation, add_remote, continue_operation, remote_op, stage, status};
    use super::*;
    use std::path::PathBuf;

    fn rev(root: &Path, what: &str) -> String {
        run_text(root, true, &["rev-parse", what]).unwrap().trim().to_string()
    }

    fn subjects(root: &Path) -> Vec<String> {
        run_text(root, true, &["log", "--format=%s", "HEAD"]).unwrap().lines().map(str::to_string).collect()
    }

    fn message(root: &Path, what: &str) -> String {
        run_text(root, true, &["log", "-1", "--format=%B", what]).unwrap().trim_end().to_string()
    }

    fn author_date(root: &Path, what: &str) -> String {
        run_text(root, true, &["log", "-1", "--format=%an|%ae|%at", what]).unwrap().trim().to_string()
    }

    fn tree(root: &Path, what: &str) -> String {
        rev(root, &format!("{what}^{{tree}}"))
    }

    fn commit_file(root: &Path, rel: &str, text: &str, msg: &str) -> String {
        let p = write(root, rel, text);
        stage(root, &[p]).unwrap();
        git_ok(root, &["commit", "-q", "-m", msg]);
        rev(root, "HEAD")
    }

    /// main: c1 … c5, each adding its own file; an editor that would hang if it were ever started.
    fn five() -> Option<(tempfile::TempDir, PathBuf, Vec<String>)> {
        let (d, root) = repo()?;
        git_ok(&root, &["config", "core.editor", "this-editor-must-never-start --wait"]);
        git_ok(&root, &["config", "sequence.editor", "this-editor-must-never-start --wait"]);
        let ids = (1..=5).map(|i| commit_file(&root, &format!("f{i}.txt"), &format!("{i}\n"), &format!("c{i}"))).collect();
        Some((d, root, ids))
    }

    fn step(sha: &str, action: &str, message: Option<&str>) -> HistoryStep {
        HistoryStep { sha: sha.to_string(), action: action.to_string(), message: message.map(str::to_string) }
    }

    fn plan(root: &Path, base: Option<&str>, steps: &[HistoryStep]) -> Result<String, String> {
        history_rewrite(root, "plan", &rev(root, "HEAD"), base, steps, None)
    }

    #[test]
    fn the_todo_carries_messages_as_exec_lines() {
        let a = "a".repeat(40);
        let b = "b".repeat(40);
        let c = "c".repeat(40);
        let t = todo_text(&[step(&a, "pick", Some("It's new\r\n\r\nBody $HOME \"q\"\n")), step(&b, "fixup", None), step(&c, "drop", None)]).unwrap();
        assert_eq!(t, format!("pick {a}\nfixup {b}\nexec printf '%s\\n' 'It'\\''s new' '' 'Body $HOME \"q\"' | git commit --amend --no-verify --cleanup=whitespace -q -F -\n"));
        // The exec comes after everything folded into the commit, before the next pick.
        let t = todo_text(&[step(&a, "pick", Some("one")), step(&b, "pick", None)]).unwrap();
        assert_eq!(t.lines().collect::<Vec<_>>(), vec![format!("pick {a}"), "exec printf '%s\\n' 'one' | git commit --amend --no-verify --cleanup=whitespace -q -F -".to_string(), format!("pick {b}")]);
        assert!(todo_text(&[step(&a, "fixup", None)]).is_err(), "nothing to fold into");
        assert!(todo_text(&[step(&a, "drop", None), step(&b, "fixup", None)]).is_err());
        assert!(todo_text(&[step(&a, "drop", None)]).is_err(), "dropping everything is a reset");
        assert!(todo_text(&[step(&a, "pick", Some("  \n"))]).is_err(), "an empty message");
        assert!(todo_text(&[step("HEAD", "pick", None)]).is_err());
        assert!(todo_text(&[step(&a, "edit", None)]).is_err());
    }

    #[test]
    fn range_lists_the_commits_up_to_the_tip_with_merges_and_what_lies_below() {
        let Some((_d, root, ids)) = five() else { return };
        let r = history_range(&root, Some(&ids[2])).unwrap();
        assert_eq!((r.branch.as_deref(), r.tip.as_str(), r.on_branch, r.total, r.operation.is_none()), (Some("main"), ids[4].as_str(), true, 3, true));
        assert_eq!(r.commits.iter().map(|c| c.summary.as_str()).collect::<Vec<_>>(), vec!["c5", "c4", "c3"]);
        assert_eq!(r.base.as_ref().map(|b| (b.sha.as_str(), b.summary.as_str())), Some((ids[1].as_str(), "c2")));
        assert!(r.commits.iter().all(|c| !c.pushed && c.parents.len() == 1 && c.author == "Test User"));
        assert_eq!(r.pushed_on, None);
        // From the first commit: the whole history, nothing below.
        let r = history_range(&root, Some(&ids[0])).unwrap();
        assert_eq!((r.total, r.base.is_none(), r.commits.last().unwrap().parents.len()), (5, true, 0));
        // A whole message, not just its subject.
        git_ok(&root, &["commit", "-q", "--allow-empty", "-m", "Subject", "-m", "Body line"]);
        let r = history_range(&root, Some(&rev(&root, "HEAD"))).unwrap();
        assert_eq!((r.commits[0].summary.as_str(), r.commits[0].message.as_str()), ("Subject", "Subject\n\nBody line"));
        // A commit of another branch is not on this one; a merge shows its two parents.
        git_ok(&root, &["switch", "-qc", "side", &ids[1]]);
        let other = commit_file(&root, "side.txt", "s\n", "side work");
        git_ok(&root, &["switch", "-q", "main"]);
        assert!(!history_range(&root, Some(&other)).unwrap().on_branch);
        git_ok(&root, &["merge", "-q", "--no-ff", "--no-edit", "side"]);
        let r = history_range(&root, Some(&ids[2])).unwrap();
        assert_eq!(r.commits[0].parents.len(), 2);
        assert!(r.commits.iter().any(|c| c.summary == "side work"), "the merged-in commits are in the range too");
        // Detached: no branch.
        git_ok(&root, &["checkout", "-q", "--detach"]);
        assert_eq!(history_range(&root, Some(&ids[2])).unwrap().branch, None);
        let at_tip = history_range(&root, Some("HEAD")).unwrap();
        assert_eq!(at_tip.commits[0].sha, at_tip.tip, "HEAD stands for the tip commit");
        assert!(history_range(&root, Some("main")).is_err());
    }

    #[test]
    fn pushed_commits_are_marked_also_without_an_upstream() {
        let Some((_d, root, ids)) = five() else { return };
        let bare = tempfile::tempdir().unwrap();
        git_ok(bare.path(), &["init", "-q", "--bare", "-b", "main"]);
        add_remote(&root, "origin", &bare.path().to_string_lossy()).unwrap();
        // No remote branch yet: nothing is pushed.
        assert!(history_range(&root, Some(&ids[0])).unwrap().commits.iter().all(|c| !c.pushed));
        // c3 goes to origin/release; main itself has no upstream.
        git_ok(&root, &["push", "-q", "origin", &format!("{}:refs/heads/release", ids[2])]);
        let r = history_range(&root, Some(&ids[1])).unwrap();
        assert_eq!(r.commits.iter().map(|c| (c.summary.as_str(), c.pushed)).collect::<Vec<_>>(), vec![("c5", false), ("c4", false), ("c3", true), ("c2", true)]);
        assert_eq!(r.pushed_on.as_deref(), Some("origin/release"));
        // Without a commit: the ones no remote has (what Edit History… opens with).
        let r = history_range(&root, None).unwrap();
        assert_eq!((r.total, r.commits.iter().map(|c| c.summary.as_str()).collect::<Vec<_>>()), (2, vec!["c5", "c4"]));
        // Everything pushed: nothing to offer.
        remote_op(&root, "push").unwrap();
        let r = history_range(&root, None).unwrap();
        assert_eq!((r.total, r.commits.len()), (0, 0));
        assert_eq!(history_range(&root, Some(&ids[4])).unwrap().pushed_on.as_deref(), Some("origin/main"));
    }

    #[test]
    fn undo_takes_the_tip_back_and_keeps_everything_staged() {
        let Some((_d, root, ids)) = five() else { return };
        // Uncommitted work of both kinds stays as it is.
        let staged = write(&root, "staged.txt", "s\n");
        stage(&root, &[staged]).unwrap();
        write(&root, "f1.txt", "1 edited\n");
        write(&root, "untracked.txt", "u\n");
        history_rewrite(&root, "undo", &ids[4], None, &[], None).unwrap();
        assert_eq!(rev(&root, "HEAD"), ids[3]);
        let st = status(&root).unwrap().unwrap();
        let of = |rel: &str| st.files.iter().find(|f| f.path.ends_with(rel)).map(|f| (f.index.clone(), f.worktree.clone()));
        assert_eq!(of("f5.txt"), Some(("A".into(), ".".into())), "the undone commit's file is staged");
        assert_eq!(of("staged.txt"), Some(("A".into(), ".".into())));
        assert_eq!(of("f1.txt"), Some((".".into(), "M".into())));
        assert_eq!(std::fs::read_to_string(root.join("f5.txt")).unwrap(), "5\n");
        assert!(root.join("untracked.txt").exists());
        // The branch moved since the question: refused.
        assert!(history_rewrite(&root, "undo", &ids[4], None, &[], None).unwrap_err().starts_with(MOVED));
        assert_eq!(rev(&root, "HEAD"), ids[3]);
    }

    #[test]
    fn undo_refuses_the_first_commit_a_merge_a_detached_head_and_an_operation() {
        let Some((_d, root)) = repo() else { return };
        let first = commit_file(&root, "a.txt", "a\n", "first");
        assert!(history_rewrite(&root, "undo", &first, None, &[], None).unwrap_err().contains("first commit"));
        git_ok(&root, &["switch", "-qc", "side"]);
        commit_file(&root, "s.txt", "s\n", "side");
        git_ok(&root, &["switch", "-q", "main"]);
        commit_file(&root, "m.txt", "m\n", "main work");
        git_ok(&root, &["merge", "-q", "--no-ff", "--no-edit", "side"]);
        let merge = rev(&root, "HEAD");
        assert!(history_rewrite(&root, "undo", &merge, None, &[], None).unwrap_err().contains("merge commit"));
        assert!(history_rewrite(&root, "reword", &merge, None, &[], Some("x")).unwrap_err().contains("merge commit"));
        assert_eq!(rev(&root, "HEAD"), merge);
        git_ok(&root, &["checkout", "-q", "--detach"]);
        assert!(history_rewrite(&root, "undo", &merge, None, &[], None).unwrap_err().contains("not on a branch"));
        // An operation in progress.
        git_ok(&root, &["switch", "-q", "main"]);
        git_ok(&root, &["switch", "-qc", "other", "HEAD~1"]);
        commit_file(&root, "m.txt", "other\n", "other m");
        git_ok(&root, &["switch", "-q", "main"]);
        let tip = commit_file(&root, "m.txt", "mine\n", "my m");
        assert!(run(&root, false, &["cherry-pick", "other"], None).is_err());
        assert!(history_rewrite(&root, "undo", &tip, None, &[], None).unwrap_err().contains("cherry-pick is in progress"));
        assert!(plan(&root, Some(&merge), &[step(&tip, "drop", None)]).unwrap_err().contains("cherry-pick is in progress"));
    }

    #[test]
    fn reword_the_tip_changes_only_its_message() {
        let Some((_d, root, ids)) = five() else { return };
        let staged = write(&root, "staged.txt", "s\n");
        stage(&root, &[staged]).unwrap();
        write(&root, "f1.txt", "1 edited\n");
        let (before_tree, before_author) = (tree(&root, "HEAD"), author_date(&root, "HEAD"));
        history_rewrite(&root, "reword", &ids[4], None, &[], Some("Fifth, said better\r\n\r\n# not a comment\nBody")).unwrap();
        assert_eq!(message(&root, "HEAD"), "Fifth, said better\n\n# not a comment\nBody");
        assert_ne!(rev(&root, "HEAD"), ids[4]);
        assert_eq!((rev(&root, "HEAD~1"), tree(&root, "HEAD"), author_date(&root, "HEAD")), (ids[3].clone(), before_tree, before_author));
        // What was staged is still staged and not in the commit.
        let st = status(&root).unwrap().unwrap();
        assert_eq!(st.files.len(), 2);
        assert!(st.files.iter().any(|f| f.path.ends_with("staged.txt") && f.index == "A"));
        assert!(history_rewrite(&root, "reword", &rev(&root, "HEAD"), None, &[], Some("  ")).is_err());
        assert!(history_rewrite(&root, "nonsense", &rev(&root, "HEAD"), None, &[], None).is_err());
    }

    #[test]
    fn reword_an_older_commit_keeps_changes_authors_dates_and_everything_below() {
        let Some((_d, root, ids)) = five() else { return };
        write(&root, "untracked.txt", "u\n");
        let before: Vec<(String, String)> = (0..3).map(|i| (tree(&root, &format!("HEAD~{i}")), author_date(&root, &format!("HEAD~{i}")))).collect();
        // Reword c3: the plan starts there, c1 and c2 are below it.
        plan(&root, Some(&ids[1]), &[step(&ids[2], "pick", Some("Third: it's \"quoted\" & $HOME `x`\n\nBody ünï")), step(&ids[3], "pick", None), step(&ids[4], "pick", None)]).unwrap();
        assert_eq!(subjects(&root), vec!["c5", "c4", "Third: it's \"quoted\" & $HOME `x`", "c2", "c1"]);
        assert_eq!(message(&root, "HEAD~2"), "Third: it's \"quoted\" & $HOME `x`\n\nBody ünï");
        assert_eq!(rev(&root, "HEAD~3"), ids[1], "commits below the change keep their ids");
        let after: Vec<(String, String)> = (0..3).map(|i| (tree(&root, &format!("HEAD~{i}")), author_date(&root, &format!("HEAD~{i}")))).collect();
        assert_eq!(before, after);
        assert!(operation(&root).is_none());
        assert!(root.join("untracked.txt").exists());
        // Rows the plan leaves alone at its bottom keep their ids too (git fast-forwards over them).
        let now: Vec<String> = (0..5).map(|i| rev(&root, &format!("HEAD~{i}"))).collect();
        plan(&root, Some(&now[4]), &[step(&now[3], "pick", None), step(&now[2], "pick", None), step(&now[1], "pick", None), step(&now[0], "pick", Some("c5 reworded"))]).unwrap();
        assert_eq!((rev(&root, "HEAD~1"), message(&root, "HEAD")), (now[1].clone(), "c5 reworded".to_string()));
    }

    #[test]
    fn reword_the_first_commit_rewrites_the_whole_branch() {
        let Some((_d, root, ids)) = five() else { return };
        let steps: Vec<HistoryStep> = ids.iter().enumerate().map(|(i, s)| step(s, "pick", (i == 0).then_some("The beginning"))).collect();
        plan(&root, None, &steps).unwrap();
        assert_eq!(subjects(&root), vec!["c5", "c4", "c3", "c2", "The beginning"]);
        assert_eq!(tree(&root, "HEAD"), tree(&root, &ids[4]));
        assert!((0..5).all(|i| rev(&root, &format!("HEAD~{i}")) != ids[4 - i]));
        assert_eq!(run_text(&root, true, &["rev-list", "--count", "HEAD"]).unwrap().trim(), "5");
    }

    #[test]
    fn drop_squash_fixup_and_reorder_in_one_plan() {
        let Some((_d, root, ids)) = five() else { return };
        // Drop c2; c4 moves below c3 and takes c3 as a fixup; c5 is squashed into that with a typed message.
        let steps = [step(&ids[1], "drop", None), step(&ids[3], "pick", Some("c4 with c3 and c5\n\nJoined.")), step(&ids[2], "fixup", None), step(&ids[4], "fixup", None)];
        plan(&root, Some(&ids[0]), &steps).unwrap();
        assert_eq!(subjects(&root), vec!["c4 with c3 and c5", "c1"]);
        assert_eq!(message(&root, "HEAD"), "c4 with c3 and c5\n\nJoined.");
        assert_eq!(author_date(&root, "HEAD"), author_date(&root, &ids[3]), "the commit folded into keeps its author and date");
        assert!(!root.join("f2.txt").exists(), "the dropped commit's change is gone");
        for f in ["f1.txt", "f3.txt", "f4.txt", "f5.txt"] {
            assert!(root.join(f).exists());
        }
        assert_eq!(rev(&root, "HEAD~1"), ids[0]);
        assert!(operation(&root).is_none());
    }

    #[test]
    fn dropping_the_tip_moves_the_branch_back_and_keeps_untracked_files() {
        let Some((_d, root, ids)) = five() else { return };
        write(&root, "untracked.txt", "u
");
        plan(&root, Some(&ids[3]), &[step(&ids[4], "drop", None)]).unwrap();
        assert_eq!(rev(&root, "HEAD"), ids[3]);
        assert_eq!(run_text(&root, true, &["symbolic-ref", "--short", "HEAD"]).unwrap().trim(), "main");
        assert!(!root.join("f5.txt").exists() && root.join("untracked.txt").exists());
        assert!(status(&root).unwrap().unwrap().files.iter().all(|f| f.untracked));
    }

    #[test]
    fn reorder_alone_and_fixup_without_a_message() {
        let Some((_d, root, ids)) = five() else { return };
        plan(&root, Some(&ids[2]), &[step(&ids[4], "pick", None), step(&ids[3], "pick", None)]).unwrap();
        assert_eq!(subjects(&root), vec!["c4", "c5", "c3", "c2", "c1"]);
        assert_eq!(tree(&root, "HEAD"), tree(&root, &ids[4]));
        let (four, five) = (rev(&root, "HEAD"), rev(&root, "HEAD~1"));
        plan(&root, Some(&ids[2]), &[step(&five, "pick", None), step(&four, "fixup", None)]).unwrap();
        assert_eq!(subjects(&root), vec!["c5", "c3", "c2", "c1"]);
        assert_eq!(message(&root, "HEAD"), "c5");
        assert!(root.join("f4.txt").exists());
    }

    #[test]
    fn a_plan_must_match_the_branch_exactly() {
        let Some((_d, root, ids)) = five() else { return };
        let tip = ids[4].clone();
        // A commit of the range is missing, one is named twice, one is not in it.
        assert!(plan(&root, Some(&ids[2]), &[step(&ids[4], "pick", None)]).unwrap_err().starts_with(MOVED));
        assert!(plan(&root, Some(&ids[2]), &[step(&ids[3], "pick", None), step(&ids[3], "pick", None)]).unwrap_err().starts_with(MOVED));
        assert!(plan(&root, Some(&ids[2]), &[step(&ids[3], "pick", None), step(&ids[4], "pick", None), step(&ids[1], "pick", None)]).unwrap_err().starts_with(MOVED));
        // The tip the question was about is no longer the tip.
        assert!(history_rewrite(&root, "plan", &ids[3], Some(&ids[2]), &[step(&ids[3], "pick", None), step(&ids[4], "drop", None)], None).unwrap_err().starts_with(MOVED));
        // Dropping everything, a base that is not a commit of the branch.
        assert!(plan(&root, Some(&ids[2]), &[step(&ids[3], "drop", None), step(&ids[4], "drop", None)]).unwrap_err().contains("Every commit would be dropped"));
        assert!(plan(&root, None, &ids.iter().map(|s| step(s, "drop", None)).collect::<Vec<_>>()).is_err());
        git_ok(&root, &["switch", "-qc", "side", &ids[1]]);
        let other = commit_file(&root, "side.txt", "s\n", "side");
        git_ok(&root, &["switch", "-q", "main"]);
        assert!(plan(&root, Some(&other), &[step(&ids[4], "pick", None)]).unwrap_err().contains("not on the current branch"));
        // Uncommitted changes to tracked files (untracked ones do not count).
        write(&root, "f1.txt", "edited\n");
        assert!(plan(&root, Some(&ids[3]), &[step(&ids[4], "pick", Some("x"))]).unwrap_err().contains("uncommitted changes"));
        assert_eq!((rev(&root, "HEAD"), std::fs::read_to_string(root.join("f1.txt")).unwrap()), (tip, "edited\n".to_string()));
        assert!(operation(&root).is_none());
    }

    #[test]
    fn a_merge_in_the_range_is_refused() {
        let Some((_d, root, ids)) = five() else { return };
        git_ok(&root, &["switch", "-qc", "side", &ids[2]]);
        let side = commit_file(&root, "side.txt", "s\n", "side");
        git_ok(&root, &["switch", "-q", "main"]);
        git_ok(&root, &["merge", "-q", "--no-ff", "--no-edit", "side"]);
        let merge = rev(&root, "HEAD");
        let after = commit_file(&root, "f6.txt", "6\n", "c6");
        let steps = [step(&ids[3], "pick", Some("x")), step(&ids[4], "pick", None), step(&side, "pick", None), step(&merge, "pick", None), step(&after, "pick", None)];
        let err = plan(&root, Some(&ids[2]), &steps).unwrap_err();
        assert!(err.contains(&format!("The merge commit {}", &merge[..7])) && err.contains("does not rewrite across a merge"), "{err}");
        assert_eq!(rev(&root, "HEAD"), after);
        // Above the merge it works.
        plan(&root, Some(&merge), &[step(&after, "pick", Some("sixth"))]).unwrap();
        assert_eq!((message(&root, "HEAD"), rev(&root, "HEAD~1")), ("sixth".to_string(), merge));
    }

    /// main: base, then A and C change the same line of one file, B in between adds a file, D adds another.
    fn conflicting() -> Option<(tempfile::TempDir, PathBuf, Vec<String>)> {
        let (d, root) = repo()?;
        git_ok(&root, &["config", "core.editor", "this-editor-must-never-start --wait"]);
        let base = commit_file(&root, "x.txt", "base\n", "base");
        let a = commit_file(&root, "x.txt", "from A\n", "A");
        let b = commit_file(&root, "b.txt", "b\n", "B");
        let c = commit_file(&root, "x.txt", "from C\n", "C");
        let e = commit_file(&root, "d.txt", "d\n", "D");
        Some((d, root, vec![base, a, b, c, e]))
    }

    #[test]
    fn a_conflict_stops_and_continue_still_applies_the_messages_typed_before() {
        let Some((_d, root, ids)) = conflicting() else { return };
        // Drop A (C then conflicts), reword B before the stop, C at the stop, and fold D into C with a message.
        let steps = [step(&ids[1], "drop", None), step(&ids[2], "pick", Some("B, reworded")), step(&ids[3], "pick", Some("C and D together\n\nTyped before the run.")), step(&ids[4], "fixup", None)];
        let err = plan(&root, Some(&ids[0]), &steps).unwrap_err();
        assert!(err.contains("CONFLICT"), "{err}");
        let st = status(&root).unwrap().unwrap();
        assert_eq!(st.operation.as_deref(), Some("rebase"));
        assert_eq!(st.operation_step, Some((2, 3)), "exec lines are not counted as commits");
        assert!(st.files.iter().any(|f| f.conflicted && f.path.ends_with("x.txt")));
        assert_eq!(message(&root, "HEAD"), "B, reworded", "the message before the stop is already applied");
        // No new edit while it is stopped.
        assert!(history_rewrite(&root, "undo", &rev(&root, "HEAD"), None, &[], None).unwrap_err().contains("rebase is in progress"));
        // Resolve and continue (with the same GIT_EDITOR=true every Continue uses).
        let x = write(&root, "x.txt", "resolved\n");
        stage(&root, &[x]).unwrap();
        assert_eq!(continue_operation(&root, "continue").unwrap(), "rebase");
        assert!(operation(&root).is_none());
        assert_eq!(subjects(&root), vec!["C and D together", "B, reworded", "base"]);
        assert_eq!(message(&root, "HEAD"), "C and D together\n\nTyped before the run.");
        assert_eq!(std::fs::read_to_string(root.join("x.txt")).unwrap(), "resolved\n");
        assert!(root.join("d.txt").exists() && root.join("b.txt").exists());
        assert_eq!(rev(&root, "HEAD~2"), ids[0]);
    }

    #[test]
    fn abort_after_a_stop_puts_every_commit_back() {
        let Some((_d, root, ids)) = conflicting() else { return };
        let steps = [step(&ids[1], "drop", None), step(&ids[2], "pick", Some("B, reworded")), step(&ids[3], "pick", None), step(&ids[4], "pick", None)];
        assert!(plan(&root, Some(&ids[0]), &steps).is_err());
        assert_eq!(status(&root).unwrap().unwrap().operation_step, Some((2, 3)));
        assert_eq!(abort_operation(&root).unwrap(), "rebase");
        assert_eq!(rev(&root, "HEAD"), ids[4]);
        assert_eq!(subjects(&root), vec!["D", "C", "B", "A", "base"]);
        assert_eq!(run_text(&root, true, &["symbolic-ref", "--short", "HEAD"]).unwrap().trim(), "main");
        let st = status(&root).unwrap().unwrap();
        assert!(st.operation.is_none() && st.files.is_empty());
        assert_eq!(std::fs::read_to_string(root.join("x.txt")).unwrap(), "from C\n");
    }

    #[test]
    fn skip_leaves_the_stopped_commit_out_and_carries_on() {
        let Some((_d, root, ids)) = conflicting() else { return };
        let steps = [step(&ids[1], "drop", None), step(&ids[2], "pick", None), step(&ids[3], "pick", None), step(&ids[4], "pick", Some("D, reworded"))];
        assert!(plan(&root, Some(&ids[0]), &steps).is_err());
        assert_eq!(continue_operation(&root, "skip").unwrap(), "rebase");
        assert!(operation(&root).is_none());
        assert_eq!(subjects(&root), vec!["D, reworded", "B", "base"]);
        assert_eq!(std::fs::read_to_string(root.join("x.txt")).unwrap(), "base\n");
    }

    #[test]
    fn other_branches_and_tags_stay_on_the_old_commits() {
        let Some((_d, root, ids)) = five() else { return };
        git_ok(&root, &["branch", "keep", &ids[3]]);
        git_ok(&root, &["tag", "v1", &ids[4]]);
        git_ok(&root, &["config", "rebase.updateRefs", "true"]);
        git_ok(&root, &["config", "rebase.autoSquash", "true"]);
        git_ok(&root, &["config", "rebase.missingCommitsCheck", "error"]);
        plan(&root, Some(&ids[1]), &[step(&ids[2], "drop", None), step(&ids[3], "pick", None), step(&ids[4], "pick", None)]).unwrap();
        assert_eq!(subjects(&root), vec!["c5", "c4", "c2", "c1"]);
        assert_eq!((rev(&root, "keep"), rev(&root, "v1")), (ids[3].clone(), ids[4].clone()));
    }

    /// Signing switched on with a signing program that does not exist: every new commit fails.
    fn signing_fails(root: &Path) {
        git_ok(root, &["config", "commit.gpgsign", "true"]);
        git_ok(root, &["config", "gpg.program", "quarry-no-such-signing-program"]);
    }

    #[test]
    fn a_stop_without_a_conflict_is_aborted_and_says_why() {
        let Some((_d, root, ids)) = five() else { return };
        signing_fails(&root);
        let tip = rev(&root, "HEAD");
        // Reword an older commit: the message step cannot make its commit.
        let err = plan(&root, Some(&ids[1]), &[step(&ids[2], "pick", Some("new words")), step(&ids[3], "pick", None), step(&ids[4], "pick", None)]).unwrap_err();
        assert!(err.starts_with(HALTED), "{err}");
        assert!(operation(&root).is_none(), "no rebase is left in progress");
        assert_eq!((rev(&root, "HEAD"), subjects(&root)[2].as_str()), (tip.clone(), "c3"));
        assert_eq!(run_text(&root, true, &["symbolic-ref", "--short", "HEAD"]).unwrap().trim(), "main");
        // Squash: the fold itself cannot be committed.
        let err = plan(&root, Some(&ids[2]), &[step(&ids[3], "pick", Some("c4 and c5")), step(&ids[4], "fixup", None)]).unwrap_err();
        assert!(err.starts_with(HALTED), "{err}");
        assert!(operation(&root).is_none() && status(&root).unwrap().unwrap().files.is_empty());
        assert_eq!(rev(&root, "HEAD"), tip);
        // The tip's reword fails cleanly too, and nothing changes.
        assert!(history_rewrite(&root, "reword", &tip, None, &[], Some("tip words")).is_err());
        assert_eq!((rev(&root, "HEAD"), message(&root, "HEAD")), (tip, "c5".to_string()));
    }

    #[test]
    fn the_reason_and_the_failed_message_step_are_recognised() {
        assert_eq!(failure_reason("Executing: x\nerror: gpg failed to sign the data\nfatal: failed to write commit object\nhint: …"), "error: gpg failed to sign the data\nfatal: failed to write commit object");
        assert_eq!(failure_reason("one\n\nlast words\n"), "last words");
        let d = tempfile::tempdir().unwrap();
        let todo = todo_text(&[step(&"a".repeat(40), "pick", Some("m"))]).unwrap();
        let exec_line = todo.lines().nth(1).unwrap().to_string();
        std::fs::write(d.path().join("git-rebase-todo"), format!("# rescheduled\n{exec_line}\npick {}\n", "b".repeat(40))).unwrap();
        assert!(message_step_failed(d.path()));
        std::fs::write(d.path().join("git-rebase-todo"), format!("pick {}\n{exec_line}\n", "b".repeat(40))).unwrap();
        assert!(!message_step_failed(d.path()));
        std::fs::write(d.path().join("git-rebase-todo"), "exec make test\n").unwrap();
        assert!(!message_step_failed(d.path()));
    }
}
