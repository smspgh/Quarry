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

- The `"branch"` action (create without switching) exists in Rust, `GitCommitAction` and the `Naming` type, but the menu only offers `"branch-switch"` (`src/components/GraphView.tsx`, `Naming` and the "Create Branch Here…" item); the plain-branch path in `act` / the naming strip and its notification (`actionDone` in `src/lib/gitGraph.ts`) are dead UI code. It has been that way since the graph was added.
- No test renders `GraphView.tsx` (toolbar, paging and scrolling, selection keys, menu, naming strip, details pane); the action dialogs and notifications are now tested through `actionConfirm` / `actionDone` in `src/lib/gitGraph.ts`. Rendering it needs a DOM harness (React + jsdom), which the repository does not have.

## Merge conflicts and stopped operations (`git-conflicts.md`)

- An `am` operation is labelled as a rebase: the Commit button reads "Continue Rebase" and the message box says a rebase keeps each commit's message (`src/components/panels/GitPanel.tsx`, `rebasing`); the notifications say "the am" and Abort's confirm button reads "Abort Am" (`src/lib/git.ts`, `continueOperation` / `abortOperation`). The git side is right: `continue_operation` / `abort_operation` in `git.rs` detect the operation themselves and run `git am --continue` / `--skip` / `--abort`, so only the wording is off. No scenarios were written for `am`.

## Compare (`compare.md`)

- `docs/git.md:13` says Compare with Last Commit shows "your tab, editable, on the right"; a tab side is always read-only (`src/lib/diff.ts:107`, `compareWithHead` at `src/lib/git.ts:718`; DIFF-006).
- `docs/compare.md:32` says the arrows copy left into right; that holds only when the right side is editable, otherwise they copy right into left, and there are none when both sides are read-only or in Inline layout (`src/components/DiffView.tsx:71`, `:82`).
- `docs/compare.md:31` says file sides can be edited directly; in Inline layout only the right side's editor exists (`DiffView.tsx:67-75`).
- `docs/compare.md:27` says Reload reads the files from disk again; clipboard and git-version sides keep their stored text (`diff.ts:102`, `:224-232`; DIFF-013.5).
- `compare.withSelected` does not require a text tab (`src/lib/commands.ts:1347`), unlike `compare.selectForCompare`; on a large-file tab it is enabled and then fails with "too large to compare".
- "Revert arrows act on mousedown" comes from the project notes and @codemirror/merge; nothing in the repo's own code sets it (DIFF-011.2).
- Not determined: the exact button labels of the save prompt when closing an edited Compare tab (`askSaveChanges`, `src/lib/actions.ts:547`; DIFF-012.7).
- No test exercises `DiffView.tsx` or `openCompare` / `saveDiff` / `reloadDiff`.

## Claude Code tabs and terminals (`claude-code.md`, `terminal.md`)

- The model setting applies on every process start, not only new conversations: the hint says "For conversations started from now on" (`src/components/panels/SettingsPanel.tsx:344`, `docs/settings.md:91`), but `spawn` passes `claudeModel` on resumes too (`src/lib/claude.ts:188`; CLAUDE-018.3).
- Terminal resume has no UI entry point: `claude.openTerminal` accepts `{ folder, resume }` and `pty_start` honours it (`src/lib/commands.ts:1199`, `src-tauri/src/pty.rs:101`), but no caller passes `resume` (TERM-002).
- The resume-id check is duplicated inline in `pty.rs:101` instead of using `claude::is_session_id` (`src-tauri/src/claude.rs:97`).
- Folder fallback order differs from `docs/claude-code.md:30`: `claude.openHere` tries the active Claude CLI tab's folder first, `claude.openTerminal` the active Claude tab's (`commands.ts:1179`, `:1201`).
- `build_args` also passes `--verbose` (`claude.rs:73`), which the project notes omit.
- Ctrl+Shift+C with no selection is swallowed, neither copied nor sent to the program (`src/components/TerminalView.tsx:106`; TERM-004.3). Probably intended.
- `pty:exit` always carries a code; the UI's null handling is only reached on a start failure (`TerminalView.tsx:83`).
- CLAUDE-007.7 (external-change handling of files Claude edits) is taken from the docs.
- No tests: `terminal.ts`, `TerminalView.tsx`, the session plumbing in `claude.ts`.

## Code intelligence (`code-intelligence.md`)

- Settings can show TypeScript as "Installed" while the status bar offers to install it: Settings only checks `tsc` on PATH (`src/components/panels/SettingsPanel.tsx:367`), the real choice needs TypeScript 7 or typescript-language-server (`src-tauri/src/lsp.rs:156`); with TypeScript 5 the install offer runs `npm install -g typescript`, which may not help.
- The references panel, rename box, signature tooltip and gutter marker come from `@codemirror/lsp-client` / `@codemirror/lint`; LSP-008, 010, 011, 012.1 and 014 follow `docs/code-intelligence.md` for them. Rename undo (LSP-011.3) and LSP-014.1 are inferred.
- No tests: `LspStatus.tsx`, `lspInstall.ts`.

## Explorer and file operations (`explorer.md`)

- The New File / New Folder name box is always drawn at the top of the tree at a fixed indent (`src/components/panels/ExplorerPanel.tsx:651-668`); `docs/editing.md:169` says items are "named inline".
- `docs/editing.md:182-184` lists only arrows, Enter and type-ahead; the code also handles Home / End, PageUp / PageDown (15 rows), Space, F2, Delete and Ctrl+C / X / V (`ExplorerPanel.tsx:531-609`).
- Not determined: what an open tab does after its file is deleted from the Explorer (`trashPaths`, `src/lib/fileOps.ts:72-90`, does not close or retarget tabs).
- Needs a manual check: Escape in the rename / new-name box unmounts an input that also commits on blur (`ExplorerPanel.tsx:662-665`, `:763-766`); if WebView2 fires blur on removal the name could still be committed (EXPL-008.3, EXPL-009.4 state the intended behaviour).
- Expanded folders are not saved in the session; `openFolder` resets them to the root (`src/lib/actions.ts:312`).
- EXPL-016 lists `src/__tests__/splitGit.test.ts` on the strength of a grep for `kindOf` / `KIND_LETTER` only.

## Application shell (`app-shell.md`)

Possible bugs
- The menu opens behind a dialog: the Alt / F10 listeners in `src/components/MenuBar.tsx:499-521` do not check `store.dialog`, unlike the shortcut guard at `src/App.tsx:105`.
- The Explorer reopens floating on start: `src/lib/actions.ts:883-884` says only a pinned panel reopens, but restoring the session folder calls `openFolder` (`:892`), which sets `sidebarVisible: true, sidebarPanel: "explorer"` (`:312`).
- Collapsed state is not persisted: `src/App.tsx:172` triggers a session save when `pinnedHidden` changes, but `buildSession` (`actions.ts:812-831`) does not write it.
- Bottom-panel layout is not persisted (`bottomVisible`, `bottomHeight`, `bottomTab`); `bottomTab` defaults to `"results"` (`src/lib/store.ts:276`), which `BottomPanel` treats as Console.
- Brand icon and Ctrl+B differ: with nothing pinned and nothing open, Ctrl+B reopens the last panel (`src/lib/panels.ts:77`), the brand icon does nothing (`src/components/TitleBar.tsx:164`; UI-014.4).

Mismatches and notes
- There are no menu mnemonics: only Alt / F10, arrows, Home / End, Enter / Space and Escape (UI-004).
- `docs/editing.md:31` says a panel opens floating over the editor; it pushes the editor over (`src/styles/app.css:105`; UI-013.3).
- `Doc.eol` can be `"CR"` (`store.ts:18`) but the picker offers only CRLF / LF (`src/components/StatusBar.tsx:194`).
- `view.zoomReset` hard-codes 14 (`src/lib/commands.ts:904`) rather than `DEFAULT_SETTINGS.fontSize`.
- `matchesRegistered` in `src/App.tsx:265-267` has a redundant branch and a `void editor;`; `ui.chordPending` is a placeholder that is never registered.
- Window state (UI-024) rests on `tauri_plugin_window_state` defaults (`src-tauri/src/lib.rs:755`); the scenarios describe the plugin's defaults.
- No tests: `resolveStroke` / `normalizeKeys` / `eventToKeys`, `dialogDefaultAction` / `dialogCancelAction`, `placePopup`, the dialog queue.

## Wording pass

About 190 scenarios had a `When` step added or converted mechanically to satisfy the format (mainly in `git-graph.md`, `git-conflicts.md`, `compare.md`, `claude-code.md`, `terminal.md`, `code-intelligence.md`, `large-files.md`). Some read as observations ("When I look at the toolbar") or states ("When Claude is working…"); they are correct but worth rewording as each story is reviewed.
