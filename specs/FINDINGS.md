# Findings from writing the specs (2026-11-13)

Possible bugs, doc/code mismatches and open questions noticed while the stories were written from the code. **None of these was verified by running the application**; each is a reading of the code at the lines given (as of Quarry 0.1.7) and needs a check before it is acted on. Where a finding touches a story, the story records today's behaviour (`Status: draft`); if the behaviour is changed, update the story in the same commit and delete the entry here.

This file is not a spec: `scripts/specs-index.mjs` ignores it.

## Files and sessions (`files.md`)

Possible bugs
- Read-only and changed-on-disk guards compare paths as exact strings (`src/lib/actions.ts:365`, `:383`, `target === doc.path` rather than `samePath`): Save As to the same file with different case or slashes skips the read-only guard and the "changed on disk" question.
- A deleted large-file tab stays dirty: `actions.ts:587` marks any tab dirty when its file disappears, but the "file is back" cleanup at `:596` handles text tabs only.
- An empty dirty untitled tab prompts at exit even with session restore on (`actions.ts:945`, `textLength === 0`; no snapshot is taken for it, `:119`). A unit test asserts this, so it may be intended.
- File › Open with several files asks about the tab limit once per file (`actions.ts:291` loops `openPath`), unlike `openFiles` (`:269`), which asks once per batch.
- Recent folders can never be cleared: `file.clearRecent` (`src/lib/commands.ts:620`) clears files only.
- Saving a large-file tab skips the "changed on disk, overwrite?" check, which is text-only (`actions.ts:383`).

Doc / code mismatches
- `docs/editing.md:44` says Open Recent keeps 12 files and 10 folders; the store keeps 15 of each (`actions.ts:347`), the menus show 12 / 10 (`src/components/MenuBar.tsx:67`, `:75`), Welcome shows 8.
- `docs/keyboard-shortcuts.md:20` lists Ctrl+F4 under `file.close`; it is a separate hidden command, `file.closeF4`.
- Unused Rust threshold: `sys.largeFileThreshold` (`src/lib/ipc.ts:121`), the `large_file_threshold` command (`src-tauri/src/lib.rs:656`) and `LARGE_FILE_THRESHOLD` (`src-tauri/src/files.rs:11`) have no caller; only `settings.largeFileThresholdMb` decides (`actions.ts:149`).

Not verified
- `cli_paths` (`src-tauri/src/lib.rs:638`) has no unit test (FILE-019), including the drive-root `C:"` repair and relative paths.
- Quick Open's 30,000-file cap and skipped folders (`docs/editing.md:56`) were not checked and are not in FILE-005.

## Tabs and split editor (`tabs.md`, `split.md`)

- Close All is not atomic: tabs closed before a Cancel stay closed (`actions.ts:497-503`; recorded as TAB-006.5).
- Tab reordering, reopen closed tab and back/forward navigation do not exist (no stories).
- Tab context menu items (Close, Close Others, Open to the Side, Copy Path, Show in…, Compare with Last Commit, Show File History) call action functions directly (`src/components/TitleBar.tsx:124-149`) and the Welcome buttons do too (`src/components/Welcome.tsx:51`, `:55`, `:69`), against the rule that every user action goes through `runCommand`; the macro recorder does not see them.
- TAB-001.3 (tabs wrap onto further rows) comes from the docs and a code comment; the CSS at `src/styles/app.css:190` was not checked.
- SPLIT-005 (one undo history, handover between panes) is written from reading `src/editor/manager.ts:150-225`; no test covers it.
- Tab Moves Focus is set only on the focused pane's view, so the other pane probably still indents on Tab (`src/lib/commands.ts:858`, `src/App.tsx:99`).

## Text editing (`editing.md`)

Possible bugs
- Read-only documents can be edited by commands: Format Document, the line transforms, case changes and Wrap in Quotes dispatch without a read-only check; only `edit.cut` / `edit.paste` have one (`src/lib/format.ts:222`, `src/lib/commands.ts:703`, `:712`, `:755`, `:786`, `:798`).
- Line commands treat a trailing newline as an empty last line: sorting a whole document that ends in a newline moves that empty line to the top; Number Lines numbers it (`commands.ts:750-753`).
- Line commands use only the main selection; other selections are ignored (`commands.ts:748`).
- Remove Duplicate Lines is quadratic (`indexOf` inside `filter`, `commands.ts:763`).
- Title Case uses `/\b\w/g`: "don't" becomes "Don'T", and existing capitals are not lowered (`commands.ts:798`).
- Convert to Tabs skips a single leading space and spaces after a leading tab; Convert to Spaces only converts the run of tabs at the very start of the line (`commands.ts:774`, `:778`).
- The status-bar language picker calls `editor.setLanguage` directly (`src/components/StatusBar.tsx:200`) instead of `runCommand("code.setLanguage", …)`; macros do not record it.

Doc / code mismatches and notes
- Language sniffing never returns "C": `#include` gives "C++" (`src/editor/cmSetup.ts:231`); `docs/editing.md:108` says "C/C++".
- `edit.cut` / `edit.copy` / `edit.paste` are in the palette but not in the Edit menu or `docs/keyboard-shortcuts.md`.
- `currentBlock` has two identical return branches (`src/editor/columnMode.ts:43-46`); the comment on `addCursorBelow` says "Alt+Shift+Down style" but the key is Ctrl+Alt+Down (`columnMode.ts:135`).
- Not determined: what the right-click menu shows on non-foldable gutter lines (EDIT-014.2 only says Quarry's menu does not open).
- No tests: column mode, add cursor above/below, `rangesInWindow`, the line transforms, Go to Line parsing (`parseGoto` is private to `CommandPalette.tsx`).

## Formatting (`formatting.md`)

- Format Document on JSON too large to pretty-print shows "JSON is not valid: … (line 0)" although the JSON is valid; `jsonTransform` handles line 0 properly (`src/lib/format.ts:172-174` vs `src/lib/commands.ts:325`).
- Format Document on JSON does not move the cursor to the error, unlike `json.format` (FMT-003.5 vs FMT-010.4).
- Format selection: `docs/formatting.md:24` and the "Formatted selection" toast (`format.ts:165`, `:188`, `:223`) claim it for all Prettier languages; Prettier is believed to honour `rangeStart` / `rangeEnd` only for JS/TS/GraphQL-type parsers, so CSS, Markdown, YAML, HTML and XML would get the whole document formatted. Not verified; FMT-005 uses JavaScript only.
- The `doc.language !== "JSON"` branch in `jsonTransform` is unreachable (`commands.ts:336`).
- Not determined: whether the dotnet "missing CSharpier" pattern (`format.ts:118`) matches current dotnet output; the exact text of Prettier / wasm formatter errors.
- No tests cover `format.ts` or `format_external`.

## Find and replace in a document (`find.md`)

- There is no "in selection" option anywhere (`src/components/FindBar.tsx`, `findBar` in `src/lib/store.ts:279`).
- History is not recorded by F3: `docs/find-and-replace.md:40` says Next / Previous add an entry; the bar's buttons and Enter do, `find.next` / `find.prev` do not (`src/lib/commands.ts:869-870`).
- Alt+Enter in the find box closes the bar even with no match (`FindBar.tsx:190-193`); the `edit.selectAllMatches` command closes it only on success (`commands.ts:691-695`).
- Not determined: F3 while focus is inside the find bar (`onBarKey` stops propagation, `FindBar.tsx:167`).

## Find in Files (`search.md`)

Possible bugs
- Open Files scope: "Max" is applied per document and `truncated` is never set, so "(limit reached)" never shows (`src/components/panels/SearchPanel.tsx:104`, `:398`).
- "No results in N files" counts every open tab, including large-file and non-text tabs that were not searched (`SearchPanel.tsx:398`).
- Replace All in open documents re-matches the current text, so left-out positions from search time can point at the wrong match after an edit (`SearchPanel.tsx:652-667`; the disk path guards with `searchedMs`); its status note reports the search-time total, not what was replaced (`:663`).
- Results past the first 500 of a file cannot be opened, stepped to with F4 or left out individually, yet Replace All still replaces them (`SearchPanel.tsx:140`, `:467`, `:472`, `:973`; SEARCH-007.6, SEARCH-009.7).
- Deleting a file from the results menu leaves `excluded`, `leftOut` and `activeKey` for it (`SearchPanel.tsx:993-1000`).

Doc / code mismatches
- Look-around and backreferences cannot be run in any scope: `docs/find-and-replace.md:130-133` says they work with Current File / Open Files, but the panel always validates with the Rust engine and blocks the search (`SearchPanel.tsx:351-369`, `:375`, `:877`; SEARCH-004.7).
- `docs/find-and-replace.md:113` says Rust replacement syntax with `${name}`; the code uses JavaScript rules (`$<name>`, `$&`, `$$`) and `${name}` comes out literally (`src-tauri/src/search.rs:395-452`).

Not determined
- Whole Word may differ between search (`.word(true)`, `search.rs:61`), disk replace (`\b(?:…)\b`, `search.rs:537`) and the preview (JavaScript `\b`) for patterns starting or ending with non-word characters.
- Multi-line plain-text search on CRLF files: a pattern typed with Ctrl+Enter contains `\n` only.
- A match block is capped at 1,000 matches (`search.rs:186`); undocumented, no scenario.

## Large files (`large-files.md`)

Possible bugs

Doc / code mismatches and dead code
- Not determined: whether a big tab's view state survives a restart.

## JSON tools (`json.md`)

- The JSON panel's Format / Minify / Validate buttons do nothing on a non-JSON-language tab whose text parses: the panel shows them (`src/components/panels/JsonPanel.tsx:311-313`) but `json.*` commands are disabled unless the language is JSON (`src/lib/commands.ts:538`; JSON-014.5).
- "Too large" shows as Invalid: `getJsonTree` returns an error at offset 0 (`src/lib/jsonModel.ts:16`), so the panel shows the "Invalid" chip and a "Document too large for tree view — click to jump" button that jumps to line 1.
- `docs/json.md:47` says the tree limit is 64 MB; the check is `doc.length` in UTF-16 code units (`jsonModel.ts:16`).
- `docs/json.md:75` mentions "Valid JSONC ✓" only; a `.json5` file reports "Valid JSON5 ✓" (`commands.ts:382`).

## Scripts (`scripting.md`)

- Selection edits land on the selection at finish time, not the snapshot: `src/lib/scripting.ts:231` applies `selectionTexts` to the current ranges; moving the cursor during a slow script retargets them, and a changed range count mismatches them.
- Awkward warning for extension-filtered scripts: `"pick" is for .csv, .tsv files documents.` (`scripting.ts:152`).
- `docs/macros.md:106` says script runs are blocked while a macro plays; only the hidden `script.run` has that guard (`src/lib/commands.ts:1133`) and nothing calls it; `script.runActive` (`commands.ts:1096`) is not blocked while recording or playing.
- `docs/scripting.md:145` says the console keeps the last 2,000 lines; `src/lib/store.ts:373` keeps 2,001.
- Not determined: `script.new` seems to always create in the scripts root (`src/components/panels/ExplorerPanel.tsx:514`) while the header button uses the selected folder (SCRIPT-002.1, .3 assume this).

## Macros (`macros.md`)

- Play Last can play a stale or deleted macro: `lastMacro` (`src/lib/commands.ts:480`, used at `:1034`, `:1050`) is an object reference; editing or renaming creates new objects through `stageMacros`, and `deleteMacro` (`src/lib/macros.ts:431`) never clears it.
- The macro times box is not clamped at 100,000 (`src/components/panels/MacrosPanel.tsx:151`, only `Math.max(1, …)`); the Scripts box clamps both ends (`ScriptsPanel.tsx:144`); `docs/macros.md:46` says 1 to 100,000.
- `docs/macros.md:75` says Delete "removes the file": Delete moves it to the Recycle Bin (`macros.ts:432`), while saving a renamed macro permanently deletes the old file (`macros.ts:421`).
- The to-end confirmation is worded differently in the panel (`MacrosPanel.tsx:52`) and the commands (`commands.ts:1052`, `:1071`).
- Not determined: whether macros reload on window focus while the panel is hidden (`MacrosPanel.tsx:93-101`); how the menu displays `macro.stop` (no `dynamicTitle`).

## Source control (`git.md`)

Possible bugs
- `git.refresh` does not rediscover a new repository: `src/lib/gitCommands.ts:81` calls `refreshGit(0)`, which skips folders cached in `notRepo` (`src/lib/git.ts:156`); only the panel's Refresh button clears the cache (`rescanGit`, `src/components/panels/GitPanel.tsx:470`). `docs/git.md:5` says the menu command handles the `git init` case.
- "Git was not found … then click Refresh" cannot recover: availability is re-checked only while `null` (`git.ts:149-150`).
- Status errors are swallowed: `find_root` returns an error for "dubious ownership" (`src-tauri/src/git.rs:219-232`), but `doRefresh` turns any rejection into "not a repository" and caches it (`git.ts:157-161`); a transient `git status` failure may be cached the same way.
- Ctrl+Enter in the message box ignores the Commit button's disabled state (`GitPanel.tsx:535-540`); it ends in a toast, not a bad commit.
- A token in a remote URL can be shown: the toast "Remote origin now points to <url>" uses the raw URL (`git.ts:570`) and the Change form prefills it (`GitRepoSettings.tsx:74`); only the remote row uses `displayUrl`.
- Background check: a failed check also counts toward the once-a-minute limit (`git.ts:542`); it runs `fetch --prune` without `--all` (`git.rs:939`), so only the default remote is checked.
- `git_unpushed` stops at 500 (`git.rs:1187`), so "N to push" in the Commits heading tops out there while the status line uses the real ahead count.
- Grammar in the discard dialog: "(1 untracked file go to the Recycle Bin)" (`git.ts:446`; quoted as is in GIT-012.5).

Doc / code mismatches
- `docs/git.md:102` says file history is at the bottom of the panel; it sits above the Repository section (`GitPanel.tsx:574-575`).
- There is no `git.commit` command: commit and amend are panel-only (the example in `specs/README.md` is illustrative).
- No tests: GIT-004 (next / previous change), GIT-025 (repository picker), GIT-026 (status bar branch).

## Commit graph (`git-graph.md`)

- The `"branch"` action (create without switching) exists in Rust, `GitCommitAction` and the `Naming` type, but the menu only offers `"branch-switch"` (`src/components/GraphView.tsx:76`, `:628`); the plain-branch path and its toast (`:330`) are dead UI code.
- The Find box placeholder says "message, author, id, branch", but whole-history search does not match branch names; only the loaded-commit filter does (`GraphView.tsx:404` vs `src-tauri/src/git.rs:1281`).
- The graph reloads from page one on every change to head, branch, ahead/behind, upstream or operation (`GraphView.tsx:178-183`); whether scroll position and selection survive was not determined.
- No test exercises `GraphView.tsx`.

## Merge conflicts and stopped operations (`git-conflicts.md`)

- An `am` operation is treated as a rebase: the button reads "Continue Rebase" and calls `continueOperation(root, "rebase", …)` (`src/components/panels/GitPanel.tsx:440-445`); Abort's confirm button would read "Abort Am" (`src/lib/git.ts:853`). No scenarios were written for `am`.
- No test exercises `src/editor/conflicts.ts`.

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

## Settings (`settings.md`)

- Reset all does not restart language servers: `resetAll` (`src/components/panels/SettingsPanel.tsx:479-487`) resets `lspEnabled` / `lspDisabled` / `lspCommands` without `restartServers()`, which every other change to them calls (`:379-384`).
- "Check for updates on start" is missing from `docs/settings.md` (`SettingsPanel.tsx:526`).
- `InfoTip` is not used in Settings; its only use is `src/components/panels/SearchPanel.tsx:739`.
- No settings migration code exists (nothing mentions the old ShiEdit id); loading is merge-over-defaults plus `sanitizeSettings` and the `.bak` fallback (`src/lib/actions.ts:673-718`; SET-003).
- `sanitizeSettings` does not type-check `fontFamily`, `mica`, `restoreSession`, `confirmRuns` or the Editor switches (`actions.ts:694-718`).
- `docs/settings.md:3` gives Tools › Settings; it is also under View › Panels › Settings.
- Not determined: the "unusable or cancelled folder change switches back to the default" behaviour of `docs/settings.md:60` (no scenario in SET-011); whether Escape in an open `Select` inside a floating panel also closes the panel (`src/components/Select.tsx:147` does not stop propagation; SET-017.3).

## Updates and releases (`updates.md`)

- "Versions must increase" is not enforced: `scripts/release.ps1:26` checks only that the three versions match, `:35-36` refuses an already-published tag under `-Publish`; `bump.ps1` accepts any `x.y.z`.

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
