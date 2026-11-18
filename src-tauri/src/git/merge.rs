//! Start a merge or rebase, force push, and the shared "already pushed" helper. Spec: specs/git-merge-rebase.md.

use super::{blocking, combined, exec, git, has_head, is_sha, operation, ref_exists, run, run_text};
use serde::Serialize;
use std::path::Path;

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

pub(super) fn count_revs(root: &Path, args: &[&str]) -> Result<u32, String> {
    let mut a = vec!["rev-list", "--count"];
    a.extend_from_slice(args);
    Ok(run_text(root, true, &a)?.trim().parse().unwrap_or(0))
}

/// Up to `max` commits of `revs` (rev-list arguments), newest first.
pub(super) fn commit_refs(root: &Path, revs: &[&str], max: usize) -> Result<Vec<GitCommitRef>, String> {
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
pub(super) fn pushed_commits(root: &Path, range: &str) -> Result<GitPushed, String> {
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
/// `allow_dirty`: the setting "Allow merging with uncommitted changes" (merge only): git itself
/// then refuses a merge that would touch a changed file.
fn start_guard(root: &Path, what: &str, allow_dirty: bool) -> Result<(), String> {
    if let Some(op) = operation(root) {
        return Err(format!("A {op} is in progress. Finish or abort it first."));
    }
    if allow_dirty {
        return Ok(());
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
pub(super) fn start_merge(root: &Path, target: &str, mode: &str, allow_dirty: bool) -> Result<String, String> {
    start_guard(root, "merge", allow_dirty)?;
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
pub(super) fn start_rebase(root: &Path, target: &str) -> Result<String, String> {
    start_guard(root, "rebase", false)?;
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
pub(super) fn force_push(root: &Path) -> Result<String, String> {
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

// ---------- commands ----------

// Start a merge or rebase, force push (specs/git-merge-rebase.md).
#[tauri::command]
pub async fn git_merge_preview(root: String, target: String) -> Result<GitMergePreview, String> {
    blocking(move || merge_preview(Path::new(&root), &target)).await
}

#[tauri::command]
pub async fn git_merge(root: String, target: String, mode: String, allow_dirty: Option<bool>) -> Result<String, String> {
    blocking(move || start_merge(Path::new(&root), &target, &mode, allow_dirty.unwrap_or(false))).await
}

#[tauri::command]
pub async fn git_rebase(root: String, target: String) -> Result<String, String> {
    blocking(move || start_rebase(Path::new(&root), &target)).await
}

#[tauri::command]
pub async fn git_force_push_preview(root: String) -> Result<GitForcePushPreview, String> {
    blocking(move || force_push_preview(Path::new(&root))).await
}

#[cfg(test)]
mod tests {
    use super::super::test_util::*;
    use super::super::*;
    use super::*;

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
        start_merge(&root, "feature", "ff-only", false).unwrap();
        assert_eq!(rev(&root, "HEAD"), feature);
        assert_eq!(subjects(&root, "HEAD"), ["f2", "f1", "init"]);
        // Always a merge commit, with feature as the second parent and no message asked for.
        git_ok(&root, &["reset", "-q", "--hard", &init]);
        start_merge(&root, "feature", "no-ff", false).unwrap();
        assert!(subjects(&root, "HEAD")[0].starts_with("Merge branch 'feature'"), "{:?}", subjects(&root, "HEAD"));
        assert_eq!(rev(&root, "HEAD^2"), feature);
        assert_eq!(rev(&root, "HEAD^1"), init);
        // Both sides have commits: "auto" joins them with a merge commit; feature itself is unchanged.
        git_ok(&root, &["reset", "-q", "--hard", &init]);
        commit_file(&root, "m1.txt", "m\n", "m1");
        let before = rev(&root, "HEAD");
        // A fast-forward is no longer possible: refused, and no merge commit is made instead.
        assert!(start_merge(&root, "feature", "ff-only", false).is_err());
        assert_eq!(rev(&root, "HEAD"), before);
        assert!(operation(&root).is_none());
        start_merge(&root, "feature", "auto", false).unwrap();
        assert_eq!((rev(&root, "HEAD^1"), rev(&root, "HEAD^2"), rev(&root, "feature")), (before, feature.clone(), feature));
        assert!(status(&root).unwrap().unwrap().files.is_empty());
        assert!(start_merge(&root, "feature", "sideways", false).is_err());
        // A remote-style or unknown name never becomes an option.
        assert!(start_merge(&root, "--abort", "auto", false).unwrap_err().contains("is not a branch or commit"));
        // A detached HEAD can merge too.
        git_ok(&root, &["checkout", "-q", "--detach", &init]);
        start_merge(&root, "feature", "ff-only", false).unwrap();
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
        let err = start_merge(&root, "feature", "auto", false).unwrap_err();
        assert!(err.contains("CONFLICT") && err.contains("notes.txt"), "{err}");
        let st = status(&root).unwrap().unwrap();
        assert_eq!(st.operation.as_deref(), Some("merge"));
        assert!(st.operation_message.as_ref().unwrap().starts_with("Merge branch 'feature'"));
        assert!(file(&st, &root, "notes.txt").conflicted);
        // Nothing else starts on top of it.
        assert!(start_merge(&root, "feature", "auto", false).unwrap_err().contains("in progress"));
        assert!(start_rebase(&root, "feature").unwrap_err().contains("in progress"));
        assert!(force_push(&root).unwrap_err().contains("in progress"));
        assert_eq!(abort_operation(&root).unwrap(), "merge");
        assert_eq!(rev(&root, "HEAD"), before);
        let st = status(&root).unwrap().unwrap();
        assert!(st.operation.is_none() && st.files.is_empty());
        assert_eq!(std::fs::read_to_string(root.join("notes.txt")).unwrap(), "1\n2\n3\nmain\n");
    }

    #[test]
    fn allow_dirty_merges_around_changes_git_does_not_touch_and_refuses_ones_it_would() {
        let Some((_d, root)) = repo_with_feature() else { return };
        // Branch "more" changes a.txt.
        git_ok(&root, &["switch", "-qc", "more"]);
        commit_file(&root, "a.txt", "two\n", "more");
        git_ok(&root, &["switch", "-q", "main"]);
        // a.txt is not changed by "feature": the merge goes ahead and the edit stays.
        write(&root, "a.txt", "edited\n");
        start_merge(&root, "feature", "auto", true).unwrap();
        assert_eq!(rev(&root, "HEAD"), rev(&root, "feature"));
        assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "edited\n");
        // A change to a file the merge would change: git refuses and nothing is in progress.
        let before = rev(&root, "HEAD");
        let err = start_merge(&root, "more", "auto", true).unwrap_err();
        assert!(err.contains("a.txt"), "{err}");
        assert!(operation(&root).is_none());
        assert_eq!(rev(&root, "HEAD"), before);
        assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "edited\n");
        // The rebase never allows it.
        assert!(start_rebase(&root, "more").unwrap_err().contains("uncommitted changes"));
    }

    #[test]
    fn merge_and_rebase_refuse_uncommitted_tracked_changes_but_not_untracked_files() {
        let Some((_d, root)) = repo_with_feature() else { return };
        let before = rev(&root, "HEAD");
        // An unstaged change to a tracked file.
        write(&root, "a.txt", "edited\n");
        assert!(start_merge(&root, "feature", "auto", false).unwrap_err().contains("uncommitted changes"));
        // A staged one: still staged after the refusal.
        git_ok(&root, &["add", "a.txt"]);
        assert!(start_rebase(&root, "feature").unwrap_err().contains("uncommitted changes"));
        let st = status(&root).unwrap().unwrap();
        assert_eq!(xy(file(&st, &root, "a.txt")), ("M", "."));
        assert_eq!(rev(&root, "HEAD"), before);
        git_ok(&root, &["reset", "-q", "--hard"]);
        // An untracked file the other side adds too: git refuses, names it, nothing is in progress.
        write(&root, "f1.txt", "mine\n");
        let err = start_merge(&root, "feature", "auto", false).unwrap_err();
        assert!(err.contains("f1.txt"), "{err}");
        assert!(operation(&root).is_none());
        assert_eq!(rev(&root, "HEAD"), before);
        assert_eq!(std::fs::read_to_string(root.join("f1.txt")).unwrap(), "mine\n");
        std::fs::remove_file(root.join("f1.txt")).unwrap();
        // An untracked file that is not in the way does not block, and is still there after.
        write(&root, "scratch.txt", "x\n");
        start_merge(&root, "feature", "ff-only", false).unwrap();
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
        let err = start_merge(&root, "imported", "auto", false).unwrap_err();
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
        assert!(start_merge(&root, "feature", "auto", false).unwrap_err().contains("in progress"));
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
}
