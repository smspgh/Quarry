# Benchmark results

Measured 24 November 2026.

**Machine:** Intel Core Ultra 7 265KF (20 threads), 32 GB RAM, NVMe SSD, Windows 11 Pro.
**App:** Quarry release build of the code released as 1.0.0, default settings.
**Files:** generated test files of 1 GB and 5 GB: a request log (59 million lines at 5 GB), a
pretty-printed JSON array of records (321 million lines, 20 million records) and a CSV table
(57 million rows). They had been read before, so they were in the Windows file cache.

## Opening a file

Time from starting Quarry with the file until its first lines are drawn on screen, and the private
memory of all of Quarry's processes with the file open. Three runs each; the table gives the middle one.

| File | Time to open | Memory |
| --- | --- | --- |
| 1 GB log | 0.50 s | 0.5 GB |
| 1 GB JSON | 0.50 s | 0.5 GB |
| 1 GB CSV | 0.52 s | 0.5 GB |
| 5 GB log | 0.57 s | 0.5 GB |
| 5 GB JSON | 0.55 s | 0.5 GB |
| 5 GB CSV | 0.57 s | 0.5 GB |

All eighteen runs were between 0.48 s and 0.64 s. The time does not grow with the file because
Quarry maps the file and reads only the first screen before showing it; the line index is built in
the background while the file is already usable. Most of the memory is the WebView2 engine that
draws the interface: the large-file engine itself holds about 11 MB for a 5 GB file.

## Working in a 5 GB file

Quarry's large-file engine, measured without the interface. One run each.

| | 5 GB log | 5 GB JSON |
| --- | --- | --- |
| First screen ready | 63 ms | 75 ms |
| Full line index (background) | 4.0 s (59 million lines) | 5.2 s (321 million lines) |
| Jump to the middle line | under 1 ms | under 1 ms |
| Find a rare string | 0.64 s | 0.46 s |
| Find a common word | 0.37 s | 0.51 s |
| Find a regex | 0.57 s | 0.54 s |
| Replace All (rare string) | 2.2 s | 2.3 to 2.5 s |
| Engine memory while open | 11 MB | 11 MB |

**Log filter** (5 GB log):

| | Time | Lines kept |
| --- | --- | --- |
| Keep the ERROR lines | 0.56 s | 7.4 million |
| Hide the DEBUG lines | 0.84 s | 44 million |

**JSON** (5 GB file):

| | Time |
| --- | --- |
| Validate the whole file | 4.8 to 6.3 s |
| Tree: open the root, list 200 children, expand one record | 3.6 ms |
| Tree: count every top-level item (background) | 5.0 s (20 million items) |

The filter, Replace All and other edits wait for the full line index (the 4 to 5 s above, counted
from opening); Find does not, and a jump to a line waits only until the index has reached it.

## Checked again on 25 November 2026

The same build and files, measured again on the same machine a day later.

| | Published above | Measured again |
| --- | --- | --- |
| Open a 5 GB file (18 launches) | 0.55 to 0.57 s | 0.48 to 0.77 s; middle run 0.60 s (log), 0.55 s (JSON), 0.60 s (CSV) |
| Memory with a 5 GB file open | 0.5 GB | 0.47 to 0.48 GB after 10 s; 0.61 to 0.72 GB while it opens |
| Find, 5 GB log (3 runs) | 0.37 to 0.64 s | 0.37 to 0.59 s |
| Find, 5 GB JSON (3 runs) | 0.46 to 0.54 s | 0.43 to 0.84 s |
| Find, 5 GB CSV (1 run) | not published | 0.34 to 0.98 s |
| Keep the ERROR lines (3 runs) | 0.56 s | 0.57 s |
| Hide the DEBUG lines (3 runs) | 0.84 s | 0.85 to 0.95 s |
| Full line index (3 runs) | 4.0 s log, 5.2 s JSON | 4.2 to 4.6 s log, 5.2 to 5.8 s JSON |
| Validate 5 GB of JSON (3 runs) | 4.8 to 6.3 s | 4.6 to 5.8 s |
| JSON tree: root, 200 children, one record | 3.6 ms | 0.1 ms |
| Replace All (7 runs) | 2.2 to 2.5 s | 2.3 to 2.9 s in four runs, 10 to 19 s in three |

The three slow Replace All runs each came straight after the benchmark's own 5 GB "save to a copy",
so the drive was still writing: see "Replace All depends on the disk" below.

## After the 25 November changes (not in 1.0.0)

Measured on the same machine and files with the code as it stands after 1.0.0: the line index is
built on up to eight cores, the filter no longer waits for it, and normal tabs show their first
lines before the whole file has arrived. Three runs each; ranges are lowest to highest.

| 5 GB file | 1.0.0 | Now |
| --- | --- | --- |
| Time to open (text on screen, 6 launches) | 0.48 to 0.77 s | 0.50 to 0.54 s |
| First screen ready (engine) | 63 to 75 ms | 7 to 27 ms |
| Full line index (background) | 4.0 to 5.8 s | 1.1 to 1.2 s |
| Filter entered straight after opening | waits for the index, then 0.6 s | 1.1 to 1.3 s |
| First search straight after opening | not measured | 0.37 to 0.62 s |
| Find, later searches (log) | 0.37 to 0.64 s | 0.27 to 0.31 s |
| Find, later searches (JSON, CSV) | 0.34 to 0.98 s | 0.20 to 0.60 s |
| Keep the ERROR lines, later runs | 0.56 s | 0.27 to 0.43 s |
| Hide the DEBUG lines, later runs | 0.84 s | 0.32 to 0.49 s |
| Validate 5 GB of JSON, first time | 4.6 to 6.9 s | 7.0 to 8.2 s |
| Validate 5 GB of JSON, again | not measured | 5.8 to 6.0 s |
| JSON tree: count every top-level item | 4.7 to 5.0 s | 6.9 to 7.1 s |
| Find and filter through the app window, later runs | not measured | 0.43 to 0.66 s |
| Find or filter through the app window, the moment the file opens | not measured | 0.76 to 0.82 s; 1.3 to 1.5 s in two of eight launches |
| Replace All | 2.2 to 2.9 s, 10 to 19 s on a busy drive | 2.2 to 2.8 s, 9.9 s once |

The first pass over a file's mapping is slower than later ones: Windows has
to map the file's pages into Quarry. In 1.0.0 the index did that pass, in 4 to 6 s; now the index,
Find and the filter read the file with ordinary reads on up to eight cores and never pay it. JSON
validation and the JSON tree's count still go through the mapping, and are about 2 s slower on a
5 GB file than in 1.0.0, where the index and earlier searches had already been through it. Checking
the text encoding from disk first was tried and gave nothing back: the validator's own pass over
the mapping took 6.9 s on its own, and the encoding check ahead of it was what had been warming it.
The window timings use the find bar's and the filter's defaults (not case-sensitive).

Normal tabs (below the 128 MB threshold), time until the first lines are on screen, three launches
each:

| File | 1.0.0 | Now |
| --- | --- | --- |
| 32 MB log | 1.2 s | 0.49 to 0.64 s |
| 64 MB log | 1.4 s | 0.53 to 0.56 s |
| 64 MB JSON | not measured | 0.53 to 0.56 s |
| 100 MB log | not measured | 0.60 to 0.71 s |
| 100 MB JSON | not measured | 0.61 to 0.69 s |

The rest of the file follows the first lines at about 100 MB a second (0.6 s for 64 MB); until it
has arrived the tab can be read but not edited.

## Normal tabs

Files below the large-file threshold (128 MB by default, 256 MB at most) open as normal tabs with
every editing feature, and their whole text is held in memory. One run each.

| File | Time to open | Delay after typing a character | Memory |
| --- | --- | --- | --- |
| 32 MB log | 1.2 s | 11 ms | 0.5 GB |
| 64 MB log | 1.4 s | 15 ms | 0.5 GB |
| 128 MB log | 2.2 s | 13 ms | 0.6 GB |
| 256 MB log | 4.0 s | 14 ms | 0.8 GB |
| 128 MB JSON | 2.8 s | 12 ms | 1.4 GB |
| 256 MB JSON | 5.1 s | 11 ms | 1.7 GB |

## Reading these numbers

- **One machine.** A slower processor or disk gives slower numbers. On a hard disk or a network
  share the background line index takes longer; the first screen does not depend on it.
- **Warm cache.** A file read for the first time after a restart comes straight from the disk. In
  October 2026 that made no measurable difference to opening on this SSD.
- **Large-file mode has fewer features** than a normal tab: no multi-cursor, column mode or
  formatting. See [Large files](../docs/large-files.md).
- **Replace All depends on the disk.** It writes a working copy of the whole file, so a 5 GB file
  means 5 GB of writing. The times above are with Windows buffering those writes in memory, which
  is the usual case. When the drive had just taken tens of gigabytes of other writes, the same
  Replace All took 20 to 35 s, on any of the three file types.
