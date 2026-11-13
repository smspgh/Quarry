---
area: Compare
prefix: DIFF
---

# Compare

Compare tabs (`kind: "diff"`): two texts side by side or inline, opened from files, an open tab, the clipboard or git, with editable file sides that can be saved. User documentation: `docs/compare.md`. The comparisons the Source Control panel opens for staged / changed files and file history are in `specs/git.md`; the ones the commit graph opens are in `specs/git-graph.md`.

## DIFF-001: Compare two files

- Status: draft
- Commands: `compare.files`
- Files:
  - `src/lib/commands.ts` — `compare.files` (two file pickers, or `[left, right]` paths as arguments)
  - `src/lib/diff.ts` — `openCompare`, `load` (file source), `compareTitle`, `distinctLabels`, `useDiff` sessions
  - `src/components/DiffView.tsx` — `DiffView` (`MergeView` from @codemirror/merge, language from the right side's path)
  - `src/components/FileMenu.tsx` — "Compare Selected" with exactly two files selected
  - `src/components/MenuBar.tsx` — File › Compare submenu
  - `src/components/TitleBar.tsx` — `DocIcon` for Compare tabs
  - `src/App.tsx` — renders one `DiffView` per Compare doc
  - `src/lib/actions.ts` — `sessionDocs()` keeps only text and Claude tabs, so Compare tabs are not saved
  - `src/styles/app.css` — `.diff-*` (colours from `--diff-*` in `src/styles/tokens.css`)
- Tests: `src/__tests__/diff.test.ts`
- Docs: `docs/compare.md`

**As a** developer with two versions of a file
**I want** to open them side by side with the differences highlighted
**So that** I can see exactly what changed between them

```gherkin
Scenario: DIFF-001.1 Pick two files
  When I choose File › Compare › Compare Two Files…
  Then a file picker titled "Compare: first (original) file" opens, then one titled "Compare: second (changed) file"
  When I pick "a.ts" and then "b.ts"
  Then a tab named "a.ts ↔ b.ts" opens with a.ts on the left and b.ts on the right
  And removed lines are tinted red on the left, added lines green on the right, and the changed words are highlighted more strongly
  And each side has its own line numbers and syntax colours

Scenario: DIFF-001.2 Cancelling a picker
  When I cancel either file picker
  Then no tab opens

Scenario: DIFF-001.3 Two files selected in the Explorer
  Given I selected exactly 2 files in the Explorer with Ctrl+click
  When I right-click and choose "Compare Selected"
  Then a Compare tab opens with the first selected file on the left and the second on the right

Scenario: DIFF-001.4 Same file name in different folders
  When I compare "C:\p\old\stats.ts" with "C:\p\new\stats.ts"
  Then the tab is named "stats.ts (old ↔ new)"
  And the sides are labelled "old\stats.ts" and "new\stats.ts"
  And each label's tooltip is the file's full path

Scenario: DIFF-001.5 Identical files
  When I compare two files with the same text
  Then the tab opens, the toolbar says "No differences"
  And a notification says "The two are identical."

Scenario: DIFF-001.6 Not restored after a restart
  Given a Compare tab is open
  When I close and start Quarry again
  Then the Compare tab is not among the restored tabs
```

## DIFF-002: Select a file for compare, then compare another with it

- Status: draft
- Commands: `compare.selectForCompare`, `compare.withSelected`
- Files:
  - `src/lib/diff.ts` — `selectForCompare`, `compareWithSelected`, `compareCandidate` (one remembered path, in memory only)
  - `src/lib/commands.ts` — `compare.selectForCompare`, `compare.withSelected` (`enabled` needs a candidate and an active text tab with a different path)
  - `src/components/FileMenu.tsx` — "Select for Compare", "Compare with “name”" (Explorer and Find in Files file rows)
  - `src/components/TitleBar.tsx` — tab menu "Select for Compare" / "Compare with Selected"
- Tests: none
- Docs: `docs/compare.md`

**As a** developer browsing files
**I want** to mark one file and later compare another against it
**So that** I can compare files that are far apart in the tree or in different lists

```gherkin
Scenario: DIFF-002.1 Select, then compare
  Given I right-click "old.ts" in the Explorer and choose "Select for Compare"
  Then a notification says "old.ts is selected for compare. Right-click another file and choose Compare with Selected."
  When I right-click "new.ts" and choose "Compare with “old.ts”"
  Then a Compare tab opens with old.ts on the left and new.ts on the right

Scenario: DIFF-002.2 From a tab
  Given "old.ts" is selected for compare and "new.ts" is open in a tab
  When I right-click the tab of "new.ts"
  Then the menu has "Compare with Selected"
  And choosing it opens the comparison with old.ts on the left

Scenario: DIFF-002.3 Nothing selected yet
  Given no file has been selected for compare
  When I right-click a file or open the File › Compare menu
  Then file menus offer only "Select for Compare"
  And "Compare Active File with Selected" is greyed out

Scenario: DIFF-002.4 Not with itself
  Given "old.ts" is selected for compare
  When I right-click that tab or open the File › Compare menu
  Then the tab menu of "old.ts" has no "Compare with Selected"
  And "Compare Active File with Selected" is greyed out while old.ts is the active tab

Scenario: DIFF-002.5 The selection stays
  Given I compared "new.ts" with the selected "old.ts"
  When I right-click another file
  Then "old.ts" is still the selected file for the next comparison

Scenario: DIFF-002.6 Untitled tabs can't be selected
  Given the active tab is an untitled document
  When I open the File › Compare menu
  Then "Select Active File for Compare" is greyed out

Scenario: DIFF-002.7 Only a text tab is compared with the selected file
  Given "old.ts" is selected for compare
  And the active tab is a large-file, terminal, Claude or Compare tab
  When I open the File › Compare menu
  Then "Compare Active File with Selected" is greyed out
```

## DIFF-003: Compare the active tab with a file

- Status: draft
- Commands: `compare.activeWith`
- Files:
  - `src/lib/commands.ts` — `compare.activeWith` (picked file = left; the tab's file when saved and clean, else a `tab` snapshot = right)
  - `src/lib/diff.ts` — `load` for `tab` sources (label `name (unsaved)` when dirty, `editable: false`)
- Tests: none
- Docs: `docs/compare.md`

**As a** developer editing a file
**I want** to compare what is in my tab with another file
**So that** I can check my version against a reference

```gherkin
Scenario: DIFF-003.1 A saved tab
  Given "app.ts" is the active tab with no unsaved edits
  When I choose File › Compare › Compare Active File With… and pick "reference.ts"
  Then a Compare tab opens with reference.ts on the left and app.ts on the right
  And both sides can be edited

Scenario: DIFF-003.2 A tab with unsaved edits
  Given "app.ts" has unsaved edits
  When I compare it with "reference.ts"
  Then the right side is labelled "app.ts (unsaved)" and shows the unsaved text
  And the right side is tagged "read-only"

Scenario: DIFF-003.3 An untitled tab
  Given the active tab is "Untitled-1"
  When I compare it with a file
  Then the right side shows the untitled text, read-only

Scenario: DIFF-003.4 Only for text tabs
  Given the active tab is a large-file, terminal, Claude or Compare tab
  When I open the File › Compare menu
  Then "Compare Active File With…" is greyed out
```

## DIFF-004: Compare unsaved edits with the saved file

- Status: draft
- Commands: `compare.withSaved`
- Files:
  - `src/lib/commands.ts` — `compare.withSaved` (enabled for a text tab with a path and unsaved edits)
  - `src/components/TitleBar.tsx` — tab menu "Compare with Saved" (only when the tab has a path and is dirty)
  - `src/lib/diff.ts` — `openCompare` with `file` (left) and `tab` (right) sources
- Tests: none
- Docs: `docs/compare.md`

**As a** developer with unsaved changes
**I want** to see them against the file on disk
**So that** I know what I am about to save

```gherkin
Scenario: DIFF-004.1 Compare with Saved
  Given "app.ts" has unsaved edits
  When I right-click its tab and choose "Compare with Saved"
  Then a Compare tab opens with the file on disk on the left and "app.ts (unsaved)" on the right
  And the right side is read-only

Scenario: DIFF-004.2 Nothing unsaved
  Given the active tab has no unsaved edits
  When I open the File › Compare menu and the tab's right-click menu
  Then "Compare with Saved" is greyed out in the File › Compare menu
  And the tab's right-click menu does not list it

Scenario: DIFF-004.3 Untitled
  Given the active tab has never been saved to a file
  When I open the File › Compare menu
  Then "Compare with Saved" is not available
```

## DIFF-005: Compare the active tab with the clipboard

- Status: draft
- Commands: `compare.withClipboard`
- Files:
  - `src/lib/commands.ts` — `compare.withClipboard` (clipboard text = left `text` source labelled "Clipboard")
  - `src/components/TitleBar.tsx` — tab menu "Compare with Clipboard" (activates the command for the active tab)
  - `src/lib/diff.ts` — `load` for `text` sources (read-only, line endings normalised)
- Tests: `src/__tests__/diff.test.ts`
- Docs: `docs/compare.md`

**As a** developer who copied a snippet or another version of a text
**I want** to compare my tab with the clipboard
**So that** I don't have to save the copied text to a file first

```gherkin
Scenario: DIFF-005.1 Compare with Clipboard
  Given the clipboard holds text and "app.ts" is the active tab, saved
  When I choose File › Compare › Compare with Clipboard
  Then a tab named "Clipboard ↔ app.ts" opens
  And the left side "Clipboard" is tagged "read-only" and the right side is app.ts, editable

Scenario: DIFF-005.2 Unsaved tab
  Given the active tab has unsaved edits
  When I compare with the clipboard
  Then the right side is the tab's unsaved text, read-only

Scenario: DIFF-005.3 Empty clipboard
  Given the clipboard holds no text
  When I run Compare with Clipboard
  Then no tab opens and a notification says "The clipboard has no text."

Scenario: DIFF-005.4 Only for text tabs
  Given the active tab is not a text tab
  When I open the File › Compare menu
  Then "Compare with Clipboard" is greyed out
```

## DIFF-006: Compare a file with its last commit

- Status: draft
- Commands: `git.compareWithHead`
- Files:
  - `src/lib/gitCommands.ts` — `git.compareWithHead` (enabled for a file in a repository that is not untracked)
  - `src/lib/git.ts` — `compareWithHead` (HEAD text left; open tab, file on disk, or "(deleted)" right)
  - `src/components/TitleBar.tsx` — tab menu "Compare with Last Commit"
  - `src/components/MenuBar.tsx` — Git menu item
  - `src-tauri/src/git.rs` — `show` / `git_show`, `decode_blob`
- Tests: `src-tauri/src/git.rs`
- Docs: `docs/git.md`, `docs/compare.md`

**As a** developer working in a git repository
**I want** to compare a file with its committed version
**So that** I can review everything I changed since the last commit

```gherkin
Scenario: DIFF-006.1 Compare with Last Commit
  Given "app.ts" is tracked by git and open in the active tab
  When I choose Git › Compare with Last Commit (HEAD)
  Then a Compare tab opens with "app.ts (HEAD)" on the left and the tab's current text on the right
  And both sides are tagged "read-only"

Scenario: DIFF-006.2 Unsaved edits are included
  Given the tab has unsaved edits
  When I run Compare with Last Commit (HEAD)
  Then the right side is labelled "app.ts (unsaved)" and shows them

Scenario: DIFF-006.3 From the tab menu
  Given a tab of a tracked file
  When I right-click the tab
  Then its right-click menu has "Compare with Last Commit"
  And the menu of an untracked file, or of a file outside a repository, does not

Scenario: DIFF-006.4 Untracked or outside a repository
  Given the active file is untracked or not in a repository
  When I open the Git menu
  Then "Compare with Last Commit (HEAD)" is greyed out

Scenario: DIFF-006.5 Not in the last commit
  Given the file was added to git but never committed
  When I run the command
  Then no tab opens and a notification says "app.ts is not in the last commit."

Scenario: DIFF-006.6 Binary
  Given the committed version is binary
  When I run Compare with Last Commit (HEAD)
  Then no tab opens and a notification says the file is a binary file

Scenario: DIFF-006.7 The file is not open in a tab
  Given "app.ts" is tracked by git and not open in any tab
  When I run Compare with Last Commit (HEAD) on it
  Then the right side is the file on disk, labelled "app.ts"
  And the right side can be edited and saved, while "app.ts (HEAD)" stays read-only
```

## DIFF-007: Refuse what can't be compared

- Status: draft
- Commands: none
- Files:
  - `src/lib/diff.ts` — `load` (folder, size ≥ `settings.largeFileThresholdMb`, `looksBinary`, non-text tab), `openCompare` error toast
- Tests: none
- Docs: `docs/compare.md`

**As a** developer
**I want** a clear message when something can't be compared
**So that** Quarry never tries to load a huge or binary file into a Compare tab

```gherkin
Scenario: DIFF-007.1 A large file
  Given the large-file threshold is 32 MB
  When I compare a 48 MB file with another file
  Then no tab opens
  And an error says "Can't compare: big.log is too large to compare (48 MB; the limit is the large-file threshold in Settings)"

Scenario: DIFF-007.2 A binary file
  When one of the two files looks binary
  Then no tab opens and an error says "Can't compare: logo.png looks like a binary file"

Scenario: DIFF-007.3 A folder
  When one of the two paths is a folder
  Then no tab opens and an error says the path is a folder

Scenario: DIFF-007.4 Either side failing stops the comparison
  Given the first file is fine and the second can't be read
  When I compare the two
  Then no tab opens
```

## DIFF-008: Move between the changes

- Status: draft
- Commands: `compare.nextChange`, `compare.prevChange`
- Files:
  - `src/components/DiffView.tsx` — `stepChange` (`goToNextChunk` / `goToPreviousChunk` on the right or inline editor), `position`, toolbar counter and arrow buttons
  - `src/lib/commands.ts` — `compare.nextChange` (`F7`), `compare.prevChange` (`Shift+F7`), enabled only on a Compare tab
- Tests: none
- Docs: `docs/compare.md`

**As a** developer reviewing a comparison
**I want** to jump from change to change and see where I am
**So that** I can review every difference without scrolling past unchanged text

```gherkin
Scenario: DIFF-008.1 Next and previous change
  Given a Compare tab with 5 changes
  When I press F7
  Then the cursor moves to the next change in the right side, which gets the keyboard focus
  And the toolbar reads "Change 2 of 5" when the cursor is in the second change
  And Shift+F7 moves to the previous change

Scenario: DIFF-008.2 Toolbar arrows
  When I click the down arrow ("Next change (F7)") or the up arrow ("Previous change (Shift+F7)")
  Then the cursor moves the same way

Scenario: DIFF-008.3 The cursor is outside every change
  Given the cursor is on an unchanged line
  When I look at the toolbar
  Then the toolbar reads "5 changes"
  And with a single change it reads "1 change"

Scenario: DIFF-008.4 No differences
  Given the two sides are identical
  When I look at the toolbar
  Then the toolbar reads "No differences" and both arrows are disabled

Scenario: DIFF-008.5 Only on a Compare tab
  Given the active tab is a text tab
  When I open the command palette
  Then the Compare commands Next Change and Previous Change are greyed out
```

## DIFF-009: Choose the layout: side by side, inline, folded, swapped

- Status: draft
- Commands: `compare.toggleInline`, `compare.swap`
- Files:
  - `src/components/DiffView.tsx` — layout switch (`unifiedMergeView` for inline), fold button (`collapseUnchanged: { margin: 3, minSize: 6 }`), rebuild effect on `version` / `inline` / `collapse`, `settingsReconfigure` on settings changes
  - `src/lib/diff.ts` — `DiffSession.inline` / `collapse` / `version`, `swapDiff`, `captureSideTexts`, `patchDiff`
  - `src/lib/commands.ts` — `compare.toggleInline`, `compare.swap` (disabled while the tab has unsaved edits)
- Tests: none
- Docs: `docs/compare.md`

**As a** developer reading a comparison
**I want** to switch between side by side and inline, fold unchanged text and swap the sides
**So that** the comparison fits my screen and the way I read it

```gherkin
Scenario: DIFF-009.1 Starts side by side with unchanged text folded
  When a Compare tab opens
  Then "Side by side" is selected
  And long unchanged stretches are folded, leaving 3 lines of context around each change
  And clicking a folded stretch shows its lines

Scenario: DIFF-009.2 Inline
  When I click "Inline" or run Toggle Inline / Side by Side
  Then one editor shows the right side's text
  And the removed lines appear above the lines that replaced them
  And running the command again returns to side by side

Scenario: DIFF-009.3 Show unchanged lines
  When I click the fold button ("Show unchanged lines")
  Then every line of both sides is shown
  And clicking it again ("Fold unchanged lines") folds them

Scenario: DIFF-009.4 Swap sides
  Given a tab "a.ts ↔ b.ts"
  When I click "Swap sides"
  Then b.ts is on the left and a.ts on the right
  And the tab is renamed "b.ts ↔ a.ts"

Scenario: DIFF-009.5 No swap with unsaved edits
  Given I edited a side and have not saved
  When I look at the toolbar and the command palette
  Then the "Swap sides" button is disabled and Swap Sides is greyed out

Scenario: DIFF-009.6 Edits survive a layout change
  Given I edited the right side and have not saved
  When I switch to Inline and back
  Then my edits are still there and the side is still tagged "edited"

Scenario: DIFF-009.7 Editor settings apply
  When I change the font size or word wrap in Settings
  Then the Compare editors follow without losing the cursor position or unsaved edits
```

## DIFF-010: Edit file sides; snapshots are read-only

- Status: draft
- Commands: none
- Files:
  - `src/lib/diff.ts` — `Side.editable` (file not read-only on disk → true; `tab` and `text` sources → false), `markSideEdited`, `syncDirty`, `sideText`, `diffViews`
  - `src/components/DiffView.tsx` — `EditorState.readOnly` per side, "read-only" / "edited" tags, update listener
- Tests: none
- Docs: `docs/compare.md`

**As a** developer comparing files
**I want** to edit a file directly in the comparison, and be shown which sides can't be edited
**So that** I can fix differences on the spot without mistaking a snapshot for the file

```gherkin
Scenario: DIFF-010.1 Edit a file side
  Given a Compare tab of two files
  When I type in the right side
  Then the differences are recalculated as I type
  And the right label gets the tag "edited"
  And the tab shows the unsaved-changes dot

Scenario: DIFF-010.2 Both file sides can be edited
  When I type in the left side of a comparison of two files
  Then the left label is tagged "edited" too

Scenario: DIFF-010.3 Snapshots are read-only
  Given a side that is the clipboard, a tab's text, or a version from git
  When I type in that side
  Then its label carries the tag "read-only"
  And typing in it changes nothing

Scenario: DIFF-010.4 A read-only file
  Given one of the compared files has the read-only attribute on disk
  When the Compare tab opens
  Then that side is tagged "read-only" and can't be edited

Scenario: DIFF-010.5 Inline layout edits the right side
  Given the Inline layout
  When I type in the editor
  Then the single editor holds the right side's text
  And it can be edited only when the right side is an editable file
```

## DIFF-011: Copy a change across with the arrows

- Status: draft
- Commands: none
- Files:
  - `src/components/DiffView.tsx` — `revertControls`: `"a-to-b"` when the right side is editable, else `"b-to-a"` when the left is, else none; `mergeControls: false` inline
  - `src/styles/app.css` — `.cm-merge-revert`
  - Library behaviour, not set in this repo: @codemirror/merge (6.12.3) listens for `mousedown` on its `.cm-merge-revert` gutter (`MergeView.setupRevertControls` → `revertClicked`), so an arrow acts when the button goes down (DIFF-011.2)
- Tests: none
- Docs: `docs/compare.md`

**As a** developer merging two versions by hand
**I want** an arrow beside each change that copies it across
**So that** I can take over a change with one click

```gherkin
Scenario: DIFF-011.1 Copy from left to right
  Given a side-by-side comparison whose right side is an editable file
  Then each change has an arrow between the two sides
  When I press the mouse button on a change's arrow
  Then the right side's lines of that change are replaced by the left side's
  And the change disappears from the count and the right side is tagged "edited"

Scenario: DIFF-011.2 The arrow acts when the button goes down
  When I press the mouse button on an arrow
  Then the change is copied at once, before the button is released

Scenario: DIFF-011.3 Only the left side is editable
  Given the right side is read-only and the left side is an editable file
  When I press the mouse button on a change's arrow
  Then the arrows copy a change from the right side into the left one

Scenario: DIFF-011.4 Nothing editable
  Given both sides are read-only
  When I look between the two sides
  Then there are no arrows

Scenario: DIFF-011.5 Inline layout
  Given the Inline layout
  When I look at the changes
  Then there are no copy arrows

Scenario: DIFF-011.6 Undo
  Given I copied a change across
  When I press Ctrl+Z in the edited side
  Then the change is back
```

## DIFF-012: Save an edited side

- Status: draft
- Commands: `file.save`
- Files:
  - `src/lib/diff.ts` — `saveDiff` (per dirty file side: modified-on-disk check, `joinEol`, same encoding and BOM), `splitEol`, `joinEol`
  - `src/lib/actions.ts` — `saveDocument` routes `kind: "diff"` to `saveDiff`; `closeDocument` asks before closing a dirty tab and calls `disposeDiff`; `checkExternalChanges` after a save
  - `src/lib/commands.ts` — `file.save` enabled on a Compare tab with unsaved edits
  - `src/components/DiffView.tsx` — "Save" button (only while a side is edited)
  - `src/lib/dialogs.ts` — `choose`
- Tests: `src/__tests__/diff.test.ts`
- Docs: `docs/compare.md`

**As a** developer who edited a file inside a comparison
**I want** to save it back to its own file without changing its encoding or line endings
**So that** my fix lands in the real file

```gherkin
Scenario: DIFF-012.1 Save with Ctrl+S
  Given I edited the right side, a file with CRLF line endings and a UTF-8 byte order mark
  When I press Ctrl+S
  Then the file is written with CRLF line endings and the byte order mark
  And the "edited" tag and the tab's unsaved-changes dot disappear
  And a notification says "Saved"

Scenario: DIFF-012.2 The Save button
  Given a side is edited
  When I look at the toolbar
  Then a "Save" button is in the toolbar
  And it is not shown when nothing is edited

Scenario: DIFF-012.3 Both sides edited
  Given I edited both file sides
  When I save
  Then each file is written with its own encoding and line endings

Scenario: DIFF-012.4 The file changed on disk meanwhile
  Given the file was modified by another program after the comparison loaded it
  When I save
  Then a dialog "<name> changed on disk" asks whether to overwrite, with "Overwrite" and "Cancel" (default)
  And "Cancel" leaves the file alone and the side stays "edited"

Scenario: DIFF-012.5 A failed write
  Given the file can't be written
  When I save
  Then an error says "Could not save <name>:" with the reason
  And the side stays "edited"

Scenario: DIFF-012.6 Other tabs notice
  Given the saved file is also open in a normal tab
  When I save the edited side
  Then that tab reacts as it does to any change made outside it

Scenario: DIFF-012.7 Closing with unsaved edits asks
  Given a side is edited
  When I close the Compare tab
  Then a dialog "Save changes to <tab name>?" says "Your changes will be lost if you don't save them."
  And it offers "Save" (default), "Don't Save" and "Cancel"
  And "Save" saves the edited sides and closes the tab, unless a save fails or is cancelled
  And "Don't Save" closes the tab without writing anything
  And "Cancel" or Escape keeps the tab open

Scenario: DIFF-012.8 Nothing to save
  Given no side is edited
  When I open the File menu
  Then Save is greyed out for the Compare tab
```

## DIFF-013: Reload the compared texts

- Status: draft
- Commands: none
- Files:
  - `src/lib/diff.ts` — `reloadDiff` (files from disk, tab snapshots from the tab, a closed tab keeps its snapshot, `text` sources keep their text, folder labels kept)
  - `src/components/DiffView.tsx` — "Reload the files from disk" button, disabled while edited
- Tests: none
- Docs: `docs/compare.md`

**As a** developer whose compared files changed outside the comparison
**I want** to read them again
**So that** the comparison shows the current state

```gherkin
Scenario: DIFF-013.1 Reload files
  Given a comparison of two files, one of which was changed on disk
  When I click "Reload the files from disk"
  Then both files are read again and the differences are recalculated
  And a notification says "Reloaded"

Scenario: DIFF-013.2 Now identical
  Given the files have the same text after the reload
  When I reload
  Then the notification says "Reloaded: the two are identical."

Scenario: DIFF-013.3 A tab side
  Given the right side is the snapshot of the tab "app.ts" and I typed more in that tab
  When I reload
  Then the right side shows the tab's current text

Scenario: DIFF-013.4 The tab was closed
  Given the tab a side was taken from has been closed
  When I reload
  Then that side keeps its last snapshot

Scenario: DIFF-013.5 Clipboard and git sides keep their text
  Given a side is the clipboard or a version from git
  When I reload
  Then that side shows the same text as before

Scenario: DIFF-013.6 Not with unsaved edits
  Given a side is edited and not saved
  When I look at the toolbar
  Then the Reload button is disabled

Scenario: DIFF-013.7 A file that can no longer be read
  Given one of the files was deleted
  When I reload
  Then an error starting "Can't reload:" is shown and the comparison stays as it was
```

## DIFF-014: Preview comparisons replace each other

- Status: draft
- Commands: none
- Files:
  - `src/lib/diff.ts` — `openCompare(a, b, { preview: true })`: closes the previous Compare tab that is `preview` and not dirty
  - `src/lib/git.ts` — `openCommitFile`, `compareSides` open with `preview: true`
  - `src/components/TitleBar.tsx` — double-click on a tab clears `Doc.preview`
- Tests: none
- Docs: `docs/git.md`

**As a** developer clicking through a commit's files or a file's conflicts
**I want** each comparison to reuse the same tab
**So that** reviewing does not fill the tab bar

```gherkin
Scenario: DIFF-014.1 The next preview replaces the last
  Given a Compare tab opened by clicking a file of a commit
  When I click another file of a commit
  Then the new comparison opens and the previous Compare tab is closed

Scenario: DIFF-014.2 Double-click keeps a tab
  Given a preview Compare tab
  When I double-click its tab and then open another preview comparison
  Then both Compare tabs are open

Scenario: DIFF-014.3 Ordinary comparisons are never replaced
  Given a Compare tab opened with Compare Two Files…
  When a preview comparison opens
  Then the Compare Two Files tab stays open

Scenario: DIFF-014.4 An ordinary comparison does not replace a preview
  Given a preview Compare tab is open
  When I run Compare with Clipboard
  Then the preview tab stays and a second Compare tab opens
```
