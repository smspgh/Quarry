//! Find / replace across directories, built on ripgrep's crates.

use grep_matcher::Matcher;
use grep_regex::RegexMatcherBuilder;
use grep_searcher::{BinaryDetection, Searcher, SearcherBuilder, Sink, SinkMatch};
use ignore::overrides::OverrideBuilder;
use ignore::WalkBuilder;
use crate::files;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
    pub pattern: String,
    pub is_regex: bool,
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub multiline: bool,
    pub dot_all: bool,
    pub include: Vec<String>,
    pub exclude: Vec<String>,
    pub respect_gitignore: bool,
    pub max_results: usize,
    /// Replace only: match the case of each replaced text (FOO → BAR, Foo → Bar, foo → bar).
    #[serde(default)]
    pub preserve_case: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileMatch {
    pub path: String,
    pub line: u64,
    pub col: u64,
    pub len: u64,
    pub preview: String,
    pub preview_col: u64,
    /// The preview starts partway through the line (text before it was left out).
    pub preview_cut: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchDone {
    pub search_id: u32,
    pub files_searched: usize,
    pub matches: usize,
    pub truncated: bool,
    pub cancelled: bool,
}

/// The regex source of the query. In plain-text mode a line break (typed with Ctrl+Enter) matches
/// both LF and CRLF line ends, so a multi-line search finds its text in Windows files too.
fn pattern_source(q: &SearchQuery) -> String {
    if q.is_regex {
        q.pattern.clone()
    } else {
        regex::escape(&q.pattern.replace("\r\n", "\n")).replace('\n', r"\r?\n")
    }
}

pub fn build_matcher(q: &SearchQuery) -> Result<grep_regex::RegexMatcher, String> {
    let pattern = pattern_source(q);
    RegexMatcherBuilder::new()
        .case_insensitive(!q.case_sensitive)
        .word(q.whole_word)
        .multi_line(true)
        .dot_matches_new_line(q.dot_all)
        .build(&pattern)
        .map_err(|e| e.to_string())
}

/// Collapse the multi-line `regex` parse error into a single line ("error: ..." part when present).
pub fn one_line_regex_error(e: &str) -> String {
    let lines: Vec<&str> = e.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    if let Some(l) = lines.iter().rev().find(|l| l.starts_with("error: ")) {
        return l["error: ".len()..].to_string();
    }
    lines.join(" ")
}

/// Validate a pattern with the same engine and flags the search uses. `Ok(())` when it compiles.
pub fn validate_regex(pattern: &str, case_sensitive: bool, whole_word: bool, dot_all: bool) -> Result<(), String> {
    let q = SearchQuery {
        pattern: pattern.to_string(),
        is_regex: true,
        case_sensitive,
        whole_word,
        multiline: true,
        dot_all,
        include: vec![],
        exclude: vec![],
        respect_gitignore: false,
        max_results: 1,
        preserve_case: false,
    };
    build_matcher(&q).map(|_| ()).map_err(|e| one_line_regex_error(&e))
}

/// Flush a partial batch when it is large enough or has been pending for a while, so a single
/// huge file streams progressively instead of jumping from 0 to its full count at the end.
pub const BATCH_MAX: usize = 200;
/// Matches listed from one matching block (a line, or the lines one multi-line match spans), so a
/// minified one-line file cannot flood the results; the rest of that block is not listed or counted.
pub const BLOCK_MATCH_CAP: usize = 1000;
pub const BATCH_INTERVAL: Duration = Duration::from_millis(100);

pub fn should_flush(len: usize, since_last: Duration) -> bool {
    len > 0 && (len >= BATCH_MAX || since_last >= BATCH_INTERVAL)
}

fn build_searcher(q: &SearchQuery) -> Searcher {
    SearcherBuilder::new()
        .line_number(true)
        .multi_line(q.multiline)
        .binary_detection(BinaryDetection::quit(0))
        .build()
}

struct Batcher<'a> {
    buf: Vec<FileMatch>,
    last_flush: Instant,
    emit: &'a dyn Fn(Vec<FileMatch>),
}

impl Batcher<'_> {
    fn push(&mut self, m: FileMatch) {
        self.buf.push(m);
        if should_flush(self.buf.len(), self.last_flush.elapsed()) {
            self.flush();
        }
    }
    fn flush(&mut self) {
        if !self.buf.is_empty() {
            (self.emit)(std::mem::take(&mut self.buf));
        }
        self.last_flush = Instant::now();
    }
}

struct CollectSink<'a, 'b> {
    matcher: &'a grep_regex::RegexMatcher,
    path: String,
    /// Encoding of a file that is not UTF-8, detected when its first such match is found, so
    /// previews and columns read as they do in the editor (`None` = not looked at yet).
    legacy: Option<&'static encoding_rs::Encoding>,
    out: &'a mut Batcher<'b>,
    count: &'a AtomicUsize,
    max: usize,
}

impl Sink for CollectSink<'_, '_> {
    type Error = std::io::Error;

    fn matched(&mut self, _s: &Searcher, mat: &SinkMatch<'_>) -> Result<bool, Self::Error> {
        let bytes = mat.bytes();
        if self.legacy.is_none() && std::str::from_utf8(bytes).is_err() {
            self.legacy = Some(file_encoding(Path::new(&self.path)));
        }
        let enc = self.legacy.unwrap_or(encoding_rs::UTF_8);
        let base_line = mat.line_number().unwrap_or(1);
        let mut found_any = false;
        let mut seen: usize = 0;
        let _ = self.matcher.find_iter(bytes, |m| {
            found_any = true;
            if self.count.load(Ordering::Relaxed) >= self.max {
                return false;
            }
            // Resolve line/col of the match within the (possibly multi-line) block.
            let before = &bytes[..m.start()];
            let line_off = memchr::memchr_iter(b'\n', before).count() as u64;
            let line_start = memchr::memrchr(b'\n', before).map(|i| i + 1).unwrap_or(0);
            let line_end = memchr::memchr(b'\n', &bytes[m.start()..]).map(|i| m.start() + i).unwrap_or(bytes.len());
            let mut pstart = if m.start() - line_start > 40 { m.start() - 40 } else { line_start };
            // Do not start the preview inside a UTF-8 sequence.
            while pstart > line_start && (bytes[pstart] & 0xc0) == 0x80 {
                pstart -= 1;
            }
            let pend = (pstart + 400).min(line_end).max(pstart);
            let pv = &bytes[pstart..pend];
            let pv = pv.strip_suffix(b"\r").unwrap_or(pv);
            // Columns and lengths are in UTF-16 units: the editor and the preview index JS strings.
            self.out.push(FileMatch {
                path: self.path.clone(),
                line: base_line + line_off,
                col: utf16_len(enc, &bytes[line_start..m.start()]),
                len: utf16_len(enc, &bytes[m.start()..m.end()]),
                preview: enc.decode_without_bom_handling(pv).0.into_owned(),
                preview_col: utf16_len(enc, &bytes[pstart..m.start()]),
                preview_cut: pstart > line_start,
            });
            self.count.fetch_add(1, Ordering::Relaxed);
            seen += 1;
            seen < BLOCK_MATCH_CAP
        });
        if !found_any {
            // Shouldn't happen, but keep the line as a match so nothing is silently lost.
            self.out.push(FileMatch {
                path: self.path.clone(),
                line: base_line,
                col: 0,
                len: 0,
                preview: String::from_utf8_lossy(bytes).trim_end().chars().take(400).collect(),
                preview_col: 0,
                preview_cut: false,
            });
            self.count.fetch_add(1, Ordering::Relaxed);
        }
        Ok(self.count.load(Ordering::Relaxed) < self.max)
    }
}

/// Length in UTF-16 code units of `b` decoded with `enc` (invalid bytes count as U+FFFD).
fn utf16_len(enc: &'static encoding_rs::Encoding, b: &[u8]) -> u64 {
    if b.is_ascii() {
        return b.len() as u64;
    }
    enc.decode_without_bom_handling(b).0.encode_utf16().count() as u64
}

/// The encoding the editor would open `path` with (detected from its first MB). UTF-16 files are
/// already transcoded to UTF-8 by the searcher, which is what the detection then reports.
fn file_encoding(path: &Path) -> &'static encoding_rs::Encoding {
    use std::io::Read;
    let mut head = Vec::new();
    if let Ok(f) = std::fs::File::open(path) {
        let _ = f.take(1 << 20).read_to_end(&mut head);
    }
    match files::detect_encoding(&head, None).0 {
        e if e == encoding_rs::UTF_16LE || e == encoding_rs::UTF_16BE => encoding_rs::UTF_8,
        e => e,
    }
}

fn walker(roots: &[String], q: &SearchQuery) -> Result<ignore::Walk, String> {
    let mut wb = WalkBuilder::new(&roots[0]);
    for r in &roots[1..] {
        wb.add(r);
    }
    wb.hidden(false)
        .git_ignore(q.respect_gitignore)
        .git_global(q.respect_gitignore)
        .git_exclude(q.respect_gitignore)
        .ignore(q.respect_gitignore)
        .follow_links(false);
    let mut ob = OverrideBuilder::new(&roots[0]);
    for inc in &q.include {
        let inc = inc.trim();
        if !inc.is_empty() {
            ob.add(inc).map_err(|e| format!("bad include glob '{inc}': {e}"))?;
        }
    }
    for exc in &q.exclude {
        let exc = exc.trim();
        if !exc.is_empty() {
            ob.add(&format!("!{exc}")).map_err(|e| format!("bad exclude glob '{exc}': {e}"))?;
        }
    }
    // Always skip obvious noise unless the user explicitly included it.
    if q.include.iter().all(|s| s.trim().is_empty()) {
        for noise in ["!**/.git/**", "!**/node_modules/**", "!**/target/**"] {
            ob.add(noise).ok();
        }
    }
    wb.overrides(ob.build().map_err(|e| e.to_string())?);
    Ok(wb.build())
}

/// Walk `roots`, stream matches in batches through `emit`, and return a summary.
pub fn search_paths<F>(search_id: u32, roots: &[String], q: &SearchQuery, cancel: Arc<AtomicBool>, emit: F) -> Result<SearchDone, String>
where
    F: Fn(Vec<FileMatch>),
{
    if roots.is_empty() {
        return Err("no search roots".into());
    }
    let matcher = build_matcher(q).map_err(|e| one_line_regex_error(&e))?;
    let mut searcher = build_searcher(q);
    let count = AtomicUsize::new(0);
    let mut files = 0usize;
    let mut batch = Batcher { buf: Vec::new(), last_flush: Instant::now(), emit: &emit };
    let mut cancelled = false;
    for ent in walker(roots, q)? {
        if cancel.load(Ordering::Relaxed) {
            cancelled = true;
            break;
        }
        if count.load(Ordering::Relaxed) >= q.max_results {
            break;
        }
        let ent = match ent {
            Ok(e) => e,
            Err(_) => continue,
        };
        if !ent.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        files += 1;
        let path_str = ent.path().to_string_lossy().into_owned();
        let sink = CollectSink { matcher: &matcher, path: path_str, legacy: None, out: &mut batch, count: &count, max: q.max_results };
        let _ = searcher.search_path(&matcher, ent.path(), sink);
    }
    batch.flush();
    let matches = count.load(Ordering::Relaxed);
    Ok(SearchDone { search_id, files_searched: files, matches, truncated: matches >= q.max_results, cancelled })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceFileResult {
    pub path: String,
    pub replaced: usize,
    pub error: Option<String>,
    /// Copy of the original bytes (in the undo folder), when the file was changed and backed up.
    pub backup: Option<String>,
    /// Digest of the bytes written, so undo can tell whether the file changed since.
    pub digest: Option<String>,
}

/// One file to restore by `undo_replace`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoEntry {
    pub path: String,
    pub backup: String,
    pub digest: String,
}

/// Files larger than this are skipped (with an error entry) by `replace_in_files`.
pub const REPLACE_MAX_BYTES: u64 = 256 << 20;
/// Total size of the originals kept for undo; files past the budget are replaced without a backup.
pub const UNDO_BUDGET_BYTES: u64 = 1 << 30;

pub fn digest(data: &[u8]) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    data.len().hash(&mut h);
    data.hash(&mut h);
    format!("{:016x}", h.finish())
}

fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    let dir = path.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let mut tmp = tempfile::Builder::new().prefix(".quarry-").tempfile_in(dir).map_err(|e| e.to_string())?;
    std::io::Write::write_all(&mut tmp, data).map_err(|e| e.to_string())?;
    tmp.persist(path).map_err(|e| e.error.to_string())?;
    Ok(())
}

/// A file for `replace_in_files`, with the matches the user left out of the replace: 1-based
/// line and 0-based column in UTF-16 units, as the search reported them.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceTarget {
    pub path: String,
    #[serde(default)]
    pub skip: Vec<(u64, u64)>,
    /// When the search that found the matches started (ms since the epoch). A file modified after
    /// that is left alone: its matches (and the skip positions) may no longer be where they were.
    #[serde(default)]
    pub searched_ms: Option<u64>,
}

fn modified_ms(m: &std::fs::Metadata) -> Option<u64> {
    m.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_millis() as u64)
}

/// `replacement` in the case of `matched`: all capitals, all lower case, or a leading capital.
/// Anything else (mixed case, no letters) leaves the replacement as typed.
pub fn preserve_case(matched: &str, replacement: &str) -> String {
    let letters: Vec<char> = matched.chars().filter(|c| c.is_alphabetic()).collect();
    if letters.is_empty() {
        return replacement.to_string();
    }
    if letters.len() > 1 && letters.iter().all(|c| !c.is_lowercase()) {
        return replacement.to_uppercase();
    }
    if letters.iter().all(|c| !c.is_uppercase()) {
        return replacement.to_lowercase();
    }
    if letters[0].is_uppercase() {
        let mut it = replacement.chars();
        return match it.next() {
            Some(f) => f.to_uppercase().chain(it).collect(),
            None => String::new(),
        };
    }
    replacement.to_string()
}

/// One piece of a parsed replacement string.
#[derive(Debug, PartialEq)]
pub enum RepPart {
    Lit(String),
    Group(usize),
    Named(String),
    /// `` $` ``: the text before the match.
    Before,
    /// `$'`: the text after the match.
    After,
}

/// Parse a replacement with JavaScript's `$` rules (`$$`, `$&`, `` $` ``, `$'`, `$1`–`$99`,
/// `$<name>`), the same rules the preview and open-document replace use (`expandReplacement` in
/// replace.ts). The regex crate's own `expand` differs (`$1x` is a group named "1x", `$&` is
/// literal), which made the preview and the files on disk disagree. `groups` counts group 0.
pub fn parse_replacement(rep: &str, groups: usize, has_names: bool) -> Vec<RepPart> {
    let mut parts = Vec::new();
    let mut lit = String::new();
    let b = rep.as_bytes();
    let mut i = 0;
    let flush = |lit: &mut String, parts: &mut Vec<RepPart>| {
        if !lit.is_empty() {
            parts.push(RepPart::Lit(std::mem::take(lit)));
        }
    };
    while i < b.len() {
        if b[i] != b'$' || i + 1 >= b.len() {
            let ch = rep[i..].chars().next().expect("i is on a char boundary");
            lit.push(ch);
            i += ch.len_utf8();
            continue;
        }
        let special = match b[i + 1] {
            b'$' => {
                lit.push('$');
                i += 2;
                continue;
            }
            b'&' => Some((RepPart::Group(0), 2)),
            b'`' => Some((RepPart::Before, 2)),
            b'\'' => Some((RepPart::After, 2)),
            b'<' if has_names => rep[i + 2..].find('>').map(|close| (RepPart::Named(rep[i + 2..i + 2 + close].to_string()), close + 3)),
            d @ b'0'..=b'9' => {
                let d1 = (d - b'0') as usize;
                let two = b.get(i + 2).filter(|c| c.is_ascii_digit()).map(|c| d1 * 10 + (c - b'0') as usize);
                match two.filter(|n| (1..groups).contains(n)) {
                    Some(n) => Some((RepPart::Group(n), 3)),
                    // "$12" with fewer groups is "$1" then "2".
                    None if (1..groups).contains(&d1) => Some((RepPart::Group(d1), 2)),
                    None => None,
                }
            }
            _ => None,
        };
        match special {
            Some((part, len)) => {
                flush(&mut lit, &mut parts);
                parts.push(part);
                i += len;
            }
            None => {
                lit.push('$');
                i += 1;
            }
        }
    }
    flush(&mut lit, &mut parts);
    parts
}

/// Expand parsed `parts` for one match. `group(i)` / `named(n)` return the group's text (empty when
/// it did not take part); `before` / `after` are the text around the match.
pub fn expand_replacement<'t>(parts: &[RepPart], group: impl Fn(usize) -> &'t [u8], named: impl Fn(&str) -> &'t [u8], before: &[u8], after: &[u8], out: &mut Vec<u8>) {
    for p in parts {
        match p {
            RepPart::Lit(s) => out.extend_from_slice(s.as_bytes()),
            RepPart::Group(i) => out.extend_from_slice(group(*i)),
            RepPart::Named(n) => out.extend_from_slice(named(n)),
            RepPart::Before => out.extend_from_slice(before),
            RepPart::After => out.extend_from_slice(after),
        }
    }
}

/// Replace every match of `re` in `text` except those at a `skip` position. `literal` takes the
/// replacement as plain text; otherwise `$1` / `$<name>` refer to capture groups (`parse_replacement`). Returns the new
/// text and the number of replacements.
pub fn replace_text(text: &str, re: &regex::Regex, replacement: &str, literal: bool, keep_case: bool, skip: &HashSet<(u64, u64)>) -> (String, usize) {
    let mut out = String::with_capacity(text.len());
    let mut last = 0usize;
    let mut n = 0usize;
    // Line / column of each match (only needed to honour `skip`), advanced incrementally.
    let (mut line, mut line_start, mut scanned) = (1u64, 0usize, 0usize);
    let (mut col_at, mut col) = (0usize, 0u64);
    let mut apply = |start: usize, end: usize, rep: String| {
        if !skip.is_empty() {
            for i in memchr::memchr_iter(b'\n', &text.as_bytes()[scanned..start]) {
                line += 1;
                line_start = scanned + i + 1;
            }
            scanned = start;
            if col_at < line_start {
                (col_at, col) = (line_start, 0);
            }
            col += text[col_at..start].encode_utf16().count() as u64;
            col_at = start;
            if skip.contains(&(line, col)) {
                return;
            }
        }
        out.push_str(&text[last..start]);
        if keep_case {
            out.push_str(&preserve_case(&text[start..end], &rep));
        } else {
            out.push_str(&rep);
        }
        last = end;
        n += 1;
    };
    if literal {
        for m in re.find_iter(text) {
            apply(m.start(), m.end(), replacement.to_string());
        }
    } else {
        let parts = parse_replacement(replacement, re.captures_len(), re.capture_names().any(|n| n.is_some()));
        for c in re.captures_iter(text) {
            let m = c.get(0).expect("group 0 always matches");
            let mut rep = Vec::new();
            let group = |i: usize| c.get(i).map_or(&b""[..], |g| g.as_str().as_bytes());
            let named = |n: &str| c.name(n).map_or(&b""[..], |g| g.as_str().as_bytes());
            expand_replacement(&parts, group, named, text[..m.start()].as_bytes(), text[m.end()..].as_bytes(), &mut rep);
            apply(m.start(), m.end(), String::from_utf8(rep).expect("pieces of str and the replacement are UTF-8"));
        }
    }
    out.push_str(&text[last..]);
    (out, n)
}

/// Readable form of an `encode_text` refusal.
fn encode_error(e: String) -> String {
    match e.strip_prefix(files::UNMAPPABLE_PREFIX).map(|r| r.split('\t').collect::<Vec<_>>()) {
        Some(p) if p.len() == 4 => format!("{} cannot store \u{201c}{}\u{201d} (line {}); file left unchanged", p[3], p[1], p[2]),
        _ => e,
    }
}

/// Replace in the given files (whole-file regex replace so multi-line patterns work). Each file is
/// decoded in its own encoding (its BOM, else detected as when it is opened) and written back in
/// that encoding; a file that does not decode cleanly, or whose result the encoding cannot store,
/// is left unchanged and reported. With a `backup_dir`, the original of every changed file is
/// copied there first so `undo_replace` can restore it.
pub fn replace_in_files(targets: &[ReplaceTarget], q: &SearchQuery, replacement: &str, backup_dir: Option<&Path>) -> Result<Vec<ReplaceFileResult>, String> {
    let pattern = pattern_source(q);
    // The search's Whole Word rule (`RegexMatcherBuilder::word`): no word character just before or
    // after the match. Plain `\b` misses "-2" in "x -2 y", which the search lists.
    let pattern = if q.whole_word { format!(r"\b{{start-half}}(?:{pattern})\b{{end-half}}") } else { pattern };
    let re = regex::RegexBuilder::new(&pattern)
        .case_insensitive(!q.case_sensitive)
        .multi_line(true)
        .dot_matches_new_line(q.dot_all)
        .build()
        .map_err(|e| one_line_regex_error(&e.to_string()))?;
    let mut results = Vec::new();
    let mut budget = UNDO_BUDGET_BYTES;
    for (i, t) in targets.iter().enumerate() {
        let path = Path::new(&t.path);
        let skip: HashSet<(u64, u64)> = t.skip.iter().copied().collect();
        let mut backup = None;
        let mut written = None;
        let r = (|| -> Result<usize, String> {
            // The whole file and its replacement are held in memory: refuse huge files instead of
            // risking an out-of-memory abort (large files have their own streaming Replace All).
            let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
            if let (Some(searched), Some(modified)) = (t.searched_ms, modified_ms(&meta)) {
                if modified > searched {
                    return Err("changed since the search; file left unchanged (search again)".into());
                }
            }
            let len = meta.len();
            if len > REPLACE_MAX_BYTES {
                return Err(format!("{} MB is too large for Replace in Files; open the file and use Replace All", len >> 20));
            }
            let data = std::fs::read(path).map_err(|e| e.to_string())?;
            let (encoding, bom_len) = files::detect_encoding(&data, None);
            let (text, had_errors) = encoding.decode_without_bom_handling(&data[bom_len..]);
            if had_errors {
                return Err(format!("not valid {} text; file left unchanged", encoding.name()));
            }
            let (new_text, n) = replace_text(&text, &re, replacement, !q.is_regex, q.preserve_case, &skip);
            if n == 0 {
                return Ok(0);
            }
            let out = files::encode_text(&new_text, encoding, bom_len > 0).map_err(encode_error)?;
            if let Some(dir) = backup_dir.filter(|_| data.len() as u64 <= budget) {
                let b = dir.join(format!("{i}.bak"));
                std::fs::write(&b, &data).map_err(|e| format!("could not back up the original: {e}"))?;
                budget -= data.len() as u64;
                backup = Some(b.to_string_lossy().into_owned());
            }
            write_atomic(path, &out)?;
            written = Some(digest(&out));
            Ok(n)
        })();
        results.push(match r {
            Ok(n) => ReplaceFileResult { path: t.path.clone(), replaced: n, error: None, backup, digest: written },
            Err(e) => {
                if let Some(b) = &backup {
                    let _ = std::fs::remove_file(b);
                }
                ReplaceFileResult { path: t.path.clone(), replaced: 0, error: Some(e), backup: None, digest: None }
            }
        });
    }
    Ok(results)
}

/// Put back the originals saved by `replace_in_files`. A file that changed since the replace
/// (its digest differs) is left alone and reported. `replaced` is 1 for each restored file.
pub fn undo_replace(entries: &[UndoEntry]) -> Vec<ReplaceFileResult> {
    entries
        .iter()
        .map(|e| {
            let path = Path::new(&e.path);
            let r = (|| -> Result<(), String> {
                let now = std::fs::read(path).map_err(|err| err.to_string())?;
                if digest(&now) != e.digest {
                    return Err("changed since the replace; not restored".into());
                }
                let original = std::fs::read(&e.backup).map_err(|err| format!("backup missing: {err}"))?;
                write_atomic(path, &original)?;
                let _ = std::fs::remove_file(&e.backup);
                Ok(())
            })();
            match r {
                Ok(()) => ReplaceFileResult { path: e.path.clone(), replaced: 1, error: None, backup: None, digest: None },
                Err(err) => ReplaceFileResult { path: e.path.clone(), replaced: 0, error: Some(err), backup: None, digest: None },
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn q(pattern: &str, is_regex: bool) -> SearchQuery {
        SearchQuery {
            pattern: pattern.into(),
            is_regex,
            case_sensitive: false,
            whole_word: false,
            multiline: false,
            dot_all: false,
            include: vec![],
            exclude: vec![],
            respect_gitignore: false,
            max_results: 100_000,
            preserve_case: false,
        }
    }

    #[test]
    fn validate_regex_reports_one_line_errors() {
        assert_eq!(validate_regex("foo(bar", false, false, false), Err("unclosed group".into()));
        assert!(validate_regex("a(?<n>b)", false, false, false).is_ok());
        let err = validate_regex("(?<=x)y", false, false, false).unwrap_err();
        assert!(!err.contains('\n'), "{err}");
        assert!(validate_regex("[a-", true, true, true).is_err());
    }

    #[test]
    fn one_line_error_falls_back_to_joined_lines() {
        assert_eq!(one_line_regex_error("regex parse error:\n  a(\n   ^\nerror: unclosed group"), "unclosed group");
        assert_eq!(one_line_regex_error("plain\nmessage"), "plain message");
    }

    #[test]
    fn flush_policy() {
        assert!(!should_flush(0, Duration::from_secs(10)));
        assert!(!should_flush(5, Duration::from_millis(10)));
        assert!(should_flush(BATCH_MAX, Duration::ZERO));
        assert!(should_flush(1, BATCH_INTERVAL));
    }

    #[test]
    fn match_columns_are_utf16_units() {
        let dir = tempfile::tempdir().unwrap();
        let long_prefix = "\u{e9}".repeat(30); // 60 bytes: the preview starts mid-line
        std::fs::write(dir.path().join("u.txt"), format!("caf\u{e9} \u{1f600} needle\n{long_prefix}needle\n")).unwrap();
        let found = Mutex::new(Vec::new());
        let roots = vec![dir.path().to_string_lossy().into_owned()];
        search_paths(1, &roots, &q("needle", false), Arc::new(AtomicBool::new(false)), |b| found.lock().unwrap().extend(b)).unwrap();
        let found = found.into_inner().unwrap();
        assert_eq!((found[0].line, found[0].col, found[0].len, found[0].preview_col), (1, 8, 6, 8));
        let units: Vec<u16> = found[0].preview.encode_utf16().collect();
        assert_eq!(String::from_utf16(&units[8..14]).unwrap(), "needle");
        assert_eq!(found[1].col, 30);
        assert!(!found[1].preview.contains('\u{fffd}'), "preview must not start inside a character");
        let units: Vec<u16> = found[1].preview.encode_utf16().collect();
        let pc = found[1].preview_col as usize;
        assert_eq!(String::from_utf16(&units[pc..pc + 6]).unwrap(), "needle");
    }

    #[test]
    fn single_huge_file_streams_in_several_batches() {
        let dir = tempfile::tempdir().unwrap();
        let mut body = String::new();
        for i in 0..1000 {
            body.push_str(&format!("line {i} needle here\n"));
        }
        std::fs::write(dir.path().join("big.txt"), &body).unwrap();
        let batches = Mutex::new(Vec::<usize>::new());
        let roots = vec![dir.path().to_string_lossy().into_owned()];
        let done = search_paths(1, &roots, &q("needle", false), Arc::new(AtomicBool::new(false)), |b| {
            batches.lock().unwrap().push(b.len());
        })
        .unwrap();
        let batches = batches.into_inner().unwrap();
        assert_eq!(done.matches, 1000);
        assert_eq!(done.files_searched, 1);
        assert!(!done.cancelled && !done.truncated);
        assert!(batches.len() >= 5, "expected several partial batches, got {batches:?}");
        assert_eq!(batches.iter().sum::<usize>(), 1000);
        assert!(batches.iter().all(|n| *n <= BATCH_MAX));
    }

    #[test]
    fn one_line_lists_at_most_block_match_cap_matches() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("min.js"), format!("{}\n{}\n", "ab ".repeat(1500), "ab ".repeat(10))).unwrap();
        let roots = vec![dir.path().to_string_lossy().into_owned()];
        for regex in [false, true] {
            let mut c = q("ab", regex);
            c.multiline = regex;
            let found = Mutex::new(Vec::new());
            let done = search_paths(1, &roots, &c, Arc::new(AtomicBool::new(false)), |b| found.lock().unwrap().extend(b)).unwrap();
            let found = found.into_inner().unwrap();
            assert_eq!(found.iter().filter(|m| m.line == 1).count(), BLOCK_MATCH_CAP);
            assert_eq!(found.iter().filter(|m| m.line == 2).count(), 10);
            assert_eq!(done.matches, BLOCK_MATCH_CAP + 10);
            assert!(!done.truncated);
        }
    }

    #[test]
    fn roots_can_mix_files_and_folders() {
        // The Explorer's selection: one file and one folder (a sibling file is not picked).
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("a.txt"), "needle\n").unwrap();
        std::fs::write(dir.path().join("b.txt"), "needle\n").unwrap();
        std::fs::write(dir.path().join("sub").join("c.txt"), "needle\n").unwrap();
        let roots = vec![dir.path().join("a.txt").to_string_lossy().into_owned(), dir.path().join("sub").to_string_lossy().into_owned()];
        let found = Mutex::new(Vec::new());
        let done = search_paths(1, &roots, &q("needle", false), Arc::new(AtomicBool::new(false)), |b| found.lock().unwrap().extend(b)).unwrap();
        let mut names: Vec<String> = found.into_inner().unwrap().iter().map(|m| Path::new(&m.path).file_name().unwrap().to_string_lossy().into_owned()).collect();
        names.sort();
        assert_eq!(names, vec!["a.txt", "c.txt"]);
        assert_eq!(done.files_searched, 2);
    }

    #[test]
    fn cancel_is_reported() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "x\n").unwrap();
        let roots = vec![dir.path().to_string_lossy().into_owned()];
        let done = search_paths(2, &roots, &q("x", false), Arc::new(AtomicBool::new(true)), |_| {}).unwrap();
        assert!(done.cancelled);
        assert_eq!(done.files_searched, 0);
    }

    #[test]
    fn bad_regex_is_an_error_not_a_panic() {
        let dir = tempfile::tempdir().unwrap();
        let roots = vec![dir.path().to_string_lossy().into_owned()];
        let err = search_paths(3, &roots, &q("(", true), Arc::new(AtomicBool::new(false)), |_| {}).unwrap_err();
        assert_eq!(err, "unclosed group");
    }

    fn targets(paths: &[&std::path::PathBuf]) -> Vec<ReplaceTarget> {
        paths.iter().map(|p| ReplaceTarget { path: p.to_string_lossy().into_owned(), skip: vec![], searched_ms: None }).collect()
    }

    #[test]
    fn preserve_case_follows_the_matched_text() {
        assert_eq!(preserve_case("FOO", "bar"), "BAR");
        assert_eq!(preserve_case("foo", "Bar"), "bar");
        assert_eq!(preserve_case("Foo", "bar"), "Bar");
        assert_eq!(preserve_case("F", "bar"), "Bar");
        assert_eq!(preserve_case("fOO", "bar"), "bar");
        assert_eq!(preserve_case("FOO_1", "bar_2"), "BAR_2");
        assert_eq!(preserve_case("123", "Bar"), "Bar");
        assert_eq!(preserve_case("Foo", "\u{e9}t\u{e9}"), "\u{c9}t\u{e9}");
    }

    #[test]
    fn replace_text_skips_positions_and_expands_groups() {
        let re = regex::RegexBuilder::new("(a)(\\d)").case_insensitive(true).build().unwrap();
        let none = HashSet::new();
        assert_eq!(replace_text("a1 A2\na3", &re, "$2$1", false, false, &none), ("1a 2A\n3a".into(), 3));
        // Line 2, column 0 is left alone; columns count UTF-16 units (the emoji is two).
        let skip: HashSet<(u64, u64)> = [(2, 0), (1, 5)].into_iter().collect();
        assert_eq!(replace_text("a1 \u{1f600}a2\na3 a4", &re, "x", true, false, &skip), ("x \u{1f600}a2\na3 x".into(), 2));
        let word = regex::RegexBuilder::new("foo").case_insensitive(true).build().unwrap();
        assert_eq!(replace_text("foo Foo FOO", &word, "bar", true, true, &none).0, "bar Bar BAR");
    }

    #[test]
    fn replacement_follows_javascript_dollar_rules() {
        let none = HashSet::new();
        let re = regex::Regex::new(r"(\w+)-(\d)").unwrap();
        let r = |rep: &str| replace_text("<ab-1>", &re, rep, false, false, &none).0;
        assert_eq!(r("$1_old"), "<ab_old>");
        assert_eq!(r("$1x"), "<abx>");
        assert_eq!(r("[$&]"), "<[ab-1]>");
        assert_eq!(r("$0"), "<$0>");
        assert_eq!(r("$$1"), "<$1>");
        assert_eq!(r("$12"), "<ab2>");
        assert_eq!(r("$3"), "<$3>");
        assert_eq!(r("$`|$'"), "<<|>>");
        assert_eq!(r("$<x>"), "<$<x>>");
        assert_eq!(r("end$"), "<end$>");
        let named = regex::Regex::new(r"(?<w>\w+)").unwrap();
        assert_eq!(replace_text("hi", &named, "[$<w>|$<nope>]", false, false, &none).0, "[hi|]");
        assert_eq!(replace_text("ab-1", &re, "$1", true, false, &none).0, "$1");
    }

    #[test]
    fn whole_word_replace_matches_what_the_search_finds() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.txt");
        let text = "x -2 y a-2 -2b\ncat category cat.\n";
        let roots = vec![dir.path().to_string_lossy().into_owned()];
        for (pat, hits, out) in [("-2", 1, "x z y a-2 -2b\ncat category cat.\n"), ("cat", 2, "x -2 y a-2 -2b\nz category z.\n")] {
            std::fs::write(&f, text).unwrap();
            let mut ww = q(pat, false);
            ww.whole_word = true;
            let found = Mutex::new(Vec::new());
            search_paths(1, &roots, &ww, Arc::new(AtomicBool::new(false)), |b| found.lock().unwrap().extend(b)).unwrap();
            assert_eq!(found.into_inner().unwrap().len(), hits, "{pat}");
            let res = replace_in_files(&targets(&[&f]), &ww, "z", None).unwrap();
            assert_eq!(res[0].replaced, hits, "{pat}");
            assert_eq!(std::fs::read_to_string(&f).unwrap(), out);
        }
    }

    #[test]
    fn multi_line_plain_text_matches_crlf_and_lf_files() {
        let dir = tempfile::tempdir().unwrap();
        let crlf = dir.path().join("crlf.txt");
        let lf = dir.path().join("lf.txt");
        std::fs::write(&crlf, "x\r\nfoo\r\nbar\r\n").unwrap();
        std::fs::write(&lf, "foo\nbar\n").unwrap();
        let mut ml = q("foo\nbar", false);
        ml.multiline = true;
        let found = Mutex::new(Vec::new());
        let roots = vec![dir.path().to_string_lossy().into_owned()];
        search_paths(1, &roots, &ml, Arc::new(AtomicBool::new(false)), |b| found.lock().unwrap().extend(b)).unwrap();
        let mut found: Vec<(bool, u64, u64)> = found.into_inner().unwrap().iter().map(|m| (m.path.ends_with("crlf.txt"), m.line, m.col)).collect();
        found.sort();
        assert_eq!(found, vec![(false, 1, 0), (true, 2, 0)]);
        let res = replace_in_files(&targets(&[&crlf, &lf]), &ml, "z", None).unwrap();
        assert_eq!(res.iter().map(|r| r.replaced).collect::<Vec<_>>(), vec![1, 1]);
        assert_eq!(std::fs::read_to_string(&crlf).unwrap(), "x\r\nz\r\n");
        assert_eq!(std::fs::read_to_string(&lf).unwrap(), "z\n");
    }

    #[test]
    fn replace_in_files_keeps_each_file_encoding() {
        let dir = tempfile::tempdir().unwrap();
        // Windows-1252: "caf\u{e9} needle" ; UTF-16LE with BOM ; UTF-8 with BOM.
        let w = dir.path().join("w1252.txt");
        std::fs::write(&w, b"caf\xe9 needle \xe9t\xe9\r\n").unwrap();
        let u16 = dir.path().join("u16.txt");
        let mut b = vec![0xFF, 0xFE];
        b.extend("x needle y\n".encode_utf16().flat_map(|u| u.to_le_bytes()));
        std::fs::write(&u16, &b).unwrap();
        let u8b = dir.path().join("u8bom.txt");
        std::fs::write(&u8b, b"\xEF\xBB\xBFneedle \xc3\xa9\n").unwrap();
        // The search finds all three (UTF-16 is transcoded by its BOM), so they reach the replace.
        let found = Mutex::new(Vec::new());
        let roots = vec![dir.path().to_string_lossy().into_owned()];
        search_paths(1, &roots, &q("needle", false), Arc::new(AtomicBool::new(false)), |b| found.lock().unwrap().extend(b)).unwrap();
        let found = found.into_inner().unwrap();
        assert_eq!(found.len(), 3);
        let w1252 = found.iter().find(|m| m.path.ends_with("w1252.txt")).unwrap();
        assert_eq!((w1252.preview.as_str(), w1252.col, w1252.preview_col), ("caf\u{e9} needle \u{e9}t\u{e9}", 5, 5));
        let res = replace_in_files(&targets(&[&w, &u16, &u8b]), &q("needle", false), "\u{e8}pingle", None).unwrap();
        assert_eq!(res.iter().map(|r| r.replaced).collect::<Vec<_>>(), vec![1, 1, 1], "{:?}", res.iter().map(|r| r.error.clone()).collect::<Vec<_>>());
        assert_eq!(std::fs::read(&w).unwrap(), b"caf\xe9 \xe8pingle \xe9t\xe9\r\n");
        let mut want = vec![0xFF, 0xFE];
        want.extend("x \u{e8}pingle y\n".encode_utf16().flat_map(|u| u.to_le_bytes()));
        assert_eq!(std::fs::read(&u16).unwrap(), want);
        assert_eq!(std::fs::read(&u8b).unwrap(), "\u{feff}\u{e8}pingle \u{e9}\n".as_bytes());
    }

    #[test]
    fn replace_in_files_refuses_characters_the_encoding_cannot_store() {
        let dir = tempfile::tempdir().unwrap();
        let w = dir.path().join("w1252.txt");
        let original = b"caf\xe9 needle\n".to_vec();
        std::fs::write(&w, &original).unwrap();
        let res = replace_in_files(&targets(&[&w]), &q("needle", false), "\u{4e2d}", None).unwrap();
        assert_eq!(res[0].replaced, 0);
        assert!(res[0].error.as_deref().unwrap().contains("cannot store"), "{:?}", res[0].error);
        assert_eq!(std::fs::read(&w).unwrap(), original, "left unchanged");
    }

    #[test]
    fn replace_in_files_honours_skipped_matches() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.txt");
        std::fs::write(&f, "needle needle\r\nneedle\n").unwrap();
        let t = vec![ReplaceTarget { path: f.to_string_lossy().into_owned(), skip: vec![(1, 7)], searched_ms: None }];
        let res = replace_in_files(&t, &q("needle", false), "pin", None).unwrap();
        assert_eq!(res[0].replaced, 2);
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "pin needle\r\npin\n");
    }

    #[test]
    fn replace_in_files_leaves_files_changed_since_the_search() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.txt");
        std::fs::write(&f, "needle\n").unwrap();
        let modified = modified_ms(&std::fs::metadata(&f).unwrap()).unwrap();
        let path = f.to_string_lossy().into_owned();
        let stale = vec![ReplaceTarget { path: path.clone(), skip: vec![], searched_ms: Some(modified - 1000) }];
        let res = replace_in_files(&stale, &q("needle", false), "pin", None).unwrap();
        assert!(res[0].error.as_deref().unwrap_or("").contains("changed since the search"));
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "needle\n");
        let fresh = vec![ReplaceTarget { path, skip: vec![], searched_ms: Some(modified + 1000) }];
        assert_eq!(replace_in_files(&fresh, &q("needle", false), "pin", None).unwrap()[0].replaced, 1);
    }

    #[test]
    fn replace_in_files_skips_files_over_the_limit() {
        let dir = tempfile::tempdir().unwrap();
        let small = dir.path().join("small.txt");
        std::fs::write(&small, "needle\n").unwrap();
        let huge = dir.path().join("huge.txt");
        let f = std::fs::File::create(&huge).unwrap();
        f.set_len(REPLACE_MAX_BYTES + 1).unwrap(); // sparse: no real disk use
        drop(f);
        let res = replace_in_files(&targets(&[&small, &huge]), &q("needle", false), "pin", None).unwrap();
        assert_eq!(res[0].replaced, 1);
        assert!(res[1].error.as_deref().unwrap_or("").contains("too large"));
        assert_eq!(std::fs::read_to_string(&small).unwrap(), "pin\n");
    }

    #[test]
    fn undo_replace_restores_unchanged_files_only() {
        let dir = tempfile::tempdir().unwrap();
        let backups = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.txt");
        let b = dir.path().join("b.txt");
        let c = dir.path().join("c.txt");
        std::fs::write(&a, b"one needle\r\n\xff raw").unwrap();
        std::fs::write(&b, "needle needle").unwrap();
        std::fs::write(&c, "no match").unwrap();
        let res = replace_in_files(&targets(&[&a, &b, &c]), &q("needle", false), "$pin", Some(backups.path())).unwrap();
        assert_eq!(res.iter().map(|r| r.replaced).collect::<Vec<_>>(), vec![1, 2, 0]);
        assert!(res[2].backup.is_none(), "unchanged files are not backed up");
        assert_eq!(std::fs::read_to_string(&b).unwrap(), "$pin $pin");
        // b is edited afterwards: undo must not clobber that edit.
        std::fs::write(&b, "edited later").unwrap();
        let entries: Vec<UndoEntry> = res
            .iter()
            .filter_map(|r| Some(UndoEntry { path: r.path.clone(), backup: r.backup.clone()?, digest: r.digest.clone()? }))
            .collect();
        assert_eq!(entries.len(), 2);
        let undo = undo_replace(&entries);
        assert_eq!(undo[0].replaced, 1);
        assert_eq!(std::fs::read(&a).unwrap(), b"one needle\r\n\xff raw", "byte-exact restore");
        assert_eq!(undo[1].replaced, 0);
        assert!(undo[1].error.as_deref().unwrap().contains("changed since"));
        assert_eq!(std::fs::read_to_string(&b).unwrap(), "edited later");
        assert!(!Path::new(&entries[0].backup).exists(), "restored backups are removed");
    }
}
