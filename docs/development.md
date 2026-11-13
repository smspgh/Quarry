# Development

- [Prerequisites](#prerequisites)
- [Build and run](#build-and-run)
- [Tests](#tests)
- [Project layout](#project-layout)
- [Architecture](#architecture)
- [Conventions](#conventions)
- [Troubleshooting](#troubleshooting)

## Prerequisites

- Windows 11.
- [Node.js](https://nodejs.org/) 20 or later, and [pnpm](https://pnpm.io/).
- [Rust](https://rustup.rs/) (stable, MSVC toolchain) and the Visual Studio C++ Build Tools. See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
- WebView2, which ships with Windows 11.

## Build and run

```bash
pnpm install
pnpm tauri dev      # Vite dev server on :1420 plus the Rust app, with hot reload
pnpm tauri build    # release build and installers
```

`pnpm tauri build` produces:

- `src-tauri/target/release/quarry.exe`
- an NSIS installer, which installs per-user with no admin prompt, in `src-tauri/target/release/bundle/nsis/`
- an MSI installer in `src-tauri/target/release/bundle/msi/`

The release profile uses LTO, a single codegen unit, symbol stripping and `panic = "abort"`. A panic is logged to `crash.log` before the process exits.

## Tests

```bash
pnpm test                          # Vitest: pure TypeScript helpers (src/__tests__/)
npx tsc --noEmit -p tsconfig.json  # type check
cd src-tauri && cargo test         # Rust: large-file engine, JSON tools, search, encodings
```

`test-fixtures/` holds small sample files for manual testing (broken and minified JSON, CSV, and messy CSS, HTML, Rust, TypeScript and XML for the formatters). `node test-fixtures/gen-hostile.mjs` generates edge-case inputs, such as deep JSON, odd encodings, long lines and CR-only files, into `test-fixtures/hostile/`. Add `--big` for 100 MB and 500 MB files and a 50,000-file tree. The generated files are git-ignored.

## Project layout

```
src-tauri/src/
  lib.rs         Tauri commands, plugin setup, external formatters, crash log
  bigfile.rs     large-file engine: memory map, sparse line index, piece table, find/replace, atomic save
  files.rs       encoding and line-ending detection, decoding, atomic writes, directory listing
  search.rs      Find / Replace in Files (grep-searcher, grep-regex, ignore) with undo backups
  json_tools.rs  strict JSON validate / format / minify that preserves the source text
  watch.rs       folder watcher for the Explorer (notify, debounced)
  claude.rs      Claude tabs: one headless `claude` process per tab (stream-json), history, images
  pty.rs         Claude CLI tabs: `claude` in a ConPTY pseudo console (portable-pty); also install commands
  lsp.rs         language servers: stdio processes, Content-Length framing, project roots, TypeScript setup
src/
  App.tsx        layout, global key handling, startup and session restore
  editor/        CodeMirror setup, the single-view manager, column mode, bulk edits
  lib/           store, commands and keybindings, actions, macros, scripting, JSON model, formatters, IPC
  components/    title bar, menu bar, find bar, palette, status bar, large-file view, side panels
  styles/        design tokens (light and dark) and app styles
  __tests__/     Vitest suites
```

## Architecture

**Rust core.** Disk I/O, everything to do with large files, Find in Files and strict JSON live in Rust. The frontend calls them as Tauri commands through `src/lib/ipc.ts`.

- **Large files** (`bigfile.rs`):
  - The file is memory-mapped, and a background thread records one byte-offset checkpoint every 1,024 lines.
  - Reads seek to the nearest checkpoint and scan forward.
  - Edits go into a piece table over the original mapping plus an append buffer. Undo stores snapshots of that table.
  - Save streams the pieces to a temporary file and renames it over the target.
- **JSON** (`json_tools.rs`): an iterative scanner checks strict JSON (RFC 8259) and re-emits it with new whitespace only. Values are never decoded, so key order, duplicate keys, exact number text and escapes survive byte for byte. Because it doesn't recurse, nesting depth is limited only by memory.
- **Search** (`search.rs`): uses ripgrep's crates. Results stream to the UI in batches as Tauri events (`search:results`), and the search can be cancelled. Replace writes each file atomically, after copying it to a backup for undo.

**Frontend.** React 19 with Zustand for state and CodeMirror 6 for editing.

- **One editor view.** There is a single `EditorView` for all text tabs. Each document keeps its own `EditorState` in `src/editor/manager.ts`, and switching tabs swaps the state into the view. Don't create a second main view.
- **Commands.** Every user action is registered in `src/lib/commands.ts` (`register` / `runCommand`). The menus, the command palette, keyboard shortcuts and the macro recorder all go through it, which is what lets macros record menu and palette actions. Commands can declare `enabled()` and `dynamicTitle()`, and `applyDefaultEnabled()` greys out commands that need a document.
- **Menus.** The menu bar model is in `src/components/MenuBar.tsx`. Its items refer to command ids and never duplicate logic.
- **Large-file tabs** are `kind: "big"` documents rendered by `BigFileView.tsx`. The UI never holds their text. Commands reach them through events on `src/lib/bus.ts` (`big.find`, `big.goto`, …).
- **JSON tree.** The tree uses the tolerant parser in `src/lib/jsonPath.ts`, so it keeps working on half-typed JSON. Validate and Format use the strict Rust code.
- **Claude Code.** Claude tabs are `kind: "claude"` documents:
  - `claude.rs` runs `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --permission-prompt-tool stdio` (plus `--permission-mode`, `--model` and `--resume` when set; `--verbose` is required for stream-json output with `-p`) in the tab's folder and forwards each stdout line as a `claude:out` event.
  - `src/lib/claudeProtocol.ts` is pure and unit-tested. It folds those events into a transcript, and builds what goes to stdin: user messages with images, `interrupt`, and answers to `can_use_tool` permission requests. AskUserQuestion is answered by allowing it with `answers`; **Allow for this conversation** sends back the suggested rules with `destination: "session"`.
  - `src/lib/claude.ts` keeps each tab's session, `ClaudeView.tsx` draws it, and `Markdown.tsx` renders replies through the parser in `src/lib/markdown.ts` as React elements, never as HTML.
  - Past conversations are read from Claude Code's JSONL transcripts (`claude_conversations`, `claude_history`) and replayed through the same reducer.
  - Claude CLI tabs (`kind: "terminal"`, `TerminalView.tsx`) are xterm.js over `pty.rs`.
  - Both kinds of tab stay mounted while hidden, and everything is behind `settings.claudeEnabled`.
- **Code intelligence.** `src/lib/lsp.ts` drives `@codemirror/lsp-client`:
  - One client per (server, project root). The server table, URI and position helpers and the hover HTML sanitiser are in `src/lib/lspServers.ts` (pure, tested).
  - Because text tabs share one `EditorView` whose state is swapped, `QuarryWorkspace` keeps a file open on the server for as long as its tab is open (not just while it's on screen), syncs from `editor.stateOf()`, and applies server edits and diagnostics to background states (`editor.dispatchTo`, `editor.setLspDiagnostics`).
  - Each document's plugin lives in `compartments.lsp`. `compartments.completion` turns suggestions-while-typing on only where a server answers.
  - Diagnostics, pushed or pulled (`textDocument/diagnostic`, TypeScript 7), go to `useLsp.problems`, which feeds the status bar (`LspStatus.tsx`) and the Problems tab.
  - Server-to-client requests the library doesn't answer (`workspace/configuration`, …) are answered in the transport.
- **Compare tabs** (`kind: "diff"`) are `DiffView.tsx` over `@codemirror/merge`: a `MergeView` (two editors) or `unifiedMergeView` (one editor). These are separate views owned by the tab, not the main editor view. Texts and save details (encoding, BOM, line endings) are in `src/lib/diff.ts`, and `saveDocument` routes a Compare tab to `saveDiff`.
- **Scripts** run in a Web Worker (`src/lib/scriptWorker.ts`) against a snapshot of the document. The main thread applies the result as one undoable transaction.
- **Formatting** (`src/lib/format.ts`) routes by language:
  - JSON goes to Rust.
  - Web languages go to Prettier, loaded on demand.
  - Other languages try the installed command-line tool first, via the `format_external` command. If it isn't installed, they use a built-in formatter: WebAssembly builds from `@wasm-fmt/*` (gofmt, Ruff, clang-format, shfmt), `sql-formatter` or `prettier-plugin-java`, each a dynamic import so it is only loaded when first used.
  - The CSP's `'wasm-unsafe-eval'` is what allows those WebAssembly modules to compile.

## Conventions

- **Colours** come from CSS variables in `src/styles/tokens.css`, with a light set and a `[data-theme="dark"]` set. High Contrast overrides are in `app.css`. Components never use colour literals.
- **No native `<select>`.** WebView2 ignores the app theme in its popup, so use `src/components/Select.tsx`.
- **Script templates.** Embedded script sources in `src/lib/scripting.ts` are template literals. Write `\n` and `\r` as escapes so the worker receives escape sequences, not raw line breaks.
- **Line endings.** The repo uses LF (`.gitattributes`). Files written on Windows by other tools may come out CRLF; Git normalises them on commit.

## Troubleshooting

- **`pnpm tauri dev` exits immediately with code -1.** Quarry is single-instance, so an installed copy that is already running takes over. Close it first.
- **WebView2 error 0x8007139F.** The dev build is sharing the WebView2 profile with a running Quarry. Set `WEBVIEW2_USER_DATA_FOLDER` to a scratch folder for the dev session.
- **Dev and release builds share settings.** Both use `%APPDATA%\com.quarry.app`.
- **Testing the UI automatically.** Start the app with WebView2 remote debugging on, then drive it over the Chrome DevTools Protocol:
  ```powershell
  $env:WEBVIEW2_USER_DATA_FOLDER = "$env:TEMP\quarry-dev"
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9333"
  pnpm tauri dev
  ```
  Dev builds expose a `window.__shi` hook (actions, store, editor, `runCommand`) for test scripts.
