//! Compare commits: the read-only difference of two commits or a commit and the work tree. Spec: specs/git-compare-commits.md.

use super::{blocking, exec, git, has_head, is_sha, parse_commit_files, parse_graph, ref_exists, valid_ref_name, GRAPH_FORMAT, GitCommitFile, GitGraphCommit};
use serde::Serialize;
use std::path::{Path, PathBuf};

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

/// Compare with Branch… set to "what the branch changed since it split off": the common ancestor
/// of the two sides (each a commit id, HEAD or a branch name, as in `compare_side`), or None when
/// the histories share no commit. Read-only.
fn merge_base(root: &Path, left: &str, right: &str) -> Result<Option<String>, String> {
    let (l, r) = (compare_side(root, left)?, compare_side(root, right)?);
    match compare_git(root, &["merge-base", &l, &r], None) {
        Ok(out) => {
            let sha = String::from_utf8_lossy(&out).trim().to_string();
            Ok(is_sha(&sha).then_some(sha))
        }
        Err(_) => Ok(None),
    }
}

// ---------- commands ----------

// Compare commits (specs/git-compare-commits.md).
#[tauri::command]
pub async fn git_diff_files(root: String, left: String, right: Option<String>) -> Result<GitCompare, String> {
    blocking(move || diff_files(Path::new(&root), &left, right.as_deref())).await
}

#[tauri::command]
pub async fn git_merge_base(root: String, left: String, right: String) -> Result<Option<String>, String> {
    blocking(move || merge_base(Path::new(&root), &left, &right)).await
}

#[cfg(test)]
mod tests {
    use super::super::test_util::*;
    use super::super::*;
    use super::*;

    #[test]
    fn merge_base_is_where_the_branch_split_off() {
        let Some((_d, root)) = repo_with_feature() else { return };
        let init = rev(&root, "main");
        commit_file(&root, "m.txt", "m\n", "on main");
        assert_eq!(merge_base(&root, "HEAD", "feature").unwrap().as_deref(), Some(init.as_str()));
        assert_eq!(merge_base(&root, "main", "feature").unwrap().as_deref(), Some(init.as_str()));
        // Unrelated histories share nothing.
        git_ok(&root, &["switch", "-q", "--orphan", "alone"]);
        commit_file(&root, "z.txt", "z\n", "alone");
        assert_eq!(merge_base(&root, "HEAD", "feature").unwrap(), None);
        assert!(merge_base(&root, "HEAD", "no-such").is_err());
    }

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
        assert!(start_merge(&root, "feature", "auto", false).is_err());
        let c = diff_files(&root, &init, None).unwrap();
        assert_eq!(compared(&c), [row("U", "notes.txt", None)]);
        // The merge is still stopped, with the same conflicted file.
        let st = status(&root).unwrap().unwrap();
        assert_eq!(st.operation.as_deref(), Some("merge"));
        assert!(file(&st, &root, "notes.txt").conflicted);
    }
}
