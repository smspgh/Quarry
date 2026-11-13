---
area: Files and Sessions
prefix: FILE
---

# Files and Sessions

Creating, opening, saving and reverting documents, encodings and line endings, noticing changes made by other programs, the session that brings tabs back on the next start, hot exit, and the Welcome screen. The large-file view itself is specified in its own area; only the decision to use it is here. User documentation: `docs/editing.md` (Opening files and folders, Encodings and line endings, Saving, External changes, Sessions and hot exit).

## FILE-001: Create a new untitled file

- Status: draft
- Commands: `file.new`
- Files:
  - `src/lib/commands.ts` — `file.new` registration: `makeRoom(["Untitled"])` then `newDocument()`
  - `src/lib/actions.ts` — `newDocument`, `nextUntitledNumber`, snapshot of the empty text
  - `src/lib/store.ts` — `Doc`, `addDoc`, `newDocId`
  - `src/editor/manager.ts` — `create` builds the document's `EditorState` and sniffs its language
  - `src/components/Welcome.tsx` — "New file" button
  - `src/components/MenuBar.tsx` — File › New File
- Tests: `src/__tests__/paths.test.ts`
- Docs: `docs/editing.md`

**As a** person who wants to jot something down
**I want** to open an empty document with one key press
**So that** I can start typing without choosing a file name first

```gherkin
Scenario: FILE-001.1 New file opens an empty untitled tab
  Given no tabs are open
  When I press Ctrl+N
  Then a tab named "Untitled-1" opens and becomes the active tab
  And it has no unsaved-changes marker
  And the status bar shows UTF-8 and the line ending from Settings › Default line endings (CRLF by default)

Scenario: FILE-001.2 Untitled numbers reuse the lowest free number
  Given tabs "Untitled-1", "Untitled-2" and "Untitled-3" are open
  And I close "Untitled-2"
  When I press Ctrl+N
  Then the new tab is named "Untitled-2"

Scenario: FILE-001.3 A new file counts towards the open-tab limit
  Given Maximum open tabs is 3 and 3 tabs without unsaved changes are open
  When I press Ctrl+N
  Then Quarry asks to close the least recently used tab before creating the new one
  And choosing Cancel creates no new tab
```

## FILE-002: Open files from a dialog

- Status: draft
- Commands: `file.open`
- Files:
  - `src/lib/actions.ts` — `openFileDialog` (several picks go through `openFiles`: one tab-limit question), `openPath` (existing-tab check with `samePath`, binary / decode / mixed-EOL toasts, error toast)
  - `src/lib/ipc.ts` — `fs.stat`, `fs.readText`
  - `src/lib/tabLimit.ts` — `makeRoom`
  - `src-tauri/src/files.rs` — `stat`, `read_text`, `looks_binary`
  - `src-tauri/src/lib.rs` — Tauri commands `fs_stat`, `fs_read_text`
  - `src/editor/manager.ts` — `create`, `goTo`
  - `src/editor/cmSetup.ts` — `detectLanguage` / `sniffLanguage` pick the language shown for the new tab
  - `src/lib/types.ts` — `FileStat`, `TextFile`
- Tests: `src/__tests__/paths.test.ts`, `src-tauri/src/files.rs`
- Docs: `docs/editing.md`

**As a** developer
**I want** to pick one or several files and have each open in its own tab
**So that** I can view and edit them

```gherkin
Scenario: FILE-002.1 Open several files at once
  Given no tabs are open
  When I press Ctrl+O and pick "a.txt" and "b.json" in the "Open File" dialog
  Then both files open in their own tabs and "a.txt" is shown
  And both are added to the recent files list

Scenario: FILE-002.2 Opening a file that is already open shows its tab
  Given "C:\work\notes.txt" is open in a tab
  When I open "c:/work/NOTES.txt" again
  Then no second tab is created
  And the existing tab becomes the active tab

Scenario: FILE-002.3 A binary file opens read-only
  Given "image.bin" has a NUL byte in its first 8192 bytes and is not UTF-16 text
  When I open it
  Then it opens read-only
  And a warning says "image.bin looks like a binary file; editing may corrupt it. Opened read-only."

Scenario: FILE-002.4 A file that cannot be read
  Given "locked.txt" cannot be read
  When I open it
  Then an error notice starting with "Could not open file:" is shown
  And no tab is created

Scenario: FILE-002.5 Cancelling the dialog
  Given 2 tabs are open
  When I press Ctrl+O and cancel the dialog
  Then the same 2 tabs are open and the active tab has not changed

Scenario: FILE-002.6 Several files over the open-tab limit ask once
  Given the open-tab limit is 10 and 9 clean tabs are open
  When I press Ctrl+O and pick 3 files
  Then Quarry asks once, "Close 2 tabs to stay within your limit?", naming the 3 files to open
  And it does not ask again for each file
```

## FILE-003: Open a folder

- Status: draft
- Commands: `file.openFolder`
- Files:
  - `src/lib/actions.ts` — `openFolderDialog`, `openFolder` (stat check, `fs.normalize`, shows the Explorer, drops a missing folder from the recent list)
  - `src/lib/ipc.ts` — `fs.normalize`, `fs.watchStart` / `fs.onChanged`
  - `src-tauri/src/files.rs` — `normalize`, `strip_verbatim`
  - `src-tauri/src/lib.rs` — `fs_normalize`, `watch_start`, `watch_stop`
  - `src-tauri/src/watch.rs` — `start`, `changed_paths`: the recursive watcher the Explorer starts on the opened folder (events `fs-changed`, 300 ms debounce)
  - `src/components/panels/ExplorerPanel.tsx` — starts the watcher for `store.folder`, Close Folder button
  - `src/components/Welcome.tsx` — "Open folder" button
- Tests: `src-tauri/src/files.rs`, `src-tauri/src/watch.rs`
- Docs: `docs/editing.md`

**As a** developer working on a project
**I want** to open its folder
**So that** I can browse its files in the Explorer and search across them

```gherkin
Scenario: FILE-003.1 Open a folder
  Given no folder is open
  When I press Ctrl+Shift+O and pick "C:\work\project" in the "Open Folder" dialog
  Then the Explorer panel is shown with "C:\work\project" as its root, expanded
  And the folder is first in File › Open Recent Folder
  And the open tabs are unchanged

Scenario: FILE-003.2 Opening another folder replaces the current one
  Given "C:\work\project" is open in the Explorer
  When I open the folder "C:\work\other"
  Then the Explorer shows "C:\work\other" only

Scenario: FILE-003.3 A folder that no longer exists
  Given "C:\gone" is in the recent folders list but was deleted
  When I choose it from File › Open Recent Folder
  Then an error notice starting with "Could not open folder C:\gone" is shown
  And "C:\gone" is removed from the recent folders list
  And the folder open in the Explorer is unchanged

Scenario: FILE-003.4 A path that is a folder opens as a folder
  Given "C:\work\project" is a folder
  When it is opened the way a file is (dropped on the window, passed on the command line or picked from a recent list)
  Then it opens in the Explorer and no tab is created for it
```

## FILE-004: Recent files and folders

- Status: draft
- Commands: `file.openRecent`, `file.openRecentFolder`, `file.clearRecent`, `file.clearRecentFolders`
- Files:
  - `src/lib/actions.ts` — `pushRecent` (most recent first, no duplicates by `samePath`, 15 kept), `pruneExisting` at start, `openFolder` removing a missing folder
  - `src/lib/commands.ts` — `file.openRecent`, `file.openRecentFolder` (hidden, take the path as argument), `file.clearRecent`, `file.clearRecentFolders`
  - `src/components/MenuBar.tsx` — `recentFilesMenu` (12 shown), `recentFoldersMenu` (10 shown, then Clear Recent Folders)
  - `src/components/Welcome.tsx` — `displayRecent`, the Recent list (8 shown)
  - `src/lib/store.ts` — `recentFiles`, `recentFolders`
- Tests: `src/__tests__/paths.test.ts`
- Docs: `docs/editing.md`

**As a** returning user
**I want** the files and folders I used last to be one click away
**So that** I don't have to browse for them again

```gherkin
Scenario: FILE-004.1 Opened and saved files go to the top of the list
  Given the recent files list is "a.txt", "b.txt"
  When I open "b.txt" and then save a new file as "c.txt"
  Then File › Open Recent File lists "c.txt", "b.txt", "a.txt" in that order
  And each file appears once

Scenario: FILE-004.2 How many are shown
  Given I have opened 20 different files and 12 different folders
  When I open File › Open Recent File and File › Open Recent Folder
  Then the file submenu shows the 12 most recent files, each with its folder beside the name
  And the folder submenu shows the 10 most recent folders
  And the Welcome screen shows the 8 most recent files

Scenario: FILE-004.3 Open a recent file
  Given "C:\work\a.txt" is in the recent files list and is not open
  When I choose it from File › Open Recent File
  Then it opens in a tab

Scenario: FILE-004.4 Clear Recent Files
  Given the recent files list has 5 entries and the recent folders list has 2
  When I choose Clear Recent Files at the bottom of File › Open Recent File
  Then the submenu shows "No recent files", disabled
  And the 2 recent folders are still listed
  And Clear Recent Files is unavailable in the command palette

Scenario: FILE-004.5 Files that no longer exist are dropped at start
  Given "C:\work\old.txt" is in the recent files list and has been deleted
  When Quarry starts
  Then "old.txt" is not in File › Open Recent File or on the Welcome screen

Scenario: FILE-004.6 Clear Recent Folders
  Given the recent files list has 5 entries and the recent folders list has 2
  When I choose Clear Recent Folders at the bottom of File › Open Recent Folder
  Then the submenu shows "No recent folders", disabled
  And the 5 recent files are still listed
  And Clear Recent Folders is unavailable in the command palette
```

## FILE-005: Quick Open a file by name

- Status: draft
- Commands: `file.quickOpen`
- Files:
  - `src/lib/commands.ts` — `file.quickOpen` sets `palette: "files"`
  - `src/components/CommandPalette.tsx` — `files` mode: open + recent files pool (50 shown), folder file list from `fs.walk` kept in `fileListCache` (100 shown), "Indexing folder…", opens with `openPath`
  - `src/lib/fuzzy.ts` — fuzzy path matching and scoring
  - `src/lib/ipc.ts` — `fs.walk`
  - `src-tauri/src/lib.rs` — `fs_walk`
- Tests: none
- Docs: `docs/editing.md`

**As a** developer who knows roughly what a file is called
**I want** to type part of its name and open it
**So that** I don't have to find it in the tree

```gherkin
Scenario: FILE-005.1 Find a file in the open folder
  Given the folder "C:\work\project" is open and contains "src\lib\store.ts"
  When I press Ctrl+P, type "store" and press Enter on "src/lib/store.ts"
  Then "C:\work\project\src\lib\store.ts" opens in a tab
  And the list closes

Scenario: FILE-005.2 Nothing typed yet
  Given a folder is open, "a.txt" is open in a tab and "b.txt" is a recent file
  When I press Ctrl+P and type nothing
  Then the list shows the open files and the recent files, "a.txt" before "b.txt"

Scenario: FILE-005.3 No folder open
  Given no folder is open
  When I press Ctrl+P and type "note"
  Then the box reads "Search open and recent files…"
  And only open and recent files matching "note" are listed
```

## FILE-006: Large files open in large-file mode

- Status: draft
- Commands: none
- Files:
  - `src/lib/actions.ts` — `openPath` compares `stat.size` with `settings.largeFileThresholdMb`; `openLarge`, `bigDocFields`, `pollBigIndex`; `sanitizeSettings` clamps the threshold to 1–4096
  - `src/lib/types.ts` — `Settings.largeFileThresholdMb` (default 32), `BigDocInfo`
  - `src/lib/ipc.ts` — `big.open`, `big.info`, `sys.largeFileThreshold`
  - `src-tauri/src/files.rs` — `LARGE_FILE_THRESHOLD` (32 MiB, the Rust-side default)
  - `src-tauri/src/lib.rs` — `big_open`, `large_file_threshold`
  - `src/components/panels/SettingsPanel.tsx` — "Large-file threshold (MB)" row
- Tests: `src/__tests__/paths.test.ts`
- Docs: `docs/large-files.md`, `docs/editing.md`

**As a** someone opening a multi-gigabyte log
**I want** Quarry to decide by size whether to load a file into the editor or read it from disk
**So that** huge files open at once instead of exhausting memory

```gherkin
Scenario: FILE-006.1 A file at the threshold opens in large-file mode
  Given the large-file threshold is 32 MB
  And "big.log" is exactly 33554432 bytes
  When I open "big.log"
  Then it opens as a large-file tab with the language "Large File"
  And a notice says "big.log (32.0 MB) opened in large-file mode."

Scenario: FILE-006.2 A file just below the threshold opens in the normal editor
  Given the large-file threshold is 32 MB
  And "almost.log" is 33554431 bytes
  When I open "almost.log"
  Then it opens as an ordinary editable text tab

Scenario: FILE-006.3 Changing the threshold changes the decision for the next open
  Given "data.csv" is 5 MB and the large-file threshold is 32 MB
  When I set Settings › Large-file threshold (MB) to 4 and open "data.csv"
  Then it opens as a large-file tab

Scenario: FILE-006.4 A UTF-16 large file is read-only
  Given "wide.log" is a 100 MB UTF-16 file
  When I open it
  Then it opens read-only in large-file mode
  And a warning says to raise the large-file threshold to edit it

Scenario: FILE-006.5 Opening at a line
  Given "big.log" is above the threshold
  When it is opened from a Find in Files result on line 120000
  Then the large-file view goes to line 120000 once it is shown
```

## FILE-007: Detect encoding and line endings on open

- Status: draft
- Commands: none
- Files:
  - `src-tauri/src/files.rs` — `detect_encoding` (BOM, else chardetng over the first 1 MiB), `read_text`, `detect_eol`, `count_eols`, `has_mixed_eol`
  - `src/lib/actions.ts` — `openPath` fills `Doc.encoding` / `bom` / `eol` / `decodeErrors` and shows the decode and mixed-EOL toasts
  - `src/lib/store.ts` — `Doc.encoding`, `Doc.bom`, `Doc.eol`, `Doc.decodeErrors`
  - `src/components/StatusBar.tsx` — shows the encoding (with " BOM") and line ending
- Tests: `src-tauri/src/files.rs`
- Docs: `docs/editing.md`

**As a** person working with files from different systems
**I want** Quarry to recognise each file's encoding and line endings
**So that** the text reads correctly and saving does not change the file's format

```gherkin
Scenario: FILE-007.1 A byte-order mark decides the encoding
  Given "utf16.txt" starts with the UTF-16 LE byte-order mark
  When I open it
  Then the status bar shows "UTF-16LE BOM"
  And the text is shown without the byte-order mark

Scenario: FILE-007.2 No byte-order mark: the encoding is detected
  Given "legacy.txt" is windows-1252 text with "café" and no byte-order mark
  When I open it
  Then the text reads "café"
  And the status bar shows "windows-1252"

Scenario: FILE-007.3 Bytes that do not decode
  Given "broken.txt" contains bytes that are invalid in its detected encoding
  When I open it
  Then the undecodable bytes are shown as "�"
  And a warning says saving would replace them and points to File › Reopen with Encoding

Scenario: FILE-007.4 Mixed line endings
  Given "mixed.txt" has 10 CRLF line endings and 2 LF line endings
  When I open it
  Then the status bar shows "CRLF"
  And a notice says "mixed.txt has mixed line endings; saving will normalise them to CRLF."
```

## FILE-008: Choose the encoding and line endings a file is saved with

- Status: draft
- Commands: `file.setEncoding`, `file.setEol`
- Files:
  - `src/lib/commands.ts` — `file.setEncoding`, `file.setEol` (with an argument: apply; without: open the status-bar picker through the bus)
  - `src/components/StatusBar.tsx` — encoding and line-ending `Picker`s (`openOn="status.encoding"` / `"status.eol"`)
  - `src/lib/bus.ts` — `status.encoding`, `status.eol` events
  - `src/lib/types.ts` — `ENCODINGS`
  - `src/lib/actions.ts` — `saveDocument` → `normalizeEol`, encoding / BOM passed to `fs.writeText`; snapshot comparison includes encoding and EOL
  - `src-tauri/src/files.rs` — `encode_text`, `write_text`
- Tests: `src-tauri/src/files.rs`
- Docs: `docs/editing.md`

**As a** person preparing a file for another system
**I want** to pick the encoding and line endings it is written with
**So that** the saved file is in the format that system expects

```gherkin
Scenario: FILE-008.1 Pick another encoding in the status bar
  Given "notes.txt" is open as UTF-8 with no unsaved changes
  When I click the encoding in the status bar and pick "windows-1252"
  Then the status bar shows "windows-1252"
  And the tab is marked as having unsaved changes
  And a notice says "Will save as windows-1252"
  And the text on screen is not reloaded or changed

Scenario: FILE-008.2 The encodings offered
  Given a text tab is active
  When I open the encoding picker
  Then it offers UTF-8, UTF-16LE, UTF-16BE, windows-1252, ISO-8859-1, ISO-8859-2, windows-1251, Shift_JIS, GBK and EUC-KR

Scenario: FILE-008.3 Switch line endings
  Given "script.sh" is open with CRLF line endings
  When I click "CRLF" in the status bar and pick "LF"
  Then the status bar shows "LF" and the tab is marked as having unsaved changes
  And after Ctrl+S every line in the file on disk ends with LF only

Scenario: FILE-008.4 Picking the current value changes nothing
  Given "notes.txt" is open as UTF-8 with LF and no unsaved changes
  When I pick "UTF-8" in the encoding picker and "LF" in the line-ending picker
  Then the tab still has no unsaved changes

Scenario: FILE-008.5 From the command palette
  Given a text tab is active
  When I run "File: Change File Encoding…" from the command palette
  Then the status bar's encoding picker opens

Scenario: FILE-008.6 Not available without a text document
  Given the active tab is a large-file tab
  When I open the command palette
  Then "Change File Encoding…" and "Change Line Endings…" are not offered
```

## FILE-009: Reopen a file in another encoding

- Status: draft
- Commands: `file.reopenWithEncoding`
- Files:
  - `src/lib/commands.ts` — `file.reopenWithEncoding` (no argument: `palette: "encoding"`)
  - `src/components/CommandPalette.tsx` — `encoding` mode listing `ENCODINGS`, current one marked
  - `src/lib/actions.ts` — `revertDocument` with `opts.encoding` (asks first when the tab has unsaved changes), result toasts
  - `src-tauri/src/files.rs` — `detect_encoding` (`force_encoding`; a BOM still wins), `read_text`
  - `src/components/MenuBar.tsx` — File › Reopen with Encoding…
- Tests: none
- Docs: `docs/editing.md`

**As a** person looking at garbled text
**I want** to re-read the file from disk in an encoding I choose
**So that** a wrongly detected encoding does not stop me reading or safely saving the file

```gherkin
Scenario: FILE-009.1 Reopen in a chosen encoding
  Given "legacy.txt" was opened as windows-1252 and shows "Ð¿Ñ€Ð¸Ð²ÐµÑ‚"
  When I choose File › Reopen with Encoding… and pick "UTF-8"
  Then the file is read again from disk as UTF-8 and shows "привет"
  And the status bar shows "UTF-8"
  And a notice says "Reopened legacy.txt as UTF-8"
  And the tab has no unsaved changes

Scenario: FILE-009.2 Unsaved changes are confirmed first
  Given "legacy.txt" has unsaved changes
  When I pick an encoding from Reopen with Encoding…
  Then Quarry asks "Revert legacy.txt?" with Revert and Cancel
  And choosing Cancel leaves the text and encoding as they were

Scenario: FILE-009.3 The chosen encoding does not fit either
  Given "data.txt" contains bytes that are not valid Shift_JIS
  When I reopen it with "Shift_JIS"
  Then a warning says "data.txt has bytes that are not valid Shift_JIS (shown as �)."

Scenario: FILE-009.4 Only for files on disk
  Given the active tab is "Untitled-1"
  When I open the File menu
  Then Reopen with Encoding… is disabled
```

## FILE-010: Save a document

- Status: draft
- Commands: `file.save`
- Files:
  - `src/lib/actions.ts` — `saveDocument` (untitled → Save dialog, read-only guard, large-file mapping guard, decode-error and changed-on-disk confirmations (the latter for text and large-file tabs), `parseUnmappable` fallback to UTF-8, `saving` set, `takeSnapshot`, toast, `pushRecent`), `normalizeEol`
  - `src/lib/commands.ts` — `file.save` and its `enabled` (text / large-file tab, or a Compare tab with changes)
  - `src/lib/ipc.ts` — `fs.writeText`, `big.save`
  - `src-tauri/src/files.rs` — `write_text` (temp file `.quarry-*.tmp` in the same folder, `sync_all`, `replace_with` via ReplaceFileW, creates missing parent folders, writes through symlinks, in-place fallback), `encode_text`, `find_unmappable`, `UNMAPPABLE_PREFIX`
  - `src-tauri/src/lib.rs` — `fs_write_text`, `big_save`
  - `src/lib/diff.ts` — `saveDiff` (a Compare tab saves its edited sides)
  - `src/lib/dialogs.ts` — `choose` behind `askDialog`
- Tests: `src-tauri/src/files.rs`
- Docs: `docs/editing.md`

**As a** person editing a file
**I want** Ctrl+S to write my text to disk safely
**So that** my work is kept and the file is never left half-written or silently altered

```gherkin
Scenario: FILE-010.1 Save a changed file
  Given "notes.txt" is open with unsaved changes
  When I press Ctrl+S
  Then the file on disk holds the text in the editor, in the tab's encoding and line endings
  And the unsaved-changes marker disappears
  And a notice says "Saved notes.txt"

Scenario: FILE-010.2 Saving an untitled document asks for a name
  Given "Untitled-1" contains "hello"
  When I press Ctrl+S and choose "C:\work\hello.txt" in the "Save" dialog
  Then the file is written and the tab is renamed "hello.txt"
  And cancelling the dialog instead would write nothing and leave the tab as it was

Scenario: FILE-010.3 The file changed on disk since it was opened
  Given "notes.txt" is open with unsaved changes
  And another program has modified "notes.txt" since
  When I press Ctrl+S
  Then Quarry asks "notes.txt changed on disk" with Overwrite and Cancel
  And choosing Cancel writes nothing and keeps my unsaved changes
  And a large-file tab whose file changed on disk asks the same before saving

Scenario: FILE-010.4 Characters the encoding cannot represent
  Given "prices.txt" is set to save as ISO-8859-1 and contains "€" on line 3
  When I press Ctrl+S
  Then Quarry says ISO-8859-1 can't represent some characters, naming "€" and line 3
  And choosing "Save as UTF-8" saves the file as UTF-8 and the status bar shows UTF-8
  And choosing Cancel writes nothing

Scenario: FILE-010.5 A read-only document is not overwritten
  Given "image.bin" was opened read-only
  When I press Ctrl+S
  Then nothing is written
  And a notice says "image.bin is read-only. Use Save As to write a copy."

Scenario: FILE-010.6 A file with undecodable bytes asks before overwriting
  Given "broken.txt" was opened with bytes shown as "�"
  When I press Ctrl+S
  Then Quarry warns that the original bytes would be lost, with "Save anyway" and Cancel
  And choosing Cancel writes nothing

Scenario: FILE-010.7 Edits typed while the save is in progress stay unsaved
  Given "notes.txt" is being saved
  When I type more text before the save finishes
  Then the tab still shows the unsaved-changes marker after the save

Scenario: FILE-010.8 Saving keeps the file's identity
  Given "hidden.txt" has the Hidden attribute
  When I change it and press Ctrl+S
  Then the file is replaced in one step and still has the Hidden attribute
  And no ".quarry-*.tmp" file is left in the folder

Scenario: FILE-010.9 Save is unavailable for tabs that are not files
  Given the active tab is a Claude Code tab
  When I open the File menu
  Then Save is disabled
```

## FILE-011: Save a document under another name

- Status: draft
- Commands: `file.saveAs`
- Files:
  - `src/lib/actions.ts` — `saveDocument(undefined, true)`: "Save As" dialog, tab takes the new path and name, `readonly` cleared, language re-detected, large-file mapping guard; a pick that `samePath`s the tab's own file keeps the read-only / decode-error / changed-on-disk guards
  - `src/lib/commands.ts` — `file.saveAs`; default `enabled` from `applyDefaultEnabled` (`fileOnly`)
  - `src/editor/manager.ts` — `setLanguage`
  - `src/editor/cmSetup.ts` — `detectLanguage`
  - `src-tauri/src/files.rs` — `write_text`
- Tests: none
- Docs: `docs/editing.md`

**As a** person who wants a copy or a new name
**I want** to save the current document to a path I choose
**So that** I can keep the original and continue working in the new file

```gherkin
Scenario: FILE-011.1 Save As moves the tab to the new file
  Given "config.txt" is open
  When I press Ctrl+Shift+S and choose "C:\work\config.json" in the "Save As" dialog
  Then "config.json" is written
  And the tab is renamed "config.json" and its language becomes JSON
  And "config.txt" on disk is unchanged
  And "config.json" is first in the recent files list

Scenario: FILE-011.2 Save As is the way out of a read-only document
  Given "image.bin" was opened read-only
  When I use Save As and choose "copy.bin"
  Then "copy.bin" is written and the tab, now "copy.bin", is no longer read-only

Scenario: FILE-011.3 Not over a file open in large-file mode
  Given "big.log" is open in a large-file tab
  And "notes.txt" is open in a text tab
  When I use Save As on "notes.txt" and choose the path of "big.log"
  Then nothing is written
  And a warning says "big.log is open in another tab in large-file mode. Close that tab before saving over it."

Scenario: FILE-011.4 Cancel
  Given "config.txt" is open with unsaved changes
  When I press Ctrl+Shift+S and cancel the dialog
  Then nothing is written and the tab still shows "config.txt" with unsaved changes

Scenario: FILE-011.5 Save As onto the same file keeps the Save guards
  Given "C:\work\notes.txt" is open with unsaved changes
  And another program has modified "notes.txt" since
  When I use Save As and choose "c:/WORK/Notes.TXT"
  Then Quarry asks "notes.txt changed on disk" with Overwrite and Cancel, as Save does
  And had the tab been read-only, nothing would be written and the read-only notice would show
```

## FILE-012: Save all changed documents

- Status: draft
- Commands: `file.saveAll`
- Files:
  - `src/lib/actions.ts` — `saveAll` (every `dirty` doc through `saveDocument`, in tab order)
  - `src/lib/commands.ts` — `file.saveAll`; default `enabled` (`docOnly`)
- Tests: none
- Docs: `docs/editing.md`

**As a** person with changes in several tabs
**I want** one command that saves them all
**So that** I don't have to visit each tab

```gherkin
Scenario: FILE-012.1 Save every changed tab
  Given "a.txt" and "b.txt" have unsaved changes and "c.txt" has none
  When I press Ctrl+Alt+S
  Then "a.txt" and "b.txt" are written and no tab shows the unsaved-changes marker
  And "c.txt" is not rewritten

Scenario: FILE-012.2 Untitled documents ask for a name
  Given "a.txt" and "Untitled-1" have unsaved changes
  When I press Ctrl+Alt+S and cancel the "Save" dialog for "Untitled-1"
  Then "a.txt" is saved
  And "Untitled-1" stays open with its unsaved changes

Scenario: FILE-012.3 Unavailable with no tabs
  Given no tabs are open
  When I open the File menu
  Then Save All is disabled
```

## FILE-013: Revert a file to the version on disk

- Status: draft
- Commands: `file.revert`
- Files:
  - `src/lib/actions.ts` — `revertDocument` (confirmation when dirty, `fs.readText`, `editor.replaceAll`, refreshes encoding / EOL / size, `takeSnapshot`)
  - `src/lib/commands.ts` — `file.revert` and its `enabled` (text tab with a path)
  - `src/editor/manager.ts` — `replaceAll`
- Tests: none
- Docs: `docs/editing.md`

**As a** person who made changes they don't want
**I want** to throw them away and reload the file
**So that** I am back at what is on disk

```gherkin
Scenario: FILE-013.1 Revert with unsaved changes asks first
  Given "notes.txt" has unsaved changes
  When I choose File › Revert File
  Then Quarry asks "Revert notes.txt?" with Revert and Cancel
  And choosing Revert shows the text from disk with no unsaved-changes marker
  And a notice says "Reverted notes.txt to the version on disk"

Scenario: FILE-013.2 Cancel keeps my changes
  Given "notes.txt" has unsaved changes
  When I choose File › Revert File and then Cancel
  Then my text and the unsaved-changes marker are unchanged

Scenario: FILE-013.3 Only for text files on disk
  Given the active tab is "Untitled-1"
  When I open the File menu
  Then Revert File is disabled

Scenario: FILE-013.4 The file cannot be read
  Given "notes.txt" is open and has been deleted from disk
  When I choose File › Revert File and confirm
  Then an error notice starting with "Could not revert notes.txt:" is shown
  And the text in the editor is unchanged
```

## FILE-014: Know which documents have unsaved changes

- Status: draft
- Commands: none
- Files:
  - `src/lib/actions.ts` — `snapshots`, `takeSnapshot`, the `editor.onDocUpdate` listener that clears `dirty` when text, EOL, encoding and BOM equal the saved snapshot (`SNAPSHOT_COMPARE_MAX` = 4 MiB)
  - `src/editor/manager.ts` — `onDocUpdate`, the update listener that sets `dirty` on edits
  - `src/lib/store.ts` — `Doc.dirty`, `updateDoc`
  - `src/components/TitleBar.tsx` — dirty dot on the tab, "●" in the window title
- Tests: none
- Docs: `docs/editing.md`

**As a** person editing several files
**I want** the unsaved state to reflect whether the text really differs from what was saved
**So that** I am only asked to save when there is something to save

```gherkin
Scenario: FILE-014.1 Editing marks the document
  Given "notes.txt" is open with no unsaved changes
  When I type a character
  Then its tab shows the unsaved-changes dot

Scenario: FILE-014.2 Undoing back to the saved text clears the mark
  Given "notes.txt" is open with no unsaved changes
  When I type "abc" and then undo until the text equals what is on disk
  Then the unsaved-changes dot disappears
  And closing the tab does not ask to save

Scenario: FILE-014.3 A changed encoding keeps it marked
  Given "notes.txt" was opened as UTF-8 and I picked "windows-1252" in the status bar
  When I type a character and undo it
  Then the tab still shows the unsaved-changes dot

Scenario: FILE-014.4 A new file with pasted-and-removed text
  Given "Untitled-1" was just created empty
  When I type "x" and delete it again
  Then "Untitled-1" has no unsaved-changes dot
```

## FILE-015: Notice changes made by other programs

- Status: draft
- Commands: none
- Files:
  - `src/lib/actions.ts` — `checkExternalChanges` (per text / large-file doc with a path: stat, `missingWarned`, came-back handling for text and unedited large-file tabs, reload or ask), `installExternalChangeWatch` (window `focus`, `visibilitychange`, tab activation), `reloadBig`, `revertDocument`, the `saving` set
  - `src/App.tsx` — installs the watch (`installExternalChangeWatch`)
  - `src/lib/store.ts` — `Doc.modifiedMs`, `Doc.following`
  - `src/components/BigFileView.tsx` — follow mode keeps `Doc.modifiedMs` / `size` current as lines are appended
  - `src/lib/ipc.ts` — `fs.stat`, `big.open`, `big.close`
  - `src-tauri/src/files.rs` — `stat`, `modified_ms`
- Tests: none
- Docs: `docs/editing.md`

**As a** developer whose files are also changed by git, build tools and other editors
**I want** Quarry to notice when an open file changes on disk
**So that** I never unknowingly edit or overwrite a stale copy

```gherkin
Scenario: FILE-015.1 A clean file reloads by itself
  Given "notes.txt" is open with no unsaved changes
  And another program changes "notes.txt"
  When I switch back to the Quarry window
  Then the tab shows the new text with no unsaved-changes marker
  And a notice says "notes.txt changed on disk and was reloaded."

Scenario: FILE-015.2 A file with unsaved changes asks
  Given "notes.txt" is open with unsaved changes
  And another program changes "notes.txt"
  When I switch back to the Quarry window
  Then Quarry asks "notes.txt changed on disk" with "Reload from disk" and "Keep my version"
  And "Reload from disk" replaces my text with the file's

Scenario: FILE-015.3 Keep my version is asked once
  Given Quarry asked about "notes.txt" changing on disk and I chose "Keep my version"
  When I switch away and back to the Quarry window without the file changing again
  Then my text is still there and Quarry does not ask again

Scenario: FILE-015.4 The file was deleted
  Given "notes.txt" is open
  And "notes.txt" is deleted in File Explorer
  When I switch back to the Quarry window
  Then the tab stays open with its text and is marked as having unsaved changes
  And a warning says "notes.txt was deleted or moved on disk. Saving will recreate it."
  And the warning is not repeated the next time the window gets focus

Scenario: FILE-015.5 A deleted file comes back
  Given "notes.txt" was reported deleted and I have not edited it since
  When the file reappears with newer content and I switch back to the Quarry window
  Then the tab shows the new content with no unsaved-changes marker
  And a notice says "notes.txt is back on disk and was reloaded."
  And the same holds for an unedited large-file tab: back unchanged, it loses the marker; back newer, it is reopened from disk

Scenario: FILE-015.6 Switching to a tab checks that tab
  Given "a.txt" is open in a background tab with no unsaved changes
  And another program changes "a.txt" while Quarry keeps focus
  When I click the "a.txt" tab
  Then it is reloaded with the notice that it changed on disk

Scenario: FILE-015.7 Quarry's own save is not an outside change
  Given "notes.txt" has unsaved changes
  When I press Ctrl+S
  Then no "changed on disk" question or reload notice appears

Scenario: FILE-015.8 A large file in follow mode is left alone
  Given "app.log" is open in a large-file tab with follow mode on
  When the log grows and I switch back to the Quarry window
  Then no "changed on disk" notice or question appears for it

Scenario: FILE-015.9 Lines picked up by follow mode are not an outside change
  Given "app.log" is open in a large-file tab in follow mode and has grown by 20 lines
  When I edit a line, which stops follow mode, and switch away and back to the Quarry window
  Then Quarry does not ask whether "app.log" changed on disk
  And pressing Ctrl+S saves without the "changed on disk" question
```

## FILE-016: Restore the previous session on start

- Status: draft
- Commands: none
- Files:
  - `src/lib/actions.ts` — `buildSession`, `sessionDocs`, `saveSession` (500 ms debounce, blocked while `restoring`), `flushSession`, `restoreSession` / `restoreSessionTabs`, `pruneExisting`, `UNTITLED_SESSION_MAX`, `SESSION_FILE` (`session.json`)
  - `src/App.tsx` — boot order (`loadSettings` → `restoreSession` → `installCloseGuard`), the store subscription that calls `saveSession`, the untitled-typing listener (`flushSession` at least every 10 s)
  - `src/editor/manager.ts` — `stateOf`, `scrollTopOf`, `restoreViewState`
  - `src/lib/ipc.ts` — `appData.read` / `appData.write`, `sys.startupPaths`
  - `src-tauri/src/lib.rs` — `app_read`, `app_write`, `safe_name`, `app_data_dir`
  - `src/lib/store.ts` — `SplitState`, `pinnedPanels`, `panelWidths`
  - `src/lib/types.ts` — `Settings.restoreSession` (default on)
  - `src/components/panels/SettingsPanel.tsx` — "Restore session on start" row
- Tests: none
- Docs: `docs/editing.md`, `docs/settings.md`

**As a** person who closes the editor at the end of the day
**I want** it to come back the way I left it
**So that** I can continue where I stopped

```gherkin
Scenario: FILE-016.1 Tabs, folder and positions come back
  Given Restore session on start is on
  And I had the folder "C:\work\project" open with tabs "a.txt", "b.json" and "c.md", "b.json" active with the cursor on line 40
  When I close and restart Quarry
  Then the folder and the three tabs are back in the same order
  And "b.json" is the active tab with the cursor and scroll position where I left them

Scenario: FILE-016.2 Untitled text comes back
  Given "Untitled-1" contains "call Anna back" and was never saved
  When I close and restart Quarry
  Then "Untitled-1" is open again with "call Anna back" and still marked as unsaved

Scenario: FILE-016.3 Files that no longer exist are skipped
  Given the session lists "a.txt" and "gone.txt", and "gone.txt" has been deleted
  When Quarry starts
  Then "a.txt" is restored and no tab or error appears for "gone.txt"

Scenario: FILE-016.4 Restoring ignores the open-tab limit
  Given the session lists 12 files and Maximum open tabs has since been lowered to 10
  When Quarry starts
  Then all 12 tabs are restored without a question

Scenario: FILE-016.5 Session restore turned off
  Given Restore session on start is off
  And I had 3 tabs and a folder open
  When I restart Quarry
  Then no tabs and no folder are open and the Welcome screen is shown
  And the recent files list and pinned side panels are still as I left them

Scenario: FILE-016.6 Empty untitled tabs and tool tabs are not kept
  Given an empty "Untitled-1", a commit graph tab and a Claude CLI terminal tab are open
  When I restart Quarry
  Then none of the three is reopened

Scenario: FILE-016.7 Untitled text is written while typing
  Given I am typing continuously in "Untitled-1"
  When 10 seconds have passed
  Then the session file already contains the text typed so far

Scenario: FILE-016.8 An untitled document too large for the session
  Given "Untitled-1" holds more than 2 MB of text
  When the session is saved
  Then a warning says "Untitled-1 is too large to keep in the session; save it to a file or it will be lost on exit."
  And the warning is shown once for that tab
```

## FILE-017: Exit without losing work (hot exit)

- Status: draft
- Commands: `app.exit`
- Files:
  - `src/lib/actions.ts` — `installCloseGuard`, `needsSavePromptOnExit`, `askSaveChanges`, `flushSession`
  - `src/lib/commands.ts` — `app.exit` closes the window (which raises the close request)
  - `src/components/TitleBar.tsx` — `WindowControls` Close button
  - `src/lib/claude.ts` — `stopAllClaude`
  - `src/lib/lsp.ts` — `stopAllServers`
  - `src-tauri/src/writer.rs` — `run_all`: stops the child processes of Claude tabs, language servers and terminals in parallel when the window closes
  - `src/lib/dialogs.ts` — `choose`
- Tests: `src/__tests__/paths.test.ts`, `src-tauri/src/writer.rs`
- Docs: `docs/editing.md`

**As a** person closing the editor
**I want** to be asked only about changes that would otherwise be lost
**So that** quitting is quick but never destroys work

```gherkin
Scenario: FILE-017.1 Unsaved untitled notes do not block exit
  Given Restore session on start is on
  And "Untitled-1" contains "scratch" and every file tab is saved
  When I press Alt+F4
  Then Quarry closes without asking
  And "Untitled-1" is back with "scratch" on the next start

Scenario: FILE-017.2 A changed file asks
  Given "notes.txt" has unsaved changes
  When I click the window's Close button
  Then Quarry asks "Save changes to notes.txt before closing?" with Save, Don't Save and Cancel
  And Cancel keeps the window open with everything as it was

Scenario: FILE-017.3 Several changed files are asked about together
  Given "a.txt", "b.txt" and a large-file tab "big.log" have unsaved changes
  When I choose File › Exit
  Then Quarry asks "Save changes to 3 files before closing?"
  And Save saves each of them and then closes

Scenario: FILE-017.4 A failed or cancelled save stops the exit
  Given "a.txt" and "Untitled-1" need saving at exit and I chose Save
  When I cancel the Save dialog for "Untitled-1"
  Then the window stays open

Scenario: FILE-017.5 With session restore off every unsaved tab is asked about
  Given Restore session on start is off
  And "Untitled-1" contains "scratch"
  When I press Alt+F4
  Then Quarry asks "Save changes to Untitled-1 before closing?"

Scenario: FILE-017.6 An untitled document over 2 MB is asked about
  Given Restore session on start is on
  And "Untitled-1" holds more than 2 MB of unsaved text
  When I close the window
  Then Quarry asks whether to save "Untitled-1"

Scenario: FILE-017.7 The session cannot be written
  Given "Untitled-1" contains unsaved text and the session file cannot be written
  When I close the window
  Then Quarry asks whether to save "Untitled-1" instead of closing silently

Scenario: FILE-017.8 An emptied untitled document is not asked about
  Given Restore session on start is on
  And "Untitled-2" was created with text that I then deleted, so it is empty but marked as changed
  When I close the window
  Then Quarry closes without asking about "Untitled-2"
  And "Untitled-2" is not brought back on the next start
```

## FILE-018: Open files by dropping them on the window

- Status: draft
- Commands: none
- Files:
  - `src/App.tsx` — `onDragDropEvent` handler: `openPath` per dropped path, except over `.claude-view` (`claude.drop`)
  - `src/lib/actions.ts` — `openPath` (a dropped folder goes to `openFolder`)
  - `src/lib/bus.ts` — `claude.drop`
  - `src/components/Welcome.tsx` — "Drop files anywhere to open them" hint
- Tests: none
- Docs: `docs/editing.md`

**As a** person with File Explorer open next to the editor
**I want** to drag files onto Quarry
**So that** they open without going through a dialog

```gherkin
Scenario: FILE-018.1 Drop files
  Given Quarry shows the Welcome screen
  When I drop "a.txt" and "b.txt" from File Explorer anywhere on the window
  Then both open in tabs

Scenario: FILE-018.2 Drop a folder
  Given no folder is open
  When I drop the folder "C:\work\project" on the window
  Then it opens in the Explorer panel and no tab is created for it

Scenario: FILE-018.3 A drop on a Claude tab is not opened as a file
  Given a Claude Code tab is showing
  When I drop "shot.png" on the conversation
  Then no editor tab opens for "shot.png"
  And the file goes to the Claude message instead

Scenario: FILE-018.4 A large file dropped on the window
  Given the large-file threshold is 32 MB
  When I drop a 2 GB "big.log" on the window
  Then it opens as a large-file tab
```

## FILE-019: Open files from the command line and File Explorer

- Status: draft
- Commands: none
- Files:
  - `src-tauri/src/lib.rs` — `cli_paths` (skips `-` options, repairs `C:"`, resolves relative paths against the launch folder, keeps existing paths only), `startup_paths`, the single-instance plugin callback emitting `open-paths` and focusing the window
  - `src/App.tsx` — `open-paths` listener
  - `src/lib/actions.ts` — `restoreSessionTabs`: startup paths replace the session's file tabs (untitled text still restored), then `openPath` for each
  - `src/lib/ipc.ts` — `sys.startupPaths`
- Tests: none
- Docs: `docs/editing.md`

**As a** person who double-clicks files or types `quarry file.txt`
**I want** those files to open in Quarry's one window
**So that** Quarry works like any other Windows editor

```gherkin
Scenario: FILE-019.1 Start with a file
  Given Quarry is not running and the last session had tabs "a.txt" and "b.txt"
  When I run `quarry.exe C:\work\c.txt`
  Then "c.txt" is open and active
  And "a.txt" and "b.txt" are not reopened

Scenario: FILE-019.2 Unsaved untitled text still comes back
  Given the last session had "Untitled-1" containing "scratch"
  When I start Quarry with `quarry.exe C:\work\c.txt`
  Then both "Untitled-1" with "scratch" and "c.txt" are open

Scenario: FILE-019.3 A second launch goes to the running window
  Given Quarry is running, minimized, with "a.txt" open
  When I choose "Open with Quarry" on "d.txt" in File Explorer
  Then no second Quarry window starts
  And the existing window is restored and focused with "d.txt" open next to "a.txt"

Scenario: FILE-019.4 Relative paths are taken from where the command ran
  Given Quarry is running
  When I run `quarry.exe notes.txt` in a terminal whose folder is "C:\work"
  Then "C:\work\notes.txt" opens in the running window

Scenario: FILE-019.5 Arguments that are not existing paths are ignored
  Given Quarry is not running
  When I run `quarry.exe --flag C:\missing.txt`
  Then Quarry starts with its restored session and no error
```

## FILE-020: Welcome screen

- Status: draft
- Commands: none
- Files:
  - `src/components/Welcome.tsx` — `Welcome` (four actions, Recent list, focus landing), `displayRecent`
  - `src/App.tsx` — renders `Welcome` when `docs.length === 0`
  - `src/lib/actions.ts` — `openFileDialog`, `openFolderDialog`, `openPath`, `dirName`; `restoreSessionTabs` creates no empty Untitled document
  - `src/components/BrandIcon.tsx` — the Quarry mark
  - `src/styles/app.css` — `.welcome`, `.welcome-card`, `.welcome-action`, `.welcome-recent`
- Tests: `src/__tests__/paths.test.ts`
- Docs: `docs/editing.md`

**As a** person starting Quarry with nothing open
**I want** a start page with the usual first steps
**So that** I can begin without hunting through menus

```gherkin
Scenario: FILE-020.1 Shown when no tabs are open
  Given there is no session to restore
  When Quarry starts
  Then the Welcome screen shows "New file", "Open file", "Open folder" and "All commands" with their shortcuts
  And no empty Untitled tab is created

Scenario: FILE-020.2 Appears again after the last tab closes
  Given one tab is open
  When I close it
  Then the Welcome screen is shown
  And keyboard focus is on "New file"

Scenario: FILE-020.3 Recent files
  Given the recent list holds "C:\work\a.txt" and "c:/work/A.TXT" and "C:\work\b.txt"
  When the Welcome screen is shown
  Then Recent lists "a.txt" once and "b.txt", each with its folder
  And clicking "b.txt" opens it

Scenario: FILE-020.4 No recent files
  Given the recent files list is empty
  When the Welcome screen is shown
  Then there is no Recent section

Scenario: FILE-020.5 All commands
  Given the Welcome screen is shown
  When I click "All commands"
  Then the command palette opens
```
