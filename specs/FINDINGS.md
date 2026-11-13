# Findings from writing the specs (2026-11-13)

Possible bugs, doc/code mismatches and open questions noticed while the stories were written from the code. **None of these was verified by running the application**; each is a reading of the code at the lines given (as of Quarry 0.1.7) and needs a check before it is acted on. Where a finding touches a story, the story records today's behaviour (`Status: draft`); if the behaviour is changed, update the story in the same commit and delete the entry here.

This file is not a spec: `scripts/specs-index.mjs` ignores it.

## Tabs and split editor (`tabs.md`, `split.md`)

- Close All is not atomic: tabs closed before a Cancel stay closed (`actions.ts:497-503`; recorded as TAB-006.5).
- Tab reordering, reopen closed tab and back/forward navigation do not exist (no stories).
- Tab context menu items (Close, Close Others, Open to the Side, Copy Path, Show in…, Compare with Last Commit, Show File History) call action functions directly (`src/components/TitleBar.tsx:124-149`), against the rule that every user action goes through `runCommand`; the macro recorder does not see them.

## Find and replace in a document (`find.md`)

- There is no "in selection" option anywhere (`src/components/FindBar.tsx`, `findBar` in `src/lib/store.ts:279`).

## Find in Files (`search.md`)

Possible bugs
- Results past the first 500 of a file cannot be opened, stepped to with F4 or left out individually, yet Replace All still replaces them (`SearchPanel.tsx:140`, `:467`, `:472`, `:973`; SEARCH-007.6, SEARCH-009.7).

Doc / code mismatches
- Look-around and backreferences cannot be run in any scope: `docs/find-and-replace.md:130-133` says they work with Current File / Open Files, but the panel always validates with the Rust engine and blocks the search (`SearchPanel.tsx:351-369`, `:375`, `:877`; SEARCH-004.7).

## Scripts (`scripting.md`)

- `docs/macros.md:106` says script runs are blocked while a macro plays; only the hidden `script.run` has that guard (`src/lib/commands.ts:1133`) and nothing calls it; `script.runActive` (`commands.ts:1096`) is not blocked while recording or playing.

## Commit graph (`git-graph.md`)

- No test renders `GraphView.tsx` (toolbar, paging and scrolling, selection keys, menu, naming strip, details pane); the action dialogs and notifications are now tested through `actionConfirm` / `actionDone` in `src/lib/gitGraph.ts`. Rendering it needs a DOM harness (React + jsdom), which the repository does not have.

## Compare (`compare.md`)

- No test exercises `DiffView.tsx` (the editors, arrows, layout switch); it needs a component test harness. `openCompare` / `saveDiff` / `reloadDiff` / `swapDiff` are covered by `src/__tests__/diffSession.test.ts`.

## Claude Code tabs and terminals (`claude-code.md`, `terminal.md`)

- The model setting applies on every process start, not only new conversations: the hint says "For conversations started from now on" (`src/components/panels/SettingsPanel.tsx:344`, `docs/settings.md:91`), but `spawn` passes `claudeModel` on resumes too (`src/lib/claude.ts:188`; CLAUDE-018.3).
- Terminal resume has no UI entry point: `claude.openTerminal` accepts `{ folder, resume }` and `pty_start` honours it (`src/lib/commands.ts:1199`, `src-tauri/src/pty.rs:101`), but no caller passes `resume` (TERM-002).
- No tests: `TerminalView.tsx` (xterm.js keys, restart, exit lines); it needs a component test harness. `terminal.ts` and the session plumbing in `claude.ts` are covered by `src/__tests__/claudeSession.test.ts`.

## Code intelligence (`code-intelligence.md`)

- With global TypeScript 5 and no typescript-language-server, the install offer (status bar and Settings) runs `npm install -g typescript`; that only helps if npm's latest `typescript` is TypeScript 7 (`src/lib/lspServers.ts:34`, `src-tauri/src/lsp.rs` `typescript_setup`). Settings now reports the same choice as the status bar (LSP-003.8).
- No tests: `LspStatus.tsx`; it needs a component test harness. `lspInstall.ts` is covered by `src/__tests__/lspInstall.test.ts`.

## Explorer and file operations (`explorer.md`)

- The New File / New Folder name box is always drawn at the top of the tree at a fixed indent (`src/components/panels/ExplorerPanel.tsx:662-680`); `docs/editing.md:169` says items are "named inline".
- Expanded folders are not saved in the session; `openFolder` resets them to the root (`src/lib/actions.ts:313`).

## Application shell (`app-shell.md`)

Possible bugs
- Collapsed state is not persisted: `src/App.tsx:172` triggers a session save when `pinnedHidden` changes, but `buildSession` (`actions.ts:813-832`) does not write it.
- Bottom-panel layout is not persisted (`bottomVisible`, `bottomHeight`, `bottomTab`); it starts hidden, 220 px, on Console each time.

Mismatches and notes
- There are no menu mnemonics: only Alt / F10, arrows, Home / End, Enter / Space and Escape (UI-004).

## Wording pass

About 190 scenarios had a `When` step added or converted mechanically to satisfy the format (mainly in `git-graph.md`, `git-conflicts.md`, `compare.md`, `claude-code.md`, `terminal.md`, `code-intelligence.md`, `large-files.md`). Some read as observations ("When I look at the toolbar") or states ("When Claude is working…"); they are correct but worth rewording as each story is reviewed.
