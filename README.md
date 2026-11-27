# Quarry

**A fast Windows 11 editor for code and data that opens multi-gigabyte logs, JSON and CSV in about half a second, and keeps colours, a JSON tree, a log filter and a CSV grid working on files that large.**

Quarry is the editor for the files other editors struggle with: multi-gigabyte logs, JSON exports and CSV dumps. It is also a capable everyday code editor, with Git, a terminal, compare and code intelligence built in. It is free for individuals, and it collects no personal information.

**[Download for Windows 11](https://github.com/smspgh/Quarry/releases/latest)** · [Install guide](https://smspgh.github.io/Quarry/docs/install.html) · [Website](https://smspgh.github.io/Quarry/) · [Privacy](https://smspgh.github.io/Quarry/privacy.html)

## Why Quarry

Shows a file of any size in about half a second, and is a modern Windows editor with Git, a terminal, compare and code intelligence built in for everything else.

- **Huge files, in half a second.** Files of 128 MB and up open in large-file mode, which never loads the file into memory. Showing it reads only the lines on screen, so a 5 GB file opens as fast as a 1 GB one, with colours for JSON, logs, CSV, XML, SQL, YAML and source code, a JSON tree, a CSV grid, a log filter and regex search. Smaller files open as normal tabs with every editing feature. Those are loaded into memory, but the first lines of a 100 MB file are on screen just as fast, about a second before the rest of it has arrived.
- **Built in, nothing to hunt for.** Git, a terminal, file compare, code intelligence, Find in Files, JSON tools, macros and scripts are part of Quarry. There are no editor extensions to find, install and keep up to date. Quarry works with the Git already on your PC, and each language's server is a separate program that Quarry offers to install for you.
- **Made for Windows 11.** Windows 11 styling with light, grey and dark themes, a command palette, shortcuts you can change, and updates that ask before they install.
- **Private by design.** No account, no telemetry, no ads. Nothing about you or your files is sent to the developer.
- **Careful with folders you don't know.** Quarry asks before it runs git or a language server in a folder you have not trusted, because both can run programs the folder's own files name.

## Features

### Huge files

Files at or above 128 MB (adjustable) open in large-file mode. The file is memory-mapped and never loaded into memory as a whole: only the lines on screen are read, and the line index is built in the background while you already scroll.

Measured on one machine (Core Ultra 7 265KF, 32 GB RAM, NVMe SSD) with 5 GB files:

| What | Time |
| --- | --- |
| Open a 5 GB log, JSON or CSV file | 0.6 s |
| Find a string in 59 million lines | 0.4 s |
| Keep only the 7.4 million ERROR lines | 0.4 s |
| Jump to any line | under 1 ms |
| Expand a record in the JSON tree | 4 ms |
| Validate all 5 GB of JSON | 6 to 8 s |
| Replace All across the file | 2 to 3 s |

Find and the filter do not wait for the line index. The times in the table are for a file that has been open a couple of seconds; started the moment a 5 GB file opens, while its index is still being built, the first search or filter takes 0.8 to 1.5 s. Replace All and other edits start once the index is built, about 1 s after a 5 GB file opens. Validation takes 7 to 8 s the first time and about 6 s after that. Replace All writes a working copy of the file, so it depends on the disk: 2 to 3 s when Windows can buffer the writes, 10 to 35 s on a drive busy with other writes.

Memory with a 5 GB file open is about 0.5 GB, up to 0.7 GB in the first seconds. Every number and how it was measured are in [the benchmark results](https://smspgh.github.io/Quarry/docs/benchmarks.html).

Once open, in large-file mode:

- **Searching.** Find with regex across the whole file (about half a second for 5 GB). Replace All streams the file instead of loading it.
- **Colours.** Syntax colours for JSON, logs, CSV / TSV, XML, SQL, YAML, INI-style settings, and a simple colouring for source code. Only the lines on screen are coloured, so it costs the same at any size.
- **JSON.** A tree view read straight from the file (expanding a node reads only that node) and strict validation (6 to 8 s for 5 GB), with the exact line and column of an error.
- **Logs.** A filter view of only the matching lines, or everything but them, with one-click Errors / Warnings: 0.4 s to keep the 7.4 million ERROR lines of a 5 GB log. Follow mode shows lines as they are added, like `tail -f`.
- **CSV / TSV.** A grid of aligned columns under a header row that stays at the top.
- **Editing and saving.** Edit, insert and delete lines with undo; saving is atomic.

Large-file mode trades some features for this: no multi-cursor, column mode, formatting, compare, split editor, code intelligence, Git change markers, scripts or macros there. See [Large files](https://smspgh.github.io/Quarry/docs/large-files.html).

### JSON tools

- **Tree view.** Live tree that follows the cursor, keeps working while the JSON is half-typed, and jumps to any node.
- **Paths.** Copy the path to any value in dot, JSONPath, JavaScript, bracket or JSON Pointer form. A breadcrumb shows where you are.
- **Validate.** Strict validation with exact line, column and a clear message, for files of any size.
- **Pretty-print and minify.** Only whitespace changes. Key order, duplicate keys and number precision (`1e400`, 40-digit integers) are kept exactly.
- **JSONC.** Comments and trailing commas are understood: formatting keeps them, and minifying strips them to give strict JSON.
- **Conversion.** JSON ↔ CSV.
- **API requests.** Send a GET, POST, PUT, PATCH, DELETE or OPTIONS request from the API Requests panel and the response opens in a tab, ready for the JSON tools. Save requests by name; tokens in secret headers are encrypted for your Windows account. See [API requests](https://smspgh.github.io/Quarry/docs/api-requests.html).

See [JSON tools](https://smspgh.github.io/Quarry/docs/json.html).

### Find and replace

- **In the file.** Regex, whole word, multi-line search, and select-all-matches as cursors.
- **Find in Files.** Searches the current file (the default), all open tabs, a folder or several folders; folder search runs on ripgrep's engine. It respects `.gitignore`, supports include/exclude globs, streams results, and previews replacements. You can leave individual results or files out of Replace All, keep case with Preserve Case, and each file keeps its own encoding (Windows-1252, UTF-16 and so on).
- **Replace in Files.** The most recent one can be undone, also after a restart, for a week (backups are kept for up to 1 GiB of files), and it never touches files with unsaved changes.

See [Find and replace](https://smspgh.github.io/Quarry/docs/find-and-replace.html).

### Editing

- **Column mode and multi-cursor.** Column (block) mode with **Alt+Shift+C**. Multi-cursor with **Ctrl+D**, **Ctrl+Shift+L** and **Ctrl+Alt+↑/↓**.
- **Line tools.** Sort (natural order), dedupe, trim, join, number lines, change case.
- **Languages and formatting.** Syntax highlighting for about 140 languages, with automatic language detection for pasted text. **Format Document** works out of the box for JSON, web languages, Go, Python, C/C++, C#, Java, Shell and SQL, using built-in formatters (Prettier, plus gofmt, Ruff, clang-format, shfmt and others compiled to WebAssembly). If you have the real tool installed, Quarry uses that instead, so the result matches your project's setup.
- **Encodings.** Encoding detection (BOM and chardetng), conversion on save, and CRLF/LF/CR line endings.
- **Your own shortcuts.** Change, remove or add the keys of any command in Settings; a conflict is named before you assign.
- **Navigation.** Command palette, Quick Open, Go to Line, and an Explorer that watches the folder.
- **Sessions.** Close Quarry without saving: it reopens your tabs with untitled notes and unsaved changes to files as you left them (up to 2 MB of text each; the files on disk are untouched until you save). Saves are atomic, and Quarry notices files that change on disk.

See [Editing](https://smspgh.github.io/Quarry/docs/editing.html) and [Formatting](https://smspgh.github.io/Quarry/docs/formatting.html).

### Code intelligence and compare

- **Language servers.** TypeScript / JavaScript, Python, Rust, Go, C / C++, C#, CSS and HTML files get suggestions while typing, hover documentation, Go to Definition (F12), Find All References (Shift+F12), Rename (F2) and live problems, from standard language servers. A **Problems** panel lists them for every open file. The servers are separate programs: a missing one installs with one click, using that language's own tools (Node.js, rustup, Go, winget or .NET).
- **Compare.** Two files (or a file against its unsaved edits or the clipboard) side by side or inline, with changed words highlighted, F7 to step through the changes, and arrows to copy a change across, then save.

- **Split editor.** Ctrl+\\ shows two panes side by side, the same file in both or two different ones.

See [Code intelligence](https://smspgh.github.io/Quarry/docs/code-intelligence.html) and [Compare](https://smspgh.github.io/Quarry/docs/compare.html).

### Git

Quarry runs your own `git`, so your configuration, hooks and credentials apply.

- **In the editor.** Change markers in the gutter with peek and revert, line blame, and change colours in the Explorer.
- **Source Control panel.** Stage, commit, amend and discard; fetch, pull and push with a status line that says what is ahead, behind or diverged; create the repository on GitHub from the panel.
- **Staging by line.** Stage, unstage or discard a single change or just the selected lines from the comparison of a file.
- **Commit graph.** Every branch in one scrolling graph, also for very large histories, with search across the whole history, a details pane, and checkout, branch, tag, cherry-pick, revert and reset from a commit's menu. Select two commits (or a commit and your working files) to compare them.
- **Merge and rebase.** Start either from the graph, a branch label or the panel, with a preview of what will happen first. Conflicts get Accept Current / Incoming / Both bars in the editor, and a stopped operation has Continue, Skip and Abort.
- **Edit history.** Undo the last commit, reword, squash, drop or reorder commits from a list, without typing a rebase plan. Force Push is offered only when needed and never overwrites work you haven't fetched.
- **Stash.** Stash with or without untracked files, look inside a stash, then apply, pop or drop it.
- **Branches and tags.** Rename, delete, set upstream, and push or delete on the remote.
- **Unsaved tabs are safe.** Any git action that rewrites files checks your open tabs first and asks before anything unsaved could be lost.
- **Merge view.** A conflicted file can also open as three panes: Current and Incoming side by side, and an editable Result below. Accept a side or both per conflict, type in the Result, then Complete Merge.

See [Git](https://smspgh.github.io/Quarry/docs/git.html).

### Terminal

- **Terminal panel.** **Ctrl+`** opens PowerShell, Command Prompt, Git Bash or your own shell in a panel under the editor, in the folder you are working in. Several terminals are listed beside it; split them side by side, search their output, and send the selected text or the file in front to the shell. Right-click a folder in the Explorer for **Open in Terminal**.
- **A real console.** Full-screen programs, colours and prompts work as in Windows Terminal, in Quarry's theme and font.

See [Terminal](https://smspgh.github.io/Quarry/docs/terminal.html).

### Macros and scripts

- **Macros.** Record typing, keys and commands, then replay once, N times or down to the end of the file. A whole run is a single undo step.
- **Scripts.** Plain JavaScript files with a small API (`doc`, `selection`, `util`, `clipboard`) that run in a sandboxed worker with no network access, with a Console panel.

See [Macros](https://smspgh.github.io/Quarry/docs/macros.html) and [Scripts](https://smspgh.github.io/Quarry/docs/scripting.html).

### Windows 11 feel

- **Look.** Mica, menus in a custom title bar with a tab row above it, and light, dark or system theme.
- **Panels.** A rail of colour-coded icons opens Search, Explorer, JSON Tools, Scripts, Macros, API Requests and Settings. A panel floats (closing when you click back into the document) until you pin it; pinned panels stay open side by side.
- **Accessibility.** High Contrast support, reduced motion, full keyboard access and screen-reader labels.
- **Explorer integration.** A small, per-user installer that adds **Open with Quarry** to Explorer's right-click menu (under **Show more options**) and to the **Open with** list, without changing your default apps.

## Install

Quarry needs Windows 11, 64-bit.

1. Open the [latest release](https://github.com/smspgh/Quarry/releases/latest).
2. Under **Assets**, download `Quarry_<version>_x64-setup.exe` (about 7 MB). The other files there are for the updater and for offline PCs.
3. Run it. It installs for your Windows account only, with no administrator rights, and does not change your default apps.

Releases are code-signed by Stephen Shirey. Windows SmartScreen can still warn about a release that few people have downloaded yet: check the publisher name, then choose **More info › Run anyway**.

Quarry checks for a new version when it starts and offers to install it; updates are verified against Quarry's signing key before they are installed. You can turn the check off in Settings, or run it yourself with **Help › Check for Updates**.

Checking a download, silent installs, updating and uninstalling are covered in the [install guide](https://smspgh.github.io/Quarry/docs/install.html).

## Documentation

The guides for every part of Quarry are on the website: **[Documentation](https://smspgh.github.io/Quarry/docs/)**. They cover installing, editing, large files, code intelligence, Compare, Git, the terminal, find and replace, JSON tools, API requests, formatting, macros, scripts, keyboard shortcuts and settings.

## Common shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl+Shift+P` / `Ctrl+P` / `Ctrl+G` | Command palette / Quick open / Go to line |
| `Ctrl+N` / `Ctrl+O` / `Ctrl+Shift+O` | New file / Open file / Open folder |
| `Ctrl+S` / `Ctrl+Shift+S` / `Ctrl+W` | Save / Save as / Close tab |
| `Ctrl+F` / `Ctrl+H` / `F3` | Find / Replace / Find next |
| `Ctrl+Shift+F` / `Ctrl+Shift+H` | Find / Replace in files |
| `Alt+Shift+C` | Toggle column (block) mode |
| `Ctrl+D` / `Ctrl+Shift+L` | Add next occurrence / Select all occurrences |
| `Shift+Alt+F` | Format document |
| `F12` / `Shift+F12` / `F2` / `F8` | Go to definition / Find references / Rename symbol / Next problem |
| `F7` / `Shift+F7` | Next / previous change in a Compare tab |
| `Ctrl+Alt+F` / `Ctrl+Alt+M` / `Ctrl+Alt+V` | JSON format / minify / validate |
| `Ctrl+Alt+P` / `Ctrl+Alt+C` | Copy JSON path / value at cursor |
| `Ctrl+Shift+R` / `Ctrl+Shift+M` | Record macro / Play last macro |
| `Ctrl+Shift+Enter` | Run current script |
| `Ctrl+Shift+G` / `Alt+F5` | Source Control / next change since the last commit |
| `Ctrl+\` / `Ctrl+1` / `Ctrl+2` | Split editor / focus left / right pane |
| ``Ctrl+` `` / ``Ctrl+Shift+` `` | Show or hide the terminal / New terminal |
| `Ctrl+B` / `Ctrl+J` / `Alt+Z` | Collapse or restore side panels / bottom panel / word wrap |

The full list is in [Keyboard shortcuts](https://smspgh.github.io/Quarry/docs/keyboard-shortcuts.html).

## License

Quarry is free for individuals, including freelancers working on their own. An organization with two or more people using Quarry needs a commercial license for each of them, after a free 30-day evaluation; it is $50 per user per year, billed annually (write for 100 or more users or custom terms), from [smspgh@outlook.com](mailto:smspgh@outlook.com). Quarry is not open source: redistributing, modifying or selling it needs permission. The terms are in [LICENSE](https://smspgh.github.io/Quarry/license.html).

Copyright © 2026 Stephen Shirey. All rights reserved.

## Built with

[Tauri 2](https://tauri.app/) · [CodeMirror 6](https://codemirror.net/) · [React 19](https://react.dev/) · [Zustand](https://github.com/pmndrs/zustand) · [Prettier](https://prettier.io/) · formatters from [wasm-fmt](https://github.com/wasm-fmt) (gofmt, Ruff, clang-format, shfmt), [sql-formatter](https://github.com/sql-formatter-org/sql-formatter) and [prettier-plugin-java](https://github.com/jhipster/prettier-java) · [@codemirror/lsp-client](https://github.com/codemirror/lsp-client) and [@codemirror/merge](https://github.com/codemirror/merge) · [xterm.js](https://xtermjs.org/) and [portable-pty](https://github.com/wezterm/wezterm/tree/main/pty) for terminal tabs · ripgrep's [`grep`](https://github.com/BurntSushi/ripgrep/tree/master/crates/grep) and [`ignore`](https://github.com/BurntSushi/ripgrep/tree/master/crates/ignore) crates · [memmap2](https://github.com/RazrFalcon/memmap2-rs) · [encoding_rs](https://github.com/hsivonen/encoding_rs) and [chardetng](https://github.com/hsivonen/chardetng) · [Lucide](https://lucide.dev/) icons
