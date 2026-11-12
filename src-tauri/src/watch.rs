//! Recursive directory watcher for the Explorer, built on `notify` with a ~300 ms debounce.
//! Changed paths are forwarded in one batch per debounce window.

use notify::RecommendedWatcher;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use std::collections::BTreeSet;
use std::path::Path;
use std::time::Duration;

pub const DEBOUNCE: Duration = Duration::from_millis(300);

pub struct FolderWatcher {
    _debouncer: Debouncer<RecommendedWatcher>,
    pub root: String,
}

/// Collapse a debounced event batch into a sorted, de-duplicated list of changed paths.
pub fn changed_paths(res: DebounceEventResult) -> Vec<String> {
    match res {
        Ok(events) => {
            let set: BTreeSet<String> = events.into_iter().map(|e| e.path.to_string_lossy().into_owned()).collect();
            set.into_iter().collect()
        }
        Err(_) => Vec::new(),
    }
}

/// Start watching `root` recursively; `on_change` receives each debounced batch of changed paths
/// (never empty).
pub fn start<F>(root: &str, on_change: F) -> Result<FolderWatcher, String>
where
    F: Fn(Vec<String>) + Send + 'static,
{
    let mut debouncer = new_debouncer(DEBOUNCE, move |res: DebounceEventResult| {
        let paths = changed_paths(res);
        if !paths.is_empty() {
            on_change(paths);
        }
    })
    .map_err(|e| e.to_string())?;
    debouncer
        .watcher()
        .watch(Path::new(root), notify::RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    Ok(FolderWatcher { _debouncer: debouncer, root: root.to_string() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn changed_paths_dedupes_and_sorts() {
        use notify_debouncer_mini::{DebouncedEvent, DebouncedEventKind};
        let ev = |p: &str| DebouncedEvent { path: p.into(), kind: DebouncedEventKind::Any };
        let out = changed_paths(Ok(vec![ev("b"), ev("a"), ev("b")]));
        assert_eq!(out, vec!["a".to_string(), "b".to_string()]);
        assert!(changed_paths(Err(notify::Error::generic("x"))).is_empty());
    }

    #[test]
    fn reports_a_new_file_in_a_subdirectory() {
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("sub");
        std::fs::create_dir(&sub).unwrap();
        let (tx, rx) = mpsc::channel();
        let w = start(&dir.path().to_string_lossy(), move |paths| {
            let _ = tx.send(paths);
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(100));
        std::fs::write(sub.join("new.txt"), "hi").unwrap();
        let got = rx.recv_timeout(Duration::from_secs(5)).expect("no fs event within 5 s");
        assert!(got.iter().any(|p| p.ends_with("new.txt")), "{got:?}");
        drop(w);
    }
}
