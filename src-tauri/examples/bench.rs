//! Engine benchmark for large files (see bench/README.md).
//!
//!   cargo run --release --example bench -- <file>...
//!
//! Times Quarry's large-file engine directly, without the UI: open, first screen, full line index,
//! a jump to the middle, searches, Replace All and Save (to a copy, never over the original).
//! Memory is the process's private bytes: the memory-mapped file itself is shared, reclaimable
//! page cache and is reported separately as the working set.

use quarry_lib::bigfile::{BigDoc, SearchOpts};
use std::path::Path;
use std::time::Instant;

#[repr(C)]
#[derive(Default)]
struct ProcessMemoryCountersEx {
    cb: u32,
    page_fault_count: u32,
    peak_working_set_size: usize,
    working_set_size: usize,
    quota_peak_paged_pool_usage: usize,
    quota_paged_pool_usage: usize,
    quota_peak_non_paged_pool_usage: usize,
    quota_non_paged_pool_usage: usize,
    pagefile_usage: usize,
    peak_pagefile_usage: usize,
    private_usage: usize,
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetCurrentProcess() -> isize;
    fn K32GetProcessMemoryInfo(process: isize, counters: *mut ProcessMemoryCountersEx, cb: u32) -> i32;
}

/// (private MB, peak private MB, working set MB)
fn memory() -> (f64, f64, f64) {
    let mut c = ProcessMemoryCountersEx { cb: std::mem::size_of::<ProcessMemoryCountersEx>() as u32, ..Default::default() };
    unsafe { K32GetProcessMemoryInfo(GetCurrentProcess(), &mut c, c.cb) };
    let mb = |b: usize| b as f64 / 1048576.0;
    (mb(c.private_usage), mb(c.peak_pagefile_usage), mb(c.working_set_size))
}

fn ms(t: Instant) -> String {
    let d = t.elapsed().as_secs_f64() * 1000.0;
    if d < 10.0 { format!("{d:.1} ms") } else if d < 10_000.0 { format!("{d:.0} ms") } else { format!("{:.1} s", d / 1000.0) }
}

fn opts(pattern: &str, is_regex: bool) -> SearchOpts<'_> {
    SearchOpts { pattern, is_regex, case_sensitive: true, whole_word: false, dot_all: false, max_results: 20_000 }
}

fn bench(path: &Path) -> Result<(), String> {
    let size = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    println!("\n== {} ({:.0} MB)", path.file_name().unwrap().to_string_lossy(), size as f64 / 1048576.0);

    let t = Instant::now();
    let mut doc = BigDoc::open(1, path, |_| {})?;
    println!("  open (file mapped)    {:>10}", ms(t));
    // The first screen can show once the background index has reached its 60 lines.
    let first = loop {
        let c = doc.get_lines(0, 60);
        if c.lines.len() >= 60 || doc.is_indexed() {
            break c;
        }
        std::thread::sleep(std::time::Duration::from_micros(200));
    };
    println!("  first screen ready    {:>10}   ({} lines)", ms(t), first.lines.len());

    let t = Instant::now();
    doc.wait_indexed();
    println!("  full line index       {:>10}   ({} lines)", ms(t), doc.total_lines());

    let t = Instant::now();
    let mid = doc.get_lines(doc.total_lines() / 2, 60);
    println!("  jump to middle line   {:>10}   ({} lines)", ms(t), mid.lines.len());

    // A word and a regex that occur often in this kind of file (see bench/gen.mjs).
    let (common, regex) = match path.extension().and_then(|e| e.to_str()) {
        Some("json") => ("Pittsburgh", r#""zip": "1\d{4}""#),
        Some("csv") => ("Pittsburgh", r",\d{3}\.\d\d,paid,"),
        _ => ("ERROR", r"status=5\d\d"),
    };
    for (label, pat, re) in [("find rare string", "NEEDLE-7f3a", false), ("find common word", common, false), ("find regex", regex, true)] {
        let t = Instant::now();
        let r = doc.search(&opts(pat, re))?;
        println!("  {label:<20}  {:>10}   ({} hits{})", ms(t), r.total, if r.truncated { ", list capped" } else { "" });
    }

    if path.extension().and_then(|e| e.to_str()) == Some("json") {
        let t = Instant::now();
        let r = quarry_lib::json_tools::validate_bytes(doc.unedited_bytes().unwrap_or(&[]), false);
        println!("  validate JSON         {:>10}   ({})", ms(t), if r.ok { "valid".to_string() } else { format!("{:?}", r.error.map(|e| e.message)) });
        let bytes = doc.unedited_bytes().unwrap_or(&[]);
        let t = Instant::now();
        let root = quarry_lib::json_tree::root(bytes).map_err(|e| e.1)?;
        let page = quarry_lib::json_tree::children(bytes, root.start, None, 0, 200).map_err(|e| e.1)?;
        let child = quarry_lib::json_tree::children(bytes, page.nodes[0].start, None, 0, 200).map_err(|e| e.1)?;
        println!("  JSON tree: root + 200 children + one record   {:>8}   ({} children of the first)", ms(t), child.nodes.len());
        let t = Instant::now();
        let (mut next, mut n) = (None, 0u64);
        loop {
            let p = quarry_lib::json_tree::children(bytes, root.start, next, n, 5000).map_err(|e| e.1)?;
            n += p.nodes.len() as u64;
            match p.next { Some(x) => next = Some(x), None => break }
        }
        println!("  JSON tree: count every root child   {:>10}   ({n} children)", ms(t));
    }

    if path.extension().and_then(|e| e.to_str()) == Some("log") {
        for (label, pat, invert) in [("filter: keep ERROR lines", "ERROR", false), ("filter: hide DEBUG lines", "DEBUG", true)] {
            let t = Instant::now();
            let f = doc.filter_lines(pat, false, true, false, invert)?;
            println!("  {label:<26} {:>8}   ({} lines)", ms(t), f.lines.total());
        }
    }

    let t = Instant::now();
    let n = doc.replace_all(&opts("NEEDLE-7f3a", false), "FOUND-7f3a", false, |_| {})?;
    println!("  replace all (rare)    {:>10}   ({n} replaced)", ms(t));

    let (private, _, ws) = memory();
    let copy = path.with_extension("bench-save.tmp");
    let t = Instant::now();
    doc.save(Some(&copy), |_| {})?;
    println!("  save to a copy        {:>10}", ms(t));
    let (_, peak, _) = memory();
    println!("  memory while open: private {private:.0} MB, working set {ws:.0} MB (includes mapped file pages); peak private {peak:.0} MB");
    drop(doc);
    let _ = std::fs::remove_file(&copy);
    Ok(())
}

fn main() {
    let files: Vec<String> = std::env::args().skip(1).collect();
    if files.is_empty() {
        eprintln!("usage: cargo run --release --example bench -- <file>...");
        std::process::exit(2);
    }
    for f in files {
        if let Err(e) = bench(Path::new(&f)) {
            eprintln!("{f}: {e}");
        }
    }
}
