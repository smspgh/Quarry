//! Copy / Cut / Paste of files and folders, through the Windows file clipboard (CF_HDROP plus
//! "Preferred DropEffect"), so files copied in Quarry paste in File Explorer and the other way round.

use serde::Serialize;
use std::path::{Path, PathBuf};

const DROPEFFECT_COPY: u32 = 1;
const DROPEFFECT_MOVE: u32 = 2;
const DROPEFFECT_LINK: u32 = 4;

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFiles {
    pub paths: Vec<String>,
    /// Put there by Cut: pasting moves them.
    pub cut: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteResult {
    pub from: String,
    /// Where it ended up (`None` when it failed or was left in place).
    pub to: Option<String>,
    pub error: Option<String>,
}

fn drop_effect_format() -> Option<u32> {
    clipboard_win::register_format("Preferred DropEffect").map(|f| f.get())
}

pub fn set_clipboard(paths: &[String], cut: bool) -> Result<(), String> {
    use clipboard_win::{options::DoClear, raw, Clipboard};
    let _open = Clipboard::new_attempts(10).map_err(|e| format!("clipboard is busy: {e}"))?;
    raw::set_file_list_with(paths, DoClear).map_err(|e| e.to_string())?;
    if let Some(f) = drop_effect_format() {
        let effect = if cut { DROPEFFECT_MOVE } else { DROPEFFECT_COPY | DROPEFFECT_LINK };
        raw::set_without_clear(f, &effect.to_le_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Files on the clipboard (none when it holds something else).
pub fn get_clipboard() -> Result<ClipboardFiles, String> {
    use clipboard_win::{raw, Clipboard};
    let _open = Clipboard::new_attempts(10).map_err(|e| format!("clipboard is busy: {e}"))?;
    let mut paths = Vec::new();
    if raw::get_file_list(&mut paths).is_err() {
        return Ok(ClipboardFiles::default());
    }
    let mut cut = false;
    if let Some(f) = drop_effect_format() {
        let mut buf = Vec::new();
        if raw::get_vec(f, &mut buf).is_ok() && buf.len() >= 4 {
            let effect = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]);
            cut = effect & DROPEFFECT_MOVE != 0 && effect & DROPEFFECT_COPY == 0;
        }
    }
    Ok(ClipboardFiles { paths, cut })
}

pub fn clear_clipboard() {
    if let Ok(_open) = clipboard_win::Clipboard::new_attempts(10) {
        let _ = clipboard_win::empty();
    }
}

/// A free name in `dir` for `name`, as File Explorer picks one: "a.txt", then "a - Copy.txt",
/// "a - Copy (2).txt", … for copies, or "a (2).txt", "a (3).txt", … otherwise.
pub fn free_name(dir: &Path, name: &str, is_dir: bool, copy: bool, exists: impl Fn(&Path) -> bool) -> PathBuf {
    let first = dir.join(name);
    if !exists(&first) {
        return first;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if !is_dir && i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    for n in 1u32.. {
        let candidate = match (copy, n) {
            (true, 1) => format!("{stem} - Copy{ext}"),
            (true, n) => format!("{stem} - Copy ({n}){ext}"),
            (false, n) => format!("{stem} ({}){ext}", n + 1),
        };
        let p = dir.join(candidate);
        if !exists(&p) {
            return p;
        }
    }
    unreachable!()
}

fn same(a: &Path, b: &Path) -> bool {
    a.to_string_lossy().to_lowercase().trim_end_matches(['\\', '/']) == b.to_string_lossy().to_lowercase().trim_end_matches(['\\', '/'])
}

fn inside(path: &Path, dir: &Path) -> bool {
    let p = path.to_string_lossy().to_lowercase();
    let d = dir.to_string_lossy().to_lowercase();
    let d = d.trim_end_matches(['\\', '/']);
    p.len() > d.len() && p.starts_with(d) && matches!(p.as_bytes()[d.len()], b'\\' | b'/')
}

fn copy_recursive(from: &Path, to: &Path) -> std::io::Result<()> {
    let meta = std::fs::symlink_metadata(from)?;
    if meta.is_dir() {
        std::fs::create_dir(to)?;
        for entry in std::fs::read_dir(from)? {
            let entry = entry?;
            copy_recursive(&entry.path(), &to.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        std::fs::copy(from, to).map(|_| ())
    }
}

/// Copy (or, with `mv`, move) `sources` into `dest`. Name clashes get a new name, never an
/// overwrite. Moving within the same folder leaves the item where it is.
pub fn paste(sources: &[String], dest: &Path, mv: bool) -> Vec<PasteResult> {
    sources
        .iter()
        .map(|src| {
            let from = Path::new(src);
            let r = (|| -> Result<Option<PathBuf>, String> {
                let meta = std::fs::symlink_metadata(from).map_err(|e| format!("{}: {e}", from.display()))?;
                let name = from.file_name().ok_or("cannot paste a drive root")?.to_string_lossy().into_owned();
                if meta.is_dir() && (same(from, dest) || inside(dest, from)) {
                    return Err(format!("cannot paste the folder \u{201c}{name}\u{201d} into itself"));
                }
                if mv && from.parent().is_some_and(|p| same(p, dest)) {
                    return Ok(None);
                }
                let to = free_name(dest, &name, meta.is_dir(), !mv, |p| p.exists());
                if mv {
                    if std::fs::rename(from, &to).is_err() {
                        // Another drive: copy, then remove the original.
                        copy_recursive(from, &to).map_err(|e| e.to_string())?;
                        let removed = if meta.is_dir() { std::fs::remove_dir_all(from) } else { std::fs::remove_file(from) };
                        removed.map_err(|e| format!("copied, but the original could not be removed: {e}"))?;
                    }
                } else if let Err(e) = copy_recursive(from, &to) {
                    if meta.is_dir() {
                        let _ = std::fs::remove_dir_all(&to);
                    }
                    return Err(e.to_string());
                }
                Ok(Some(to))
            })();
            match r {
                Ok(to) => PasteResult { from: src.clone(), to: to.map(|p| p.to_string_lossy().into_owned()), error: None },
                Err(e) => PasteResult { from: src.clone(), to: None, error: Some(e) },
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_names_follow_file_explorer() {
        let taken = ["a.txt", "a - Copy.txt", "b (2).txt", "b.txt", "dir.d"];
        let exists = |p: &Path| taken.iter().any(|t| p.ends_with(t));
        let d = Path::new("x");
        assert_eq!(free_name(d, "new.txt", false, true, exists), d.join("new.txt"));
        assert_eq!(free_name(d, "a.txt", false, true, exists), d.join("a - Copy (2).txt"));
        assert_eq!(free_name(d, "b.txt", false, false, exists), d.join("b (3).txt"));
        assert_eq!(free_name(d, "dir.d", true, true, exists), d.join("dir.d - Copy"));
    }

    #[test]
    fn paste_copies_moves_and_never_overwrites() {
        let root = tempfile::tempdir().unwrap();
        let src = root.path().join("src");
        let dst = root.path().join("dst");
        std::fs::create_dir_all(src.join("folder")).unwrap();
        std::fs::create_dir(&dst).unwrap();
        std::fs::write(src.join("a.txt"), "A").unwrap();
        std::fs::write(src.join("folder").join("inner.txt"), "I").unwrap();
        std::fs::write(dst.join("a.txt"), "existing").unwrap();
        let s = |p: PathBuf| p.to_string_lossy().into_owned();

        let res = paste(&[s(src.join("a.txt")), s(src.join("folder"))], &dst, false);
        assert!(res.iter().all(|r| r.error.is_none()));
        assert_eq!(std::fs::read_to_string(dst.join("a - Copy.txt")).unwrap(), "A");
        assert_eq!(std::fs::read_to_string(dst.join("a.txt")).unwrap(), "existing");
        assert_eq!(std::fs::read_to_string(dst.join("folder").join("inner.txt")).unwrap(), "I");
        assert!(src.join("a.txt").exists(), "copy keeps the original");

        let res = paste(&[s(src.join("folder"))], &dst, true);
        assert_eq!(res[0].to.as_deref(), Some(s(dst.join("folder (2)")).as_str()));
        assert!(!src.join("folder").exists(), "move removes the original");

        // Same folder: a copy gets a new name, a move stays put; a folder can't go inside itself.
        let res = paste(&[s(dst.join("a.txt"))], &dst, false);
        assert_eq!(res[0].to.as_deref(), Some(s(dst.join("a - Copy (2).txt")).as_str()));
        let res = paste(&[s(dst.join("a.txt"))], &dst, true);
        assert!(res[0].to.is_none() && res[0].error.is_none());
        let res = paste(&[s(dst.join("folder"))], &dst.join("folder"), false);
        assert!(res[0].error.as_deref().unwrap().contains("into itself"));
    }
}
