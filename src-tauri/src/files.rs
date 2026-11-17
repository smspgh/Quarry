//! Regular-file I/O: encoding detection, line-ending detection, directory listing.

use encoding_rs::{Encoding, UTF_8};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
    pub modified_ms: u64,
    pub readonly: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    pub path: String,
    pub content: String,
    pub encoding: String,
    pub has_bom: bool,
    pub eol: String,
    pub size: u64,
    pub modified_ms: u64,
    pub had_decode_errors: bool,
    /// NUL bytes in the first 8 KiB: almost certainly not a text file.
    pub looks_binary: bool,
    /// More than one kind of line ending was found (saving normalises to `eol`).
    pub mixed_eol: bool,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WriteOptions {
    pub encoding: Option<String>,
    pub bom: Option<bool>,
}

fn modified_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn stat(path: &Path) -> Result<FileStat, String> {
    let meta = fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(FileStat {
        path: path.to_string_lossy().into_owned(),
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        size: meta.len(),
        is_dir: meta.is_dir(),
        modified_ms: modified_ms(&meta),
        readonly: meta.permissions().readonly(),
    })
}

/// Count line endings in the first ~2000 lines: (crlf, lf, cr).
fn count_eols(s: &str) -> (usize, usize, usize) {
    let mut crlf = 0usize;
    let mut lf = 0usize;
    let mut cr = 0usize;
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\r' => {
                if i + 1 < bytes.len() && bytes[i + 1] == b'\n' {
                    crlf += 1;
                    i += 1;
                } else {
                    cr += 1;
                }
            }
            b'\n' => lf += 1,
            _ => {}
        }
        i += 1;
        if crlf + lf + cr > 2000 {
            break;
        }
    }
    (crlf, lf, cr)
}

fn detect_eol(s: &str) -> &'static str {
    let (crlf, lf, cr) = count_eols(s);
    if crlf >= lf && crlf >= cr && crlf > 0 {
        "CRLF"
    } else if cr > lf && cr > 0 {
        "CR"
    } else if lf > 0 {
        "LF"
    } else if cfg!(windows) {
        "CRLF"
    } else {
        "LF"
    }
}

/// True when the sampled text uses more than one line-ending style.
fn has_mixed_eol(s: &str) -> bool {
    let (crlf, lf, cr) = count_eols(s);
    (crlf > 0) as u8 + (lf > 0) as u8 + (cr > 0) as u8 > 1
}

/// Heuristic: a NUL byte in the leading bytes means binary. UTF-16 files legitimately contain
/// NULs, so a UTF-16 BOM (or an even-length sample that looks like UTF-16 text) is exempt.
pub fn looks_binary(bytes: &[u8]) -> bool {
    if bytes.len() >= 2 && (bytes[..2] == [0xFF, 0xFE] || bytes[..2] == [0xFE, 0xFF]) {
        return false;
    }
    let sample = &bytes[..bytes.len().min(8192)];
    if !sample.contains(&0) {
        return false;
    }
    // BOM-less UTF-16: NULs alternate with ASCII in (almost) every pair.
    let pairs = sample.len() / 2;
    if pairs >= 4 {
        let le = sample.chunks_exact(2).filter(|c| c[1] == 0 && c[0] != 0 && c[0] < 0x80).count();
        let be = sample.chunks_exact(2).filter(|c| c[0] == 0 && c[1] != 0 && c[1] < 0x80).count();
        if le * 10 >= pairs * 9 || be * 10 >= pairs * 9 {
            return false;
        }
    }
    true
}

/// The encoding of `bytes` and the length of its BOM: the BOM when there is one, else
/// `force_encoding`, else a guess (chardetng over the first MB).
pub fn detect_encoding(bytes: &[u8], force_encoding: Option<&str>) -> (&'static Encoding, usize) {
    if let Some((enc, len)) = Encoding::for_bom(bytes) {
        return (enc, len);
    }
    if let Some(e) = force_encoding.and_then(|l| Encoding::for_label(l.as_bytes())) {
        return (e, 0);
    }
    let mut det = chardetng::EncodingDetector::new(chardetng::Iso2022JpDetection::Allow);
    let sample = bytes.len().min(1 << 20);
    det.feed(&bytes[..sample], bytes.len() <= sample);
    (det.guess(None, chardetng::Utf8Detection::Allow), 0)
}

pub fn read_text(path: &Path, force_encoding: Option<&str>) -> Result<TextFile, String> {
    let meta = fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut file = fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    file.read_to_end(&mut bytes)
        .map_err(|e| format!("{}: {e}", path.display()))?;

    let (encoding, bom_len) = detect_encoding(&bytes, force_encoding);
    let (cow, had_errors) = encoding.decode_without_bom_handling(&bytes[bom_len..]);
    let content = cow.into_owned();
    let eol = detect_eol(&content).to_string();
    let mixed_eol = has_mixed_eol(&content);
    let looks_binary = looks_binary(&bytes);
    Ok(TextFile {
        path: path.to_string_lossy().into_owned(),
        encoding: encoding.name().to_string(),
        has_bom: bom_len > 0,
        eol,
        size: meta.len(),
        modified_ms: modified_ms(&meta),
        had_decode_errors: had_errors,
        looks_binary,
        mixed_eol,
        content,
    })
}

/// Error prefix for a save refused because the target encoding cannot represent some characters.
/// Followed by tab-separated: count, first character, 1-based line of the first one, encoding name.
pub const UNMAPPABLE_PREFIX: &str = "UNMAPPABLE\t";

#[derive(Debug, PartialEq)]
struct Unmappable {
    count: usize,
    first: char,
    line: usize,
}

/// Characters of `content` that `encoding` (a non-UTF encoding) cannot represent.
fn find_unmappable(encoding: &'static Encoding, content: &str) -> Option<Unmappable> {
    let mut encoder = encoding.new_encoder();
    let mut buf = vec![0u8; 64 * 1024];
    let mut src = content;
    let mut consumed = 0usize;
    let mut found: Option<(char, usize)> = None;
    let mut count = 0usize;
    loop {
        let (res, read, _) = encoder.encode_from_utf8_without_replacement(src, &mut buf, true);
        consumed += read;
        src = &src[read..];
        match res {
            encoding_rs::EncoderResult::InputEmpty => break,
            encoding_rs::EncoderResult::OutputFull => {}
            encoding_rs::EncoderResult::Unmappable(c) => {
                count += 1;
                if found.is_none() {
                    found = Some((c, consumed - c.len_utf8()));
                }
            }
        }
    }
    let (first, offset) = found?;
    let eol = if content.contains('\n') { '\n' } else { '\r' };
    Some(Unmappable { count, first, line: content[..offset].matches(eol).count() + 1 })
}

/// `content` encoded in `encoding` (UTF-16 handled here, since encoding_rs only decodes it), with
/// a BOM when `bom` is set and the encoding has one. Characters the encoding cannot represent are
/// an error (`UNMAPPABLE_PREFIX`), never silently replaced.
pub fn encode_text(content: &str, encoding: &'static Encoding, bom: bool) -> Result<Vec<u8>, String> {
    // encoding_rs's `encode()` deliberately falls back to UTF-8 for UTF-16 (WHATWG rule), which
    // would silently corrupt a UTF-16 file on save. Encode UTF-16 ourselves.
    let encoded: std::borrow::Cow<[u8]> = if encoding == encoding_rs::UTF_16LE || encoding == encoding_rs::UTF_16BE {
        let mut v = Vec::with_capacity(content.len() * 2);
        for unit in content.encode_utf16() {
            let b = if encoding == encoding_rs::UTF_16LE { unit.to_le_bytes() } else { unit.to_be_bytes() };
            v.extend_from_slice(&b);
        }
        std::borrow::Cow::Owned(v)
    } else {
        // encoding_rs replaces unmappable characters with HTML numeric references (`&#8364;`),
        // which silently changes the text. Refuse instead and let the UI offer UTF-8.
        if let Some(u) = find_unmappable(encoding, content) {
            return Err(format!("{UNMAPPABLE_PREFIX}{}\t{}\t{}\t{}", u.count, u.first, u.line, encoding.name()));
        }
        encoding.encode(content).0
    };
    let mut out: Vec<u8> = Vec::with_capacity(encoded.len() + 3);
    if bom {
        if encoding == UTF_8 {
            out.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
        } else if encoding == encoding_rs::UTF_16LE {
            out.extend_from_slice(&[0xFF, 0xFE]);
        } else if encoding == encoding_rs::UTF_16BE {
            out.extend_from_slice(&[0xFE, 0xFF]);
        }
    }
    out.extend_from_slice(&encoded);
    Ok(out)
}

pub fn write_text(path: &Path, content: &str, opts: &WriteOptions) -> Result<FileStat, String> {
    let encoding = opts
        .encoding
        .as_deref()
        .and_then(|l| Encoding::for_label(l.as_bytes()))
        .unwrap_or(UTF_8);
    let out = encode_text(content, encoding, opts.bom.unwrap_or(false))?;

    let target = link_target(path);
    // Atomic save: write to a sibling temp file, then put it in place of the target.
    let dir = target.parent().unwrap_or_else(|| Path::new("."));
    if !dir.as_os_str().is_empty() && !dir.exists() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let dir = if dir.as_os_str().is_empty() { Path::new(".") } else { dir };
    let mut tmp = match tempfile::Builder::new().prefix(".quarry-").suffix(".tmp").tempfile_in(dir) {
        Ok(t) => t,
        // A folder where files can be changed but not created: write the file in place.
        Err(e) if target.exists() => {
            fs::write(&target, &out).map_err(|e2| format!("cannot save {} ({e}; in place: {e2})", path.display()))?;
            return stat(path);
        }
        Err(e) => return Err(format!("cannot create temp file in {}: {e}", dir.display())),
    };
    std::io::Write::write_all(&mut tmp, &out).map_err(|e| e.to_string())?;
    tmp.as_file().sync_all().ok();
    replace_with(tmp.into_temp_path(), &target).map_err(|e| format!("cannot save {}: {e}", path.display()))?;
    stat(path)
}

/// The file a save of `path` writes: through a symbolic link, the file it points to (so the link is kept).
pub(crate) fn link_target(path: &Path) -> PathBuf {
    match fs::symlink_metadata(path) {
        Ok(m) if m.file_type().is_symlink() => fs::canonicalize(path).map(|c| PathBuf::from(strip_verbatim(&c.to_string_lossy()))).unwrap_or_else(|_| path.to_path_buf()),
        _ => path.to_path_buf(),
    }
}

/// Put the saved temp file in place of `target`. An existing file is replaced with ReplaceFileW,
/// which keeps the file's own attributes, permissions (ACL), creation time and alternate data
/// streams; a plain rename would give it the temp file's. A new file is renamed into place.
#[cfg(windows)]
pub(crate) fn replace_with(tmp: tempfile::TempPath, target: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{ReplaceFileW, REPLACEFILE_IGNORE_MERGE_ERRORS};
    if target.is_file() {
        let wide = |p: &Path| p.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<u16>>();
        let (replaced, replacement) = (wide(target), wide(&tmp));
        // SAFETY: both are NUL-terminated wide strings that outlive the call; no backup, no reserved args.
        let ok = unsafe { ReplaceFileW(replaced.as_ptr(), replacement.as_ptr(), std::ptr::null(), REPLACEFILE_IGNORE_MERGE_ERRORS, std::ptr::null(), std::ptr::null()) } != 0;
        if ok {
            let _ = tmp.keep(); // already moved into place
            return Ok(());
        }
    }
    tmp.persist(target).map_err(|e| e.error.to_string())
}

#[cfg(not(windows))]
pub(crate) fn replace_with(tmp: tempfile::TempPath, target: &Path) -> Result<(), String> {
    tmp.persist(target).map_err(|e| e.error.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_ms: u64,
}

pub fn list_dir(path: &Path, show_hidden: bool) -> Result<Vec<DirEntry>, String> {
    let rd = fs::read_dir(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut out = Vec::new();
    for ent in rd.flatten() {
        let name = ent.file_name().to_string_lossy().into_owned();
        if !show_hidden && name.starts_with('.') {
            continue;
        }
        let meta = match ent.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        out.push(DirEntry {
            name,
            path: ent.path().to_string_lossy().into_owned(),
            is_dir: meta.is_dir(),
            size: meta.len(),
            modified_ms: modified_ms(&meta),
        });
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

/// Canonicalize and strip the `\\?\` verbatim prefix Windows adds (`\\?\UNC\srv\share` → `\\srv\share`).
pub fn normalize(path: &str) -> PathBuf {
    let p = PathBuf::from(path);
    match fs::canonicalize(&p) {
        Ok(c) => PathBuf::from(strip_verbatim(&c.to_string_lossy())),
        Err(_) => p,
    }
}

/// `\\?\C:\x` → `C:\x`; `\\?\UNC\srv\share\x` → `\\srv\share\x`; anything else unchanged.
pub fn strip_verbatim(s: &str) -> String {
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        s.to_string()
    }
}

#[cfg(test)]
mod encode_tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn saving_keeps_file_attributes_and_symlinks() {
        use std::os::windows::fs::MetadataExt;
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("hidden.txt");
        fs::write(&f, "old").unwrap();
        let hide = std::process::Command::new("attrib").arg("+h").arg(&f).status().unwrap();
        assert!(hide.success());
        let opts = WriteOptions { encoding: None, bom: None };
        write_text(&f, "new", &opts).unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "new");
        const HIDDEN: u32 = 0x2;
        assert_ne!(fs::metadata(&f).unwrap().file_attributes() & HIDDEN, 0, "the hidden attribute survives a save");
        // Through a symbolic link (creating one needs Developer Mode or admin; skip otherwise).
        let real = dir.path().join("real.txt");
        fs::write(&real, "a").unwrap();
        let link = dir.path().join("link.txt");
        if std::os::windows::fs::symlink_file(&real, &link).is_ok() {
            write_text(&link, "via link", &opts).unwrap();
            assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink(), "still a link");
            assert_eq!(fs::read_to_string(&real).unwrap(), "via link");
        }
        // No leftover temp files.
        assert!(fs::read_dir(dir.path()).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().starts_with(".quarry-")));
    }

    #[test]
    fn strips_verbatim_prefixes() {
        assert_eq!(strip_verbatim(r"\\?\C:\a\b.txt"), r"C:\a\b.txt");
        assert_eq!(strip_verbatim(r"\\?\UNC\srv\share\f"), r"\\srv\share\f");
        assert_eq!(strip_verbatim(r"C:\a\b.txt"), r"C:\a\b.txt");
        assert_eq!(strip_verbatim(r"\?\odd"), r"\?\odd");
    }

    #[test]
    fn utf16le_roundtrip_with_bom() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("u16.txt");
        let opts = WriteOptions { encoding: Some("UTF-16LE".into()), bom: Some(true), ..Default::default() };
        write_text(&p, "héllo\r\n€", &opts).unwrap();
        let bytes = fs::read(&p).unwrap();
        assert_eq!(&bytes[..4], &[0xFF, 0xFE, b'h', 0x00]);
        let back = read_text(&p, None).unwrap();
        assert_eq!(back.content, "héllo\r\n€");
        assert_eq!(back.encoding, "UTF-16LE");
        assert!(back.has_bom);
    }

    #[test]
    fn unmappable_characters_are_refused_not_replaced() {
        let w1252 = Encoding::for_label(b"windows-1252").unwrap();
        assert_eq!(find_unmappable(w1252, "café €5"), None);
        assert_eq!(find_unmappable(w1252, "ok\r\nline あ\r\nい"), Some(Unmappable { count: 2, first: 'あ', line: 2 }));
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.txt");
        let opts = WriteOptions { encoding: Some("windows-1252".into()), ..Default::default() };
        let err = write_text(&p, "xあ", &opts).err().expect("save must be refused");
        assert!(err.starts_with(UNMAPPABLE_PREFIX), "{err}");
        assert!(!p.exists());
        write_text(&p, "café", &opts).unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"caf\xe9");
    }
}

#[cfg(test)]
mod sniff_tests {
    use super::*;

    #[test]
    fn binary_detection() {
        assert!(!looks_binary(b"plain text\r\nmore"));
        assert!(!looks_binary(b""));
        assert!(looks_binary(b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff"));
        // UTF-16LE with BOM and without.
        assert!(!looks_binary(&[0xFF, 0xFE, b'h', 0, b'i', 0]));
        let bomless: Vec<u8> = "hello world\n".encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        assert!(!looks_binary(&bomless));
        let be: Vec<u8> = "hello world\n".encode_utf16().flat_map(|u| u.to_be_bytes()).collect();
        assert!(!looks_binary(&be));
    }

    #[test]
    fn mixed_eol_detection() {
        assert!(!has_mixed_eol("a\r\nb\r\nc"));
        assert!(!has_mixed_eol("a\nb\n"));
        assert!(!has_mixed_eol("no newlines"));
        assert!(has_mixed_eol("a\r\nb\nc"));
        assert!(has_mixed_eol("a\rb\n"));
        assert_eq!(detect_eol("a\r\nb\nc\r\n"), "CRLF");
    }

    #[test]
    fn read_text_reports_flags() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("mixed.txt");
        fs::write(&p, b"one\r\ntwo\nthree").unwrap();
        let f = read_text(&p, None).unwrap();
        assert!(f.mixed_eol);
        assert!(!f.looks_binary);
        let b = dir.path().join("bin.dat");
        fs::write(&b, b"abc\x00\x01\x02def").unwrap();
        let f = read_text(&b, None).unwrap();
        assert!(f.looks_binary);
    }
}
