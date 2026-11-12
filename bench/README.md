# Benchmarks

Repeatable large-file benchmarks for Quarry, and for comparing it with other editors. Results from
one machine are in [RESULTS.md](RESULTS.md).

## 1. Generate the test files

```powershell
node bench/gen.mjs                       # log, JSON and CSV at 100 MB, 1 GB and 5 GB (about 19 GB)
node bench/gen.mjs --only log --sizes 2G # or pick kinds and sizes
```

Files go to `%LOCALAPPDATA%\quarry-bench` (never into the repo; `--dir` changes it). They are
deterministic, so every run uses the same bytes:

- `log-*.log`: timestamped request log lines with INFO / DEBUG / WARN / ERROR levels.
- `json-*.json`: one pretty-printed array of user records (valid JSON).
- `csv-*.csv`: an order table with a header row and a quoted field.

Every file contains `NEEDLE-7f3a` once per million lines, the "rare string" the searches look for.

## 2. Engine benchmark (Quarry only)

```powershell
cd src-tauri
cargo run --release --example bench -- $env:LOCALAPPDATA\quarry-bench\log-5G.log
```

Times Quarry's large-file engine directly, without the UI:
- opening the file, and the first screen of text;
- the full line index and a jump to the middle line;
- three searches: a rare string, a common word and a regex;
- Replace All and Save, written to a copy so the original is never changed.

Memory is *private* memory. The memory-mapped file is shared page cache that Windows can drop at any time, so it isn't counted as Quarry's memory.

## 3. Real-app benchmark (Quarry and VS Code)

```powershell
pnpm tauri build                                   # Quarry's release build is what gets measured
node bench/app.mjs quarry $env:LOCALAPPDATA\quarry-bench\log-1G.log
node bench/app.mjs vscode $env:LOCALAPPDATA\quarry-bench\log-1G.log
```

Launches the editor with the file, as a double-click in File Explorer does, and times **from launch
until the file's first line is drawn on screen**. It also records the app's total private memory
(all its processes) at that moment and after it settles. Both apps are measured the same way,
through their Chromium debugging port.

- **Quarry** must not be running (it allows one instance). It opens with your saved session, so
  set `session.json` aside for a clean run.
- **VS Code** runs with a throwaway profile and extensions disabled; your own VS Code and its
  settings are not touched. VS Code asks for confirmation before opening a local file over 1024 MB
  (`workbench.editorLargeFileConfirmation`). The benchmark profile turns that prompt off, so the
  time is VS Code's, not the time someone took to click; the output notes when it applied.

## 4. Native editors (Notepad++, UltraEdit, and Quarry for comparison)

```powershell
powershell -ExecutionPolicy Bypass -File bench\native.ps1 -Exe "C:\Program Files\Notepad++\notepad++.exe" -File $env:LOCALAPPDATA\quarry-bench\log-5G.log
```

For editors without a debugging port. Reports when the window title first shows the file name,
when the editor has also stopped reading from disk for 1 s ("loaded"), and its private memory. Run
Quarry through it too (`-Exe ...\quarry.exe`) for a like-for-like comparison. Any prompt the editor
shows is recorded word for word and answered with its default button, so no one's click is
timed. Don't touch the editor's windows during a run.

## Reading the numbers honestly

- **Warm cache.** Files that were just generated (or recently read) are in the Windows file cache.
  A first read straight from disk is slower; reboot before a run to measure that.
- **Not like for like on features.** Quarry opens files above its large-file threshold in
  [large-file mode](../docs/large-files.md), which has fewer features than a normal tab (no syntax
  highlighting or JSON tools, for example). VS Code loads the whole file into memory and turns
  features off above 20 MB (tokenization, folding, word highlighting and more; it says so in a
  notification).
- **One machine.** Record the CPU, RAM, disk and app versions with any numbers you publish.
