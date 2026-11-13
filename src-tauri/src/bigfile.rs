//! Disk-backed large-file engine.
//!
//! A file is memory-mapped and never read fully into RAM. A sparse line index
//! (one checkpoint every `STRIDE` lines) is built in the background so a
//! 10 GB / 100 M-line file costs well under a megabyte of index memory.
//! Edits are kept in a piece table: pieces point either at the original mapping
//! or at an append-only "add" buffer, so edits stay cheap regardless of file size.
//! Saving streams the pieces to a temp file and atomically replaces the target.

use memchr::{memchr, memchr_iter};
use memmap2::Mmap;
use parking_lot::RwLock;
use serde::Serialize;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

const STRIDE: u64 = 1024;
const INDEX_CHUNK: usize = 64 << 20;
const SEARCH_CHUNK: usize = 8 << 20;
const MAX_READ_BYTES: usize = 16 << 20;
const PREVIEW_BYTES: usize = 400;

#[derive(Default)]
pub struct LineIndex {
    /// Line separator byte: `\n` (LF and CRLF files) or `\r` (classic Mac, CR-only files).
    sep: Sep,
    /// `checkpoints[k]` = byte offset where line `k * STRIDE` starts.
    checkpoints: Vec<u64>,
    newlines: u64,
    indexed_bytes: u64,
    complete: bool,
}

impl LineIndex {
    fn new(sep: Sep) -> Self {
        Self { sep, checkpoints: vec![0], newlines: 0, indexed_bytes: 0, complete: false }
    }

    /// Byte offset of the start of line `n` (0-based) inside `data`.
    fn line_start(&self, data: &[u8], n: u64) -> Option<u64> {
        if n > self.newlines {
            return None;
        }
        if n == self.newlines && !self.complete {
            return None;
        }
        let k = (n / STRIDE) as usize;
        let mut pos = *self.checkpoints.get(k)? as usize;
        let rem = n % STRIDE;
        for _ in 0..rem {
            let nl = self.sep.find(&data[pos..], pos as u64)?;
            pos += nl + 1;
        }
        Some(pos as u64)
    }

    /// 0-based line number containing byte offset `off` (= number of newlines before `off`).
    fn line_at_offset(&self, data: &[u8], off: u64) -> u64 {
        let k = self.checkpoints.partition_point(|&c| c <= off).saturating_sub(1);
        let start = self.checkpoints[k] as usize;
        let end = (off as usize).min(data.len());
        let cnt = if end > start { self.sep.count(&data[start..end], start as u64) } else { 0 };
        k as u64 * STRIDE + cnt
    }

    fn count_newlines(&self, data: &[u8], a: u64, b: u64) -> u64 {
        if b <= a {
            return 0;
        }
        self.line_at_offset(data, b) - self.line_at_offset(data, a)
    }
}

#[derive(Clone, Debug)]
struct Piece {
    orig: bool,
    start: u64,
    len: u64,
    nl: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IndexProgress {
    pub id: u32,
    pub newlines: u64,
    pub indexed_bytes: u64,
    pub total_bytes: u64,
    pub complete: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BigDocInfo {
    pub id: u32,
    pub path: String,
    pub size: u64,
    pub total_lines: u64,
    pub indexed: bool,
    pub dirty: bool,
    pub eol: String,
    /// "UTF-8", or "UTF-16LE" / "UTF-16BE" when the file starts with a UTF-16 byte-order mark
    /// (shown decoded, read-only).
    pub encoding: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinesChunk {
    pub start: u64,
    pub lines: Vec<String>,
    pub total_lines: u64,
    pub indexed: bool,
    pub truncated: bool,
    /// Indices (into `lines`) of lines that are not valid UTF-8 and were shown with U+FFFD.
    /// Editing such a line would replace those bytes, so the UI asks first.
    pub lossy: Vec<u32>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BigMatch {
    pub line: u64,
    pub col: u64,
    pub len: u64,
    pub preview: String,
    pub preview_col: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BigSearchResult {
    pub matches: Vec<BigMatch>,
    pub total: u64,
    pub truncated: bool,
}

pub struct SearchOpts<'a> {
    pub pattern: &'a str,
    pub is_regex: bool,
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub dot_all: bool,
    pub max_results: usize,
}

pub fn build_regex(o: &SearchOpts) -> Result<regex::bytes::Regex, String> {
    let mut pat = if o.is_regex { o.pattern.to_string() } else { regex::escape(o.pattern) };
    if o.whole_word {
        pat = format!(r"\b(?:{pat})\b");
    }
    regex::bytes::RegexBuilder::new(&pat)
        .case_insensitive(!o.case_sensitive)
        .multi_line(true)
        .dot_matches_new_line(o.dot_all)
        .size_limit(64 << 20)
        .build()
        .map_err(|e| e.to_string())
}

/// True when both paths name the same existing file.
fn same_file(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

/// Line ending and encoding from the first bytes of a file. CR-only files (no LF at all, but CRs)
/// use CR as the line separator; a UTF-16 byte-order mark selects decoded, read-only display.
fn detect_layout(head: &[u8]) -> (&'static [u8], &'static str) {
    let encoding = if head.starts_with(&[0xff, 0xfe]) {
        "UTF-16LE"
    } else if head.starts_with(&[0xfe, 0xff]) {
        "UTF-16BE"
    } else {
        "UTF-8"
    };
    let eol: &'static [u8] = match memchr(b'\n', head) {
        Some(i) if i > 0 && head[i - 1] == b'\r' => b"\r\n",
        // UTF-16: CR LF is 0D 00 0A 00 (LE) or 00 0D 00 0A (BE).
        Some(i) if encoding == "UTF-16LE" && i >= 2 && head[i - 2] == b'\r' => b"\r\n",
        Some(i) if encoding == "UTF-16BE" && i >= 2 && head[i - 2] == b'\r' => b"\r\n",
        Some(_) => b"\n",
        None if memchr(b'\r', head).is_some() => b"\r",
        None if cfg!(windows) => b"\r\n",
        None => b"\n",
    };
    (eol, encoding)
}

/// Where lines end: the separator byte, and for UTF-16 files which byte order. In UTF-16 only a
/// whole code unit U+000A ends a line (`0A 00` at an even file offset in LE, `00 0A` in BE); a 0x0A
/// byte is also half of many other characters (上 is `0A 4E` in UTF-16LE).
#[derive(Clone, Copy, Default)]
struct Sep {
    byte: u8,
    /// Some(true) = UTF-16LE, Some(false) = UTF-16BE.
    utf16: Option<bool>,
}

impl Sep {
    fn new(byte: u8, encoding: &str) -> Self {
        let utf16 = match encoding {
            "UTF-16LE" => Some(true),
            "UTF-16BE" => Some(false),
            _ => None,
        };
        Self { byte, utf16 }
    }

    /// Offsets in `hay` of line separators; `base` is the file offset of `hay[0]` (UTF-16 alignment).
    fn iter<'a>(self, hay: &'a [u8], base: u64) -> impl Iterator<Item = usize> + 'a {
        memchr_iter(self.byte, hay).filter(move |&i| match self.utf16 {
            None => true,
            Some(true) => (base + i as u64) % 2 == 0 && hay.get(i + 1).is_none_or(|&b| b == 0),
            Some(false) => (base + i as u64) % 2 == 1 && (i == 0 || hay[i - 1] == 0),
        })
    }

    fn find(self, hay: &[u8], base: u64) -> Option<usize> {
        match self.utf16 {
            None => memchr(self.byte, hay),
            Some(_) => self.iter(hay, base).next(),
        }
    }

    fn count(self, hay: &[u8], base: u64) -> u64 {
        match self.utf16 {
            None => memchr_iter(self.byte, hay).count() as u64,
            Some(_) => self.iter(hay, base).count() as u64,
        }
    }
}

/// Largest char boundary of `s` at or below `i`.
fn floor_boundary(s: &str, mut i: usize) -> usize {
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

/// Text of line `n` (its bytes up to, not including, the separator) and whether decoding was lossy.
fn decode_line(part: &[u8], n: u64, sep: u8, encoding: &str) -> (String, bool) {
    match encoding {
        "UTF-16LE" | "UTF-16BE" => {
            // Lines were split at the 0x0A byte of U+000A: in LE the 0x00 that follows it starts
            // the next line, in BE the 0x00 before it ends this one. Drop those halves, the BOM and the CR.
            let le = encoding == "UTF-16LE";
            let mut b = part;
            if n == 0 {
                b = b.get(2..).unwrap_or(&[]);
            } else if le {
                b = b.get(1..).unwrap_or(&[]);
            }
            if !le {
                b = b.strip_suffix(&[0x00]).unwrap_or(b);
            }
            b = if le { b.strip_suffix(&[0x0d, 0x00]) } else { b.strip_suffix(&[0x00, 0x0d]) }.unwrap_or(b);
            let enc = if le { encoding_rs::UTF_16LE } else { encoding_rs::UTF_16BE };
            let (text, bad) = enc.decode_without_bom_handling(b);
            (text.into_owned(), bad)
        }
        _ => {
            let b = if sep == b'\n' { part.strip_suffix(b"\r").unwrap_or(part) } else { part };
            match std::str::from_utf8(b) {
                Ok(t) => (t.to_owned(), false),
                Err(_) => (String::from_utf8_lossy(b).into_owned(), true),
            }
        }
    }
}

pub struct BigDoc {
    pub id: u32,
    /// The path the user opened / will save to.
    pub path: PathBuf,
    mmap: Option<Arc<Mmap>>,
    file_len: u64,
    add: Vec<u8>,
    pieces: Vec<Piece>,
    index: Arc<RwLock<LineIndex>>,
    cancel: Arc<AtomicBool>,
    indexer: Option<JoinHandle<()>>,
    undo: Vec<Vec<Piece>>,
    redo: Vec<Vec<Piece>>,
    /// Undo-stack depth at which the document matches the file on disk; `None` once
    /// that state can no longer be reached by undo/redo (replace-all, trimmed history).
    clean_depth: Option<usize>,
    eol: &'static [u8],
    /// Line separator byte (see `LineIndex::sep`).
    sep: u8,
    /// Encoding for display; anything but UTF-8 is read-only.
    encoding: &'static str,
    /// Backing temp file after a materializing operation (replace-all).
    _temp_backing: Option<tempfile::TempPath>,
    /// The file that is memory-mapped right now (the opened file, a replace-all temp file, or the
    /// last save target). Only saving over this file requires releasing the mapping first.
    backing: PathBuf,
    /// Follow mode: a copy of the first and last 4 KB as mapped (length, head, tail). The mapping
    /// itself can't tell whether the file was rewritten: it shows the new bytes too.
    follow_sig: Option<(u64, Vec<u8>, Vec<u8>)>,
}

impl BigDoc {
    pub fn open<F>(id: u32, path: &Path, on_progress: F) -> Result<Self, String>
    where
        F: Fn(IndexProgress) + Send + 'static,
    {
        let file = File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
        let len = file.metadata().map_err(|e| e.to_string())?.len();
        // SAFETY: we only read the mapping; concurrent external writes to the file are
        // the user's responsibility, as with any editor holding a file open.
        let mmap = unsafe { Mmap::map(&file).map_err(|e| format!("mmap {}: {e}", path.display()))? };
        let (eol, encoding) = detect_layout(&mmap[..mmap.len().min(1 << 20)]);
        let sep = if eol == b"\r" { b'\r' } else { b'\n' };
        let mut doc = Self {
            id,
            path: path.to_path_buf(),
            mmap: Some(Arc::new(mmap)),
            file_len: len,
            add: Vec::new(),
            pieces: vec![Piece { orig: true, start: 0, len, nl: 0 }],
            index: Arc::new(RwLock::new(LineIndex::new(Sep::new(sep, encoding)))),
            cancel: Arc::new(AtomicBool::new(false)),
            indexer: None,
            undo: Vec::new(),
            redo: Vec::new(),
            clean_depth: Some(0),
            eol,
            sep,
            encoding,
            _temp_backing: None,
            backing: path.to_path_buf(),
            follow_sig: None,
        };
        doc.start_indexing(on_progress);
        Ok(doc)
    }

    fn start_indexing<F>(&mut self, on_progress: F)
    where
        F: Fn(IndexProgress) + Send + 'static,
    {
        let mmap = match &self.mmap {
            Some(m) => m.clone(),
            None => return,
        };
        let index = self.index.clone();
        let cancel = Arc::new(AtomicBool::new(false));
        self.cancel = cancel.clone();
        let id = self.id;
        let total = self.file_len;
        let sep = Sep::new(self.sep, self.encoding);
        self.indexer = Some(std::thread::spawn(move || {
            let data: &[u8] = &mmap;
            let mut checkpoints = vec![0u64];
            let mut newlines = 0u64;
            let mut pos = 0usize;
            while pos < data.len() {
                if cancel.load(Ordering::Relaxed) {
                    return;
                }
                let end = (pos + INDEX_CHUNK).min(data.len());
                for i in sep.iter(&data[pos..end], pos as u64) {
                    newlines += 1;
                    if newlines % STRIDE == 0 {
                        checkpoints.push((pos + i + 1) as u64);
                    }
                }
                pos = end;
                {
                    let mut ix = index.write();
                    ix.checkpoints.clone_from(&checkpoints);
                    ix.newlines = newlines;
                    ix.indexed_bytes = pos as u64;
                    ix.complete = pos >= data.len();
                }
                on_progress(IndexProgress {
                    id,
                    newlines,
                    indexed_bytes: pos as u64,
                    total_bytes: total,
                    complete: pos >= data.len(),
                });
            }
            if data.is_empty() {
                let mut ix = index.write();
                ix.complete = true;
                drop(ix);
                on_progress(IndexProgress { id, newlines: 0, indexed_bytes: 0, total_bytes: 0, complete: true });
            }
        }));
    }

    fn stop_indexing(&mut self) {
        self.cancel.store(true, Ordering::Relaxed);
        if let Some(h) = self.indexer.take() {
            let _ = h.join();
        }
    }

    /// Block until the background indexer finishes.
    #[allow(dead_code)]
    pub fn wait_indexed(&mut self) {
        if let Some(h) = self.indexer.take() {
            let _ = h.join();
        }
    }

    pub fn is_indexed(&self) -> bool {
        self.index.read().complete
    }

    fn data(&self) -> &[u8] {
        match &self.mmap {
            Some(m) => m,
            None => &[],
        }
    }

    fn single_orig(&self) -> bool {
        self.pieces.len() == 1 && self.pieces[0].orig
    }

    pub fn total_newlines(&self) -> u64 {
        if self.single_orig() {
            self.index.read().newlines
        } else {
            self.pieces.iter().map(|p| p.nl).sum()
        }
    }

    pub fn total_lines(&self) -> u64 {
        self.total_newlines() + 1
    }

    pub fn doc_len(&self) -> u64 {
        self.pieces.iter().map(|p| p.len).sum()
    }

    /// True when the current piece table differs from the saved file. Undoing every
    /// edit (or redoing back to the saved point) makes the document clean again.
    pub fn is_dirty(&self) -> bool {
        self.clean_depth != Some(self.undo.len())
    }

    pub fn info(&self) -> BigDocInfo {
        BigDocInfo {
            id: self.id,
            path: self.path.to_string_lossy().into_owned(),
            size: self.doc_len(),
            total_lines: self.total_lines(),
            indexed: self.is_indexed(),
            dirty: self.is_dirty(),
            eol: match self.eol {
                b"\r\n" => "CRLF".into(),
                b"\r" => "CR".into(),
                _ => "LF".into(),
            },
            encoding: self.encoding.into(),
        }
    }

    /// The whole document as one slice when it is still exactly the file on disk (no edits): the
    /// memory mapping itself, so nothing is copied whatever the size. `None` once it has edits.
    pub fn unedited_bytes(&self) -> Option<&[u8]> {
        match self.pieces.as_slice() {
            [] => Some(&[]),
            [p] if p.orig && p.start == 0 && p.len == self.file_len => Some(self.piece_slice(p)),
            _ => None,
        }
    }

    /// 1-based line of byte offset `off` of the unedited file (for the JSON tree's jumps).
    pub fn line_of_offset(&self, off: u64) -> Option<u64> {
        let data = self.unedited_bytes()?;
        Some(self.index.read().line_at_offset(data, off) + 1)
    }

    fn piece_slice(&self, p: &Piece) -> &[u8] {
        let s = p.start as usize;
        let e = (p.start + p.len) as usize;
        // `get` rather than indexing: a missing mapping must read as empty, not abort the app.
        if p.orig {
            self.data().get(s..e).unwrap_or(&[])
        } else {
            self.add.get(s..e).unwrap_or(&[])
        }
    }

    fn piece_nl(&self, p: &Piece) -> u64 {
        if self.single_orig() && p.orig {
            self.index.read().newlines
        } else {
            p.nl
        }
    }

    /// Locate the start of line `n`: (piece index, offset within piece, doc offset).
    fn locate_line(&self, n: u64) -> Option<(usize, u64, u64)> {
        let mut acc_nl = 0u64;
        let mut acc_len = 0u64;
        for (i, p) in self.pieces.iter().enumerate() {
            let pnl = self.piece_nl(p);
            if n <= acc_nl + pnl {
                let want = n - acc_nl; // newlines to skip inside this piece
                let off_in_piece = if want == 0 {
                    0
                } else if p.orig {
                    let ix = self.index.read();
                    let data = self.data();
                    let first = ix.line_at_offset(data, p.start);
                    let abs = ix.line_start(data, first + want)?;
                    abs - p.start
                } else {
                    let sl = self.piece_slice(p);
                    let mut pos = 0usize;
                    for _ in 0..want {
                        pos += memchr(self.sep, &sl[pos..])? + 1;
                    }
                    pos as u64
                };
                let mut idx = i;
                let mut off = off_in_piece;
                let mut doc_off = acc_len + off_in_piece;
                while idx + 1 < self.pieces.len() && off >= self.pieces[idx].len {
                    off -= self.pieces[idx].len;
                    idx += 1;
                }
                if idx == self.pieces.len() - 1 && off > self.pieces[idx].len {
                    return None;
                }
                doc_off = doc_off.min(self.doc_len());
                return Some((idx, off, doc_off));
            }
            acc_nl += pnl;
            acc_len += p.len;
        }
        None
    }

    /// Read forward from a piece position until `max_newlines` newlines have been
    /// emitted or `max_bytes` reached. Returns (bytes, newlines_emitted, hit_byte_cap).
    fn read_from(&self, mut idx: usize, mut off: u64, max_newlines: u64, max_bytes: usize) -> (Vec<u8>, u64, bool) {
        let mut out = Vec::new();
        let mut nls = 0u64;
        while idx < self.pieces.len() {
            let p = &self.pieces[idx];
            let sl = &self.piece_slice(p)[off as usize..];
            let mut cut = None;
            // UTF-16 files are read-only: their one piece is the file itself, so p.start + off is the file offset.
            for i in Sep::new(self.sep, self.encoding).iter(sl, p.start + off) {
                nls += 1;
                if nls >= max_newlines {
                    cut = Some(i + 1);
                    break;
                }
            }
            let take = cut.unwrap_or(sl.len());
            if out.len() + take > max_bytes {
                out.extend_from_slice(&sl[..max_bytes - out.len()]);
                return (out, nls, true);
            }
            out.extend_from_slice(&sl[..take]);
            if cut.is_some() {
                return (out, nls, false);
            }
            idx += 1;
            off = 0;
        }
        (out, nls, false)
    }

    pub fn get_lines(&self, start: u64, count: u64) -> LinesChunk {
        let total = self.total_lines();
        let indexed = self.is_indexed();
        let count = count.min(5000);
        let mut lines = Vec::new();
        let mut lossy = Vec::new();
        let mut truncated = false;
        if let Some((idx, off, doc_off)) = self.locate_line(start) {
            let avail = if indexed { total } else { self.total_newlines() };
            let want = count.min(avail.saturating_sub(start));
            if want > 0 {
                let (bytes, _, cap) = self.read_from(idx, off, want, MAX_READ_BYTES);
                truncated = cap;
                let sep = self.sep;
                let mut parts: Vec<&[u8]> = Vec::new();
                let mut from = 0usize;
                for i in Sep::new(sep, self.encoding).iter(&bytes, doc_off) {
                    parts.push(&bytes[from..i]);
                    from = i + 1;
                }
                parts.push(&bytes[from..]);
                if parts.len() as u64 > want {
                    parts.truncate(want as usize);
                }
                for (k, part) in parts.into_iter().enumerate() {
                    let n = start + k as u64;
                    let (text, bad) = decode_line(part, n, sep, self.encoding);
                    if bad {
                        lossy.push(k as u32);
                    }
                    lines.push(text);
                }
            }
        }
        LinesChunk { start, lines, total_lines: total, indexed, truncated, lossy }
    }

    /// Doc byte range of line `n`'s content (excluding the line terminator).
    fn line_range(&self, n: u64) -> Option<(u64, u64)> {
        let (idx, off, doc_off) = self.locate_line(n)?;
        let (bytes, nls, cap) = self.read_from(idx, off, 1, usize::MAX);
        let _ = cap;
        let mut end = doc_off + bytes.len() as u64;
        if nls > 0 {
            end -= 1;
            if self.sep == b'\n' && bytes.len() >= 2 && bytes[bytes.len() - 2] == b'\r' {
                end -= 1;
            }
        }
        Some((doc_off, end))
    }

    fn ensure_editable(&self) -> Result<(), String> {
        if self.encoding != "UTF-8" {
            return Err(format!("{} large files are read-only; open them below the large-file threshold to edit.", self.encoding));
        }
        if !self.is_indexed() {
            return Err("File is still being indexed; editing is available once indexing completes.".into());
        }
        Ok(())
    }

    fn freeze_pieces(&mut self) {
        // Once we edit, the single orig piece needs its concrete newline count.
        if self.single_orig() {
            let nl = self.index.read().newlines;
            self.pieces[0].nl = nl;
        }
    }

    fn piece_count_nl(&self, orig: bool, start: u64, len: u64) -> u64 {
        if orig {
            self.index.read().count_newlines(self.data(), start, start + len)
        } else {
            memchr_iter(self.sep, &self.add[start as usize..(start + len) as usize]).count() as u64
        }
    }

    /// Ensure a piece boundary exists at `doc_off`; return the index of the piece starting there.
    fn split_at(&mut self, doc_off: u64) -> usize {
        let mut acc = 0u64;
        for i in 0..self.pieces.len() {
            let p = self.pieces[i].clone();
            if doc_off == acc {
                return i;
            }
            if doc_off < acc + p.len {
                let left_len = doc_off - acc;
                let left_nl = self.piece_count_nl(p.orig, p.start, left_len);
                let left = Piece { orig: p.orig, start: p.start, len: left_len, nl: left_nl };
                let right = Piece { orig: p.orig, start: p.start + left_len, len: p.len - left_len, nl: p.nl - left_nl };
                self.pieces[i] = left;
                self.pieces.insert(i + 1, right);
                return i + 1;
            }
            acc += p.len;
        }
        self.pieces.len()
    }

    pub fn replace_range(&mut self, from: u64, to: u64, text: &[u8]) -> Result<(), String> {
        self.ensure_editable()?;
        let len = self.doc_len();
        let from = from.min(len);
        let to = to.clamp(from, len);
        self.freeze_pieces();
        self.undo.push(self.pieces.clone());
        if self.undo.len() > 200 {
            self.undo.remove(0);
            // The dropped snapshot might have been the clean one.
            self.clean_depth = match self.clean_depth {
                Some(0) | None => None,
                Some(d) => Some(d - 1),
            };
        }
        self.redo.clear();
        let a = self.split_at(from);
        let b = self.split_at(to);
        self.pieces.drain(a..b);
        if !text.is_empty() {
            let start = self.add.len() as u64;
            self.add.extend_from_slice(text);
            let nl = memchr_iter(self.sep, text).count() as u64;
            self.pieces.insert(a, Piece { orig: false, start, len: text.len() as u64, nl });
        }
        self.pieces.retain(|p| p.len > 0);
        if self.pieces.is_empty() {
            self.pieces.push(Piece { orig: false, start: self.add.len() as u64, len: 0, nl: 0 });
        }
        Ok(())
    }

    pub fn replace_line(&mut self, n: u64, text: &str) -> Result<(), String> {
        self.ensure_editable()?;
        let (s, e) = self.line_range(n).ok_or("line out of range")?;
        // The UI only ever sees the first MAX_READ_BYTES of a line; writing that back would cut the rest.
        if e - s > MAX_READ_BYTES as u64 {
            return Err(format!("Line {} is longer than {} MB and cannot be edited in large-file mode.", n + 1, MAX_READ_BYTES >> 20));
        }
        let normalized = text.replace("\r\n", "\n").replace('\n', std::str::from_utf8(self.eol).unwrap());
        self.replace_range(s, e, normalized.as_bytes())
    }

    pub fn delete_lines(&mut self, from: u64, to: u64) -> Result<(), String> {
        self.ensure_editable()?;
        let total = self.total_lines();
        if from > to || to >= total {
            return Err("line out of range".into());
        }
        let (start, _) = self.line_range(from).ok_or("line out of range")?;
        let end = if to + 1 < total {
            self.locate_line(to + 1).ok_or("line out of range")?.2
        } else {
            self.doc_len()
        };
        // Deleting through the last line: also remove the terminator before `from`.
        let start = if to + 1 >= total && from > 0 {
            let (_, prev_end) = self.line_range(from - 1).ok_or("line out of range")?;
            prev_end
        } else {
            start
        };
        self.replace_range(start, end, b"")
    }

    pub fn insert_lines(&mut self, at: u64, text: &str) -> Result<(), String> {
        self.ensure_editable()?;
        let total = self.total_lines();
        let eol = std::str::from_utf8(self.eol).unwrap();
        let body = text.replace("\r\n", "\n").replace('\n', eol);
        if at >= total {
            let len = self.doc_len();
            let s = format!("{eol}{body}");
            self.replace_range(len, len, s.as_bytes())
        } else {
            let off = self.locate_line(at).ok_or("line out of range")?.2;
            let s = format!("{body}{eol}");
            self.replace_range(off, off, s.as_bytes())
        }
    }

    pub fn undo(&mut self) -> bool {
        match self.undo.pop() {
            Some(prev) => {
                self.redo.push(std::mem::replace(&mut self.pieces, prev));
                true
            }
            None => false,
        }
    }

    pub fn redo(&mut self) -> bool {
        match self.redo.pop() {
            Some(next) => {
                self.undo.push(std::mem::replace(&mut self.pieces, next));
                true
            }
            None => false,
        }
    }

    /// Visit the document as chunks that end on newline boundaries (except at piece ends).
    /// Callback gets (first_line_number_of_chunk, bytes). Returning false stops.
    /// Call `f(first_line, chunk)` over the document in order. Every chunk starts at a line start and
    /// ends at a line end (or the end of the document): a line that crosses a piece boundary (an
    /// edit leaves one before the line's ending) is carried over and joined, so `^` / `$` and
    /// patterns never see half a line.
    fn for_each_chunk<F: FnMut(u64, &[u8]) -> bool>(&self, mut f: F) {
        let mut line = 0u64;
        let sep = Sep::new(self.sep, self.encoding);
        let mut carry: Vec<u8> = Vec::new();
        let mut emit = |chunk: &[u8], base: u64, line: &mut u64| -> bool {
            if !f(*line, chunk) {
                return false;
            }
            *line += sep.count(chunk, base);
            true
        };
        let last = self.pieces.len().saturating_sub(1);
        for (pi, p) in self.pieces.iter().enumerate() {
            let sl = self.piece_slice(p);
            let mut pos = 0usize;
            while pos < sl.len() {
                let mut end = (pos + SEARCH_CHUNK).min(sl.len());
                if end < sl.len() {
                    // Extend to include the rest of the current line.
                    match sep.find(&sl[end..], p.start + end as u64) {
                        Some(i) => end += i + 1,
                        None => end = sl.len(),
                    }
                }
                let chunk = &sl[pos..end];
                let base = p.start + pos as u64;
                pos = end;
                // At the end of a piece (not the last) the line may go on in the next one: keep its
                // start for the next chunk. UTF-16 files are read-only, one piece, so never here.
                let tail_from = if end == sl.len() && pi < last { chunk.iter().rposition(|&b| b == sep.byte).map_or(0, |i| i + 1) } else { chunk.len() };
                let (whole, tail) = chunk.split_at(tail_from);
                if !whole.is_empty() {
                    let ok = if carry.is_empty() {
                        emit(whole, base, &mut line)
                    } else {
                        carry.extend_from_slice(whole);
                        let joined = std::mem::take(&mut carry);
                        emit(&joined, base, &mut line)
                    };
                    if !ok {
                        return;
                    }
                }
                carry.extend_from_slice(tail);
            }
        }
        if !carry.is_empty() {
            emit(&carry, 0, &mut line);
        }
    }

    pub fn search(&self, opts: &SearchOpts) -> Result<BigSearchResult, String> {
        if self.encoding != "UTF-8" {
            return self.search_decoded(opts);
        }
        let re = build_regex(opts)?;
        let mut matches = Vec::new();
        let mut total = 0u64;
        let mut truncated = false;
        self.for_each_chunk(|first_line, chunk| {
            let mut line = first_line;
            let mut cursor = 0usize; // bytes already counted for `line`
            let mut line_start = 0usize;
            for m in re.find_iter(chunk) {
                if m.start() == m.end() && m.start() >= chunk.len() {
                    break;
                }
                total += 1;
                if matches.len() < opts.max_results {
                    for i in memchr_iter(self.sep, &chunk[cursor..m.start()]) {
                        line += 1;
                        line_start = cursor + i + 1;
                    }
                    cursor = m.start();
                    // Look for the line end only within the preview window: on a 500 MB line an unbounded
                    // scan per match turned the first 1 000 matches into ~500 GB of memchr.
                    let window_end = (m.start() + PREVIEW_BYTES).min(chunk.len());
                    let line_end = memchr(self.sep, &chunk[m.start()..window_end]).map(|i| m.start() + i).unwrap_or(window_end);
                    let col = (m.start() - line_start) as u64;
                    let pstart = if col as usize > 40 { m.start() - 40 } else { line_start };
                    let pend = (pstart + PREVIEW_BYTES).min(line_end);
                    let preview_bytes = &chunk[pstart..pend.max(pstart)];
                    let preview_bytes = preview_bytes.strip_suffix(b"\r").unwrap_or(preview_bytes);
                    matches.push(BigMatch {
                        line,
                        col,
                        len: (m.end() - m.start()) as u64,
                        preview: String::from_utf8_lossy(preview_bytes).into_owned(),
                        preview_col: (m.start() - pstart) as u64,
                    });
                } else {
                    truncated = true;
                }
                if total > 5_000_000 {
                    return false;
                }
            }
            true
        });
        Ok(BigSearchResult { matches, total, truncated })
    }

    /// Find in a UTF-16 document: each line is decoded and searched as UTF-8, so matches never span
    /// lines. Columns are byte offsets into the decoded line, as for UTF-8 documents.
    fn search_decoded(&self, opts: &SearchOpts) -> Result<BigSearchResult, String> {
        let re = build_regex(opts)?;
        let mut matches = Vec::new();
        let mut total = 0u64;
        let mut truncated = false;
        let sep = Sep::new(self.sep, self.encoding);
        let mut base = 0u64; // file offset of `chunk` (a read-only UTF-16 file is one piece)
        self.for_each_chunk(|first_line, chunk| {
            let chunk_base = base;
            base += chunk.len() as u64;
            let mut line = first_line;
            let mut start = 0usize;
            loop {
                let end = sep.find(&chunk[start..], chunk_base + start as u64).map(|i| start + i);
                let part = &chunk[start..end.unwrap_or(chunk.len())];
                if end.is_none() && part.is_empty() {
                    break;
                }
                let (text, _) = decode_line(part, line, self.sep, &self.encoding);
                for m in re.find_iter(text.as_bytes()) {
                    total += 1;
                    if matches.len() < opts.max_results {
                        let pstart = floor_boundary(&text, m.start().saturating_sub(40));
                        let pend = floor_boundary(&text, (pstart + PREVIEW_BYTES).min(text.len())).max(m.start());
                        matches.push(BigMatch {
                            line,
                            col: m.start() as u64,
                            len: (m.end() - m.start()) as u64,
                            preview: text[pstart..pend].to_owned(),
                            preview_col: (m.start() - pstart) as u64,
                        });
                    } else {
                        truncated = true;
                    }
                    if total > 5_000_000 {
                        return false;
                    }
                }
                match end {
                    Some(e) => {
                        start = e + 1;
                        line += 1;
                    }
                    None => break,
                }
            }
            true
        });
        Ok(BigSearchResult { matches, total, truncated })
    }

    /// Replace every match by streaming the result to a temp file that becomes the new backing store.
    /// `keep_case`: Preserve Case, as in Replace in Files (`search::preserve_case`).
    pub fn replace_all<F>(&mut self, opts: &SearchOpts, replacement: &str, keep_case: bool, on_progress: F) -> Result<u64, String>
    where
        F: Fn(IndexProgress) + Send + 'static,
    {
        self.ensure_editable()?;
        let re = build_regex(opts)?;
        let rep: &[u8] = replacement.as_bytes();
        // JavaScript `$` rules, as in Replace in Files; a plain-text search replaces literally.
        let parts = crate::search::parse_replacement(replacement, re.captures_len(), re.capture_names().any(|n| n.is_some()));
        let dir = std::env::temp_dir();
        let tmp = tempfile::Builder::new().prefix("quarry-").tempfile_in(&dir).map_err(|e| e.to_string())?;
        let mut w = BufWriter::with_capacity(4 << 20, tmp.reopen().map_err(|e| e.to_string())?);
        let mut count = 0u64;
        let mut io_err: Option<String> = None;
        self.for_each_chunk(|_, chunk| {
            let mut last = 0usize;
            for caps in re.captures_iter(chunk) {
                let m = caps.get(0).unwrap();
                // An empty match at the very end of a chunk (`^` after its last line ending) is the
                // next chunk's first line, or nothing at the end of the file: Find skips it too.
                if m.start() == m.end() && m.start() >= chunk.len() {
                    break;
                }
                count += 1;
                if let Err(e) = w.write_all(&chunk[last..m.start()]) {
                    io_err = Some(e.to_string());
                    return false;
                }
                let mut expanded = Vec::new();
                if opts.is_regex {
                    let group = |i: usize| caps.get(i).map_or(&b""[..], |g| g.as_bytes());
                    let named = |n: &str| caps.name(n).map_or(&b""[..], |g| g.as_bytes());
                    crate::search::expand_replacement(&parts, group, named, &chunk[..m.start()], &chunk[m.end()..], &mut expanded);
                } else {
                    expanded.extend_from_slice(rep);
                }
                if keep_case {
                    if let (Ok(hit), Ok(r)) = (std::str::from_utf8(m.as_bytes()), std::str::from_utf8(&expanded)) {
                        expanded = crate::search::preserve_case(hit, r).into_bytes();
                    }
                }
                if let Err(e) = w.write_all(&expanded) {
                    io_err = Some(e.to_string());
                    return false;
                }
                last = m.end();
            }
            if let Err(e) = w.write_all(&chunk[last..]) {
                io_err = Some(e.to_string());
                return false;
            }
            true
        });
        if let Some(e) = io_err {
            return Err(e);
        }
        if count == 0 {
            // Nothing matched: keep the document (and its undo history / clean state) untouched.
            return Ok(0);
        }
        w.flush().map_err(|e| e.to_string())?;
        drop(w);
        let temp_path = tmp.into_temp_path();
        self.rebind(&temp_path, on_progress)?;
        self._temp_backing = Some(temp_path);
        // The working copy on disk is not the user's file: dirty until saved.
        self.clean_depth = None;
        Ok(count)
    }

    /// Point the document at a new backing file and rebuild the index.
    fn rebind<F>(&mut self, backing: &Path, on_progress: F) -> Result<(), String>
    where
        F: Fn(IndexProgress) + Send + 'static,
    {
        // Map the new file first so a failure leaves the document as it was.
        let file = File::open(backing).map_err(|e| e.to_string())?;
        let len = file.metadata().map_err(|e| e.to_string())?.len();
        let mmap = unsafe { Mmap::map(&file).map_err(|e| e.to_string())? };
        self.stop_indexing();
        self.mmap = Some(Arc::new(mmap));
        self.backing = backing.to_path_buf();
        self.file_len = len;
        self.add = Vec::new();
        self.pieces = vec![Piece { orig: true, start: 0, len, nl: 0 }];
        self.index = Arc::new(RwLock::new(LineIndex::new(Sep::new(self.sep, self.encoding))));
        self.undo.clear();
        self.redo.clear();
        self._temp_backing = None;
        self.start_indexing(on_progress);
        Ok(())
    }

    pub fn save<F>(&mut self, target: Option<&Path>, on_progress: F) -> Result<(), String>
    where
        F: Fn(IndexProgress) + Send + 'static,
    {
        let target = target.map(Path::to_path_buf).unwrap_or_else(|| self.path.clone());
        let dir = target.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(Path::new("."));
        let tmp = tempfile::Builder::new()
            .prefix(".quarry-")
            .suffix(".tmp")
            .tempfile_in(dir)
            .map_err(|e| format!("cannot create temp file in {}: {e}", dir.display()))?;
        {
            let mut w = BufWriter::with_capacity(4 << 20, tmp.reopen().map_err(|e| e.to_string())?);
            for p in &self.pieces {
                w.write_all(self.piece_slice(p)).map_err(|e| e.to_string())?;
            }
            w.flush().map_err(|e| e.to_string())?;
        }
        // Windows cannot replace a file that is mapped: release our mapping only when the target
        // is the file we map. If the replace then fails, map the (unchanged) original again so the
        // pieces stay valid; previously the document was left without data and the next read panicked.
        let release = same_file(&target, &self.backing);
        let index_complete = self.index.read().complete;
        if release {
            self.stop_indexing();
            self.mmap = None;
        }
        let temp_path = tmp.into_temp_path();
        if let Err(e) = temp_path.persist(&target) {
            if release {
                let file = File::open(&self.backing).map_err(|e2| format!("cannot save {}: {}; reopening the original failed: {e2}", target.display(), e.error))?;
                let mmap = unsafe { Mmap::map(&file).map_err(|e2| e2.to_string())? };
                self.mmap = Some(Arc::new(mmap));
                if !index_complete {
                    self.index = Arc::new(RwLock::new(LineIndex::new(Sep::new(self.sep, self.encoding))));
                    self.start_indexing(on_progress);
                }
            }
            return Err(format!("cannot save {}: {}", target.display(), e.error));
        }
        self.path = target.clone();
        self.rebind(&target, on_progress)?;
        self.clean_depth = Some(0);
        Ok(())
    }
}

impl Drop for BigDoc {
    fn drop(&mut self) {
        self.stop_indexing();
    }
}

/// A set of line numbers as a bitset (one bit per line of the file, so 7.4 MB for 60 M lines
/// however many it holds), with a running count per 512 lines so the k-th line and a line's
/// position are found in O(log n) even for millions of scattered lines.
#[derive(Default, Clone, Debug, PartialEq)]
pub struct LineSet {
    words: Vec<u64>,
    /// `cum[b]` = lines set before block `b` (blocks of `BLOCK` words).
    cum: Vec<u64>,
    total: u64,
}

const BLOCK: usize = 8;

impl LineSet {
    pub fn total(&self) -> u64 {
        self.total
    }

    /// Add lines `start..start + len` (call `finish` before reading).
    fn push_run(&mut self, start: u64, len: u64) {
        let end = start + len;
        let need = end.div_ceil(64) as usize;
        if self.words.len() < need {
            self.words.resize(need, 0);
        }
        let mut i = start;
        while i < end {
            let (w, b) = ((i / 64) as usize, i % 64);
            let n = (64 - b).min(end - i);
            let mask = if n == 64 { u64::MAX } else { ((1u64 << n) - 1) << b };
            self.words[w] |= mask;
            i += n;
        }
    }

    /// Recount after `push_run` / `truncate_from`.
    fn finish(&mut self) {
        self.cum.clear();
        let mut total = 0u64;
        for chunk in self.words.chunks(BLOCK) {
            self.cum.push(total);
            total += chunk.iter().map(|w| w.count_ones() as u64).sum::<u64>();
        }
        self.total = total;
    }

    /// The `k`-th line (0-based) of the set.
    pub fn line_at(&self, k: u64) -> Option<u64> {
        if k >= self.total {
            return None;
        }
        let b = self.cum.partition_point(|&c| c <= k) - 1;
        let mut rest = k - self.cum[b];
        for (j, &w) in self.words[b * BLOCK..].iter().enumerate() {
            let n = w.count_ones() as u64;
            if rest < n {
                let mut w = w;
                for _ in 0..rest {
                    w &= w - 1; // drop the lowest set bit
                }
                return Some(((b * BLOCK + j) * 64) as u64 + w.trailing_zeros() as u64);
            }
            rest -= n;
        }
        None
    }

    /// Drop every line from `line` on (before re-scanning a file's last, possibly incomplete, line).
    fn truncate_from(&mut self, line: u64) {
        let w = (line / 64) as usize;
        if w < self.words.len() {
            self.words[w] &= (1u64 << (line % 64)) - 1;
            self.words.truncate(w + 1);
        }
        self.finish();
    }
}

/// Lines matching (or, with `invert`, not matching) a search, for the filter view.
pub struct LineFilter {
    pub pattern: String,
    pub is_regex: bool,
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub invert: bool,
    pub lines: LineSet,
    /// The file's last line, which may still grow (follow mode re-scans from it).
    resume_line: u64,
    resume_offset: u64,
}


impl LineFilter {
    fn opts(&self) -> SearchOpts<'_> {
        SearchOpts { pattern: &self.pattern, is_regex: self.is_regex, case_sensitive: self.case_sensitive, whole_word: self.whole_word, dot_all: false, max_results: 0 }
    }
}

/// Scan `chunk` (whole lines, the first being `first_line`) for matching lines.
fn scan_lines(re: &regex::bytes::Regex, sep: u8, chunk: &[u8], first_line: u64, invert: bool, next_unseen: &mut u64, out: &mut LineSet) -> Result<(), String> {
    let mut pos = 0usize;
    let mut line = first_line;
    while pos < chunk.len() {
        let Some(m) = re.find_at(chunk, pos) else { break };
        line += memchr_iter(sep, &chunk[pos..m.start()]).count() as u64;
        if invert {
            if line > *next_unseen {
                out.push_run(*next_unseen, line - *next_unseen);
            }
            *next_unseen = line + 1;
        } else {
            out.push_run(line, 1);
        }
        // On to the next line: a line is kept once however many matches it has.
        match memchr(sep, &chunk[m.start()..]) {
            Some(i) => {
                pos = m.start() + i + 1;
                line += 1;
            }
            None => break,
        }
    }
    Ok(())
}

impl BigDoc {
    /// Build the filter view's line set (see `LineFilter`). The file must be fully indexed, so
    /// the line count (needed for `invert`) is known.
    pub fn filter_lines(&self, pattern: &str, is_regex: bool, case_sensitive: bool, whole_word: bool, invert: bool) -> Result<LineFilter, String> {
        if self.encoding != "UTF-8" {
            return Err(format!("filtering works on UTF-8 files; this one is {}", self.encoding));
        }
        if !self.is_indexed() {
            return Err("still indexing: the filter can run once indexing finishes".into());
        }
        let mut f = LineFilter { pattern: pattern.into(), is_regex, case_sensitive, whole_word, invert, lines: LineSet::default(), resume_line: 0, resume_offset: 0 };
        let re = build_regex(&f.opts())?;
        let mut next_unseen = 0u64;
        let mut err = None;
        if let Some(data) = self.unedited_bytes() {
            scan_lines(&re, self.sep, data, 0, invert, &mut next_unseen, &mut f.lines)?;
        } else {
            self.for_each_chunk(|first, chunk| match scan_lines(&re, self.sep, chunk, first, invert, &mut next_unseen, &mut f.lines) {
                Ok(()) => true,
                Err(e) => {
                    err = Some(e);
                    false
                }
            });
        }
        if let Some(e) = err {
            return Err(e);
        }
        let total = self.total_lines();
        if invert && total > next_unseen {
            f.lines.push_run(next_unseen, total - next_unseen);
        }
        f.lines.finish();
        f.resume_line = total - 1;
        f.resume_offset = self.index.read().line_start(self.data(), total - 1).unwrap_or(0);
        Ok(f)
    }

    /// Bring a filter up to date after `follow_appended` grew the file: re-scan from the old last
    /// line (it may have been incomplete) to the end. Unedited documents only.
    pub fn extend_filter(&self, f: &mut LineFilter) -> Result<(), String> {
        let data = self.unedited_bytes().ok_or("the file has unsaved changes")?;
        let re = build_regex(&f.opts())?;
        f.lines.truncate_from(f.resume_line);
        let mut next_unseen = f.resume_line;
        let from = (f.resume_offset as usize).min(data.len());
        scan_lines(&re, self.sep, &data[from..], f.resume_line, f.invert, &mut next_unseen, &mut f.lines)?;
        let total = self.total_lines();
        if f.invert && total > next_unseen {
            f.lines.push_run(next_unseen, total - next_unseen);
        }
        f.lines.finish();
        f.resume_line = total - 1;
        f.resume_offset = self.index.read().line_start(data, total - 1).unwrap_or(0);
        Ok(())
    }

    /// Follow mode: the file grew on disk (a log still being written). Map the new length and index
    /// just the appended bytes. Only for an unedited, fully indexed document whose existing bytes
    /// are unchanged (the last 4 KB are compared); anything else is `Replaced` (the caller reloads).
    pub fn follow_appended(&mut self) -> Result<Appended, String> {
        if self.unedited_bytes().is_none() || self.is_dirty() || !self.is_indexed() || self.encoding != "UTF-8" {
            return Ok(Appended::Unchanged);
        }
        if !matches!(&self.follow_sig, Some((len, _, _)) if *len == self.file_len) {
            self.remember_follow_sig();
        }
        let new_len = std::fs::metadata(&self.backing).map_err(|e| e.to_string())?.len();
        if new_len == self.file_len {
            return Ok(Appended::Unchanged);
        }
        if new_len < self.file_len {
            return Ok(Appended::Replaced);
        }
        let file = File::open(&self.backing).map_err(|e| e.to_string())?;
        // SAFETY: as in `open`: read-only mapping of a file others may be appending to.
        let mmap = unsafe { Mmap::map(&file).map_err(|e| e.to_string())? };
        let old_len = self.file_len as usize;
        let rewritten = match &self.follow_sig {
            Some((len, head, tail)) if *len == self.file_len => mmap.len() < old_len || mmap[..head.len()] != head[..] || mmap[old_len - tail.len()..old_len] != tail[..],
            // First check since this length was mapped: nothing to compare with yet.
            _ => false,
        };
        if rewritten {
            return Ok(Appended::Replaced);
        }
        {
            let mut ix = self.index.write();
            let mut newlines = ix.newlines;
            let from = self.file_len as usize;
            for i in Sep::new(self.sep, self.encoding).iter(&mmap[from..], from as u64) {
                newlines += 1;
                if newlines % STRIDE == 0 {
                    ix.checkpoints.push((from + i + 1) as u64);
                }
            }
            ix.newlines = newlines;
            ix.indexed_bytes = mmap.len() as u64;
            ix.complete = true;
        }
        self.file_len = mmap.len() as u64;
        self.pieces = vec![Piece { orig: true, start: 0, len: self.file_len, nl: 0 }];
        self.mmap = Some(Arc::new(mmap));
        self.remember_follow_sig();
        Ok(Appended::Grew)
    }

    fn remember_follow_sig(&mut self) {
        let d = self.data();
        let n = d.len().min(4096);
        self.follow_sig = Some((self.file_len, d[..n].to_vec(), d[d.len() - n..].to_vec()));
    }
}

/// What `follow_appended` found.
#[derive(Serialize, Debug, PartialEq, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum Appended {
    Unchanged,
    Grew,
    /// Shrunk or rewritten (e.g. a rotated log): reload the file.
    Replaced,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make(content: &str) -> (tempfile::TempPath, BigDoc) {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(content.as_bytes()).unwrap();
        f.flush().unwrap();
        let path = f.into_temp_path(); // close the write handle so saves can replace the file
        let mut d = BigDoc::open(1, &path, |_| {}).unwrap();
        d.wait_indexed();
        (path, d)
    }

    fn make_bytes(content: &[u8]) -> (tempfile::TempPath, BigDoc) {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(content).unwrap();
        f.flush().unwrap();
        let path = f.into_temp_path();
        let mut d = BigDoc::open(1, &path, |_| {}).unwrap();
        d.wait_indexed();
        (path, d)
    }

    fn all_lines(d: &BigDoc) -> Vec<String> {
        d.get_lines(0, d.total_lines()).lines
    }

    fn big_text(n: usize) -> String {
        (0..n).map(|i| format!("line {i}\n")).collect()
    }

    #[test]
    fn reads_lines_across_checkpoints() {
        let n = 5000;
        let (_f, d) = make(&big_text(n));
        assert!(d.is_indexed());
        assert_eq!(d.total_lines(), n as u64 + 1);
        let c = d.get_lines(1020, 10);
        assert_eq!(c.lines[0], "line 1020");
        assert_eq!(c.lines[9], "line 1029");
        let c = d.get_lines(4999, 5);
        assert_eq!(c.lines, vec!["line 4999".to_string(), String::new()]);
    }

    #[test]
    fn edits_and_undo() {
        let (_f, mut d) = make("a\nbb\nccc\n");
        d.replace_line(1, "BB!").unwrap();
        assert_eq!(all_lines(&d), vec!["a", "BB!", "ccc", ""]);
        d.insert_lines(1, "x\ny").unwrap();
        assert_eq!(all_lines(&d), vec!["a", "x", "y", "BB!", "ccc", ""]);
        d.delete_lines(1, 2).unwrap();
        assert_eq!(all_lines(&d), vec!["a", "BB!", "ccc", ""]);
        d.delete_lines(3, 3).unwrap();
        assert_eq!(all_lines(&d), vec!["a", "BB!", "ccc"]);
        assert!(d.undo());
        assert!(d.undo());
        assert!(d.undo());
        assert!(d.undo());
        assert_eq!(all_lines(&d), vec!["a", "bb", "ccc", ""]);
        assert!(d.redo());
        assert_eq!(all_lines(&d), vec!["a", "BB!", "ccc", ""]);
    }

    #[test]
    fn undo_to_original_is_clean() {
        let (_f, mut d) = make("a
b
");
        assert!(!d.is_dirty());
        d.replace_line(0, "A").unwrap();
        assert!(d.is_dirty());
        d.replace_line(1, "B").unwrap();
        assert!(d.undo());
        assert!(d.is_dirty());
        assert!(d.undo());
        assert!(!d.is_dirty(), "undoing every edit restores the clean state");
        assert!(d.redo());
        assert!(d.is_dirty());
        assert!(d.undo());
        assert!(!d.is_dirty());
        // A fresh edit from the clean state is dirty even though redo history is gone.
        d.replace_line(0, "a").unwrap();
        assert!(d.is_dirty());
    }

    #[test]
    fn replace_all_stays_dirty_after_undo_history_reset() {
        let (_f, mut d) = make("x
y
");
        let opts = SearchOpts { pattern: "x", is_regex: false, case_sensitive: true, whole_word: false, dot_all: false, max_results: 10 };
        d.replace_all(&opts, "z", false, |_| {}).unwrap();
        d.wait_indexed();
        assert!(d.is_dirty());
        assert!(!d.undo());
        assert!(d.is_dirty());
        d.save(None, |_| {}).unwrap();
        d.wait_indexed();
        assert!(!d.is_dirty());
    }

    #[test]
    fn crlf_preserved() {
        let (_f, mut d) = make("a\r\nb\r\nc");
        d.replace_line(1, "B").unwrap();
        assert_eq!(all_lines(&d), vec!["a", "B", "c"]);
        let (s, e) = d.line_range(2).unwrap();
        assert_eq!((s, e), (6, 7));
    }

    #[test]
    fn unedited_bytes_is_the_file_until_it_is_edited() {
        let (_f, mut d) = make("a\nb\n");
        assert_eq!(d.unedited_bytes(), Some(&b"a\nb\n"[..]));
        d.replace_line(0, "A").unwrap();
        assert_eq!(d.unedited_bytes(), None);
    }

    #[test]
    fn line_set_matches_a_plain_list() {
        // Runs across word (64) and block (512) boundaries, a single line, a long run.
        let runs = [(0u64, 1u64), (63, 2), (100, 1), (511, 3), (600, 1000), (5000, 1)];
        let mut set = LineSet::default();
        let mut plain = Vec::new();
        for &(s, n) in &runs {
            set.push_run(s, n);
            plain.extend(s..s + n);
        }
        set.finish();
        assert_eq!(set.total(), plain.len() as u64);
        for (k, &line) in plain.iter().enumerate() {
            assert_eq!(set.line_at(k as u64), Some(line), "k = {k}");
        }
        assert_eq!(set.line_at(plain.len() as u64), None);
        set.truncate_from(600);
        // 0, 63, 64, 100, 511, 512, 513 remain.
        assert_eq!(set.total(), 7);
        assert_eq!(set.line_at(6), Some(513));
    }

    #[test]
    fn filter_keeps_matching_lines_as_runs() {
        let (_f, d) = make("a ERROR\nb\nc ERROR ERROR\nd ERROR\ne\n");
        let f = d.filter_lines("ERROR", false, true, false, false).unwrap();
        assert_eq!(f.lines.total(), 3);
        assert_eq!((0..3).map(|k| f.lines.line_at(k).unwrap()).collect::<Vec<_>>(), vec![0, 2, 3]);
        let inv = d.filter_lines("ERROR", false, true, false, true).unwrap();
        // Lines 1, 4 and the empty last line 5.
        assert_eq!((0..inv.lines.total()).map(|k| inv.lines.line_at(k).unwrap()).collect::<Vec<_>>(), vec![1, 4, 5]);
        assert!(d.filter_lines("(", true, true, false, false).is_err());
    }

    #[test]
    fn follow_maps_appended_lines_and_extends_the_filter() {
        use std::io::{Seek, SeekFrom};
        let (path, mut d) = make("one ERROR\ntwo\nthree ERR");
        let mut f = d.filter_lines("ERROR", false, true, false, false).unwrap();
        assert_eq!(f.lines.total(), 1);
        assert_eq!(d.follow_appended().unwrap(), Appended::Unchanged);
        std::fs::OpenOptions::new().append(true).open(&path).unwrap().write_all(b"OR\nfour\nfive ERROR\n").unwrap();
        assert_eq!(d.follow_appended().unwrap(), Appended::Grew);
        assert_eq!(all_lines(&d), vec!["one ERROR", "two", "three ERROR", "four", "five ERROR", ""]);
        d.extend_filter(&mut f).unwrap();
        assert_eq!((0..f.lines.total()).map(|k| f.lines.line_at(k).unwrap()).collect::<Vec<_>>(), vec![0, 2, 4]);
        // Rewritten in place and longer (Windows refuses to truncate a mapped file): not an append.
        let mut w = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
        w.seek(SeekFrom::Start(0)).unwrap();
        w.write_all(b"REWRITTEN FROM THE START, AND LONGER THAN BEFORE\n").unwrap();
        drop(w);
        assert_eq!(d.follow_appended().unwrap(), Appended::Replaced);
    }

    #[test]
    fn replace_all_can_preserve_case() {
        let (_f, mut d) = make("foo Foo FOO\nfoo\n");
        let opts = SearchOpts { pattern: "foo", is_regex: false, case_sensitive: false, whole_word: false, dot_all: false, max_results: 10 };
        assert_eq!(d.replace_all(&opts, "bar", true, |_| {}).unwrap(), 4);
        d.wait_indexed();
        assert_eq!(all_lines(&d), vec!["bar Bar BAR", "bar", ""]);
    }

    #[test]
    fn plain_replace_all_keeps_dollar_literal() {
        let (_f, mut d) = make("price x
");
        let opts = SearchOpts { pattern: "x", is_regex: false, case_sensitive: true, whole_word: false, dot_all: false, max_results: 10 };
        assert_eq!(d.replace_all(&opts, "$5 $$ $1 $&", false, |_| {}).unwrap(), 1);
        d.wait_indexed();
        assert_eq!(all_lines(&d), vec!["price $5 $$ $1 $&", ""]);
    }

    #[test]
    fn search_and_replace_all() {
        let (_f, mut d) = make(&big_text(3000));
        let opts = SearchOpts { pattern: r"line (2\d\d\d)", is_regex: true, case_sensitive: true, whole_word: false, dot_all: false, max_results: 10 };
        let r = d.search(&opts).unwrap();
        assert_eq!(r.total, 1000);
        assert_eq!(r.matches.len(), 10);
        assert_eq!(r.matches[0].line, 2000);
        assert_eq!(r.matches[0].col, 0);
        assert!(r.truncated);
        let n = d.replace_all(&opts, "L$1", false, |_| {}).unwrap();
        assert_eq!(n, 1000);
        d.wait_indexed();
        assert_eq!(d.get_lines(2000, 1).lines[0], "L2000");
        assert_eq!(d.get_lines(1999, 1).lines[0], "line 1999");
    }

    #[test]
    fn save_roundtrip() {
        let (f, mut d) = make("one\ntwo\nthree\n");
        d.replace_line(0, "ONE").unwrap();
        d.save(None, |_| {}).unwrap();
        d.wait_indexed();
        assert!(!d.is_dirty());
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "ONE\ntwo\nthree\n");
        assert_eq!(all_lines(&d), vec!["ONE", "two", "three", ""]);
    }

    #[test]
    fn cr_only_files_split_on_cr_and_edit_in_place() {
        let (f, mut d) = make("one\rtwo\rthree");
        assert_eq!(d.info().eol, "CR");
        assert_eq!(d.total_lines(), 3);
        assert_eq!(all_lines(&d), vec!["one", "two", "three"]);
        d.replace_line(1, "TWO").unwrap();
        d.insert_lines(3, "four").unwrap();
        assert_eq!(all_lines(&d), vec!["one", "TWO", "three", "four"]);
        let r = d.search(&SearchOpts { pattern: "three", is_regex: false, case_sensitive: true, whole_word: false, dot_all: false, max_results: 10 }).unwrap();
        assert_eq!((r.total, r.matches[0].line), (1, 2));
        d.save(None, |_| {}).unwrap();
        assert_eq!(std::fs::read(&f).unwrap(), b"one\rTWO\rthree\rfour");
    }

    #[test]
    fn mixed_eol_keeps_lone_cr_inside_lines() {
        let (_f, d) = make("a\r\nb\rc\nd");
        assert_eq!(d.info().eol, "CRLF");
        assert_eq!(all_lines(&d), vec!["a", "b\rc", "d"]);
    }

    #[test]
    fn invalid_utf8_lines_are_flagged() {
        let (_f, d) = make_bytes(b"ok\ncaf\xe9\n\xff\xfe\nfine");
        let c = d.get_lines(0, 10);
        assert_eq!(c.lossy, vec![1, 2]);
        assert_eq!(c.lines[1], "caf\u{fffd}");
        assert_eq!(c.lines[3], "fine");
    }

    #[test]
    fn utf16_files_are_decoded_and_read_only() {
        let text = "h\u{e9}llo \u{4e16}\r\nsecond\r\nlast";
        for (le, bom) in [(true, [0xffu8, 0xfe]), (false, [0xfe, 0xff])] {
            let mut bytes = bom.to_vec();
            for u in text.encode_utf16() {
                bytes.extend_from_slice(&if le { u.to_le_bytes() } else { u.to_be_bytes() });
            }
            let (_f, mut d) = make_bytes(&bytes);
            assert_eq!(d.info().encoding, if le { "UTF-16LE" } else { "UTF-16BE" });
            assert_eq!(d.info().eol, "CRLF");
            let c = d.get_lines(0, 10);
            assert_eq!(c.lines, vec!["h\u{e9}llo \u{4e16}", "second", "last"], "le={le}");
            assert!(c.lossy.is_empty());
            assert!(d.replace_line(0, "x").unwrap_err().contains("read-only"));
            let opts = SearchOpts { pattern: "SECOND|\u{4e16}", is_regex: true, case_sensitive: false, whole_word: false, dot_all: false, max_results: 10 };
            let r = d.search(&opts).unwrap();
            assert_eq!(r.total, 2, "le={le}");
            assert_eq!((r.matches[0].line, r.matches[0].col, r.matches[0].len), (0, 7, 3), "byte column in the decoded line");
            assert_eq!(r.matches[0].preview, "h\u{e9}llo \u{4e16}");
            assert_eq!((r.matches[1].line, r.matches[1].col, r.matches[1].preview.as_str()), (1, 0, "second"));
        }
    }

    #[test]
    fn utf16_lines_end_only_at_a_whole_line_feed() {
        // 上 = U+4E0A (bytes 0A 4E in LE, 4E 0A in BE); U+0A0A has 0x0A in both bytes.
        let text = "\u{4e0a}\u{4e0a}a\nb\u{a0a}c\n\u{4e0a}";
        for (le, bom) in [(true, [0xffu8, 0xfe]), (false, [0xfe, 0xff])] {
            let mut bytes = bom.to_vec();
            for u in text.encode_utf16() {
                bytes.extend_from_slice(&if le { u.to_le_bytes() } else { u.to_be_bytes() });
            }
            let (_f, d) = make_bytes(&bytes);
            assert_eq!(d.total_lines(), 3, "le={le}");
            assert_eq!(d.get_lines(0, 10).lines, vec!["\u{4e0a}\u{4e0a}a", "b\u{a0a}c", "\u{4e0a}"], "le={le}");
            assert_eq!(d.get_lines(2, 1).lines, vec!["\u{4e0a}"], "le={le}");
            let opts = SearchOpts { pattern: "\u{4e0a}", is_regex: false, case_sensitive: true, whole_word: false, dot_all: false, max_results: 10 };
            let r = d.search(&opts).unwrap();
            assert_eq!(r.matches.iter().map(|m| m.line).collect::<Vec<_>>(), vec![0, 0, 2], "le={le}");
        }
    }

    #[test]
    fn regex_anchors_after_a_line_edit_see_whole_lines() {
        let (_f, mut d) = make("alpha\r\nbeta\r\ngamma\r\n");
        d.replace_line(1, "BETA").unwrap();
        let opts = SearchOpts { pattern: "^", is_regex: true, case_sensitive: true, whole_word: false, dot_all: false, max_results: 100 };
        let r = d.search(&opts).unwrap();
        assert_eq!(r.matches.iter().map(|m| (m.line, m.col)).collect::<Vec<_>>(), vec![(0, 0), (1, 0), (2, 0)]);
        let n = d.replace_all(&opts, "> ", false, |_| {}).unwrap();
        assert_eq!(n, 3);
        d.wait_indexed();
        assert_eq!(all_lines(&d), vec!["> alpha", "> BETA", "> gamma", ""]);
    }

    #[test]
    fn empty_file_has_one_empty_line() {
        let (_f, d) = make("");
        assert_eq!(d.total_lines(), 1);
        assert_eq!(all_lines(&d), vec![""]);
    }

    #[test]
    fn search_on_one_huge_line_is_linear() {
        // 20 MB without a newline and a match every 10 bytes: previews must not rescan to the line end.
        let (_f, d) = make(&"abcdefghij".repeat(2_000_000));
        let t0 = std::time::Instant::now();
        let r = d.search(&SearchOpts { pattern: "jabcdefghija", is_regex: false, case_sensitive: true, whole_word: false, dot_all: false, max_results: 1000 }).unwrap();
        assert_eq!(r.matches.len(), 1000);
        assert!(r.truncated);
        assert!(r.matches[999].preview.len() <= PREVIEW_BYTES);
        assert!(t0.elapsed().as_secs() < 10, "search took {:?}", t0.elapsed());
    }

    #[test]
    fn lines_longer_than_the_read_cap_cannot_be_edited() {
        let (_f, mut d) = make(&format!("{}\nshort", "x".repeat(MAX_READ_BYTES + 10)));
        let c = d.get_lines(0, 2);
        assert!(c.truncated);
        assert!(d.replace_line(0, "cut").unwrap_err().contains("cannot be edited"));
        d.replace_line(1, "SHORT").unwrap();
        assert_eq!(d.get_lines(1, 1).lines, vec!["SHORT"]);
    }

    #[test]
    fn replace_all_without_matches_changes_nothing() {
        let (_f, mut d) = make("alpha\nbeta\n");
        d.replace_line(0, "ALPHA").unwrap();
        d.undo();
        assert!(!d.is_dirty());
        let opts = SearchOpts { pattern: "zzz", is_regex: false, case_sensitive: true, whole_word: false, dot_all: false, max_results: 10 };
        assert_eq!(d.replace_all(&opts, "x", false, |_| {}).unwrap(), 0);
        assert!(!d.is_dirty());
        assert!(d.redo(), "undo history must survive a no-op replace-all");
    }

    #[test]
    fn failed_save_keeps_the_document_readable() {
        let (_f, mut d) = make("one\ntwo\n");
        d.replace_line(0, "ONE").unwrap();
        // Saving into a directory that does not exist fails before anything is released.
        let bad = std::env::temp_dir().join("quarry-no-such-dir").join("x.txt");
        assert!(d.save(Some(&bad), |_| {}).is_err());
        assert_eq!(all_lines(&d), vec!["ONE", "two", ""]);
        // Saving over a file that another document maps fails at the replace step (Windows).
        let (other_path, other) = make("other\n");
        let r = d.save(Some(&other_path), |_| {});
        if r.is_err() {
            assert_eq!(all_lines(&d), vec!["ONE", "two", ""], "document must stay readable after a failed save");
            assert!(d.is_dirty());
        }
        drop(other);
        // And saving over its own file still works.
        d.save(None, |_| {}).unwrap();
        d.wait_indexed();
        assert_eq!(all_lines(&d), vec!["ONE", "two", ""]);
    }

    #[test]
    fn same_file_compares_canonical_paths() {
        let (p, _d) = make("x");
        let dotted = p.parent().unwrap().join(".").join(p.file_name().unwrap());
        assert!(same_file(&p, &dotted));
        assert!(!same_file(&p, Path::new("C:/definitely/missing.txt")));
    }
}
