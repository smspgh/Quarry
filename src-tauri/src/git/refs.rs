//! Branches (list, checkout) and branch and tag housekeeping (delete, rename, upstream, push). Spec: specs/git-branches.md.

use super::{blocking, combined, count_revs, exec, git, has_head, is_sha, ref_exists, remotes, run, run_text, valid_ref_name};
use serde::Serialize;
use std::path::Path;

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

// ---------- branches ----------

pub(super) fn branches(root: &Path) -> Result<Vec<GitBranch>, String> {
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

pub(super) fn checkout(root: &Path, name: &str, create: bool) -> Result<(), String> {
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

#[tauri::command]
pub async fn git_branches(root: String) -> Result<Vec<GitBranch>, String> {
    blocking(move || branches(Path::new(&root))).await
}

#[tauri::command]
pub async fn git_checkout(root: String, name: String, create: bool) -> Result<(), String> {
    blocking(move || checkout(Path::new(&root), &name, create)).await
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

#[cfg(test)]
mod tests {
    use super::super::test_util::*;
    use super::super::*;
    use super::*;

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
