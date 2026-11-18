//! Remotes (list, add, change URL, fetch / pull / push) and the commit identity. Spec: specs/git.md.

use super::{blocking, combined, exec, force_push, git, remotes, run, run_text};
use serde::Serialize;
use std::path::Path;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitRemote {
    pub name: String,
    /// The fetch URL.
    pub url: String,
}

/// `remote -v`: one fetch and one push line per remote; the fetch URL is the one shown.
pub(super) fn remote_list(root: &Path) -> Result<Vec<GitRemote>, String> {
    let mut list: Vec<GitRemote> = Vec::new();
    for line in run_text(root, true, &["remote", "-v"])?.lines() {
        let Some((name, rest)) = line.split_once('\t') else { continue };
        let Some(url) = rest.strip_suffix(" (fetch)") else { continue };
        list.push(GitRemote { name: name.to_string(), url: url.to_string() });
    }
    Ok(list)
}

pub(super) fn add_remote(root: &Path, name: &str, url: &str) -> Result<(), String> {
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

// ---------- remotes ----------

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
pub(super) fn remote_op(root: &Path, op: &str) -> Result<String, String> {
    let mut quiet = false;
    let args: Vec<String> = match op {
        "fetch" => vec!["fetch".into(), "--all".into(), "--prune".into()],
        "check" => {
            quiet = true;
            let mut v = quiet_options(root);
            // --no-tags: a tag deleted here must not come back on its own (a Fetch the user asks for may bring it).
            v.extend(["fetch".into(), "--prune".into(), "--no-tags".into(), "--quiet".into()]);
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

// ---------- commands ----------

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

#[cfg(test)]
mod tests {
    use super::super::test_util::*;
    use super::super::*;
    use super::*;

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
        // A tag deleted here does not come back with the background check.
        git_ok(other.path(), &["tag", "v9"]);
        git_ok(other.path(), &["push", "-q", "origin", "v9"]);
        git_ok(&root, &["fetch", "-q", "--tags"]);
        git_ok(&root, &["tag", "-d", "v9"]);
        remote_op(&root, "check").unwrap();
        assert_eq!(run_text(&root, true, &["tag", "-l", "v9"]).unwrap().trim(), "");

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
