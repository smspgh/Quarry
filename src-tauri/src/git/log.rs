//! Blame, file / repository history and the files a commit changed. Spec: specs/git.md.

use super::{abs_path, blocking, find_root, has_head, is_sha, ls_files, rel_path, run, run_text};
use crate::files;
use encoding_rs::{Encoding, UTF_8};
use serde::Serialize;
use std::path::Path;

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitInfo {
    pub sha: String,
    pub short: String,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub summary: String,
    /// The line is not committed yet (all-zero sha).
    pub uncommitted: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitBlame {
    pub commits: Vec<GitCommitInfo>,
    /// One entry per line of the file: an index into `commits`.
    pub lines: Vec<u32>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitLogEntry {
    pub sha: String,
    pub short: String,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub summary: String,
    /// The file's repo-relative path (`/`-separated) at this commit; "" for a repository log.
    pub rel: String,
    pub root: String,
}

// ---------- blame ----------

/// Parse `blame --porcelain`: a header `<sha> <orig> <final> [<count>]`, the commit's details the
/// first time it appears, then the line itself prefixed by a tab.
fn parse_blame(out: &[u8]) -> GitBlame {
    let mut commits: Vec<GitCommitInfo> = Vec::new();
    let mut index: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    let mut lines: Vec<u32> = Vec::new();
    let mut cur: Option<u32> = None;
    for raw in out.split(|&b| b == b'\n') {
        if raw.first() == Some(&b'\t') {
            cur = None; // the line's text
            continue;
        }
        let line = String::from_utf8_lossy(raw);
        if cur.is_none() {
            let mut parts = line.split(' ');
            let (Some(sha), _, Some(fin)) = (parts.next(), parts.next(), parts.next()) else { continue };
            if !is_sha(sha) {
                continue;
            }
            let id = *index.entry(sha.to_string()).or_insert_with(|| {
                commits.push(GitCommitInfo {
                    sha: sha.to_string(),
                    short: sha[..7].to_string(),
                    author: String::new(),
                    email: String::new(),
                    time: 0,
                    summary: String::new(),
                    uncommitted: sha.bytes().all(|b| b == b'0'),
                });
                commits.len() as u32 - 1
            });
            let fin: usize = fin.parse().unwrap_or(0);
            if fin >= 1 {
                if lines.len() < fin {
                    lines.resize(fin, 0);
                }
                lines[fin - 1] = id;
            }
            cur = Some(id);
            continue;
        }
        let c = &mut commits[cur.unwrap() as usize];
        let (k, v) = line.split_once(' ').unwrap_or((&line, ""));
        match k {
            "author" => c.author = v.to_string(),
            "author-mail" => c.email = v.trim_start_matches('<').trim_end_matches('>').to_string(),
            "author-time" => c.time = v.parse().unwrap_or(0),
            "summary" => c.summary = v.to_string(),
            _ => {}
        }
    }
    GitBlame { commits, lines }
}

/// The bytes git should see for an unsaved buffer: the file's encoding, its BOM if the file on
/// disk has one, and its line endings (`eol`, else those of the file on disk; the editor's buffer
/// uses `\n`), so unchanged lines match their committed version.
fn buffer_bytes(path: &Path, contents: &str, encoding: Option<&str>, eol: Option<&str>) -> Result<Vec<u8>, String> {
    let enc: &'static Encoding = encoding.and_then(|l| Encoding::for_label(l.as_bytes())).unwrap_or(UTF_8);
    let head: Vec<u8> = std::fs::File::open(path)
        .ok()
        .map(|f| {
            let mut buf = Vec::new();
            let _ = std::io::Read::read_to_end(&mut std::io::Read::take(f, 64 * 1024), &mut buf);
            buf
        })
        .unwrap_or_default();
    let bom = Encoding::for_bom(&head).is_some_and(|(e, _)| e == enc);
    let crlf = match eol {
        Some(e) => e.eq_ignore_ascii_case("CRLF"),
        None => {
            let (disk_enc, bom_len) = files::detect_encoding(&head, Some(enc.name()));
            disk_enc.decode_without_bom_handling(&head[bom_len..]).0.contains("\r\n")
        }
    };
    let cr = eol.is_some_and(|e| e.eq_ignore_ascii_case("CR"));
    let text: std::borrow::Cow<str> = if contents.contains('\r') {
        contents.into()
    } else if crlf {
        contents.replace('\n', "\r\n").into()
    } else if cr {
        contents.replace('\n', "\r").into()
    } else {
        contents.into()
    };
    files::encode_text(&text, enc, bom)
}

fn blame(path: &str, contents: Option<String>, encoding: Option<String>, eol: Option<String>) -> Result<Option<GitBlame>, String> {
    let file = Path::new(path);
    let Some(root) = find_root(file)? else { return Ok(None) };
    let rel = rel_path(&root, path)?;
    if !has_head(&root) || ls_files(&root, &["--cached"], std::slice::from_ref(&rel))?.is_empty() {
        return Ok(None); // untracked, or nothing committed yet
    }
    let input = match &contents {
        Some(c) => Some(buffer_bytes(file, c, encoding.as_deref(), eol.as_deref())?),
        None => None,
    };
    let mut args = vec!["blame", "--porcelain"];
    if input.is_some() {
        args.extend(["--contents", "-"]);
    }
    args.extend(["--", &rel]);
    match run(&root, true, &args, input) {
        Ok(out) => Ok(Some(parse_blame(&out))),
        Err(e) if e.contains("no such path") => Ok(None), // staged as new, not in HEAD
        Err(e) => Err(e),
    }
}

// ---------- log ----------

fn parse_log(out: &[u8], root: &Path, start_rel: &str, follow: bool) -> Vec<GitLogEntry> {
    let text = String::from_utf8_lossy(out);
    let root_s = root.to_string_lossy().into_owned();
    let mut rel = start_rel.to_string();
    let mut list = Vec::new();
    for rec in text.split('\x1e').filter(|r| !r.is_empty()) {
        let f: Vec<&str> = rec.split('\0').collect();
        if f.len() < 6 {
            continue;
        }
        if follow {
            // After the fields: the file's name in this commit (missing for a merge: keep the newer one).
            if let Some(name) = f[6..].iter().map(|s| s.trim_matches(['\n', '\r'])).find(|s| !s.is_empty()) {
                rel = name.to_string();
            }
        }
        list.push(GitLogEntry {
            sha: f[0].to_string(),
            short: f[1].to_string(),
            author: f[2].to_string(),
            email: f[3].to_string(),
            time: f[4].parse().unwrap_or(0),
            summary: f[5].trim_end_matches(['\n', '\r']).to_string(),
            rel: rel.clone(),
            root: root_s.clone(),
        });
    }
    list
}

/// History of a file (following renames) or a folder (the repository root: every commit).
pub(super) fn log(path: &str, skip: u32, limit: u32) -> Result<Vec<GitLogEntry>, String> {
    let p = Path::new(path);
    let Some(root) = find_root(p)? else { return Ok(Vec::new()) };
    if !has_head(&root) {
        return Ok(Vec::new());
    }
    let rel = rel_path(&root, path)?;
    let follow = !rel.is_empty() && !p.is_dir();
    let skip_arg = format!("--skip={skip}");
    let limit_arg = format!("--max-count={}", limit.max(1));
    let mut args = vec!["log", "-z", "--format=%x1e%H%x00%h%x00%an%x00%ae%x00%at%x00%s", &skip_arg, &limit_arg];
    if follow {
        args.extend(["--follow", "--name-only"]);
    }
    if !rel.is_empty() {
        args.extend(["--", &rel]);
    }
    let out = run(&root, true, &args, None)?;
    Ok(parse_log(&out, &root, &rel, follow))
}

/// A file a commit changed (against its first parent; everything for the first commit).
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitFile {
    /// Where the file is (or would be) in the work tree.
    pub path: String,
    /// Repo-relative path (`/`-separated) at this commit.
    pub rel: String,
    /// A (added), M (modified), D (deleted), R (renamed), ...: git's status letter.
    pub status: String,
    /// The path before the commit, for a rename or copy.
    pub orig_rel: Option<String>,
}

pub(super) fn parse_commit_files(out: &[u8], root: &Path) -> Vec<GitCommitFile> {
    let text = String::from_utf8_lossy(out);
    let mut parts = text.split('\0').map(|s| s.trim_start_matches(['\n', '\r'])).filter(|s| !s.is_empty());
    let mut list = Vec::new();
    while let Some(code) = parts.next() {
        let status: String = code.chars().take(1).collect();
        let two = matches!(status.as_str(), "R" | "C");
        let Some(first) = parts.next() else { break };
        let (orig_rel, rel) = if two {
            let Some(to) = parts.next() else { break };
            (Some(first.to_string()), to.to_string())
        } else {
            (None, first.to_string())
        };
        list.push(GitCommitFile { path: abs_path(root, &rel), rel, status, orig_rel });
    }
    list
}

/// The files `sha` changed.
pub(super) fn commit_files(root: &Path, sha: &str) -> Result<Vec<GitCommitFile>, String> {
    if !is_sha(sha) {
        return Err("not a commit id".into());
    }
    let out = run(root, true, &["show", "--format=", "--name-status", "-z", "-M", "--diff-merges=first-parent", sha], None)?;
    Ok(parse_commit_files(&out, root))
}

/// Commits on the current branch that its upstream does not have yet (newest first, at most 500).
/// Empty when there is no upstream.
pub(super) fn unpushed(root: &Path) -> Vec<String> {
    match run_text(root, true, &["rev-list", "--max-count=500", "@{upstream}..HEAD"]) {
        Ok(t) => t.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect(),
        Err(_) => Vec::new(),
    }
}

// ---------- commands ----------

#[tauri::command]
pub async fn git_blame(path: String, contents: Option<String>, encoding: Option<String>, eol: Option<String>) -> Result<Option<GitBlame>, String> {
    blocking(move || blame(&path, contents, encoding, eol)).await
}

#[tauri::command]
pub async fn git_log(path: String, skip: u32, limit: u32) -> Result<Vec<GitLogEntry>, String> {
    blocking(move || log(&path, skip, limit)).await
}

#[tauri::command]
pub async fn git_commit_files(root: String, sha: String) -> Result<Vec<GitCommitFile>, String> {
    blocking(move || commit_files(Path::new(&root), &sha)).await
}

#[tauri::command]
pub async fn git_unpushed(root: String) -> Result<Vec<String>, String> {
    blocking(move || Ok(unpushed(Path::new(&root)))).await
}

#[cfg(test)]
mod tests {
    use super::super::test_util::*;
    use super::super::*;
    use super::*;

    #[test]
    fn blame_marks_unsaved_lines_uncommitted() {
        let Some((_d, root)) = repo() else { return };
        let p = write(&root, "f.txt", "alpha\r\nbeta\r\n");
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "add f"]);

        let b = blame(&p, None, None, None).unwrap().unwrap();
        assert_eq!(b.lines.len(), 2);
        assert_eq!(b.commits.len(), 1);
        assert_eq!(b.commits[0].summary, "add f");
        assert_eq!(b.commits[0].author, "Test User");
        assert_eq!(b.commits[0].email, "test@example.com");
        assert!(b.commits[0].time > 0);

        // The editor's buffer uses \n; the file's CRLF is applied so unchanged lines still match.
        let b = blame(&p, Some("alpha\nnew line\nbeta\n".into()), Some("UTF-8".into()), None).unwrap().unwrap();
        assert_eq!(b.lines.len(), 3);
        let c = |i: usize| &b.commits[b.lines[i] as usize];
        assert!(!c(0).uncommitted && c(1).uncommitted && !c(2).uncommitted);

        let u = write(&root, "untracked.txt", "x\n");
        assert!(blame(&u, None, None, None).unwrap().is_none());
    }

    #[test]
    fn log_follows_a_rename() {
        let Some((_d, root)) = repo() else { return };
        write(&root, "old.txt", "line one\nline two\nline three\n");
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "create"]);
        git_ok(&root, &["mv", "old.txt", "new.txt"]);
        git_ok(&root, &["commit", "-qm", "rename"]);
        let p = write(&root, "new.txt", "line one\nline two\nline three\nfour\n");
        git_ok(&root, &["commit", "-qam", "edit: odd \"chars\" | ; %"]);

        let entries = log(&p, 0, 50).unwrap();
        let got: Vec<(&str, &str)> = entries.iter().map(|e| (e.summary.as_str(), e.rel.as_str())).collect();
        assert_eq!(got, [("edit: odd \"chars\" | ; %", "new.txt"), ("rename", "new.txt"), ("create", "old.txt")]);
        assert_eq!(entries[2].author, "Test User");
        assert_eq!(entries[2].root, root.to_string_lossy());
        // The old name reads its contents at that commit.
        let first = show(&p, &entries[2].sha, Some(entries[2].rel.clone())).unwrap().unwrap();
        assert_eq!(first.text, "line one\nline two\nline three\n");

        let page = log(&p, 1, 1).unwrap();
        assert_eq!(page.len(), 1);
        assert_eq!(page[0].summary, "rename");

        let repo_log = log(&root.to_string_lossy(), 0, 10).unwrap();
        assert_eq!(repo_log.len(), 3);
        assert!(repo_log.iter().all(|e| e.rel.is_empty()));
    }

    #[test]
    fn commit_files_lists_what_a_commit_changed() {
        let Some((_d, root)) = repo() else { return };
        write(&root, "keep.txt", "one\ntwo\nthree\nfour\n");
        write(&root, "gone.txt", "x\n");
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "first"]);
        std::fs::create_dir_all(root.join("sub dir")).unwrap();
        git_ok(&root, &["mv", "keep.txt", "sub dir/kept.txt"]);
        git_ok(&root, &["rm", "-q", "gone.txt"]);
        write(&root, "new.txt", "n\n");
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "second"]);

        let entries = log(&root.to_string_lossy(), 0, 10).unwrap();
        let second = commit_files(&root, &entries[0].sha).unwrap();
        let mut got: Vec<(String, String, Option<String>)> = second.iter().map(|f| (f.status.clone(), f.rel.clone(), f.orig_rel.clone())).collect();
        got.sort();
        assert_eq!(
            got,
            [
                ("A".to_string(), "new.txt".to_string(), None),
                ("D".to_string(), "gone.txt".to_string(), None),
                ("R".to_string(), "sub dir/kept.txt".to_string(), Some("keep.txt".to_string())),
            ]
        );
        assert!(second.iter().all(|f| f.path.starts_with(&*root.to_string_lossy())));
        // The first commit has no parent: everything in it is added.
        let first = commit_files(&root, &entries[1].sha).unwrap();
        assert_eq!(first.len(), 2);
        assert!(first.iter().all(|f| f.status == "A"));
        assert!(commit_files(&root, "HEAD; rm -rf").is_err());
        // No upstream: nothing is known to be unpushed.
        assert!(unpushed(&root).is_empty());
    }
}
