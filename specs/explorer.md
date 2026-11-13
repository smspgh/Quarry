---
area: Explorer and File Operations
prefix: EXPL
---

# Explorer and File Operations

The Explorer panel shows the open folder as a tree, opens files from it, and carries the file and folder actions (new, rename, delete, cut / copy / paste through the Windows file clipboard, copy path, show in File Explorer). The same tree component (`FileTree`) is reused by the Scripts panel with a `TreeVariant`; that panel has its own spec. User documentation: `docs/editing.md` (section "Explorer").

## EXPL-001: Open a folder and browse its tree

- Status: draft
- Commands: `view.explorer`, `file.openFolder`
- Files:
  - `src/components/panels/ExplorerPanel.tsx` — `ExplorerPanel`, `FileTree` (`load`, `rows`, `toggle`, header buttons, "No folder open" state), `compareEntries`, `FileIcon`
  - `src/lib/actions.ts` — `openFolderDialog`, `openFolder` (resets `explorerExpanded` to the root, shows the Explorer, recent folders)
  - `src/lib/store.ts` — `folder`, `explorerExpanded`, `fileListCache`
  - `src/lib/commands.ts` — `view.explorer` (`showPanel("explorer")`), `file.openFolder`
  - `src/lib/ipc.ts` — `fs.listDir(dir, true)`
  - `src-tauri/src/files.rs` — `list_dir` (hidden entries included when asked)
  - `src-tauri/src/lib.rs` — `fs_list_dir`
- Tests: `src/__tests__/paths.test.ts`, `src/__tests__/panels.test.ts`
- Docs: `docs/editing.md`, `docs/keyboard-shortcuts.md`

**As a** developer working in a project folder
**I want** to open the folder and browse it as a tree in a side panel
**So that** I can see and reach every file without leaving the editor

```gherkin
Scenario: EXPL-001.1 No folder open
  Given no folder is open
  When I press Ctrl+Shift+E
  Then the Explorer panel shows "No folder open." and an "Open Folder" button
  And clicking "Open Folder" shows the Windows folder picker titled "Open Folder"

Scenario: EXPL-001.2 Open a folder
  Given no folder is open
  When I press Ctrl+Shift+O and pick C:\work\site
  Then the Explorer panel opens with the header "site"
  And the top level of C:\work\site is listed with only the root expanded
  And C:\work\site is added to the recent folders

Scenario: EXPL-001.3 Folders first, natural order, hidden files included
  Given the folder contains the files "b.txt", "a10.txt", "a2.txt", ".gitignore" and the folder "zeta"
  When the tree is shown
  Then the rows are in the order "zeta", ".gitignore", "a2.txt", "a10.txt", "b.txt"

Scenario: EXPL-001.4 Expand and collapse a folder by clicking it
  Given the folder "src" is collapsed
  When I click "src"
  Then "src" expands and its children are listed one level deeper
  When I click "src" again
  Then "src" collapses

Scenario: EXPL-001.5 Collapsing a folder keeps the selection visible
  Given "src" is expanded and "src\main.ts" is the selected row
  When I collapse "src"
  Then "src" becomes the selected row

Scenario: EXPL-001.6 Close the folder
  Given C:\work\site is open in the Explorer
  When I click "Close Folder" in the Explorer header
  Then the Explorer shows "No folder open."
  And the open tabs stay open

Scenario: EXPL-001.7 A path that is not a folder
  Given a recent folder that has since been deleted
  When I open it
  Then an error toast starts with "Could not open folder"
  And the folder is removed from the recent folders
  And the Explorer keeps what it showed before
```

## EXPL-002: Single click previews a file, double-click opens it

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/ExplorerPanel.tsx` — row `onClick` (`openPath(p, { preview: true })`, `editor.keepFocusOnNextOpen()`), row `onDoubleClick` (clears `preview`, `editor.focus()`)
  - `src/editor/manager.ts` — `keepFocusOnNextOpen`, `takeKeepFocus`, `focus`
  - `src/lib/actions.ts` — `openPath` (preview tabs)
- Tests: none
- Docs: `docs/editing.md`

**As a** developer looking through a folder
**I want** a single click to show a file without leaving the tree and a double-click to take me into it
**So that** I can skim many files quickly and still act on the one I clicked with the keyboard

```gherkin
Scenario: EXPL-002.1 Single click opens a preview tab and focus stays in the tree
  Given the folder is open and "notes.md" is not open
  When I click "notes.md" in the Explorer
  Then "notes.md" opens in a preview tab
  And keyboard focus stays on the "notes.md" row
  And pressing Delete asks to delete "notes.md" instead of typing into the editor

Scenario: EXPL-002.2 The next single click replaces the preview
  Given "notes.md" is open as an unmodified preview tab
  When I click "todo.md" in the Explorer
  Then the preview tab now shows "todo.md"
  And there is no tab for "notes.md"

Scenario: EXPL-002.3 Double-click keeps the tab and focuses the editor
  Given the folder is open
  When I double-click "notes.md"
  Then "notes.md" is open in a tab that is not a preview
  And keyboard focus is in the editor

Scenario: EXPL-002.4 Double-clicking a folder does not open anything
  When I double-click the folder "src"
  Then no tab is opened
```

## EXPL-003: Navigate the tree with the keyboard

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/ExplorerPanel.tsx` — `onTreeKeyDown` (arrows, Home / End, PageUp / PageDown by 15 rows, Enter / Space, F2, Delete, type-ahead with a 700 ms window), `focusRow`, roving `tabIndex`, `role="tree"` / `treeitem` attributes
- Tests: none
- Docs: `docs/editing.md`

**As a** keyboard user
**I want** to move through the tree, expand folders and open files without the mouse
**So that** the Explorer is fully usable from the keyboard

```gherkin
Scenario: EXPL-003.1 Move between rows
  Given the row "a.txt" has focus and "b.txt" is the row below it
  When I press ArrowDown
  Then "b.txt" is selected and has focus
  When I press Home
  Then the first row is selected
  When I press End
  Then the last row is selected

Scenario: EXPL-003.2 Page keys move 15 rows
  Given a tree of 100 rows with the first row selected
  When I press PageDown
  Then the 16th row is selected
  When I press PageUp
  Then the first row is selected

Scenario: EXPL-003.3 ArrowRight expands, then enters a folder
  Given the collapsed folder "src" has focus
  When I press ArrowRight
  Then "src" expands and stays selected
  When I press ArrowRight again
  Then the first row inside "src" is selected

Scenario: EXPL-003.4 ArrowLeft collapses, or goes to the parent folder
  Given the expanded folder "src" has focus
  When I press ArrowLeft
  Then "src" collapses
  Given the file "src\main.ts" has focus
  When I press ArrowLeft
  Then the row "src" is selected
  And a row at the top level stays selected when I press ArrowLeft

Scenario: EXPL-003.5 Enter or Space opens a file or toggles a folder
  Given the file "notes.md" has focus
  When I press Enter
  Then "notes.md" opens in a tab
  Given the folder "src" has focus
  When I press Space
  Then "src" expands or collapses

Scenario: EXPL-003.6 Type the start of a name to jump to it
  Given the tree lists "alpha.txt", "beta.txt" and "bravo.txt" and "alpha.txt" has focus
  When I type "b"
  Then "beta.txt" is selected
  When I type "b" again more than 700 ms later
  Then "bravo.txt" is selected
  When I type "br" quickly
  Then "bravo.txt" is selected

Scenario: EXPL-003.7 Keys are left alone while a name is being typed
  Given I am renaming "notes.md" in the tree
  When I press ArrowDown or Delete in the name box
  Then the selection does not move and nothing is deleted from disk
```

## EXPL-004: Select several files and folders

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/ExplorerPanel.tsx` — `multi`, `anchor`, `rangeOf`, `toggleIn`, `selection()`, `pickTargets`, row `onContextMenu` (right-click outside the selection selects that row only)
- Tests: `src/__tests__/paths.test.ts`
- Docs: `docs/editing.md`

**As a** developer tidying a folder
**I want** to select several rows with Ctrl+click and Shift+click
**So that** I can cut, copy, delete, open or search them in one action

```gherkin
Scenario: EXPL-004.1 Ctrl+click adds and removes rows without opening them
  Given "a.txt" is the selected row
  When I Ctrl+click "c.txt"
  Then "a.txt" and "c.txt" are both selected
  And no tab is opened for "c.txt"
  When I Ctrl+click "a.txt"
  Then only "c.txt" is selected

Scenario: EXPL-004.2 Shift+click selects a range from the last plain click
  Given the rows "a.txt", "b.txt", "c.txt", "d.txt" and I clicked "b.txt"
  When I Shift+click "d.txt"
  Then "b.txt", "c.txt" and "d.txt" are selected
  And no further tab is opened

Scenario: EXPL-004.3 Ctrl+Shift+click adds a range to the selection
  Given "a.txt" is selected and I Ctrl+clicked "c.txt"
  When I Ctrl+Shift+click "e.txt"
  Then "a.txt", "c.txt", "d.txt" and "e.txt" are selected

Scenario: EXPL-004.4 Right-click inside the selection keeps it
  Given "a.txt", "b.txt" and "c.txt" are selected
  When I right-click "b.txt"
  Then the menu offers "Cut 3 items", "Copy 3 items" and "Delete 3 items"

Scenario: EXPL-004.5 Right-click outside the selection selects just that row
  Given "a.txt" and "b.txt" are selected
  When I right-click "z.txt"
  Then only "z.txt" is selected
  And the menu offers "Cut", "Copy" and "Delete" for one item

Scenario: EXPL-004.6 A plain click or a click on blank space ends the multi-selection
  Given "a.txt" and "b.txt" are selected
  When I click the blank space below the rows
  Then no row is selected
```

## EXPL-005: Expand All and Collapse All for a folder

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/ExplorerPanel.tsx` — `expandAll` (`EXPAND_ALL_MAX` = 500, `EXPAND_ALL_SKIP` = `.git`, `node_modules`, batches of 16 listings), `collapseAll`, `collapseUnder`, the Expand / Expand All / Collapse / Collapse All menu items
- Tests: `src/__tests__/paths.test.ts`
- Docs: `docs/editing.md`

**As a** developer exploring an unfamiliar project
**I want** to open or close a whole subtree from a folder's right-click menu
**So that** I do not have to click every folder one by one

```gherkin
Scenario: EXPL-005.1 Menu items follow the folder's state
  Given the collapsed folder "src" contains subfolders
  When I right-click "src"
  Then the menu offers "Expand" and "Expand All" and neither "Collapse" nor "Collapse All"
  Given "src" is expanded and "src\lib" inside it is expanded too
  When I right-click "src"
  Then the menu offers "Expand All", "Collapse" and "Collapse All" and not "Expand"

Scenario: EXPL-005.2 No Expand All for a folder without subfolders
  Given the folder "docs" contains only files
  When I right-click "docs"
  Then the menu does not offer "Expand All"

Scenario: EXPL-005.3 Expand All opens the folder and everything below it
  Given "src" contains "lib" and "lib" contains "util"
  When I choose "Expand All" on "src"
  Then "src", "src\lib" and "src\lib\util" are expanded

Scenario: EXPL-005.4 Expand All passes over .git and node_modules
  Given the open folder contains ".git", "node_modules" and "src"
  When I choose "Expand All" on a folder that contains them
  Then ".git" and "node_modules" stay collapsed
  And "node_modules" still expands fully when I choose "Expand All" on "node_modules" itself

Scenario: EXPL-005.5 Expand All stops at 500 folders
  Given a folder with 2000 folders beneath it
  When I choose "Expand All" on it
  Then 500 folders are expanded
  And a toast says "Expanded the first 500 folders; expand the rest one at a time."

Scenario: EXPL-005.6 Collapse All closes the folder and every folder under it
  Given "src" and "src\lib" are expanded and "src\lib\a.ts" is selected
  When I choose "Collapse All" on "src"
  Then "src" is collapsed and "src" is the selected row
  And "src\lib" is collapsed when I expand "src" again
```

## EXPL-006: The tree follows the active tab and reveals a file on request

- Status: draft
- Commands: `file.showInQuarryExplorer`
- Files:
  - `src/components/panels/ExplorerPanel.tsx` — `reveal`, `ancestorDirs`, `revealWanted` / `focusWanted`, `explorer.reveal` bus listener, `.active` row class
  - `src/lib/actions.ts` — `showInExplorerPanel` (opens the file's own folder when it is outside the open one), `isInside`
  - `src/lib/commands.ts` — `file.showInQuarryExplorer` (enabled only for a tab with a path)
  - `src/components/FileMenu.tsx` — "Show in Quarry Explorer" item (`showInQuarry`, hidden in the Explorer itself)
  - `src/components/MenuBar.tsx` — File menu entry
  - `src/lib/bus.ts` — `explorer.reveal` event
- Tests: `src/__tests__/paths.test.ts`
- Docs: `docs/editing.md`

**As a** developer with a file open
**I want** the Explorer to show where that file is
**So that** I can find its neighbours and act on it in the tree

```gherkin
Scenario: EXPL-006.1 Switching tabs selects the file in the tree
  Given C:\work\site is open and the folders "src" and "src\lib" are collapsed
  When I switch to the tab of C:\work\site\src\lib\util.ts
  Then "src" and "src\lib" expand
  And the row "util.ts" is selected, marked active and scrolled into view

Scenario: EXPL-006.2 Show in Quarry Explorer focuses the file's row
  Given the Explorer panel is closed and the active tab is C:\work\site\src\main.ts
  When I run "Show in Quarry Explorer"
  Then the Explorer panel opens
  And the row "main.ts" is selected and has keyboard focus

Scenario: EXPL-006.3 A file outside the open folder opens its own folder
  Given C:\work\site is open in the Explorer
  And the active tab is D:\logs\app.log
  When I run "Show in Quarry Explorer"
  Then D:\logs becomes the open folder
  And a toast says "Opened D:\logs in the Explorer"
  And the row "app.log" is selected and has focus

Scenario: EXPL-006.4 Not available for a tab without a file
  Given the active tab is an untitled document
  When I open the File menu
  Then "Show in Quarry Explorer" is disabled

Scenario: EXPL-006.5 The Explorer's own menu does not offer it
  When I right-click a file in the Explorer
  Then the menu has "Show in Windows Explorer" and no "Show in Quarry Explorer"
```

## EXPL-007: The tree refreshes when files change on disk

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/ExplorerPanel.tsx` — watcher effect (`fs.onChanged`, reloads only loaded directories that contain a changed path, clears `fileListCache`), `refresh`, `explorer.reload` bus listener
  - `src-tauri/src/watch.rs` — `start` (recursive `notify` watcher, `DEBOUNCE` = 300 ms), `changed_paths`
  - `src-tauri/src/lib.rs` — `watch_start` (one watcher, replaced when the root changes; emits `fs-changed`), `watch_stop`
  - `src/lib/ipc.ts` — `fs.watchStart`, `fs.watchStop`, `fs.onChanged`
- Tests: `src-tauri/src/watch.rs`
- Docs: `docs/editing.md`

**As a** developer whose tools create and delete files while I work
**I want** the tree to update by itself
**So that** what I see is what is on disk without pressing Refresh

```gherkin
Scenario: EXPL-007.1 A file created outside Quarry appears
  Given C:\work\site is open and "src" is expanded
  When another program creates C:\work\site\src\new.ts
  Then the row "new.ts" appears under "src" within about a second, without my doing anything

Scenario: EXPL-007.2 A file deleted outside Quarry disappears
  Given "src\old.ts" is listed
  When another program deletes it
  Then the row "old.ts" is removed

Scenario: EXPL-007.3 Changes in folders that were never expanded cost nothing visible
  Given "node_modules" has never been expanded
  When 5000 files change inside "node_modules"
  Then the rows on screen do not change
  And "node_modules" shows its current contents when I expand it later

Scenario: EXPL-007.4 Refresh reloads everything shown
  Given the tree is shown with "src" expanded
  When I click "Refresh" in the Explorer header
  Then the root and every expanded folder are listed again from disk

Scenario: EXPL-007.5 The watcher follows the open folder
  Given C:\work\site is open
  When I open C:\work\api instead
  Then changes in C:\work\api update the tree
  And changes in C:\work\site no longer do

Scenario: EXPL-007.6 The watcher cannot start
  Given the folder cannot be watched
  When it is opened
  Then a warning toast starts with "File watcher unavailable:"
  And the tree is still shown and Refresh still works
```

## EXPL-008: Create a file or folder from the Explorer

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/ExplorerPanel.tsx` — `startCreate`, `targetDir`, `commitCreate` (once-only guard `committingCreate`; `createClosed` stops a blur after Escape or a finished commit from committing again), `fileNameProblem`, the name box row
  - `src/lib/ipc.ts` — `fs.exists`, `fs.createDir`, `fs.writeText`
  - `src-tauri/src/lib.rs` — `fs_create_dir`, `fs_exists`
- Tests: `src/__tests__/paths.test.ts`
- Docs: `docs/editing.md`

**As a** developer adding to a project
**I want** to create a file or folder next to what I have selected
**So that** I do not have to switch to File Explorer

```gherkin
Scenario: EXPL-008.1 New File in the selected folder
  Given the folder "src" is the selected row
  When I click "New File" in the Explorer header, type "util.ts" and press Enter
  Then the empty file "src\util.ts" is created
  And "src" is expanded and lists "util.ts"
  And "util.ts" opens in a tab

Scenario: EXPL-008.2 New item next to a selected file, or in the root
  Given the file "src\main.ts" is the selected row
  When I create the folder "lib" with "New Folder"
  Then "src\lib" is created
  Given no row is selected
  When I create the folder "docs" with "New Folder"
  Then "docs" is created at the top level of the open folder
  And no tab is opened

Scenario: EXPL-008.3 Escape or an empty name creates nothing
  Given the name box is open
  When I press Escape, or press Enter with the box empty
  Then the name box closes and nothing is created
  When I type "x.txt" in a new name box and press Escape
  Then no file "x.txt" is created, even though the box loses focus as it closes

Scenario: EXPL-008.4 A name Windows refuses is rejected
  Given the name box is open
  When I type "what?.txt" and press Enter
  Then an error toast says the name can't contain any of < > : " | ? *
  And nothing is created and the name box stays open

Scenario Outline: EXPL-008.5 Invalid names
  When I try to create "<name>"
  Then an error toast is shown and nothing is created

  Examples:
    | name      |
    | a/b       |
    | sub\x.txt |
    | name.     |
    | CON       |
    | nul.txt   |

Scenario: EXPL-008.6 An existing name is never overwritten
  Given "src\util.ts" exists and has content
  When I create a new file named "util.ts" in "src"
  Then an error toast says "util.ts already exists"
  And the content of "src\util.ts" is unchanged
```

## EXPL-009: Rename a file or folder

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/ExplorerPanel.tsx` — `startRename`, `commitRename` (runs once per box: `renameClosed` is set by Escape and by the first commit, so the blur as the box is removed does nothing; open tabs follow, `explorerExpanded` follows a renamed folder, case-only rename allowed), rename input (`onFocus` selects the name without its extension), "Rename" menu item, F2
  - `src/lib/ipc.ts` — `fs.rename`
  - `src-tauri/src/lib.rs` — `fs_rename`
- Tests: `src/__tests__/paths.test.ts`
- Docs: `docs/editing.md`

**As a** developer
**I want** to rename a file or folder in place
**So that** the tree and my open tabs stay consistent with the disk

```gherkin
Scenario: EXPL-009.1 F2 renames the focused file
  Given the row "notes.md" has focus
  When I press F2
  Then the name becomes an edit box with "notes" selected and ".md" not selected
  When I type "todo" and press Enter
  Then the file is now "todo.md" and its row is selected and has focus

Scenario: EXPL-009.2 An open tab follows the renamed file
  Given "notes.md" is open in a tab with unsaved changes
  When I rename it to "todo.md" in the Explorer
  Then the tab is titled "todo.md" and still has its unsaved changes
  And saving writes to "todo.md"

Scenario: EXPL-009.3 Tabs follow a renamed folder
  Given "src\main.ts" is open in a tab and "src" is expanded
  When I rename the folder "src" to "app"
  Then the tab's file is "app\main.ts"
  And the folder "app" is still expanded

Scenario: EXPL-009.4 Escape cancels
  Given I am renaming "notes.md" and have typed "todo.md"
  When I press Escape
  Then the file is still called "notes.md"
  And no error toast is shown

Scenario: EXPL-009.5 A taken name is refused
  Given "a.txt" and "b.txt" are in the same folder
  When I rename "a.txt" to "b.txt"
  Then an error toast says "b.txt already exists"
  And both files are unchanged

Scenario: EXPL-009.6 Changing only the letter case works
  Given the file "readme.md"
  When I rename it to "README.md"
  Then the file is called "README.md"
  And no "already exists" error is shown

Scenario: EXPL-009.7 Invalid names are refused
  When I rename "a.txt" to "a?.txt"
  Then an error toast is shown and the file keeps its name

Scenario: EXPL-009.8 Rename is for one item
  Given "a.txt" and "b.txt" are selected
  When I right-click "a.txt"
  Then the menu does not offer "Rename"

Scenario: EXPL-009.9 Enter renames once
  Given I am renaming "notes.md"
  When I type "todo.md" and press Enter
  Then the file is renamed to "todo.md"
  And no "already exists" error follows when the box closes
```

## EXPL-010: Delete files and folders to the Recycle Bin

- Status: draft
- Commands: none
- Files:
  - `src/lib/fileOps.ts` — `trashPaths` (one confirmation for the whole selection, per-item error toasts, `explorer.reload`, then `checkExternalChanges` so open tabs of deleted files are flagged at once)
  - `src/lib/actions.ts` — `confirmDelete` (Delete / Cancel, Cancel is the default), `checkExternalChanges` (missing file: tab kept, marked unsaved, warned once)
  - `src/components/FileMenu.tsx` — "Delete" / "Delete N items"
  - `src/components/panels/ExplorerPanel.tsx` — `deleteSelection` (Delete key), `afterDelete` (selection moves to the parent folder)
  - `src/lib/ipc.ts` — `fs.trash`
  - `src-tauri/src/lib.rs` — `fs_trash` (`trash::delete`)
- Tests: none
- Docs: `docs/editing.md`

**As a** developer
**I want** deletes to ask first and go to the Recycle Bin
**So that** a slip can be undone from Windows

```gherkin
Scenario: EXPL-010.1 Delete one file
  Given the row "old.txt" has focus
  When I press Delete
  Then a dialog asks 'Delete "old.txt"?' with the text "The file is moved to the Recycle Bin."
  When I click "Delete"
  Then "old.txt" is in the Windows Recycle Bin and its row is gone
  And its parent folder becomes the selected row

Scenario: EXPL-010.2 Cancel is the default
  Given the delete dialog for "old.txt" is open
  When I press Enter or Escape
  Then nothing is deleted

Scenario: EXPL-010.3 Delete a folder
  When I delete the folder "build"
  Then the dialog asks 'Delete folder "build"?' and says the folder and everything inside it are moved to the Recycle Bin
  And confirming moves the folder with its contents to the Recycle Bin

Scenario: EXPL-010.4 Delete a selection with one question
  Given "a.txt", "b.txt" and the folder "tmp" are selected
  When I choose "Delete 3 items" from the right-click menu
  Then one dialog asks "Delete 3 items?"
  And confirming moves all three to the Recycle Bin

Scenario: EXPL-010.5 An item that cannot be deleted does not stop the others
  Given "a.txt" and "locked.txt" are selected and "locked.txt" cannot be deleted
  When I confirm the delete
  Then "a.txt" is in the Recycle Bin
  And an error toast starts with "locked.txt:"
  And "locked.txt" is still listed

Scenario: EXPL-010.6 An open tab of a deleted file stays open
  Given "notes.md" is open in a tab
  When I delete "notes.md" (or a folder containing it) from the Explorer
  Then the tab stays open with its text and is marked as having unsaved changes
  And a warning says "notes.md was deleted or moved on disk. Saving will recreate it."
```

## EXPL-011: Cut, copy and paste files through the Windows clipboard

- Status: draft
- Commands: none
- Files:
  - `src/lib/fileOps.ts` — `filesToClipboard`, `pasteInto` (toasts, `retargetDocs` after a move, `explorer.reload` for destination and source folders), `baseName`
  - `src/components/FileMenu.tsx` — Cut / Copy / Paste items, `canPaste` (Paste disabled with nothing to paste, "Paste N items"), key hints
  - `src/components/panels/ExplorerPanel.tsx` — Ctrl+C / Ctrl+X / Ctrl+V in `onTreeKeyDown`, `pasteDirFor`, `pasteHere`, `afterPaste`, `data-file-keys`
  - `src/App.tsx` — global key handler leaves Ctrl+C / X / V alone inside `[data-file-keys]`
  - `src-tauri/src/fileops.rs` — `set_clipboard` (CF_HDROP + "Preferred DropEffect"), `get_clipboard`, `paste`, `free_name`, `copy_recursive`, `clear_clipboard`
  - `src-tauri/src/lib.rs` — `files_to_clipboard`, `files_from_clipboard`, `files_paste` (empties the clipboard after a move)
  - `src/lib/ipc.ts` — `fs.toClipboard`, `fs.fromClipboard`, `fs.paste`
- Tests: `src-tauri/src/fileops.rs`
- Docs: `docs/editing.md`

**As a** developer moving files around
**I want** Cut, Copy and Paste in the Explorer to use the same clipboard as Windows File Explorer
**So that** I can copy in one and paste in the other, and never lose a file to an overwrite

```gherkin
Scenario: EXPL-011.1 Copy and paste inside Quarry
  Given the row "a.txt" has focus
  When I press Ctrl+C
  Then a toast says "Copied a.txt. Paste with Ctrl+V here or in File Explorer."
  When I select the folder "backup" and press Ctrl+V
  Then "backup\a.txt" exists and the original "a.txt" is still there
  And "backup" is expanded and the pasted row is selected and has focus
  And a toast says "Pasted 1 item into backup"

Scenario: EXPL-011.2 Files copied in Quarry paste in File Explorer, and the other way round
  Given I copied "a.txt" in the Quarry Explorer
  When I paste in a Windows File Explorer window
  Then a copy of "a.txt" appears there
  Given I copied "report.pdf" in Windows File Explorer
  When I press Ctrl+V on a folder row in Quarry
  Then "report.pdf" is copied into that folder

Scenario: EXPL-011.3 Cut then paste moves, and open tabs follow
  Given "src\a.ts" is open in a tab
  When I press Ctrl+X on "src\a.ts" and Ctrl+V on the folder "lib"
  Then "lib\a.ts" exists and "src\a.ts" does not
  And the tab now belongs to "lib\a.ts"
  And a toast says "Moved 1 item into lib"
  And a second Ctrl+V says "Nothing to paste. Copy or cut files first."

Scenario: EXPL-011.4 Paste never overwrites
  Given the folder "dst" already contains "a.txt" with the text "existing"
  When I copy another "a.txt" and paste it into "dst"
  Then "dst\a - Copy.txt" is created
  And "dst\a.txt" still contains "existing"
  When I paste the same copy again
  Then "dst\a - Copy (2).txt" is created

Scenario: EXPL-011.5 A move into a folder with the same name gets a number
  Given the folder "dst" already contains "a.txt"
  When I cut another "a.txt" and paste it into "dst"
  Then it arrives as "dst\a (2).txt"

Scenario: EXPL-011.6 Paste target
  When I paste with a folder row selected
  Then the items go into that folder
  When I paste with a file row selected
  Then the items go into that file's folder
  When I right-click the blank space below the rows and choose "Paste"
  Then the items go into the open folder itself

Scenario: EXPL-011.7 Cut and paste into the same folder leaves the item alone
  Given I cut "src\a.ts"
  When I paste into "src"
  Then "src\a.ts" is still there under the same name and no copy is made

Scenario: EXPL-011.8 A folder cannot be pasted into itself
  Given I copied the folder "src"
  When I paste into "src\lib"
  Then an error toast says the folder "src" cannot be pasted into itself
  And nothing is created

Scenario: EXPL-011.9 Paste is disabled when the clipboard holds no files
  Given the clipboard holds plain text
  When I right-click a folder
  Then "Paste" is disabled with the tooltip "Nothing to paste. Copy or cut files first."

Scenario: EXPL-011.10 Several items
  Given "a.txt", "b.txt" and "c.txt" are selected
  When I press Ctrl+C
  Then a toast starts with "Copied 3 items."
  And the right-click menu on a folder offers "Paste 3 items"
  And after pasting, the three new rows are selected

Scenario: EXPL-011.11 Ctrl+C in the tree does not copy editor text
  Given text is selected in the editor and focus is on a row in the Explorer
  When I press Ctrl+C
  Then the file of that row is put on the clipboard
  And the editor's Copy command does not run
```

## EXPL-012: Copy a path or a name as text

- Status: draft
- Commands: none
- Files:
  - `src/lib/fileOps.ts` — `copyLines` (CRLF-separated), `baseName`
  - `src/components/FileMenu.tsx` — "Copy Path" / "Copy Paths", "Copy File Name" / "Copy Name" / "Copy Names"
- Tests: none
- Docs: `docs/editing.md`

**As a** developer writing a command line or a message
**I want** to copy the full path or just the name of what I right-clicked
**So that** I can paste it elsewhere without typing it

```gherkin
Scenario: EXPL-012.1 Copy Path
  When I right-click C:\work\site\src\main.ts and choose "Copy Path"
  Then the clipboard text is "C:\work\site\src\main.ts"
  And a toast says "Path copied"

Scenario: EXPL-012.2 Copy File Name and Copy Name
  When I right-click the file "main.ts"
  Then the menu offers "Copy File Name" and choosing it copies "main.ts"
  When I right-click the folder "src"
  Then the menu offers "Copy Name" and choosing it copies "src"

Scenario: EXPL-012.3 Several items are copied one per line
  Given "a.txt" and "b.txt" in C:\work are selected
  When I choose "Copy Paths"
  Then the clipboard text is "C:\work\a.txt" and "C:\work\b.txt" on two lines
  And a toast says "Paths copied"
  And "Copy Names" copies "a.txt" and "b.txt" on two lines
```

## EXPL-013: Show a file in Windows File Explorer

- Status: draft
- Commands: `file.showInWindowsExplorer`
- Files:
  - `src/lib/actions.ts` — `showInWindowsExplorer` (`revealItemInDir`)
  - `src/components/FileMenu.tsx` — "Show in Windows Explorer" (one item only)
  - `src/lib/commands.ts` — `file.showInWindowsExplorer` (enabled only for a tab with a path)
  - `src/components/MenuBar.tsx` — File menu entry
- Tests: none
- Docs: `docs/editing.md`

**As a** developer
**I want** to jump from a file in Quarry to the same file in Windows File Explorer
**So that** I can use Windows tools on it

```gherkin
Scenario: EXPL-013.1 From the Explorer menu
  When I right-click "src\main.ts" and choose "Show in Windows Explorer"
  Then a Windows File Explorer window opens at "src" with "main.ts" selected

Scenario: EXPL-013.2 From the File menu for the active tab
  Given the active tab is C:\work\site\notes.md
  When I choose File › Show in Windows Explorer
  Then File Explorer opens at C:\work\site with "notes.md" selected

Scenario: EXPL-013.3 Only for one saved file
  Given the active tab is an untitled document
  Then File › Show in Windows Explorer is disabled
  Given 2 rows are selected in the Explorer
  When I right-click one of them
  Then the menu does not offer "Show in Windows Explorer"
```

## EXPL-014: Open all files of a folder or a selection

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/ExplorerPanel.tsx` — `openAll` (files directly inside a selected folder unless something of its own is selected), "Open All Files" menu item
  - `src/lib/actions.ts` — `openFiles` (tab limit asked once for the batch)
  - `src/lib/tabLimit.ts` — `makeRoom` / `planRoom`
- Tests: none
- Docs: `docs/editing.md`

**As a** developer who wants a set of files side by side in tabs
**I want** to open every file of a folder or of my selection at once
**So that** I do not have to double-click each one

```gherkin
Scenario: EXPL-014.1 Open All Files on a folder
  Given the folder "docs" contains "a.md", "b.md" and the subfolder "img" with "x.png"
  When I right-click "docs" and choose "Open All Files"
  Then "a.md" and "b.md" each open in their own tab
  And "x.png" is not opened

Scenario: EXPL-014.2 Open a selection
  Given "a.md" and "c.md" are selected
  When I right-click one of them and choose "Open All Files"
  Then exactly "a.md" and "c.md" are opened

Scenario: EXPL-014.3 A selected folder with selected files inside opens only those files
  Given the folder "docs" and "docs\a.md" are both selected, and "docs" also contains "b.md"
  When I choose "Open All Files"
  Then "a.md" is opened and "b.md" is not

Scenario: EXPL-014.4 Nothing to open
  Given the folder "empty" contains no files
  When I choose "Open All Files" on it
  Then a toast says "No files to open there."

Scenario: EXPL-014.5 Not offered for a single file
  When I right-click a single file
  Then the menu does not offer "Open All Files"
```

## EXPL-015: Start Find in Files from the Explorer

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/ExplorerPanel.tsx` — `findIn`, `pickTargets` (sets `search.treeTargets` on every click and selection change), "Find in File" / "Find in Folder" / "Find in Selected (N)" menu items
  - `src/lib/store.ts` — `search.treeTargets`, `search.scope`
  - `src/lib/panels.ts` — `showPanel("search")`
- Tests: none
- Docs: `docs/editing.md`, `docs/find-and-replace.md`

**As a** developer
**I want** to search inside the file, folder or selection I am pointing at
**So that** I do not have to type paths into the Search panel

```gherkin
Scenario: EXPL-015.1 Find in Folder
  When I right-click the folder "src" and choose "Find in Folder"
  Then the Search panel opens with its search box focused
  And its scope is the folder scope, limited to "src"

Scenario: EXPL-015.2 Find in File
  When I right-click the file "src\main.ts" and choose "Find in File"
  Then the Search panel opens with the folder scope limited to "src\main.ts"

Scenario: EXPL-015.3 Find in Selected
  Given "a.ts", "b.ts" and the folder "lib" are selected
  When I right-click one of them
  Then the menu offers "Find in Selected (3)"
  And choosing it opens the Search panel limited to those 3 items

Scenario: EXPL-015.4 The last click is remembered as the search target
  Given the Search panel's scope is the folder scope
  When I click the folder "docs" in the Explorer and then search
  Then only "docs" is searched
```

## EXPL-016: Git status in the tree

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/ExplorerPanel.tsx` — `gitFiles` / `gitDirs` lookup per row, `.tree-git` letter, `.tree-git-dot`, `git-<kind>` label class
  - `src/lib/git.ts` — `useGit` (`files`, `dirs` keyed by lower-case path)
  - `src/lib/gitStatus.ts` — `kindOf`, `KIND_LETTER`, `KIND_LABEL`, `KIND_RANK`
  - `src/styles/app.css` — `.tree-git`, `.tree-git-dot`, `.git-*` colours, struck-through deleted label
- Tests: `src/__tests__/splitGit.test.ts`
- Docs: `docs/git.md`

**As a** developer in a git repository
**I want** changed files marked in the Explorer
**So that** I can see what I have touched while browsing

```gherkin
Scenario Outline: EXPL-016.1 A changed file shows a letter
  Given the open folder is a git repository and "file.txt" is <state>
  When the tree is shown
  Then the row "file.txt" is coloured and ends with the letter "<letter>" with the tooltip "<label>"

  Examples:
    | state                 | letter | label     |
    | modified              | M      | Modified  |
    | newly added and staged| A      | Added     |
    | untracked             | U      | Untracked |
    | renamed               | R      | Renamed   |
    | in conflict           | !      | Conflict  |

Scenario: EXPL-016.2 A folder containing changes shows a dot
  Given "src\main.ts" is modified
  When the tree is shown
  Then the row "src" is coloured and ends with a dot with the tooltip "Contains changes"

Scenario: EXPL-016.3 Unchanged files and non-repositories show nothing
  Given a file with no changes, or a folder that is not a git repository
  When the tree is shown
  Then the rows have no letter and no dot
```

## EXPL-017: The file right-click menu

- Status: draft
- Commands: none
- Files:
  - `src/components/FileMenu.tsx` — `FileMenu` (item order, labels for one / several items, compare items for 1 or 2 files, clamped to the window, closes on outside mouse-down, Escape or window blur)
  - `src/components/panels/ExplorerPanel.tsx` — `menu` state, `lead` items (Expand…, Open All Files, Claude Code items when `claudeEnabled`, Find in…, Rename), blank-space menu
  - `src/lib/diff.ts` — `selectForCompare`, `compareWithSelected`, `compareCandidate`, `openCompare`
  - `src/styles/app.css` — `.ctx-menu`, `.file-menu`
- Tests: none
- Docs: `docs/editing.md`

**As a** developer
**I want** one consistent right-click menu on files and folders
**So that** every file action is where I expect it, for one item or several

```gherkin
Scenario: EXPL-017.1 Menu for one file
  When I right-click the file "main.ts"
  Then the menu lists, in order, "Find in File", "Rename" (F2), "Cut" (Ctrl+X), "Copy" (Ctrl+C), "Paste" (Ctrl+V), "Select for Compare", "Delete" (Del), "Copy Path", "Copy File Name" and "Show in Windows Explorer"

Scenario: EXPL-017.2 Menu for a folder
  When I right-click the folder "src" with Claude Code enabled in Settings
  Then the menu also offers "Open All Files", "Work with Claude Code Here", "Claude Code Terminal Here" and "Find in Folder"
  And it offers no compare items

Scenario: EXPL-017.3 Claude Code items follow the setting
  Given Claude Code is turned off in Settings
  When I right-click a folder or the blank space below the rows
  Then the menu has no "Work with Claude Code Here" and no "Claude Code Terminal Here"

Scenario: EXPL-017.4 Menu on blank space
  When I right-click the blank space below the rows
  Then the selection is cleared
  And the menu offers "Paste" into the open folder and none of Cut, Copy, Delete or Rename

Scenario: EXPL-017.5 Compare items
  Given exactly two files are selected
  When I right-click one of them
  Then the menu offers "Compare Selected"
  Given I chose "Select for Compare" on "a.txt"
  When I right-click the file "b.txt"
  Then the menu offers "Compare with “a.txt”"

Scenario: EXPL-017.6 The menu closes without acting
  Given the menu is open
  When I press Escape, click elsewhere, or switch to another window
  Then the menu closes and nothing is changed

Scenario: EXPL-017.7 The menu stays inside the window
  When I right-click a row at the bottom-right corner of the window
  Then the whole menu is visible, at least 4 px from the window edges
```
