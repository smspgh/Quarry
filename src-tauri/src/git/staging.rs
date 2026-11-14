//! Staging, unstaging and discarding part of a file (specs/git-staging.md): one change of a
//! Compare tab, or some of its lines. The UI sends line ranges only (`LinePick`); the patch is
//! built here from git's own bytes (the index / HEAD blob, and the working file as `git diff`
//! sees it), so line endings, encoding, a BOM and a missing final newline are never touched, and
//! it is applied with `git apply --cached`, `git apply --cached -R` or `git apply -R`.

use super::{blocking, decode_blob, rel_path, run, unstage};
use crate::files;
use serde::Deserialize;
use std::path::Path;

/// Start of the error for "what the comparison shows is no longer what git / the disk has".
pub const STALE: &str = "quarry-stale";

/// One piece to take: lines `new_start .. new_start + new_count` of the comparison's right side
/// stand in for lines `old_start .. old_start + old_count` of its left side (1-based; a count of 0
/// is the place before that line). Lines are the editor's: the text split on line breaks, so a
/// text ending in a line break has an empty last line.
#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LinePick {
    pub old_start: usize,
    pub old_count: usize,
    pub new_start: usize,
    pub new_count: usize,
}

/// What the comparison showed when the user acted: hashes (`text_hash`) of its two texts, and the
/// encoding the right side's file was read with.
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Expected {
    pub left: String,
    pub right: String,
    pub encoding: Option<String>,
}

// ---------- pure: lines, splice, patch ----------

/// The editor's lines of `bytes`: split on `\n` (a `\r` stays on its line).
fn cm_lines(bytes: &[u8]) -> Vec<&[u8]> {
    bytes.split(|b| *b == b'\n').collect()
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Op<'a> {
    Keep(&'a [u8]),
    Del(&'a [u8]),
    Add(&'a [u8]),
}

/// The edit script that turns `base` into `base` with each `(base_start, base_count)` range
/// replaced by `from`'s `(from_start, from_count)` lines. Ranges are 1-based, in order, apart.
fn splice<'a>(base: &[&'a [u8]], from: &[&'a [u8]], picks: &[(usize, usize, usize, usize)]) -> Result<Vec<Op<'a>>, String> {
    let mut ops = Vec::with_capacity(base.len() + 8);
    let mut at = 0; // lines of `base` already emitted
    for &(bs, bc, fs, fc) in picks {
        let bad = bs == 0 || fs == 0 || bs - 1 < at || bs - 1 + bc > base.len() || fs - 1 + fc > from.len();
        if bad {
            return Err(format!("{STALE}: a line range is outside the file"));
        }
        ops.extend(base[at..bs - 1].iter().map(|l| Op::Keep(*l)));
        ops.extend(base[bs - 1..bs - 1 + bc].iter().map(|l| Op::Del(*l)));
        ops.extend(from[fs - 1..fs - 1 + fc].iter().map(|l| Op::Add(*l)));
        at = bs - 1 + bc;
    }
    ops.extend(base[at..].iter().map(|l| Op::Keep(*l)));
    Ok(ops)
}

/// The same script read backwards (result → base).
fn invert<'a>(ops: &[Op<'a>]) -> Vec<Op<'a>> {
    ops.iter()
        .map(|op| match *op {
            Op::Keep(l) => Op::Keep(l),
            Op::Del(l) => Op::Add(l),
            Op::Add(l) => Op::Del(l),
        })
        .collect()
}

/// The text an edit script ends with.
fn result_of(ops: &[Op]) -> Vec<u8> {
    let lines: Vec<&[u8]> = ops.iter().filter_map(|op| match *op {
        Op::Keep(l) | Op::Add(l) => Some(l),
        Op::Del(_) => None,
    }).collect();
    lines.join(&b'\n')
}

struct Entry<'a> {
    tag: u8,
    text: &'a [u8],
    /// The line ends with a line break (false: the file's last line without one).
    nl: bool,
}

const CONTEXT: usize = 3;

/// A unified diff for `rel` that makes the script's edits, or None when it changes nothing.
/// Editor lines become file lines here: every line but the last ends in `\n`; the last one has no
/// line break, and does not exist at all when it is empty (the text ended in a line break).
fn build_patch(rel: &str, ops: &[Op]) -> Option<Vec<u8>> {
    let old_n = ops.iter().filter(|o| !matches!(o, Op::Add(_))).count();
    let new_n = ops.iter().filter(|o| !matches!(o, Op::Del(_))).count();
    // (exists, ends with a line break) for editor line `i` of `n`.
    let form = |i: usize, n: usize, text: &[u8]| if i + 1 < n { (true, true) } else { (!text.is_empty(), false) };
    let mut entries: Vec<Entry> = Vec::with_capacity(ops.len());
    let (mut oi, mut ni) = (0, 0);
    for op in ops {
        match *op {
            Op::Keep(text) => {
                let (old, new) = (form(oi, old_n, text), form(ni, new_n, text));
                oi += 1;
                ni += 1;
                if old == new {
                    if old.0 {
                        entries.push(Entry { tag: b' ', text, nl: old.1 });
                    }
                } else {
                    // The same text, but its line break came or went (it is, or was, the last line).
                    if old.0 {
                        entries.push(Entry { tag: b'-', text, nl: old.1 });
                    }
                    if new.0 {
                        entries.push(Entry { tag: b'+', text, nl: new.1 });
                    }
                }
            }
            Op::Del(text) => {
                let old = form(oi, old_n, text);
                oi += 1;
                if old.0 {
                    entries.push(Entry { tag: b'-', text, nl: old.1 });
                }
            }
            Op::Add(text) => {
                let new = form(ni, new_n, text);
                ni += 1;
                if new.0 {
                    entries.push(Entry { tag: b'+', text, nl: new.1 });
                }
            }
        }
    }
    // Within a run of changed lines: removals first, then additions (as git writes them).
    let mut i = 0;
    while i < entries.len() {
        if entries[i].tag == b' ' {
            i += 1;
            continue;
        }
        let mut j = i;
        while j < entries.len() && entries[j].tag != b' ' {
            j += 1;
        }
        entries[i..j].sort_by_key(|e| e.tag != b'-'); // stable
        i = j;
    }
    let changed: Vec<usize> = entries.iter().enumerate().filter(|(_, e)| e.tag != b' ').map(|(i, _)| i).collect();
    if changed.is_empty() {
        return None;
    }
    // Hunks: each change with 3 lines of context, joined when they touch.
    let mut hunks: Vec<(usize, usize)> = Vec::new();
    for &c in &changed {
        let (from, to) = (c.saturating_sub(CONTEXT), (c + CONTEXT + 1).min(entries.len()));
        match hunks.last_mut() {
            Some(last) if from <= last.1 => last.1 = to,
            _ => hunks.push((from, to)),
        }
    }
    let name = if rel.contains(' ') { format!("{rel}\t") } else { rel.to_string() };
    let mut out = format!("diff --git a/{rel} b/{rel}\n--- a/{name}\n+++ b/{name}\n").into_bytes();
    let (mut old_before, mut new_before, mut at) = (0usize, 0usize, 0usize);
    for (from, to) in hunks {
        for e in &entries[at..from] {
            old_before += (e.tag != b'+') as usize;
            new_before += (e.tag != b'-') as usize;
        }
        let old_count = entries[from..to].iter().filter(|e| e.tag != b'+').count();
        let new_count = entries[from..to].iter().filter(|e| e.tag != b'-').count();
        // "-N,0" names the line before the place.
        let start = |before: usize, count: usize| if count == 0 { before } else { before + 1 };
        out.extend_from_slice(format!("@@ -{},{} +{},{} @@\n", start(old_before, old_count), old_count, start(new_before, new_count), new_count).as_bytes());
        for e in &entries[from..to] {
            out.push(e.tag);
            out.extend_from_slice(e.text);
            out.push(b'\n');
            if !e.nl {
                out.extend_from_slice(b"\\ No newline at end of file\n");
            }
        }
        old_before += old_count;
        new_before += new_count;
        at = to;
    }
    Some(out)
}

/// The hash the UI sends for a text (`textHash` in src/lib/gitHunks.ts): length and two 32-bit
/// hashes over its UTF-16 code units.
pub fn text_hash(text: &str) -> String {
    let (mut a, mut b, mut len) = (0x811c_9dc5u32, 5381u32, 0usize);
    for c in text.encode_utf16() {
        a = (a ^ c as u32).wrapping_mul(0x0100_0193);
        b = b.wrapping_mul(33).wrapping_add(c as u32);
        len += 1;
    }
    format!("{len}:{a:x}:{b:x}")
}

/// Line breaks as the editors hold them.
fn lf(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

// ---------- git ----------

/// A blob's bytes exactly as stored (`spec`: ":path" or "HEAD:path"); None when it is not there.
fn blob(root: &Path, spec: &str) -> Result<Option<Vec<u8>>, String> {
    match run(root, true, &["cat-file", "blob", spec], None) {
        Ok(b) => Ok(Some(b)),
        Err(_) => Ok(None),
    }
}

/// The text the comparison shows for a blob (`git_show`: through the checkout filters, decoded).
fn shown(root: &Path, spec: &str) -> Result<String, String> {
    let bytes = run(root, true, &["cat-file", "--filters", spec], None)?;
    Ok(lf(&decode_blob(&bytes).text))
}

/// The working file as git compares it with the index (after its line-ending and clean filters),
/// read from `git diff-files` with the whole file as context: git does the conversion, nothing is
/// written to the repository.
fn worktree_as_git(root: &Path, rel: &str, index: &[u8], disk_len: usize) -> Result<Vec<u8>, String> {
    let context = format!("-U{}", cm_lines(index).len() + disk_len + 8);
    let out = run(
        root,
        true,
        &["-c", "diff.suppressBlankEmpty=false", "diff-files", "-p", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", &context, "--", rel],
        None,
    )?;
    if out.is_empty() {
        return Ok(index.to_vec()); // no difference once converted
    }
    let mut lines = out.split(|b| *b == b'\n');
    if !lines.by_ref().any(|l| l.starts_with(b"@@")) {
        return Err(if out.windows(12).any(|w| w == b"Binary files") { BINARY.to_string() } else { format!("{STALE}: no text difference") });
    }
    let (mut old, mut new) = (Vec::with_capacity(index.len()), Vec::with_capacity(index.len() + 1024));
    let mut last = b' ';
    for l in lines {
        match l.first() {
            Some(b' ') => {
                old.extend_from_slice(&l[1..]);
                old.push(b'\n');
                new.extend_from_slice(&l[1..]);
                new.push(b'\n');
            }
            Some(b'-') => {
                old.extend_from_slice(&l[1..]);
                old.push(b'\n');
            }
            Some(b'+') => {
                new.extend_from_slice(&l[1..]);
                new.push(b'\n');
            }
            // "\ No newline at end of file": the line before has no line break.
            Some(b'\\') => {
                if last != b'+' {
                    old.pop();
                }
                if last != b'-' {
                    new.pop();
                }
                continue;
            }
            None => break, // the end of the output
            _ => return Err(format!("{STALE}: unexpected diff output")),
        }
        last = l[0];
    }
    if old != index {
        return Err(format!("{STALE}: the index changed"));
    }
    Ok(new)
}

fn editor_lines(text: &str) -> usize {
    text.matches('\n').count() + 1
}

const BINARY: &str = "This is a binary file (or UTF-16 text, which git treats as binary): only the whole file can be staged, unstaged or discarded.";
const MIXED: &str = "This file mixes line endings (or uses a filter) in a way that hides which line is which, so part of it can't be staged. Stage the whole file instead.";

/// Check and apply a patch (stdin) with `git apply <flags>`: whole or not at all.
fn apply(root: &Path, flags: &[&str], patch: Vec<u8>) -> Result<(), String> {
    let mut args = vec!["apply", "--whitespace=nowarn"];
    args.extend_from_slice(flags);
    let mut check = args.clone();
    check.push("--check");
    run(root, false, &check, Some(patch.clone()))?;
    run(root, false, &args, Some(patch)).map(|_| ())
}

/// Stage (`stage`), unstage (`unstage`) or discard (`discard`) the picked lines of `path`.
/// `orig`: the file's path in HEAD when it is a staged rename. Nothing is changed unless both
/// texts the comparison showed (`expect`) are still what git and the disk have.
pub fn apply_lines(root: &Path, path: &str, mode: &str, picks: &[LinePick], expect: &Expected, orig: Option<&str>) -> Result<(), String> {
    let rel = rel_path(root, path)?;
    if picks.is_empty() {
        return Ok(());
    }
    let stale = |what: &str| format!("{STALE}: {what}");
    let index_spec = format!(":{rel}");
    // From here "left" / "right" are the comparison's sides, in git's own bytes.
    let (left, right, left_shown, right_shown): (Vec<u8>, Vec<u8>, String, String) = if mode == "unstage" {
        let head_spec = format!("HEAD:{}", match orig {
            Some(o) => rel_path(root, o)?,
            None => rel.clone(),
        });
        let index = blob(root, &index_spec)?.ok_or_else(|| stale("the file is no longer staged"))?;
        let head = blob(root, &head_spec)?;
        let head_shown = if head.is_some() { shown(root, &head_spec)? } else { String::new() };
        (head.unwrap_or_default(), index, head_shown, shown(root, &index_spec)?)
    } else if mode == "stage" || mode == "discard" {
        let index = blob(root, &index_spec)?.ok_or_else(|| stale("the file is not in the index"))?;
        let disk = std::fs::read(root.join(rel.replace('/', "\\"))).map_err(|_| stale("the file is gone"))?;
        if files::looks_binary(&disk) || files::looks_binary(&index) {
            return Err(BINARY.into());
        }
        let (enc, bom) = files::detect_encoding(&disk, expect.encoding.as_deref());
        let disk_shown = lf(&enc.decode_without_bom_handling(&disk[bom..]).0);
        // Compare before asking git for the converted file: an outdated picture stops here.
        let index_shown = shown(root, &index_spec)?;
        if text_hash(&index_shown) != expect.left || text_hash(&disk_shown) != expect.right {
            return Err(stale("the file or the index changed"));
        }
        let work = worktree_as_git(root, &rel, &index, editor_lines(&disk_shown))?;
        (index, work, index_shown, disk_shown)
    } else {
        return Err(format!("unknown mode {mode}"));
    };
    if text_hash(&left_shown) != expect.left || text_hash(&right_shown) != expect.right {
        return Err(stale("the file or the index changed"));
    }
    // What git calls binary (a NUL byte: UTF-16 text too) has no lines to pick here.
    let binary = |b: &[u8]| b[..b.len().min(8000)].contains(&0);
    if binary(&left) || binary(&right) {
        return Err(BINARY.into());
    }
    let (old, new) = (cm_lines(&left), cm_lines(&right));
    // The editor's line numbers must be git's: no lone CR line breaks, no filter adding lines.
    if old.len() != editor_lines(&left_shown) || new.len() != editor_lines(&right_shown) {
        return Err(MIXED.into());
    }
    let forward: Vec<(usize, usize, usize, usize)> = picks.iter().map(|p| (p.old_start, p.old_count, p.new_start, p.new_count)).collect();
    let backward: Vec<(usize, usize, usize, usize)> = picks.iter().map(|p| (p.new_start, p.new_count, p.old_start, p.old_count)).collect();
    match mode {
        // index → index with the picked lines of the working file.
        "stage" => match build_patch(&rel, &splice(&old, &new, &forward)?) {
            Some(patch) => apply(root, &["--cached"], patch),
            None => Ok(()),
        },
        // The patch that made the picked lines (from the version without them), taken back out
        // of the index (unstage) or of the working file (discard).
        _ => {
            let ops = splice(&new, &old, &backward)?;
            // A newly added file with nothing left staged: no longer in the index at all.
            if mode == "unstage" && blob(root, &format!("HEAD:{rel}"))?.is_none() && orig.is_none() && result_of(&ops).is_empty() {
                return unstage(root, &[path.to_string()]);
            }
            match build_patch(&rel, &invert(&ops)) {
                Some(patch) => apply(root, if mode == "unstage" { &["--cached", "-R"] } else { &["-R"] }, patch),
                None => Ok(()),
            }
        }
    }
}

#[tauri::command]
pub async fn git_apply_lines(root: String, path: String, mode: String, picks: Vec<LinePick>, expect: Expected, orig: Option<String>) -> Result<(), String> {
    blocking(move || apply_lines(Path::new(&root), &path, &mode, &picks, &expect, orig.as_deref())).await
}

#[cfg(test)]
mod tests {
    use super::super::tests::{git_ok, repo, write};
    use super::super::{run_text, show, status};
    use super::*;
    use std::path::PathBuf;

    fn pick(old_start: usize, old_count: usize, new_start: usize, new_count: usize) -> LinePick {
        LinePick { old_start, old_count, new_start, new_count }
    }

    /// What the comparison would show for the file's index (or HEAD) text and its working copy.
    fn seen(root: &Path, rel: &str, staged: bool) -> Expected {
        let p = root.join(rel).to_string_lossy().into_owned();
        let text = |rev: &str| lf(&show(&p, rev, None).unwrap().map(|b| b.text).unwrap_or_default());
        if staged {
            return Expected { left: text_hash(&text("HEAD")), right: text_hash(&text(":")), encoding: None };
        }
        let disk = std::fs::read(root.join(rel)).unwrap();
        let (enc, bom) = files::detect_encoding(&disk, None);
        Expected { left: text_hash(&text(":")), right: text_hash(&lf(&enc.decode_without_bom_handling(&disk[bom..]).0)), encoding: None }
    }

    fn go(root: &Path, rel: &str, mode: &str, picks: &[LinePick]) -> Result<(), String> {
        let p = root.join(rel).to_string_lossy().into_owned();
        apply_lines(root, &p, mode, picks, &seen(root, rel, mode == "unstage"), None)
    }

    /// The changed lines of a `git diff` (no headers), e.g. ["-three", "+THREE"].
    fn diff(root: &Path, cached: bool, rel: &str) -> Vec<String> {
        let mut args = vec!["diff", "--no-color", "-U0"];
        if cached {
            args.push("--cached");
        }
        args.extend_from_slice(&["--", rel]);
        let out = run(root, true, &args, None).unwrap();
        String::from_utf8_lossy(&out)
            .split('\n')
            .filter(|l| (l.starts_with('+') || l.starts_with('-')) && !l.starts_with("+++") && !l.starts_with("---"))
            .map(str::to_string)
            .collect()
    }

    fn numbered(n: usize, eol: &str) -> String {
        (1..=n).map(|i| format!("line {i}{eol}")).collect()
    }

    /// A committed file of `n` lines, then edited: lines 3, 20 and 40 changed.
    fn three_changes(eol: &str) -> Option<(tempfile::TempDir, PathBuf, String)> {
        let (d, root) = repo()?;
        let p = write(&root, "app.ts", &numbered(50, eol));
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "init"]);
        let edited = numbered(50, eol).replace(&format!("line 3{eol}"), &format!("THREE{eol}")).replace(&format!("line 20{eol}"), &format!("TWENTY{eol}")).replace(&format!("line 40{eol}"), &format!("FORTY{eol}"));
        std::fs::write(&p, &edited).unwrap();
        Some((d, root, p))
    }

    #[test]
    fn patch_for_one_changed_line_has_three_lines_of_context() {
        let old = b"a\nb\nc\nd\ne\nf\ng\nh\ni\n";
        let new = b"a\nb\nc\nd\nE\nf\ng\nh\ni\n";
        let ops = splice(&cm_lines(old), &cm_lines(new), &[(5, 1, 5, 1)]).unwrap();
        assert_eq!(result_of(&ops), new);
        let patch = String::from_utf8(build_patch("dir/my file.txt", &ops).unwrap()).unwrap();
        assert_eq!(patch, "diff --git a/dir/my file.txt b/dir/my file.txt\n--- a/dir/my file.txt\t\n+++ b/dir/my file.txt\t\n@@ -2,7 +2,7 @@\n b\n c\n d\n-e\n+E\n f\n g\n h\n");
        // Nothing picked: no patch.
        assert!(build_patch("x", &splice(&cm_lines(old), &cm_lines(new), &[]).unwrap()).is_none());
        // A range outside the file is refused.
        assert!(splice(&cm_lines(old), &cm_lines(new), &[(11, 1, 5, 1)]).unwrap_err().starts_with(STALE));
    }

    #[test]
    fn patch_marks_a_missing_final_newline_and_empty_sides() {
        let p = |old: &[u8], new: &[u8], picks: &[(usize, usize, usize, usize)]| {
            let ops = splice(&cm_lines(old), &cm_lines(new), picks).unwrap();
            assert_eq!(result_of(&ops), new);
            String::from_utf8(build_patch("f", &ops).unwrap()).unwrap().split_once("+++ b/f\n").unwrap().1.to_string()
        };
        // Last line changed, no final newline on either side.
        assert_eq!(p(b"a\nb", b"a\nB", &[(2, 1, 2, 1)]), "@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+B\n\\ No newline at end of file\n");
        // A final newline added (the editor shows a new empty last line), and removed.
        assert_eq!(p(b"a\nb", b"a\nb\n", &[(2, 1, 2, 2)]), "@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+b\n");
        assert_eq!(p(b"a\nb\n", b"a\nb", &[(2, 2, 2, 1)]), "@@ -1,2 +1,2 @@\n a\n-b\n+b\n\\ No newline at end of file\n");
        // A line appended after a last line that had no newline: that line gains one.
        assert_eq!(p(b"a\nb", b"a\nb\nc", &[(3, 0, 3, 1)]), "@@ -1,2 +1,3 @@\n a\n-b\n\\ No newline at end of file\n+b\n+c\n\\ No newline at end of file\n");
        // From and to an empty file.
        assert_eq!(p(b"", b"a\nb\n", &[(1, 0, 1, 2)]), "@@ -0,0 +1,2 @@\n+a\n+b\n");
        assert_eq!(p(b"a\nb\n", b"", &[(1, 2, 1, 0)]), "@@ -1,2 +0,0 @@\n-a\n-b\n");
        // First line.
        assert_eq!(p(b"a\nb\n", b"A\nb\n", &[(1, 1, 1, 1)]), "@@ -1,2 +1,2 @@\n-a\n+A\n b\n");
    }

    #[test]
    fn text_hash_matches_the_ui() {
        // The same vectors are in src/__tests__/gitHunks.test.ts.
        assert_eq!(text_hash(""), "0:811c9dc5:1505");
        assert_eq!(text_hash("héllo\n😀"), "8:ba263d42:8a1c51e4");
    }

    #[test]
    fn one_change_staged_one_discarded_one_left() {
        let Some((_d, root, p)) = three_changes("\n") else { return };
        // STAGE-001.2: stage the change at line 3.
        go(&root, "app.ts", "stage", &[pick(3, 1, 3, 1)]).unwrap();
        assert_eq!(diff(&root, true, "app.ts"), ["-line 3", "+THREE"]);
        assert_eq!(diff(&root, false, "app.ts"), ["-line 20", "+TWENTY", "-line 40", "+FORTY"]);
        assert!(std::fs::read_to_string(&p).unwrap().contains("THREE\n"));
        let st = status(&root).unwrap().unwrap();
        assert_eq!((st.files[0].index.as_str(), st.files[0].worktree.as_str()), ("M", "M"));
        // STAGE-001.6: discard the change at line 20 (the left side is now the staged text).
        go(&root, "app.ts", "discard", &[pick(20, 1, 20, 1)]).unwrap();
        assert_eq!(diff(&root, true, "app.ts"), ["-line 3", "+THREE"]);
        assert_eq!(diff(&root, false, "app.ts"), ["-line 40", "+FORTY"]);
        let text = std::fs::read_to_string(&p).unwrap();
        assert_eq!(text.lines().nth(19), Some("line 20"));
        assert!(text.contains("THREE\n") && text.contains("FORTY\n"));
        // STAGE-001.5: the last one.
        go(&root, "app.ts", "stage", &[pick(40, 1, 40, 1)]).unwrap();
        assert!(diff(&root, false, "app.ts").is_empty());
        // STAGE-002.2: unstage one of the two staged changes; the file is not touched.
        go(&root, "app.ts", "unstage", &[pick(40, 1, 40, 1)]).unwrap();
        assert_eq!(diff(&root, true, "app.ts"), ["-line 3", "+THREE"]);
        assert_eq!(diff(&root, false, "app.ts"), ["-line 40", "+FORTY"]);
        assert_eq!(std::fs::read_to_string(&p).unwrap(), text);
        // STAGE-002.3: and the other: nothing staged any more.
        go(&root, "app.ts", "unstage", &[pick(3, 1, 3, 1)]).unwrap();
        assert!(diff(&root, true, "app.ts").is_empty());
        assert_eq!(diff(&root, false, "app.ts"), ["-line 3", "+THREE", "-line 40", "+FORTY"]);
    }

    #[test]
    fn several_changes_are_staged_together() {
        let Some((_d, root, _p)) = three_changes("\n") else { return };
        go(&root, "app.ts", "stage", &[pick(3, 1, 3, 1), pick(20, 1, 20, 1)]).unwrap();
        assert_eq!(diff(&root, true, "app.ts"), ["-line 3", "+THREE", "-line 20", "+TWENTY"]);
        assert_eq!(diff(&root, false, "app.ts"), ["-line 40", "+FORTY"]);
    }

    #[test]
    fn some_lines_of_one_change() {
        let Some((_d, root)) = repo() else { return };
        let p = write(&root, "app.ts", &numbered(30, "\n"));
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "init"]);
        // Lines 10–15 added (after line 9), lines 20–22 of the original replaced line for line
        // (now 26–28), and the original 25–26 replaced by 5 lines (now 31–35).
        let mut lines: Vec<String> = (1..=30).map(|i| format!("line {i}")).collect();
        lines.splice(24..26, (1..=5).map(|i| format!("wide {i}")));
        lines.splice(19..22, ["P", "Q", "R"].map(String::from));
        lines.splice(9..9, (1..=6).map(|i| format!("added {i}")));
        std::fs::write(&p, lines.join("\n") + "\n").unwrap();

        // STAGE-004.1: lines 11–12 of the added block.
        go(&root, "app.ts", "stage", &[pick(10, 0, 11, 2)]).unwrap();
        assert_eq!(diff(&root, true, "app.ts"), ["+added 2", "+added 3"]);
        assert_eq!(diff(&root, false, "app.ts")[..4], ["+added 1", "+added 4", "+added 5", "+added 6"]);
        // STAGE-004.2: the middle line of the 3-for-3 block. The index now has 32 lines: the old
        // lines 20–22 are its 22–24, and the working file's are 26–28.
        go(&root, "app.ts", "stage", &[pick(23, 1, 27, 1)]).unwrap();
        assert_eq!(diff(&root, true, "app.ts"), ["+added 2", "+added 3", "-line 21", "+Q"]);
        // STAGE-004.3: two of the five lines that replaced two: the old block goes, those two come.
        go(&root, "app.ts", "stage", &[pick(27, 2, 31, 2)]).unwrap();
        assert_eq!(diff(&root, true, "app.ts"), ["+added 2", "+added 3", "-line 21", "+Q", "-line 25", "-line 26", "+wide 1", "+wide 2"]);
        let rest = diff(&root, false, "app.ts");
        assert!(rest.ends_with(&["+wide 3".to_string(), "+wide 4".into(), "+wide 5".into()]), "{rest:?}");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), lines.join("\n") + "\n");

        // STAGE-004.6: unstage one of the two staged added lines (staged line 11 = "added 3").
        go(&root, "app.ts", "unstage", &[pick(10, 0, 11, 1)]).unwrap();
        assert_eq!(diff(&root, true, "app.ts")[..2], ["+added 2", "-line 21"]);
        // STAGE-004.7: discard two of the added lines from the file ("added 5", "added 6").
        // The index has "added 2" at line 10; the working file has the six at 10–15.
        go(&root, "app.ts", "discard", &[pick(11, 0, 14, 2)]).unwrap();
        let text = std::fs::read_to_string(&p).unwrap();
        assert!(!text.contains("added 5") && !text.contains("added 6") && text.contains("added 4\nline 10\n"));
        assert_eq!(diff(&root, true, "app.ts")[..2], ["+added 2", "-line 21"]);
    }

    #[test]
    fn removed_lines_are_staged_and_put_back() {
        let Some((_d, root)) = repo() else { return };
        let p = write(&root, "app.ts", &numbered(30, "\n"));
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "init"]);
        let mut lines: Vec<String> = (1..=30).map(|i| format!("line {i}")).collect();
        lines.drain(19..23); // 4 lines removed after line 19
        std::fs::write(&p, lines.join("\n") + "\n").unwrap();
        go(&root, "app.ts", "stage", &[pick(20, 4, 20, 0)]).unwrap();
        assert_eq!(diff(&root, true, "app.ts"), ["-line 20", "-line 21", "-line 22", "-line 23"]);
        assert!(diff(&root, false, "app.ts").is_empty());
        go(&root, "app.ts", "unstage", &[pick(20, 4, 20, 0)]).unwrap();
        assert!(diff(&root, true, "app.ts").is_empty());
        // STAGE-003.6: discarding the removal puts the 4 lines back.
        go(&root, "app.ts", "discard", &[pick(20, 4, 20, 0)]).unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), numbered(30, "\n"));
    }

    #[test]
    fn a_crlf_file_keeps_its_line_endings() {
        // STAGE-006.1 / .3: committed with CRLF.
        let Some((_d, root, p)) = three_changes("\r\n") else { return };
        let before = std::fs::read(&p).unwrap();
        go(&root, "app.ts", "stage", &[pick(3, 1, 3, 1)]).unwrap();
        assert_eq!(diff(&root, true, "app.ts"), ["-line 3\r", "+THREE\r"]);
        assert_eq!(std::fs::read(&p).unwrap(), before);
        let staged = run(&root, true, &["cat-file", "blob", ":app.ts"], None).unwrap();
        assert_eq!(staged.iter().filter(|b| **b == b'\n').count(), 50);
        assert_eq!(staged.windows(2).filter(|w| w == b"\r\n").count(), 50);
        go(&root, "app.ts", "discard", &[pick(20, 1, 20, 1)]).unwrap();
        let after = std::fs::read(&p).unwrap();
        assert_eq!(after.windows(2).filter(|w| w == b"\r\n").count(), 50);
        assert_eq!(after.iter().filter(|b| **b == b'\n').count(), 50);
        assert_eq!(diff(&root, false, "app.ts"), ["-line 40\r", "+FORTY\r"]);
    }

    #[test]
    fn crlf_on_disk_and_lf_in_the_repository() {
        // STAGE-006.2: core.autocrlf = true.
        let Some((_d, root)) = repo() else { return };
        git_ok(&root, &["config", "core.autocrlf", "true"]);
        let p = write(&root, "win.txt", &numbered(50, "\r\n"));
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "init"]);
        let head = run(&root, true, &["cat-file", "blob", "HEAD:win.txt"], None).unwrap();
        assert!(!head.contains(&b'\r'), "the commit holds LF");
        let edited = numbered(50, "\r\n").replace("line 3\r\n", "THREE\r\n").replace("line 20\r\n", "TWENTY\r\n").replace("line 40\r\n", "FORTY\r\nand more\r\n");
        std::fs::write(&p, &edited).unwrap();
        go(&root, "win.txt", "stage", &[pick(3, 1, 3, 1)]).unwrap();
        go(&root, "win.txt", "discard", &[pick(20, 1, 20, 1)]).unwrap();
        assert_eq!(diff(&root, true, "win.txt"), ["-line 3", "+THREE"]);
        assert_eq!(diff(&root, false, "win.txt"), ["-line 40", "+FORTY", "+and more"]);
        let index = run(&root, true, &["cat-file", "blob", ":win.txt"], None).unwrap();
        assert!(!index.contains(&b'\r'), "the index holds LF");
        let disk = std::fs::read(&p).unwrap();
        assert_eq!(disk.iter().filter(|b| **b == b'\n').count(), 51);
        assert_eq!(disk.windows(2).filter(|w| w == b"\r\n").count(), 51);
        assert!(String::from_utf8_lossy(&disk).contains("line 20\r\n"));
        // One line of the two that replaced line 40.
        go(&root, "win.txt", "stage", &[pick(40, 1, 41, 1)]).unwrap();
        assert_eq!(diff(&root, true, "win.txt"), ["-line 3", "+THREE", "-line 40", "+and more"]);
    }

    #[test]
    fn the_end_of_the_file_is_kept_as_it_is() {
        let Some((_d, root)) = repo() else { return };
        // STAGE-006.4: no final newline, last line changed.
        let p = write(&root, "app.ts", "one\ntwo\nthree");
        let q = write(&root, "nl.ts", "one\ntwo");
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "init"]);
        std::fs::write(&p, "ONE\ntwo\nTHREE").unwrap();
        go(&root, "app.ts", "stage", &[pick(3, 1, 3, 1)]).unwrap();
        assert_eq!(run(&root, true, &["cat-file", "blob", ":app.ts"], None).unwrap(), b"one\ntwo\nTHREE");
        assert_eq!(diff(&root, false, "app.ts"), ["-one", "+ONE"]);
        // STAGE-006.7: and the first line is discarded.
        go(&root, "app.ts", "discard", &[pick(1, 1, 1, 1)]).unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"one\ntwo\nTHREE");
        // STAGE-006.5: only a final newline was added (the editor: line 2 became lines 2–3).
        std::fs::write(&q, "one\ntwo\n").unwrap();
        go(&root, "nl.ts", "stage", &[pick(2, 1, 2, 2)]).unwrap();
        assert_eq!(run(&root, true, &["cat-file", "blob", ":nl.ts"], None).unwrap(), b"one\ntwo\n");
        assert!(diff(&root, false, "nl.ts").is_empty());
        // ...and unstaged again.
        go(&root, "nl.ts", "unstage", &[pick(2, 1, 2, 2)]).unwrap();
        assert_eq!(run(&root, true, &["cat-file", "blob", ":nl.ts"], None).unwrap(), b"one\ntwo");
    }

    #[test]
    fn legacy_encodings_and_a_bom_are_staged_byte_for_byte() {
        let Some((_d, root)) = repo() else { return };
        // STAGE-006.6: Windows-1252 ("é" is the single byte E9), and UTF-8 with a BOM.
        let latin = root.join("latin.txt");
        std::fs::write(&latin, b"un caf\xe9 noir\nligne deux\nligne trois\n").unwrap();
        let bom = root.join("bom.txt");
        std::fs::write(&bom, b"\xef\xbb\xbffirst\nsecond\n").unwrap();
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "init"]);
        std::fs::write(&latin, b"un caf\xe9 cr\xe8me\nligne deux\nLIGNE TROIS\n").unwrap();
        std::fs::write(&bom, b"\xef\xbb\xbfFIRST\nsecond\nthird\n").unwrap();
        go(&root, "latin.txt", "stage", &[pick(1, 1, 1, 1)]).unwrap();
        assert_eq!(run(&root, true, &["cat-file", "blob", ":latin.txt"], None).unwrap(), b"un caf\xe9 cr\xe8me\nligne deux\nligne trois\n");
        go(&root, "bom.txt", "stage", &[pick(1, 1, 1, 1)]).unwrap();
        assert_eq!(run(&root, true, &["cat-file", "blob", ":bom.txt"], None).unwrap(), b"\xef\xbb\xbfFIRST\nsecond\n");
        go(&root, "bom.txt", "unstage", &[pick(1, 1, 1, 1)]).unwrap();
        go(&root, "bom.txt", "discard", &[pick(1, 1, 1, 1)]).unwrap();
        assert_eq!(std::fs::read(&bom).unwrap(), b"\xef\xbb\xbffirst\nsecond\nthird\n");
    }

    #[test]
    fn nothing_is_applied_on_an_outdated_picture() {
        let Some((_d, root, p)) = three_changes("\n") else { return };
        let was = seen(&root, "app.ts", false);
        // STAGE-009.1: the index changed (git add in a terminal).
        git_ok(&root, &["add", "app.ts"]);
        let err = apply_lines(&root, &p, "stage", &[pick(3, 1, 3, 1)], &was, None).unwrap_err();
        assert!(err.starts_with(STALE), "{err}");
        git_ok(&root, &["restore", "--staged", "app.ts"]);
        // STAGE-009.2: the file changed on disk.
        let was = seen(&root, "app.ts", false);
        let rewritten = std::fs::read_to_string(&p).unwrap().replace("line 10\n", "ten\n");
        std::fs::write(&p, &rewritten).unwrap();
        let err = apply_lines(&root, &p, "discard", &[pick(20, 1, 20, 1)], &was, None).unwrap_err();
        assert!(err.starts_with(STALE), "{err}");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), rewritten);
        assert!(diff(&root, true, "app.ts").is_empty());
        // STAGE-009.9: the file is gone.
        let was = seen(&root, "app.ts", false);
        std::fs::remove_file(&p).unwrap();
        let err = apply_lines(&root, &p, "stage", &[pick(3, 1, 3, 1)], &was, None).unwrap_err();
        assert!(err.starts_with(STALE), "{err}");
        // A staged comparison whose index moved on.
        std::fs::write(&p, &rewritten).unwrap();
        git_ok(&root, &["add", "app.ts"]);
        let was = seen(&root, "app.ts", true);
        git_ok(&root, &["restore", "--staged", "app.ts"]);
        let err = apply_lines(&root, &p, "unstage", &[pick(3, 1, 3, 1)], &was, None).unwrap_err();
        assert!(err.starts_with(STALE), "{err}");
    }

    #[test]
    fn a_patch_that_does_not_fit_changes_nothing() {
        // STAGE-009.8: lines that are not what the hashes describe can't happen through the UI;
        // a range past the end is the nearest thing, and must leave the index alone.
        let Some((_d, root, _p)) = three_changes("\n") else { return };
        let err = go(&root, "app.ts", "stage", &[pick(3, 1, 3, 1), pick(20, 1, 20, 1), pick(60, 1, 60, 1)]).unwrap_err();
        assert!(err.starts_with(STALE), "{err}");
        assert!(diff(&root, true, "app.ts").is_empty());
    }

    #[test]
    fn a_file_already_staged_and_a_new_file() {
        let Some((_d, root)) = repo() else { return };
        let p = write(&root, "app.ts", &numbered(30, "\n"));
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "init"]);
        // STAGE-001.8: staged whole, then edited in two more places.
        std::fs::write(&p, numbered(30, "\n").replace("line 5\n", "FIVE\n")).unwrap();
        git_ok(&root, &["add", "."]);
        std::fs::write(&p, numbered(30, "\n").replace("line 5\n", "FIVE\n").replace("line 15\n", "FIFTEEN\n").replace("line 25\n", "TWENTY-FIVE\n")).unwrap();
        go(&root, "app.ts", "stage", &[pick(15, 1, 15, 1)]).unwrap();
        assert_eq!(diff(&root, true, "app.ts"), ["-line 5", "+FIVE", "-line 15", "+FIFTEEN"]);
        assert_eq!(diff(&root, false, "app.ts"), ["-line 25", "+TWENTY-FIVE"]);
        // STAGE-003.5: discard goes back to the staged version, not to the commit.
        go(&root, "app.ts", "discard", &[pick(25, 1, 25, 1)]).unwrap();
        assert!(std::fs::read_to_string(&p).unwrap().contains("FIVE\n"));
        assert!(diff(&root, false, "app.ts").is_empty());

        // STAGE-007.4: a new file, added, then edited again: its later edits stage in parts.
        let n = write(&root, "new file.ts", "a\nb\nc\n");
        git_ok(&root, &["add", "."]);
        std::fs::write(&n, "a\nB\nc\nd\n").unwrap();
        go(&root, "new file.ts", "stage", &[pick(4, 0, 4, 1)]).unwrap();
        assert_eq!(run(&root, true, &["cat-file", "blob", ":new file.ts"], None).unwrap(), b"a\nb\nc\nd\n");
        // Unstage one line of the new file: it stays added, without that line.
        go(&root, "new file.ts", "unstage", &[pick(1, 0, 4, 1)]).unwrap();
        assert_eq!(run(&root, true, &["cat-file", "blob", ":new file.ts"], None).unwrap(), b"a\nb\nc\n");
        // STAGE-002.5: unstage its whole text: untracked again, still on disk.
        go(&root, "new file.ts", "unstage", &[pick(1, 0, 1, 3)]).unwrap();
        let st = status(&root).unwrap().unwrap();
        assert!(st.files.iter().any(|f| f.path.ends_with("new file.ts") && f.untracked));
        assert_eq!(std::fs::read_to_string(&n).unwrap(), "a\nB\nc\nd\n");
    }

    #[test]
    fn utf16_text_is_refused_as_binary() {
        let Some((_d, root)) = repo() else { return };
        let utf16 = |text: &str| -> Vec<u8> { [0xFF, 0xFE].into_iter().chain(text.encode_utf16().flat_map(|u| u.to_le_bytes())).collect() };
        let p = root.join("wide.txt");
        std::fs::write(&p, utf16("one
two
")).unwrap();
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "init"]);
        std::fs::write(&p, utf16("ONE
two
")).unwrap();
        let err = go(&root, "wide.txt", "stage", &[pick(1, 1, 1, 1)]).unwrap_err();
        assert!(err.contains("binary"), "{err}");
        git_ok(&root, &["add", "."]);
        let err = go(&root, "wide.txt", "unstage", &[pick(1, 1, 1, 1)]).unwrap_err();
        assert!(err.contains("binary"), "{err}");
        assert_eq!(run_text(&root, true, &["status", "--porcelain"]).unwrap().trim(), "M  wide.txt");
    }

    #[test]
    fn a_staged_rename_keeps_its_other_change() {
        // STAGE-002.6
        let Some((_d, root)) = repo() else { return };
        let old = write(&root, "old.ts", &numbered(30, "\n"));
        git_ok(&root, &["add", "."]);
        git_ok(&root, &["commit", "-qm", "init"]);
        git_ok(&root, &["mv", "old.ts", "new.ts"]);
        let new = root.join("new.ts");
        std::fs::write(&new, numbered(30, "\n").replace("line 5\n", "FIVE\n").replace("line 25\n", "TWENTY-FIVE\n")).unwrap();
        git_ok(&root, &["add", "."]);
        let p = new.to_string_lossy().into_owned();
        let text = |spec: &str| lf(&String::from_utf8(run(&root, true, &["cat-file", "blob", spec], None).unwrap()).unwrap());
        let expect = Expected { left: text_hash(&text("HEAD:old.ts")), right: text_hash(&text(":new.ts")), encoding: None };
        apply_lines(&root, &p, "unstage", &[pick(25, 1, 25, 1)], &expect, Some(&old)).unwrap();
        let st = run_text(&root, true, &["status", "--porcelain"]).unwrap();
        assert!(st.contains("RM old.ts -> new.ts"), "{st}");
        assert_eq!(diff(&root, false, "new.ts"), ["-line 25", "+TWENTY-FIVE"]);
        assert!(text(":new.ts").contains("FIVE\n") && text(":new.ts").contains("line 25\n"));
    }
}
