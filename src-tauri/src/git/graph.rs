//! The commit graph: pages, search, commit details, commit actions, Continue / Abort of a stopped operation. Spec: specs/git-graph.md.

use super::{blocking, combined, commit_files, exec, fold_stashes, git, has_head, has_unmerged, history, is_sha, operation, run, run_text, stash_list, valid_ref_name, GitCommitFile};
use serde::Serialize;
use std::path::Path;

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

pub(super) fn parse_graph(out: &[u8]) -> Vec<GitGraphCommit> {
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
#[cfg(test)]
pub(super) fn graph(root: &Path, all: bool, skip: u32, limit: u32) -> Result<Vec<GitGraphCommit>, String> {
    graph_ordered(root, all, skip, limit, false)
}

/// Graph polish (GRAPH-018): `by_date` lists the commits in git's author-date order (newest
/// first, but never a commit above one of its children) instead of branch by branch, for any size
/// of history (each page re-sorts the history, so pages cost a little more than in branch order).
fn graph_ordered(root: &Path, all: bool, skip: u32, limit: u32, by_date: bool) -> Result<Vec<GitGraphCommit>, String> {
    if !has_head(root) {
        return Ok(Vec::new());
    }
    let skip_arg = format!("--skip={skip}");
    let limit_arg = format!("--max-count={}", limit.clamp(1, 5000));
    // Topological order: a branch's commits stay together, which keeps the graph several times
    // narrower than date order on histories with many merged branches.
    let order = if by_date { "--author-date-order" } else { "--topo-order" };
    let mut args = vec!["log", "-z", order, "--decorate=full", GRAPH_FORMAT, &skip_arg, &limit_arg];
    args.extend(graph_scope(root, all));
    // Stash: with `all`, the commit each stash was made on is walked too (it may be on no branch
    // any more), and every stash becomes one row above that commit (`fold_stashes`).
    let stashes = if all { stash_list(root).unwrap_or_default() } else { Vec::new() };
    args.extend(stashes.iter().map(|s| s.base.as_str()));
    let out = run(root, true, &args, None)?;
    Ok(fold_stashes(parse_graph(&out), &stashes))
}

pub(super) const GRAPH_FORMAT: &str = "--format=%x1e%H%x00%h%x00%P%x00%an%x00%ae%x00%at%x00%D%x00%s";

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
pub(super) fn graph_search(root: &Path, all: bool, query: &str, limit: u32) -> Result<Vec<GitGraphCommit>, String> {
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
pub(super) fn continue_operation(root: &Path, how: &str) -> Result<String, String> {
    let Some(op) = operation(root) else { return Err("Nothing is in progress.".into()) };
    let flag = match how {
        "continue" => "--continue",
        "skip" if op != "merge" => "--skip",
        "skip" => return Err("A merge has nothing to skip. Abort it instead.".into()),
        _ => return Err(format!("unknown step {how}")),
    };
    // With files still in conflict, git refuses a Continue: that stays an error.
    let unmerged_before = has_unmerged(root);
    let mut cmd = git(root, false);
    // Each commit keeps its own message: never wait on an editor.
    cmd.env("GIT_EDITOR", "true").args([op.as_str(), flag]);
    let out = exec(cmd, None)?;
    if out.ok {
        return Ok(op);
    }
    // It went on and stopped on a conflict in the next commit: not a failure (CONFLICT-012.3).
    if (how == "skip" || !unmerged_before) && operation(root).is_some() && has_unmerged(root) {
        return Ok(format!("{op}{STOPPED_AGAIN}"));
    }
    let text = combined(&out);
    // A history edit's new message could not be set (signing failed, …): say so plainly. The step
    // stays on the todo, so the next Continue tries it again.
    if op == "rebase" && operation(root).is_some() && !has_unmerged(root) {
        if let Ok(dir) = run_text(root, true, &["rev-parse", "--git-path", "rebase-merge"]) {
            let dir = root.join(dir.trim());
            if history::message_step_failed(&dir) {
                return Err(format!("{}: {}", history::MESSAGE_FAILED, history::failure_reason(&text)));
            }
        }
    }
    Err(text)
}

/// Ends the operation name `continue_operation` returns when it stopped again on a conflict.
pub(crate) const STOPPED_AGAIN: &str = ":conflicts";

/// Abandon the merge / rebase / cherry-pick / revert in progress: back to how things were before it.
pub(super) fn abort_operation(root: &Path) -> Result<String, String> {
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

#[tauri::command]
pub async fn git_graph(root: String, all: bool, skip: u32, limit: u32, order: Option<String>) -> Result<Vec<GitGraphCommit>, String> {
    blocking(move || graph_ordered(Path::new(&root), all, skip, limit, order.as_deref() == Some("date"))).await
}

/// Graph polish (GRAPH-015): the full id of the current commit (the parent of the graph's
/// uncommitted-changes row), None before the first commit.
pub(super) fn head_sha(root: &Path) -> Option<String> {
    run_text(root, true, &["rev-parse", "--verify", "-q", "HEAD^{commit}"]).ok().map(|s| s.trim().to_string()).filter(|s| is_sha(s))
}

#[tauri::command]
pub async fn git_head_sha(root: String) -> Result<Option<String>, String> {
    blocking(move || Ok(head_sha(Path::new(&root)))).await
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
pub async fn git_continue(root: String, how: String) -> Result<String, String> {
    blocking(move || continue_operation(Path::new(&root), &how)).await
}

#[cfg(test)]
mod tests {
    use super::super::test_util::*;
    use super::super::*;
    use super::*;

    // ----- Graph polish (GRAPH-015, GRAPH-018) -----
    #[test]
    fn graph_date_order_interleaves_branches_but_never_lists_a_commit_above_its_child() {
        let Some((_d, root)) = repo() else { return };
        let commit_at = |file: &str, msg: &str, date: &str| {
            write(&root, file, msg);
            git_ok(&root, &["add", "."]);
            git_ok(&root, &["commit", "-qm", msg, "--date", date]);
        };
        // Before the first commit there is no current commit.
        assert_eq!(head_sha(&root), None);
        commit_at("a.txt", "main 10:00", "2026-01-05T10:00:00");
        git_ok(&root, &["switch", "-qc", "feature"]);
        commit_at("f.txt", "feature 11:00", "2026-01-05T11:00:00");
        git_ok(&root, &["switch", "-q", "main"]);
        commit_at("b.txt", "main 12:00", "2026-01-05T12:00:00");
        git_ok(&root, &["merge", "-q", "--no-ff", "-m", "merge 13:00", "feature"]);
        git_ok(&root, &["commit", "-q", "--amend", "--no-edit", "--date", "2026-01-05T13:00:00"]);
        let names = |by_date: bool| graph_ordered(&root, false, 0, 301, by_date).unwrap().into_iter().map(|c| c.summary).collect::<Vec<_>>();
        // Branch order (the default, and what `graph` gives): the merged branch's commit is not
        // sorted in between main's by date.
        assert_eq!(names(false), graph(&root, false, 0, 301).unwrap().into_iter().map(|c| c.summary).collect::<Vec<_>>());
        // Date order: by author date across the branches.
        assert_eq!(names(true), ["merge 13:00", "main 12:00", "feature 11:00", "main 10:00"]);
        // Parents and labels are the same in either order.
        let by_date = graph_ordered(&root, false, 0, 301, true).unwrap();
        assert_eq!(by_date[0].parents.len(), 2);
        assert_eq!(by_date[0].refs, ["HEAD", "refs/heads/main"]);
        assert_eq!(head_sha(&root).as_deref(), Some(by_date[0].sha.as_str()));

        // A commit authored later than the commit made on top of it (a wrong clock) stays below it.
        commit_at("c.txt", "authored in 2030", "2030-01-01T09:00:00");
        commit_at("d.txt", "on top, authored 14:00", "2026-01-05T14:00:00");
        assert_eq!(names(true)[..3], ["on top, authored 14:00", "authored in 2030", "merge 13:00"]);
        // The date used is the author's (what the Date column shows): a commit authored on an
        // earlier day is listed by that day even though it was committed just now.
        git_ok(&root, &["switch", "-qc", "side", "HEAD~2"]);
        commit_at("e.txt", "side, authored 10:30", "2026-01-05T10:30:00");
        let all = graph_ordered(&root, true, 0, 301, true).unwrap().into_iter().map(|c| c.summary).collect::<Vec<_>>();
        assert_eq!(all, ["on top, authored 14:00", "authored in 2030", "side, authored 10:30", "merge 13:00", "main 12:00", "feature 11:00", "main 10:00"]);
    }

    #[test]
    fn graph_first_page_probe_tells_exactly_300_commits_from_more() {
        let Some((_d, root)) = repo() else { return };
        // 301 commits without files, written in one go.
        let mut stream = String::new();
        for i in 1..=301 {
            let msg = format!("c{i}");
            stream.push_str(&format!("commit refs/heads/main\nmark :{i}\ncommitter Test User <test@example.com> {} +0000\ndata {}\n{msg}\n", 1_700_000_000 + i, msg.len()));
            if i > 1 {
                stream.push_str(&format!("from :{}\n", i - 1));
            }
            stream.push('\n');
        }
        run(&root, false, &["fast-import", "--quiet"], Some(stream.into_bytes())).unwrap();
        // The UI asks the first page for 301 commits: 301 back means "more than 300".
        let page = graph_ordered(&root, false, 0, 301, false).unwrap();
        assert_eq!(page.len(), 301);
        assert_eq!(page[0].summary, "c301");
        // The commit left out of the first page is the first one of the next.
        assert_eq!(graph_ordered(&root, false, 300, 300, false).unwrap().iter().map(|c| c.summary.as_str()).collect::<Vec<_>>(), ["c1"]);
        // Exactly 300 commits: the probe comes back with 300, so the whole history is known to be loaded.
        git_ok(&root, &["update-ref", "refs/heads/main", "refs/heads/main~1"]);
        for by_date in [false, true] {
            let page = graph_ordered(&root, false, 0, 301, by_date).unwrap();
            assert_eq!(page.len(), 300);
            assert_eq!((page[0].summary.as_str(), page[299].summary.as_str()), ("c300", "c1"));
        }
    }

    // ----- end -----

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
}
