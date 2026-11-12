# Quarry

**A fast Windows 11 editor for code and data that opens multi-gigabyte logs, JSON and CSV in about half a second, and keeps colours, a JSON tree, a log filter and a CSV grid working at any size.**

Quarry is an everyday code editor with a large-file mode for the files other editors struggle with: multi-gigabyte logs, JSON exports and CSV dumps. It's built with [Tauri 2](https://tauri.app/): a Rust core for disk I/O and search, and a React + [CodeMirror 6](https://codemirror.net/) interface with Windows 11 Mica styling.

## Features

### Huge files

Files at or above 32 MB (adjustable) open in large-file mode. The file is memory-mapped and never loaded into memory as a whole: only the lines on screen are read, and the line index is built in the background while you already scroll.

Measured on one machine (Core Ultra 7 265KF, 32 GB RAM, NVMe SSD), from launching the app with the file to its text on screen:

| File | Quarry | Notepad++ 8.9 | UltraEdit 33 | VS Code 1.143 |
| --- | --- | --- | --- | --- |
| 1 GB log | **0.5 s**, 0.4 GB | 1.2 s, 1.2 GB | 2.1 s, 0.7 GB | 5.1 s, 2.8 GB |
| 5 GB log | **0.5 s**, 0.4 GB | 5.8 s, 5.7 GB | 2.1 s, 0.7 GB | 31 s, 8.0 GB |
| 5 GB JSON | **0.5 s**, 0.4 GB | 8.8 s, 7.8 GB | 2.1 s, 0.8 GB | 30 s, 9.0 GB |

For Notepad++ and UltraEdit the time is when the window shows the file; both go on reading it for a few more seconds (4–9 s at 5 GB). Memory is each app's total private memory with the file open. Quarry opens these without asking; the others ask first at these sizes (Notepad++ above 2 GB, UltraEdit above 50 MB, VS Code above 1 GB). These were measured with the files in the Windows file cache; read for the first time after a reboot (cold cache), Quarry was still under 0.5 s for every file and the others were the same or slightly slower. How they were measured, every number, and the caveats (including where Quarry is *not* faster, like starting up with a small file) are in [bench/RESULTS.md](bench/RESULTS.md); you can re-run them with the tools in [bench/](bench/README.md).

Once open, at any size:

- **Searching.** Find with regex across the whole file (about 0.5 s for 5 GB). Replace All streams the file instead of loading it.
- **Colours.** Syntax colours for JSON, logs, CSV / TSV, XML and SQL. Only the lines on screen are coloured, so it costs the same at any size.
- **JSON.** A tree view read straight from the file (expanding a node reads only that node) and strict validation (about 1 GB a second), with the exact line and column of an error.
- **Logs.** A filter view of only the matching lines, or everything but them, with one-click Errors / Warnings: 0.6 s to keep the 7.4 million ERROR lines of a 5 GB log. Follow mode shows lines as they are added, like `tail -f`.
- **CSV / TSV.** A grid of aligned columns under a header row that stays at the top.
- **Editing and saving.** Edit, insert and delete lines with undo; saving is atomic.

Large-file mode trades some features for this: no multi-cursor, column mode, formatting, scripts or macros there. See [Large files](docs/large-files.md).

### JSON tools

- **Tree view.** Live tree that follows the cursor, keeps working while the JSON is half-typed, and jumps to any node.
- **Paths.** Copy the path to any value in dot, JSONPath, JavaScript, bracket or JSON Pointer form. A breadcrumb shows where you are.
- **Validate.** Strict validation with exact line, column and a clear message, for files of any size.
- **Pretty-print and minify.** Only whitespace changes. Key order, duplicate keys and number precision (`1e400`, 40-digit integers) are kept exactly.
- **JSONC.** Comments and trailing commas are understood: formatting keeps them, and minifying strips them to give strict JSON.
- **Conversion.** JSON ↔ CSV.

See [JSON tools](docs/json.md).

### Find and replace

- **In the file.** Regex, whole word, multi-line search, and select-all-matches as cursors.
- **Find in Files.** Searches the current file (the default), all open tabs, a folder or several folders, using ripgrep's engine. It respects `.gitignore`, supports include/exclude globs, streams results, and previews replacements. You can leave individual results or files out of Replace All, keep case with Preserve Case, and each file keeps its own encoding (Windows-1252, UTF-16 and so on).
- **Replace in Files.** Can be undone, and never touches files with unsaved changes.

See [Find and replace](docs/find-and-replace.md).

### Editing

- **Column mode and multi-cursor.** Column (block) mode with **Alt+Shift+C**. Multi-cursor with **Ctrl+D**, **Ctrl+Shift+L** and **Ctrl+Alt+↑/↓**.
- **Line tools.** Sort (natural order), dedupe, trim, join, number lines, change case.
- **Languages and formatting.** Syntax highlighting for about 140 languages, with automatic language detection for pasted text. **Format Document** works out of the box for JSON, web languages, Go, Python, C/C++, C#, Java, Shell and SQL, using built-in formatters (Prettier, plus gofmt, Ruff, clang-format, shfmt and others compiled to WebAssembly). If you have the real tool installed, Quarry uses that instead, so the result matches your project's setup.
- **Encodings.** Encoding detection (BOM and chardetng), conversion on save, and CRLF/LF/CR line endings.
- **Navigation.** Command palette, Quick Open, Go to Line, and an Explorer that watches the folder.
- **Sessions.** Hot exit restores your tabs and unsaved scratch buffers. Saves are atomic, and Quarry notices files that change on disk.

See [Editing](docs/editing.md) and [Formatting](docs/formatting.md).

### Code intelligence and compare

- **Language servers.** TypeScript / JavaScript, Python, Rust, Go, C / C++, C#, CSS and HTML files get suggestions while typing, hover documentation, Go to Definition (F12), Find All References (Shift+F12), Rename (F2) and live problems, from the same language servers VS Code uses. A **Problems** panel lists them for every open file, and a missing server installs with one click.
- **Compare.** Two files (or a file against its unsaved edits or the clipboard) side by side or inline, with changed words highlighted, F7 to step through the changes, and arrows to copy a change across, then save.

- **Git.** Change markers in the gutter with peek and revert, line blame, a Source Control panel to stage, commit, discard and amend, branch switching and creation, fetch / pull / push, file history, and change colours in the Explorer. It runs your own `git`.
- **Split editor.** Ctrl+\\ shows two panes side by side, the same file in both or two different ones.

See [Code intelligence](docs/code-intelligence.md), [Compare](docs/compare.md) and [Git](docs/git.md).

### Macros and scripts

- **Macros.** Record typing, keys and commands, then replay once, N times or down to the end of the file. A whole run is a single undo step.
- **Scripts.** Plain JavaScript files with a small API (`doc`, `selection`, `util`, `clipboard`) that run in a sandboxed worker, with a Console panel.

See [Macros](docs/macros.md) and [Scripts](docs/scripting.md).

### Claude Code

- **Claude tabs.** Right-click a folder in the Explorer and choose **Work with Claude Code Here** to work with [Claude Code](https://claude.com/claude-code) in that folder, in Quarry's own interface: streamed replies, a card for every step, diffs of each edit, and permission requests answered with a click. File edits are applied automatically and commands ask first, or set it to ask before everything.
- **Screenshots and context.** Paste screenshots into the message box, drop files on it, or send the editor selection with **Ctrl+Alt+L**.
- **History.** Restored tabs show their earlier messages, and any past conversation in the folder can be continued.
- **Terminal.** **Claude Code Terminal Here** runs the `claude` command line itself in a terminal tab.
- **Optional.** It uses your own Claude Code installation and login. One switch in Settings turns the whole integration off.

See [Claude Code](docs/claude-code.md).

### Windows 11 feel

- **Look.** Mica, menus in a custom title bar with a tab row above it, and light, dark or system theme.
- **Panels.** A rail of colour-coded icons opens Search, Explorer, JSON Tools, Scripts, Macros and Settings. A panel floats over the editor until you pin it; pinned panels stay open side by side.
- **Accessibility.** High Contrast support, reduced motion, full keyboard access and screen-reader labels.
- **Explorer integration.** A small, per-user installer that adds **Open with Quarry** to Explorer's right-click menu and to the **Open with** list, without changing your default apps.

## Install

Quarry is at version 0.1.0. There are no prebuilt releases yet, so build it from source (below). The installers aren't code-signed, so Windows SmartScreen will warn the first time you run one.

## Build from source

You need Windows 11, [Node.js](https://nodejs.org/) 20+, [pnpm](https://pnpm.io/), and [Rust](https://rustup.rs/) with the MSVC toolchain (see the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)).

```bash
git clone https://github.com/smspgh/Quarry.git
cd Quarry
pnpm install
pnpm tauri dev      # run in development
pnpm tauri build    # build quarry.exe plus NSIS and MSI installers
```

The installers end up in `src-tauri/target/release/bundle/`. Tests, project layout and architecture are covered in [Development](docs/development.md).

## Documentation

| Guide | Covers |
| --- | --- |
| [Editing](docs/editing.md) | Layout, opening files, palette, multi-cursor and column mode, line commands, languages, encodings, saving, sessions, Explorer, accessibility |
| [Large files](docs/large-files.md) | How large-file mode works: colours, CSV grid, JSON tree and validation, filter view, follow mode, find, replace, editing, limits |
| [Code intelligence](docs/code-intelligence.md) | Language servers: suggestions, hover, definitions, references, rename, problems, installing servers |
| [Compare](docs/compare.md) | Comparing files, a file with its unsaved edits or the clipboard; editing and saving |
| [Git](docs/git.md) | Change markers, blame, Source Control panel, branches, pull / push, file history |
| [Find and replace](docs/find-and-replace.md) | Find bar, Find / Replace in Files, undo, regex flavours |
| [JSON tools](docs/json.md) | Tree view, paths, validate, format, JSON ↔ CSV |
| [Formatting](docs/formatting.md) | Built-in and installed formatters for each language |
| [Macros](docs/macros.md) | Recording, playback, step editor, file format |
| [Scripts](docs/scripting.md) | Script API reference, sandbox, examples |
| [Claude Code](docs/claude-code.md) | Claude tabs, permissions, screenshots and context, past conversations, terminal tabs |
| [Keyboard shortcuts](docs/keyboard-shortcuts.md) | Every shortcut and command id |
| [Settings](docs/settings.md) | Every setting, and where Quarry keeps its files |
| [Development](docs/development.md) | Building, tests, architecture, conventions |

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
| `Ctrl+Alt+L` | Add the selection to Claude Code |
| `Ctrl+Shift+G` / `Alt+F5` | Source Control / next change since the last commit |
| `Ctrl+\` / `Ctrl+1` / `Ctrl+2` | Split editor / focus left / right pane |
| `Ctrl+B` / `Ctrl+J` / `Alt+Z` | Collapse or restore side panels / bottom panel / word wrap |

The full list is in [Keyboard shortcuts](docs/keyboard-shortcuts.md).

## Built with

[Tauri 2](https://tauri.app/) · [CodeMirror 6](https://codemirror.net/) · [React 19](https://react.dev/) · [Zustand](https://github.com/pmndrs/zustand) · [Prettier](https://prettier.io/) · formatters from [wasm-fmt](https://github.com/wasm-fmt) (gofmt, Ruff, clang-format, shfmt), [sql-formatter](https://github.com/sql-formatter-org/sql-formatter) and [prettier-plugin-java](https://github.com/jhipster/prettier-java) · [@codemirror/lsp-client](https://github.com/codemirror/lsp-client) and [@codemirror/merge](https://github.com/codemirror/merge) · [xterm.js](https://xtermjs.org/) and [portable-pty](https://github.com/wezterm/wezterm/tree/main/pty) for terminal tabs · ripgrep's [`grep`](https://github.com/BurntSushi/ripgrep/tree/master/crates/grep) and [`ignore`](https://github.com/BurntSushi/ripgrep/tree/master/crates/ignore) crates · [memmap2](https://github.com/RazrFalcon/memmap2-rs) · [encoding_rs](https://github.com/hsivonen/encoding_rs) and [chardetng](https://github.com/hsivonen/chardetng) · [Lucide](https://lucide.dev/) icons
