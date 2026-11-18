//! Git integration: every operation shells out to the `git` executable on PATH (no libgit2), with
//! no console window, no terminal prompts (credentials go through Git Credential Manager's own
//! window) and paths quoted as UTF-8. Paths cross the boundary as absolute Windows paths in the
//! same form as the rest of the app (`files::normalize`); git itself sees repo-relative `/` paths.
//! All commands are async and run git on a blocking thread, so a slow fetch or a big status never
//! stalls the UI.

use crate::files;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

// Staging / unstaging / discarding part of a file (git/staging.rs, specs/git-staging.md).
pub mod staging;
// Edit History: undo, reword, drop, squash, the interactive rebase list (git/history.rs, specs/git-history-edit.md).
pub mod history;

// Status, file contents, index and work tree (git/status.rs, specs/git.md).
mod status;
// Remotes and identity (git/remotes.rs, specs/git.md).
mod remotes;
// Creating a GitHub repository (git/github.rs, specs/git.md).
mod github;
// Blame and log (git/log.rs, specs/git.md).
mod log;
// Commit graph (git/graph.rs, specs/git-graph.md).
mod graph;
// Start a merge or rebase, force push (git/merge.rs, specs/git-merge-rebase.md).
mod merge;
// Stash (git/stash.rs, specs/git-stash.md).
mod stash;
// Compare commits (git/compare.rs, specs/git-compare-commits.md).
mod compare;
// Branches and branch / tag housekeeping (git/refs.rs, specs/git-branches.md).
mod refs;

// Every feature's commands and types stay reachable as `git::<name>` (lib.rs registers
// `git::git_status`, …) and as `super::<name>` inside the submodules.
pub use compare::*;
pub use github::*;
pub use graph::*;
pub use log::*;
pub use merge::*;
pub use refs::*;
pub use remotes::*;
pub use stash::*;
pub use status::*;

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

// ---------- shared helpers (used by several features) ----------

fn ref_exists(root: &Path, full: &str) -> bool {
    run(root, true, &["show-ref", "--verify", "-q", full], None).is_ok()
}

fn remotes(root: &Path) -> Result<Vec<String>, String> {
    Ok(run_text(root, true, &["remote"])?.lines().map(str::trim).filter(|l| !l.is_empty()).map(str::to_string).collect())
}

fn combined(out: &Output) -> String {
    let stdout = String::from_utf8_lossy(&out.stdout);
    [stdout.trim(), out.stderr.as_str()].iter().filter(|s| !s.is_empty()).copied().collect::<Vec<_>>().join("\n")
}

fn is_sha(s: &str) -> bool {
    (s.len() == 40 || s.len() == 64) && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// A valid new branch / tag name (git's own rules), not starting with `-`.
fn valid_ref_name(root: &Path, name: &str) -> bool {
    !name.is_empty() && !name.starts_with('-') && run(root, true, &["check-ref-format", "--branch", name], None).is_ok()
}

fn has_unmerged(root: &Path) -> bool {
    run(root, true, &["ls-files", "-u"], None).map(|o| !o.is_empty()).unwrap_or(false)
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

#[cfg(test)]
mod test_util {
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

    pub(super) fn file<'a>(st: &'a GitStatus, root: &Path, rel: &str) -> &'a GitFile {
        let p = abs_path(root, rel);
        st.files.iter().find(|f| f.path == p).unwrap_or_else(|| panic!("{rel} not in {:?}", st.files))
    }

    pub(super) fn xy(f: &GitFile) -> (&str, &str) {
        (f.index.as_str(), f.worktree.as_str())
    }

    pub(super) fn commit_file(root: &Path, rel: &str, text: &str, message: &str) {
        write(root, rel, text);
        git_ok(root, &["add", "."]);
        git_ok(root, &["commit", "-qm", message]);
    }

    pub(super) fn rev(root: &Path, what: &str) -> String {
        run_text(root, true, &["rev-parse", what]).unwrap().trim().to_string()
    }

    pub(super) fn subjects(root: &Path, what: &str) -> Vec<String> {
        run_text(root, true, &["log", "--format=%s", what]).unwrap().lines().map(str::to_string).collect()
    }

    /// main: init; feature: init + f1 + f2 (other files). Left on main.
    pub(super) fn repo_with_feature() -> Option<(tempfile::TempDir, PathBuf)> {
        let (d, root) = repo()?;
        commit_file(&root, "a.txt", "one\n", "init");
        git_ok(&root, &["switch", "-qc", "feature"]);
        commit_file(&root, "f1.txt", "1\n", "f1");
        commit_file(&root, "f2.txt", "2\n", "f2");
        git_ok(&root, &["switch", "-q", "main"]);
        Some((d, root))
    }

    pub(super) fn read(root: &Path, rel: &str) -> String {
        std::fs::read_to_string(root.join(rel)).unwrap()
    }
}
