---
area: Large Files
prefix: BIG
---

# Large Files

Files at or above the large-file threshold open as `kind: "big"` tabs: memory-mapped by the Rust core, indexed in the background, shown through a virtual view and edited line by line. This area covers everything those tabs do (view, find, Replace All, line edits, save, colours, filter, follow, CSV grid, JSON tree and validation). User documentation: `docs/large-files.md`. The threshold decision itself (which files open this way) belongs to the files/tabs area.

## BIG-001: Open a file in large-file mode

- Status: draft
- Commands: none
- Files:
  - `src/lib/actions.ts` — `openLarge`, `bigDocFields`, `pollBigIndex` (called from `openPath` when the size is at or above the threshold), opening toasts
  - `src-tauri/src/lib.rs` — `big_open`, `big_close`, `AppState.docs`
  - `src-tauri/src/bigfile.rs` — `BigDoc::open` (memory mapping, `detect_layout`), `BigDocInfo`
  - `src/lib/ipc.ts` — `big.open`, `big.close`, `big.info`
  - `src/lib/types.ts` — `BigDocInfo`, `LinesChunk`, `IndexProgress`
  - `src/lib/store.ts` — `Doc.bigId`, `Doc.bigInfo`, `Doc.indexProgress`
  - `src/App.tsx` — renders `BigFileView` for the active big tab, keyed by doc id and `bigId`
  - `src/components/BigFileView.tsx` — banner ("Large file mode", size, line count)
  - `src/components/TitleBar.tsx` — hard-drive tab icon for big tabs
  - `src/components/StatusBar.tsx` — size and line count item, Ln/Col, encoding, line ending
- Tests: `src-tauri/src/bigfile.rs`
- Docs: `docs/large-files.md`

**As a** someone opening a multi-gigabyte log or data export
**I want** the file to open at once without being loaded into memory
**So that** I can start reading it whatever its size

```gherkin
Scenario: BIG-001.1 A file at the threshold opens in large-file mode
  Given the large-file threshold is 32 MB
  When I open "server.log" of 5 GB
  Then a tab "server.log" opens with a hard-drive icon
  And a banner reads "Large file mode" with the file size and the line count
  And a toast says "server.log (… ) opened in large-file mode."
  And the first lines are shown before indexing has finished

Scenario: BIG-001.2 The status bar describes the large file
  Given a large-file tab is active
  When I look at the status bar
  Then the status bar shows the file size and line count
  And it shows "Ln 1, Col 1", the encoding and the line ending

Scenario: BIG-001.3 A file that cannot be mapped does not open a tab
  Given a large file that cannot be opened by the operating system
  When I open it
  Then an error toast starting "Could not open large file:" is shown
  And no tab is added

Scenario: BIG-001.4 An empty document still has one line
  Given a large-file tab whose file is empty
  When the view is shown
  Then the view shows one empty line numbered 1

Scenario: BIG-001.5 Closing the tab releases the file
  Given a large-file tab is open
  When I close the tab
  Then Quarry no longer holds the file mapped
  And any filter built for it is discarded
```

## BIG-002: Background indexing with progress

- Status: draft
- Commands: none
- Files:
  - `src-tauri/src/bigfile.rs` — `start_indexing` (64 MiB chunks, one checkpoint per 1,024 lines), `LineIndex`, `stop_indexing`, `IndexProgress`
  - `src-tauri/src/lib.rs` — `progress_emitter` (`bigfile:progress` event), `big_info`
  - `src/lib/ipc.ts` — `big.onProgress`, `big.info`
  - `src/App.tsx` — progress listener updating `indexProgress` and `bigInfo`
  - `src/lib/actions.ts` — `pollBigIndex` (polls until indexed, in case events were missed)
  - `src/components/BigFileView.tsx` — banner progress bar, 500 ms refetch while indexing, short-chunk handling in `ensure`
  - `src/components/StatusBar.tsx` — "indexing N%"
- Tests: `src-tauri/src/bigfile.rs`
- Docs: `docs/large-files.md`

**As a** someone who just opened a very large file
**I want** to see how far line indexing has got while I already read the file
**So that** I know when the line count is final and editing becomes available

```gherkin
Scenario: BIG-002.1 Progress is shown while the index is built
  Given a 5 GB file was just opened in large-file mode
  When I look at the tab while indexing runs
  Then the banner shows a progress bar and "indexing N%"
  And the status bar shows "· indexing N%" after the line count
  And the line count grows as indexing advances

Scenario: BIG-002.2 Progress disappears when indexing completes
  Given a large file is being indexed
  When indexing reaches the end of the file
  Then the progress bar and the "indexing" text are gone
  And the banner shows the final line count

Scenario: BIG-002.3 The file is readable during indexing
  Given a large file is still being indexed
  When I scroll within the lines counted so far
  Then those lines are shown
  And lines that are not available yet show "…" until they can be read

Scenario: BIG-002.4 Actions that need the whole index wait for it
  Given a large file is still being indexed
  When I try actions that need the whole index
  Then the Replace All button is disabled
  And the Follow button is disabled with the tooltip "Available once indexing finishes"
  And pressing Enter on a line shows "Editing is enabled once indexing completes."
```

## BIG-003: Scroll through the file in a virtual view

- Status: draft
- Commands: none
- Files:
  - `src/components/BigFileView.tsx` — `ensure` (256-line chunks, cache of 400 chunks), `scrollTo`, `onScroll`, `onWheel`, `onKey`, `clipRow` / `MAX_ROW_CHARS`, `visibleRowText`, view-state persistence on unmount
  - `src/lib/bigGeometry.ts` — `bigGeometry` (scaled scroll range past 12,000,000 px)
  - `src-tauri/src/bigfile.rs` — `get_lines` (at most 5,000 lines and 16 MB per read), `locate_line`, `read_from`
  - `src-tauri/src/lib.rs` — `big_lines`
  - `src/lib/ipc.ts` — `big.lines`
  - `src/lib/store.ts` — `BigViewState`, `bigViewState` (dropped when the tab closes)
  - `src/styles/app.css` — `.bigview`, `.big-banner`, `.big-scroll`, `.big-row`, `.big-ln`, `.big-more`, `.big-loading`
- Tests: `src/__tests__/bigview.test.ts`, `src-tauri/src/bigfile.rs`
- Docs: `docs/large-files.md`

**As a** someone reading a file with tens of millions of lines
**I want** to scroll and page through it as smoothly as a small file
**So that** I can reach any part of it, including the very last line

```gherkin
Scenario: BIG-003.1 Only the lines on screen are read
  Given a large file with 60,000,000 lines
  When I drag the scrollbar to the middle
  Then the lines around line 30,000,000 are shown with their line numbers
  And the rest of the file is not loaded into memory

Scenario: BIG-003.2 The last line is reachable
  Given a large file with 60,000,000 lines
  When I press Ctrl+End
  Then the cursor is on line 60,000,000 and that line is visible

Scenario: BIG-003.3 Keyboard navigation
  Given the large-file view has focus with the cursor on line 100
  When I press Page Down
  Then the view and the cursor move down by one screen of lines
  When I press Ctrl+Home
  Then the cursor is on line 1

Scenario: BIG-003.4 Home and End scroll horizontally
  Given a large file with lines wider than the view
  When I press End
  Then the view scrolls to the right end of the rows
  When I press Home
  Then the view scrolls back to the left
  And the cursor line does not change

Scenario: BIG-003.5 Very long lines are cut on screen
  Given a line of 50,000 characters
  When that line is on screen
  Then its first 20,000 characters are shown followed by "… (30,000 more chars)"

Scenario: BIG-003.6 A line longer than 16 MB shows only its start
  Given a line longer than 16 MB
  When that line is on screen
  Then the row ends with "… (line continues past 16 MB)"

Scenario: BIG-003.7 Switching tabs keeps the position
  Given I scrolled a large-file tab to line 5,000 and ran a search
  When I switch to another tab and back
  Then the same lines are on screen, the cursor is where it was
  And the find bar still shows the earlier results
```

## BIG-004: Move the cursor, select lines and copy

- Status: draft
- Commands: none
- Files:
  - `src/components/BigFileView.tsx` — `moveCursor`, `revealCursor`, `onRowMouseDown`, `onRowMouseEnter`, `selectionRange`, `nativeRowSelection`, `copySelected`, cursor published to the store for the status bar
  - `src/components/StatusBar.tsx` — "Ln N, Col 1 (N lines selected)"
  - `src/App.tsx` — lets native text selection start inside `.big-text`
  - `src-tauri/src/bigfile.rs` — `get_lines`
  - `src/styles/app.css` — `.big-row.cursor`, `.big-row.selected`, `.big-scroll.dragging`
- Tests: none
- Docs: `docs/large-files.md`

**As a** someone investigating a large log
**I want** to select lines or part of a line and copy them
**So that** I can paste the relevant extract somewhere else

```gherkin
Scenario: BIG-004.1 Arrow keys move the cursor line
  Given the cursor is on line 10
  When I press the Down arrow
  Then line 11 is the cursor line
  And the status bar shows "Ln 11, Col 1"

Scenario: BIG-004.2 Shift extends a selection of whole lines
  Given the cursor is on line 10
  When I press Shift+Down three times
  Then lines 10 to 13 are selected
  And the status bar shows "(4 lines selected)"

Scenario: BIG-004.3 Dragging across rows selects whole lines
  When I press the mouse on line 20 and drag to line 25
  Then lines 20 to 25 are selected

Scenario: BIG-004.4 Shift+click extends from the cursor
  Given the cursor is on line 20
  When I Shift+click line 40
  Then lines 20 to 40 are selected

Scenario: BIG-004.5 Copy the selected lines
  Given lines 20 to 25 are selected in a file with CRLF line endings
  When I press Ctrl+C
  Then the clipboard holds those 6 lines joined with CRLF
  And a toast says "Copied 6 line(s)"

Scenario: BIG-004.6 Copy text selected inside one line
  Given no lines are selected and I dragged over 12 characters inside one row
  When I press Ctrl+C
  Then the clipboard holds those 12 characters
  And a toast says "Copied 12 character(s)"

Scenario: BIG-004.7 Copy is limited to 200,000 lines
  Given I pressed Ctrl+A in a file with 1,000,000 lines
  When I press Ctrl+C
  Then a warning says "Copy is limited to 200,000 lines at a time."
  And the clipboard is unchanged

Scenario: BIG-004.8 Escape clears the selection
  Given lines 20 to 25 are selected and the find bar is closed
  When I press Escape
  Then only the cursor line is highlighted
```

## BIG-005: Go to a line

- Status: draft
- Commands: `goto.line`, `big.gotoLine`
- Files:
  - `src/lib/commands.ts` — `goto.line` (enabled for big tabs through `applyDefaultEnabled`), hidden `big.gotoLine`
  - `src/components/CommandPalette.tsx` — goto mode: line total from `bigInfo`, out-of-range hint, emits `big.goto`
  - `src/components/BigFileView.tsx` — `onGoto`, `pendingGoto` (deferred jump), `jumpTo`
  - `src/lib/bus.ts` — `emit` / `emitFor` / `onFor` (queues a jump for a view that is not mounted yet)
  - `src/lib/actions.ts` — `openPath` with `line` emits `big.goto` for a big tab
  - `src/components/panels/SearchPanel.tsx` — a Find in Files result in an open big tab emits `big.goto`
  - `src/components/StatusBar.tsx` — Ln/Col button runs `goto.line`
- Tests: none
- Docs: `docs/large-files.md`

**As a** someone who knows the line number they need
**I want** to jump straight to that line of a large file
**So that** I do not have to scroll through millions of lines

```gherkin
Scenario: BIG-005.1 Jump to a line with Ctrl+G
  Given a fully indexed large file with 2,000,000 lines
  When I press Ctrl+G, type "1500000" and press Enter
  Then line 1,500,000 is the cursor line, centred in the view
  And the view has keyboard focus

Scenario: BIG-005.2 A line past the end jumps to the last line
  Given a fully indexed large file with 2,000 lines
  When I go to line 9999
  Then the cursor is on line 2,000
  And a toast says "Line 9999 is out of range; jumped to line 2000."

Scenario: BIG-005.3 A jump past the indexed part waits for the index
  Given a large file is being indexed and 1,000,000 lines are known so far
  When something asks to show line 3,000,000
  Then nothing moves yet
  And the view jumps to line 3,000,000 as soon as indexing has reached it

Scenario: BIG-005.4 A jump requested before the tab is drawn is not lost
  Given a large file is not open
  When I open it from a Find in Files result on line 42,000
  Then the tab opens and the view jumps to line 42,000

Scenario: BIG-005.5 The status bar position opens Go to Line
  Given a large-file tab is active
  When I click "Ln 12, Col 1" in the status bar
  Then the Go to Line prompt opens

Scenario: BIG-005.6 Go to Line during indexing does not call the line out of range
  Given a large file is being indexed and 1,000,000 lines are known so far
  When I press Ctrl+G
  Then the prompt shows "Go to line[:column]  (1–1000000+, still indexing)"
  When I type "3000000" and press Enter
  Then no "out of range" hint or toast appears
  And the view jumps to line 3,000,000 once indexing has reached it, or to the last line if the file is shorter
```

## BIG-006: Find in a large file

- Status: draft
- Commands: `find.open`, `find.next`, `find.prev`
- Files:
  - `src/lib/commands.ts` — `find.open`, `find.next`, `find.prev` emit `big.find`, `big.findNext`, `big.findPrev` on a big tab
  - `src/components/BigFileView.tsx` — find bar, `runFind`, `step`, `closeFind`, `queryArgs` (20,000 hits), result list (first 2,000), `utf8Span`, `clearHits`
  - `src-tauri/src/bigfile.rs` — `search`, `search_decoded` (UTF-16), `build_regex`, `for_each_chunk`, `BigMatch`, count stop at 5,000,000
  - `src-tauri/src/lib.rs` — `big_search`, `BigSearchArgs`
  - `src/lib/ipc.ts` — `big.search`
  - `src/lib/types.ts` — `BigMatch`, `BigSearchResult`, `BigSearchArgs`
  - `src/lib/store.ts` — `BigFindState`
  - `src/styles/app.css` — `.big-find-results`, `.big-row.hit`
- Tests: `src/__tests__/bigview.test.ts`, `src-tauri/src/bigfile.rs`
- Docs: `docs/large-files.md`

**As a** someone looking for an event in a huge log
**I want** to search the whole file with plain text or a regular expression
**So that** I can step through every place it occurs

```gherkin
Scenario: BIG-006.1 Search runs on Enter, not while typing
  Given a large-file tab is active
  When I press Ctrl+F and type "timeout"
  Then no search has run yet
  When I press Enter
  Then the count shows "Searching…" and then "1 of 318"
  And the view jumps to the first hit with the match highlighted
  And a list of hits with line numbers and previews appears under the find bar

Scenario: BIG-006.2 Step through the hits
  Given a search found 318 hits and the current one is 1
  When I press F3
  Then the count shows "2 of 318" and the view jumps to that hit
  When I press Shift+F3 twice
  Then the count shows "318 of 318"

Scenario: BIG-006.3 Click a hit in the list
  Given a search listed its hits
  When I click the hit on line 88,201
  Then the view jumps to line 88,201 and that hit becomes the current one

Scenario: BIG-006.4 Search options
  Given the find bar is open
  When I look at its option buttons
  Then Match Case, Whole Word and Regular Expression can be toggled
  And "Dot Matches Newline" is disabled until Regular Expression is on
  And a search without Match Case finds "ERROR" for the query "error"

Scenario: BIG-006.5 Many hits are capped
  Given a query that occurs 300,000 times
  When I run the search
  Then the count shows "1 of 300,000+"
  And F3 steps through the first 20,000 hits
  And the list under the find bar shows the first 2,000

Scenario: BIG-006.6 No results
  When I search for text that does not occur
  Then the count shows "No results"

Scenario: BIG-006.7 An invalid regular expression
  Given an earlier search left hits on screen
  When I search for the regular expression "(" 
  Then an error toast shows the pattern error
  And the earlier hits are cleared

Scenario: BIG-006.8 Closing the find bar
  Given the find bar is open with results
  When I press Escape
  Then the find bar closes, the hit marks are removed and the view has focus

Scenario: BIG-006.9 Edits drop the hits
  Given a search found hits
  When I edit, insert or delete a line, or undo
  Then the hits are cleared because their line numbers may have moved
```

## BIG-007: Replace All in a large file

- Status: draft
- Commands: `find.replace`
- Files:
  - `src/lib/commands.ts` — `find.replace` emits `big.find` with `replace: true` on a big tab
  - `src/components/BigFileView.tsx` — replace row, Preserve Case toggle (`keepCase`), `replaceAll` (confirmation through `choose`)
  - `src-tauri/src/bigfile.rs` — `replace_all` (streams to a `quarry-` temp file in the temp folder), `rebind`, `ensure_editable`
  - `src-tauri/src/lib.rs` — `big_replace_all`, `BigSearchArgs.preserve_case`
  - `src-tauri/src/search.rs` — `parse_replacement`, `expand_replacement`, `preserve_case` (shared with Replace in Files)
  - `src/lib/ipc.ts` — `big.replaceAll`
  - `src/lib/dialogs.ts` — `choose`
- Tests: `src-tauri/src/bigfile.rs`
- Docs: `docs/large-files.md`

**As a** someone cleaning up a large data file
**I want** to replace every occurrence of a pattern in one go
**So that** I can fix the whole file without loading it into a normal editor

```gherkin
Scenario: BIG-007.1 Replace All asks first, then rewrites into a working copy
  Given a fully indexed large file "export.csv" where "N/A" occurs 12,400 times
  And I pressed Ctrl+H, typed "N/A" in Find and "" in Replace
  When I click "Replace All"
  Then a dialog "Replace all occurrences?" explains that the file is rewritten into a new working copy and undo history is reset
  When I choose "Replace All"
  Then a toast says "Replaced 12,400 occurrence(s)"
  And the tab is marked modified
  And the file on disk is unchanged until I save

Scenario: BIG-007.2 Cancelling changes nothing
  When I click "Replace All" and choose "Cancel"
  Then the document is unchanged

Scenario: BIG-007.3 Capture groups in regex mode
  Given Regular Expression is on with the query "line (\d+)" and the replacement "L$1"
  When I confirm Replace All
  Then "line 2000" becomes "L2000"

Scenario: BIG-007.4 Preserve Case
  Given the text "foo Foo FOO", the query "foo" without Match Case and the replacement "bar"
  And the Preserve Case toggle is on
  When I confirm Replace All
  Then the text becomes "bar Bar BAR"

Scenario: BIG-007.5 Undo history is reset
  Given I edited two lines and then ran a Replace All that replaced something
  When I press Ctrl+Z
  Then nothing is undone
  And the tab stays marked modified

Scenario: BIG-007.6 Nothing matched
  Given a query that does not occur
  When I confirm Replace All
  Then a toast says "Replaced 0 occurrence(s)"
  And the document, its undo history and its modified mark are untouched

Scenario: BIG-007.7 Not available while indexing or without a query
  Given a large file is still being indexed, or the Find box is empty
  When I open the replace row
  Then the "Replace All" button is disabled

Scenario: BIG-007.8 No single replace
  Given the replace row is open on a large-file tab
  When I look at its buttons
  Then there is a "Replace All" button and no button to replace one match

Scenario: BIG-007.9 A dollar sign is literal in plain-text mode
  Given Regular Expression is off with the query "x" and the replacement "$5 $$ $1"
  When I confirm Replace All
  Then each "x" becomes exactly "$5 $$ $1"
```

## BIG-008: Edit, insert and delete lines

- Status: draft
- Commands: none
- Files:
  - `src/components/BigFileView.tsx` — `canChange` (one gate for Enter / F2 / double-click / Ctrl+Enter / Delete), `beginEdit`, `editGate`, `commitEdit`, `insertLine`, `deleteSelected`, the `.big-edit` input
  - `src-tauri/src/bigfile.rs` — piece table (`Piece`, `replace_range`, `split_at`), `replace_line`, `insert_lines`, `delete_lines`, `ensure_editable`, `MAX_READ_BYTES`
  - `src-tauri/src/lib.rs` — `big_replace_line`, `big_insert_lines`, `big_delete_lines`
  - `src/lib/ipc.ts` — `big.replaceLine`, `big.insertLines`, `big.deleteLines`
  - `src/lib/actions.ts` — `askDialog`
  - `src/styles/app.css` — `.big-edit`
- Tests: `src/__tests__/bigview.test.ts`, `src-tauri/src/bigfile.rs`
- Docs: `docs/large-files.md`

**As a** someone who spotted a wrong value in a large file
**I want** to change, add or remove individual lines
**So that** I can correct the file without a tool that loads it whole

```gherkin
Scenario: BIG-008.1 Edit a line in place
  Given a fully indexed UTF-8 large file with the cursor on line 7
  When I press Enter, change the text and press Enter again
  Then line 7 shows the new text
  And the tab is marked modified
  And the file on disk is unchanged until I save

Scenario: BIG-008.2 Other ways to start and end an edit
  When I use the other ways of editing a line
  Then F2 and a double-click on a row also start editing that line
  And clicking elsewhere commits the edit
  And Escape leaves the line as it was

Scenario: BIG-008.3 Insert a line
  Given the cursor is on line 7
  When I press Ctrl+Enter
  Then an empty line 8 is inserted and is being edited

Scenario: BIG-008.4 Delete the selected lines
  Given lines 20 to 25 are selected
  When I press Delete
  Then those 6 lines are removed and the cursor is on line 20
  And the tab is marked modified

Scenario: BIG-008.5 Delete is limited to 100,000 lines
  Given 150,000 lines are selected
  When I press Delete
  Then a warning says "Select fewer than 100,000 lines to delete at once."
  And nothing is deleted

Scenario: BIG-008.6 Editing waits for indexing
  Given a large file is still being indexed
  When I press Enter on a line
  Then a toast says "Editing is enabled once indexing completes."
  And F2, a double-click on a row, Ctrl+Enter and Delete show the same toast and change nothing

Scenario: BIG-008.7 A line longer than 16 MB cannot be edited
  Given line 3 is longer than 16 MB
  When I press Enter on line 3
  Then a warning says "Line 3 is longer than 16 MB and cannot be edited in large-file mode."

Scenario: BIG-008.8 A line with invalid UTF-8 asks first
  Given line 12 contains bytes that are not valid UTF-8
  When I press Enter on line 12
  Then a dialog "Edit a line with invalid UTF-8?" explains that those bytes are replaced when saved
  And editing starts only if I choose "Edit anyway"

Scenario: BIG-008.9 A typed line break uses the file's line ending
  Given a file with CRLF line endings
  When an edited line is committed with a line break in its text
  Then the break is stored as CRLF
```

## BIG-009: Undo and redo line edits

- Status: draft
- Commands: `edit.undo`, `edit.redo`
- Files:
  - `src/lib/commands.ts` — `edit.undo` / `edit.redo` emit `big.undo` / `big.redo` on a big tab
  - `src/components/BigFileView.tsx` — `undoRedo`, Ctrl+Z / Ctrl+Y in `onKey`
  - `src-tauri/src/bigfile.rs` — `undo`, `redo`, snapshot stack capped at 200, `clean_depth` / `is_dirty`
  - `src-tauri/src/lib.rs` — `big_undo`, `big_redo`
  - `src/lib/ipc.ts` — `big.undo`, `big.redo`
- Tests: `src-tauri/src/bigfile.rs`
- Docs: `docs/large-files.md`

**As a** someone editing lines of a large file
**I want** to undo and redo my line edits
**So that** a slip does not force me to reload the file

```gherkin
Scenario: BIG-009.1 Undo and redo an edit
  Given I changed line 7 of a large file
  When I press Ctrl+Z
  Then line 7 shows its original text
  When I press Ctrl+Y
  Then line 7 shows my change again

Scenario: BIG-009.2 Undoing back to the saved state clears the modified mark
  Given a saved large file in which I then deleted one line
  When I press Ctrl+Z
  Then the tab is no longer marked modified

Scenario: BIG-009.3 Undo from the Edit menu
  Given a large-file tab is active with an edit made
  When I choose Edit › Undo
  Then the last line edit is undone

Scenario: BIG-009.4 Undo depth is 200 steps
  Given I made 250 line edits
  When I press Ctrl+Z repeatedly
  Then only the last 200 can be undone
  And the tab stays marked modified after undoing all of them

Scenario: BIG-009.5 A new edit clears redo
  Given I undid an edit
  When I edit another line
  Then Ctrl+Y does nothing
```

## BIG-010: Save and Save As

- Status: draft
- Commands: `file.save`, `file.saveAs`
- Files:
  - `src/lib/actions.ts` — `saveDocument` (big branch, read-only guard, `mappedElsewhere` guard)
  - `src-tauri/src/bigfile.rs` — `save` (temp file `.quarry-*.tmp` in the target folder, then replace; remaps the original if the replace fails), `rebind`, `same_file`
  - `src-tauri/src/lib.rs` — `big_save`
  - `src/lib/ipc.ts` — `big.save`
- Tests: `src-tauri/src/bigfile.rs`
- Docs: `docs/large-files.md`

**As a** someone who edited a large file
**I want** to save it, or save a copy, safely
**So that** a failed save never costs me the original file

```gherkin
Scenario: BIG-010.1 Save writes the file and clears the modified mark
  Given a large file with edited lines
  When I press Ctrl+S
  Then the file on disk contains my edits
  And the tab is no longer marked modified
  And the file is indexed again with progress shown

Scenario: BIG-010.2 Line endings are kept
  Given a large file with CRLF line endings in which I edited a line
  When I save
  Then every line ending in the saved file is still CRLF

Scenario: BIG-010.3 Save As writes a copy and the tab follows it
  Given a large-file tab "data.csv" with edits
  When I choose Save As and pick "data-fixed.csv"
  Then "data-fixed.csv" contains the document
  And the tab is now named "data-fixed.csv"
  And the original "data.csv" is unchanged

Scenario: BIG-010.4 A failed save keeps everything
  Given the target cannot be replaced
  When I save
  Then an error is shown
  And the original file is intact
  And the document stays open, readable and modified

Scenario: BIG-010.5 No saving over a file open in another large-file tab
  Given "a.log" is open in large-file mode in another tab
  When I Save As over "a.log"
  Then a warning says "a.log is open in another tab in large-file mode. Close that tab before saving over it."
  And nothing is written

Scenario: BIG-010.6 Read-only documents save only as a copy
  Given a UTF-16 large file, which is read-only
  When I press Ctrl+S
  Then a toast says the file is read-only and to use Save As
```

## BIG-011: Encodings and line endings

- Status: draft
- Commands: none
- Files:
  - `src-tauri/src/bigfile.rs` — `detect_layout` (first 1 MiB), `Sep` (UTF-16 aware line ends), `decode_line`, `LinesChunk.lossy`, `ensure_editable`, `search_decoded`
  - `src/lib/actions.ts` — `bigDocFields` (`readonly` when not UTF-8), read-only and CR-only toasts in `openLarge`
  - `src/components/BigFileView.tsx` — `editGate`, `visibleRowText` (stray CR shown as `␍`), `lossyLines`
  - `src/components/StatusBar.tsx` — encoding, line ending and "Read-only" items
- Tests: `src/__tests__/bigview.test.ts`, `src-tauri/src/bigfile.rs`
- Docs: `docs/large-files.md`

**As a** someone opening large files from different systems
**I want** their encoding and line endings handled correctly
**So that** I see readable text and never corrupt the file by saving

```gherkin
Scenario: BIG-011.1 UTF-16 files with a byte-order mark are shown decoded and read-only
  Given a 100 MB UTF-16LE file that starts with a byte-order mark
  When I open it
  Then its text is readable
  And a warning toast says it is UTF-16LE and opened read-only in large-file mode
  And the status bar shows "UTF-16LE" and "Read-only"
  And hovering "UTF-16LE" shows "UTF-16LE large files are shown decoded and read-only"

Scenario: BIG-011.2 A read-only file refuses edits
  Given a UTF-16 large-file tab
  When I press Enter on a line
  Then a warning says "UTF-16LE large files are read-only."
  And F2, a double-click, Delete and Ctrl+Enter show the same warning and change nothing
  And Replace All reports that the file is read-only instead of changing it

Scenario: BIG-011.3 Find works on UTF-16 files
  Given a UTF-16 large-file tab
  When I search for "error"
  Then the hits are found and highlighted on their lines

Scenario: BIG-011.4 Invalid UTF-8 is shown, not hidden
  Given a UTF-8 file with a line that contains invalid bytes
  When that line is on screen
  Then that line shows "�" where the bytes are
  And editing it asks for confirmation first

Scenario: BIG-011.5 Line endings are detected
  Given a file whose first megabyte uses CRLF
  When I open it in large-file mode
  Then the status bar shows "CRLF"
  And a file with only CR line endings shows "CR" and a toast that CR-only line endings are kept when saving

Scenario: BIG-011.6 A stray CR inside a line is visible
  Given an LF file where one line contains a lone CR
  When that line is on screen
  Then that CR is shown as "␍" inside the line and does not split it

Scenario: BIG-011.7 Other encodings are read as UTF-8
  Given a large file in UTF-16 without a byte-order mark
  When I open it
  Then it is read as UTF-8 and the status bar shows "UTF-8"
```

## BIG-012: Syntax colours for large files

- Status: draft
- Commands: none
- Files:
  - `src/lib/bigHighlight.ts` — `bigLanguageOf` (extension, else sniffing the first 40 non-empty lines), `tokenize` (JSON, log, CSV, TSV, XML, SQL; first 4,000 characters), `segments`
  - `src/components/BigFileView.tsx` — `renderText` (colours merged with the search hit), `lang`
  - `src/components/BigFilterPane.tsx` — colours filtered lines (first 2,000 characters)
  - `src/components/panels/SettingsPanel.tsx` — "Colours in large-file mode" (`bigHighlight`)
  - `src/lib/types.ts` — `Settings.bigHighlight`, default `true`
  - `src/lib/actions.ts` — `sanitizeSettings` (`bigHighlight`)
  - `src/styles/app.css` — `.hl-*` classes mapped to `--syn-*` variables
- Tests: `src/__tests__/bigHighlight.test.ts`
- Docs: `docs/large-files.md`

**As a** someone reading a large log, JSON, CSV, XML or SQL file
**I want** the visible lines coloured by their format
**So that** levels, keys and values stand out as they do in a normal tab

```gherkin
Scenario: BIG-012.1 Colours follow the file extension
  Given a large file "events.jsonl"
  When I open it with the default settings
  Then keys, strings, numbers and true / false / null are coloured on the visible lines

Scenario: BIG-012.2 Log levels stand out
  Given a large file "app.log"
  When I open it with the default settings
  Then the timestamp at the start of a line is coloured
  And the first level word of a line is coloured by severity: ERROR and FATAL as errors, WARN as a warning, DEBUG and TRACE dimmed
  And "[tags]", "key=" names and numbers are coloured

Scenario: BIG-012.3 A .txt file that looks like a log is coloured as one
  Given a large file "dump.txt" where at least half of the first lines start with a timestamp
  When I open it with the default settings
  Then it is coloured as a log
  And a .txt file of ordinary prose stays uncoloured

Scenario: BIG-012.4 The search hit stays marked on a coloured line
  Given a coloured line contains the current search hit
  When that line is on screen
  Then the hit is marked and the rest of the line keeps its colours

Scenario: BIG-012.5 Only the start of a very long line is coloured
  Given a line of 10,000 characters
  When that line is on screen
  Then its first 4,000 characters are coloured and the rest is plain

Scenario: BIG-012.6 Colours can be turned off
  Given Settings › Files › "Colours in large-file mode" is off
  When I open a large log
  Then large-file tabs show plain text
  And the filter pane no longer offers the Errors and Warnings buttons

Scenario: BIG-012.7 Every coloured extension and the sniffed formats
  Given large files named "a.json", "a.jsonc", "a.json5", "a.jsonl", "a.ndjson", "a.geojson", "a.har", "a.log", "a.out", "a.err", "a.csv", "a.tsv", "a.tab", "a.xml", "a.html", "a.htm", "a.xhtml", "a.svg", "a.plist", "a.xsd", "a.kml", "a.gpx" and "a.sql"
  When I open each one
  Then each is coloured as JSON, log, CSV, TSV, XML or SQL by its extension
  And a file with another extension whose first lines start with "{" or "[" and hold "key": pairs is coloured as JSON
  And one whose first lines mostly start with "<" is coloured as XML
```

## BIG-013: Filter view of matching lines

- Status: draft
- Commands: `big.filter`
- Files:
  - `src/lib/commands.ts` — `big.filter` ("Large File: Filter Lines") emits `big.filter` for the active big tab
  - `src/components/BigFilterPane.tsx` — the pane: query, options (`dotAll` always off: `.` stays within a line), `LEVEL_FILTERS`, long-row "more chars" marker, paging by 200 (`big.filterLines`), keyboard and click navigation, status text, re-run on `version`
  - `src/components/BigFileView.tsx` — Filter banner button, `filterOpen`, `onJump`, `filterClear` on close
  - `src-tauri/src/bigfile.rs` — `filter_lines`, `scan_lines`, `LineFilter` (`opts`: `dot_all` off), `LineSet` (bitset with a count per 512 lines, `line_at`)
  - `src-tauri/src/lib.rs` — `big_filter`, `big_filter_lines` (at most 1,000 per call), `big_filter_clear`, `AppState.filters`
  - `src/lib/ipc.ts` — `big.filter`, `big.filterLines`, `big.filterClear`
  - `src/lib/bigGeometry.ts` — scaled scrolling for millions of filtered lines
  - `src/styles/app.css` — `.big-filter`, `.big-filter-bar`, `.big-filter-list`
- Tests: `src/__tests__/bigHighlight.test.ts`, `src-tauri/src/bigfile.rs`
- Docs: `docs/large-files.md`

**As a** someone reading a 5 GB log
**I want** a pane that lists only the lines matching a search, or only those that do not
**So that** I can read the errors together and still see each one in context

```gherkin
Scenario: BIG-013.1 Show only the matching lines
  Given a fully indexed large log
  When I click "Filter" in the banner, type "timeout" and press Enter
  Then a pane under the file lists every line containing "timeout" with its line number in the file
  And the status reads the number of lines, for example "7,412 lines"

Scenario: BIG-013.2 Open the filter from the command palette
  Given a large-file tab is active
  When I run "Large File: Filter Lines"
  Then the filter pane opens with the cursor in its search box

Scenario: BIG-013.3 Click a filtered line to see it in context
  Given the filter lists its lines
  When I click the line numbered 1,204,551
  Then the file view above jumps to line 1,204,551
  And the arrow keys, Page Up / Down, Home and End move through the filtered lines the same way

Scenario: BIG-013.4 Hide the matching lines instead
  Given the filter ran for "DEBUG"
  When I turn on "Hide matching lines"
  Then the pane lists every line without "DEBUG"
  And the status ends with "without a match"

Scenario: BIG-013.5 Quick level filters for logs
  Given a large file coloured as a log
  When I click "Errors"
  Then the pane lists the lines with ERROR, FATAL, CRITICAL, SEVERE or FAILED as whole upper-case words
  And "Warnings" lists the lines with WARN or WARNING

Scenario: BIG-013.6 The filter waits for indexing
  Given a large file is still being indexed
  When I enter a filter
  Then the status reads "Waiting for indexing to finish…"
  And the filter runs by itself once indexing completes

Scenario: BIG-013.7 The filter re-runs after an edit
  Given the filter lists its lines
  When I delete a line in the file
  Then the filter runs again so its line numbers are right

Scenario: BIG-013.8 An invalid pattern
  Given Regular Expression is on
  When I filter by "("
  Then the status shows the pattern error in the error colour

Scenario: BIG-013.9 Closing the filter
  When I press Escape in the filter box or click its close button
  Then the pane closes and the file view has focus

Scenario: BIG-013.10 UTF-16 files cannot be filtered
  Given a UTF-16 large-file tab
  When I enter a filter
  Then the status says filtering works on UTF-8 files

Scenario: BIG-013.11 A dot never matches a line break
  Given Regular Expression is on
  When I filter by "start.*end"
  Then only lines that contain both "start" and a later "end" are listed
  And a "start" on one line and an "end" on the next do not match together

Scenario: BIG-013.12 Long filtered lines say how much is cut
  Given a matching line of 5,000 characters
  When it is listed in the filter pane
  Then its first 2,000 characters are shown, followed by "… (3,000 more chars)"
  And in grid mode a row is cut at 20,000 characters the same way
```

## BIG-014: Follow a file as it grows

- Status: draft
- Commands: `big.follow`
- Files:
  - `src/lib/commands.ts` — `big.follow` ("Large File: Follow (Show Lines as They Are Added)")
  - `src/components/BigFileView.tsx` — Follow button, `followBlocked` / `canFollow` (also guards the `big.follow` bus event), 1 s polling, `stickToEnd`, "Following" chip, stop on edit, reload on "replaced"
  - `src-tauri/src/bigfile.rs` — `follow_appended`, `remember_follow_sig` (`follow_sig`: first / last 4 KB), `extend_filter`, `Appended`
  - `src-tauri/src/lib.rs` — `big_follow`, `FollowResult`
  - `src/lib/ipc.ts` — `big.follow`
  - `src/lib/actions.ts` — `reloadBig`; `checkExternalChanges` skips a tab with `Doc.following`
  - `src/lib/store.ts` — `Doc.following`
  - `src/components/BigFilterPane.tsx` — `growth` (new filtered lines, keeps the end in view)
- Tests: `src-tauri/src/bigfile.rs`
- Docs: `docs/large-files.md`

**As a** someone watching a log that is still being written
**I want** new lines to appear as they are added, like tail -f
**So that** I can watch a running system without reopening the file

```gherkin
Scenario: BIG-014.1 Start following
  Given a fully indexed, unedited UTF-8 large log
  When I click "Follow" in the banner
  Then the view jumps to the end of the file
  And a "Following" chip appears in the banner
  And lines appended to the file appear within about a second

Scenario: BIG-014.2 Scrolling up pauses the jump to the end
  Given follow mode is on
  When I scroll up to read earlier lines
  Then new lines no longer move the view
  When I scroll back to the end
  Then the view follows new lines again

Scenario: BIG-014.3 An open filter picks up new lines
  Given follow mode is on and the filter pane lists the lines with "ERROR"
  When a line with "ERROR" is appended to the file
  Then it appears at the end of the filter pane and the line count goes up

Scenario: BIG-014.4 A rewritten file is reloaded
  Given follow mode is on
  When the file is replaced by a shorter or different file
  Then a toast says the file was rewritten on disk and is being reloaded
  And the tab shows the new content

Scenario: BIG-014.5 Follow needs an unedited, indexed file
  Given a large file with unsaved changes
  When I hover the Follow button
  Then the Follow button is disabled with the tooltip "Save first: follow mode needs the file unedited"
  And while indexing runs the tooltip is "Available once indexing finishes", and on a UTF-16 file "Follow mode works on UTF-8 files"

Scenario: BIG-014.6 Editing stops follow mode
  Given follow mode is on
  When I edit a line
  Then follow mode turns off
  And a toast says "Follow mode stopped: the file has unsaved changes."

Scenario: BIG-014.7 Following replaces the external-change check
  Given follow mode is on and the file grew
  When the Quarry window regains focus
  Then no "changed on disk" reload or prompt appears for that tab

Scenario: BIG-014.8 The palette command has the same guard as the button
  Given a large file that is still being indexed, has unsaved changes, or is UTF-16
  When I run "Large File: Follow (Show Lines as They Are Added)" from the command palette
  Then follow mode does not start and no "Following" chip appears
  And a toast gives the reason, e.g. "Available once indexing finishes" or "Follow mode works on UTF-8 files"
```

## BIG-015: CSV and TSV grid

- Status: draft
- Commands: none
- Files:
  - `src/lib/delimited.ts` — `splitDelimited`, `isNumeric`, `growWidths`, `MAX_COL_CH`
  - `src/components/GridCells.tsx` — one row of fixed-width cells, numbers right-aligned, hit cell
  - `src/components/BigFileView.tsx` — `gridSep` (by extension), Grid toggle, `header` overlay on the top row slot, `colW`, `renderCells`, `revealCursor` grid rule
  - `src/components/BigFilterPane.tsx` — `grid` prop: same cells and header in the filter pane
  - `src/styles/app.css` — `.big-cell`, `.big-grid-head`, `.big-filter-head`
- Tests: `src/__tests__/delimited.test.ts`
- Docs: `docs/large-files.md`

**As a** someone inspecting a large CSV or TSV export
**I want** its fields lined up in columns under a fixed header
**So that** I can read rows and compare values without counting commas

```gherkin
Scenario: BIG-015.1 A large CSV opens as a grid
  Given a large file "orders.csv"
  When I open it
  Then each field is shown in its own column
  And the file's first line stays at the top as the header while I scroll
  And a "Grid" button in the banner is on

Scenario: BIG-015.2 Tab-separated files
  Given a large file "orders.tsv" or "orders.tab"
  When I open it
  Then it opens as a grid split on tabs
  And a large ".txt" file has no Grid button

Scenario: BIG-015.3 Quoted fields
  Given a CSV line: 1,"Smith, Jo","say ""hi"""
  When that line is shown in the grid
  Then the row has 3 cells: 1, Smith, Jo and say "hi"

Scenario: BIG-015.4 Numbers are right-aligned
  Given a column with the values 12, 1,250.50 and -3e5
  When those rows are shown in the grid
  Then those cells are right-aligned
  And a cell "abc" is left-aligned

Scenario: BIG-015.5 Column widths only grow, up to 40 characters
  Given the rows seen so far have at most 8 characters in column 2
  When I scroll to a row with 60 characters in column 2
  Then column 2 widens to 40 characters and the value is cut
  And hovering the cell shows the whole value
  And scrolling back does not narrow the column

Scenario: BIG-015.6 A search hit marks its cell
  Given a search whose current hit lies in the third field of a row
  When that row is on screen in the grid
  Then the third cell of that row is marked

Scenario: BIG-015.7 Switch to raw text and back
  When I click "Grid"
  Then the lines are shown as raw text, coloured one colour per column
  When I click "Grid" again
  Then the grid is back

Scenario: BIG-015.8 The header never hides the cursor row
  Given the grid is on
  When I move the cursor up to the row directly under the header
  Then the view scrolls so that row is not covered by the header

Scenario: BIG-015.9 Editing a row edits its raw text
  Given the grid is on
  When I press Enter on a row
  Then the edit box holds the line's raw text including separators and quotes

Scenario: BIG-015.10 The filter pane uses the same columns
  Given the grid is on and the filter pane lists lines
  When I look at the filter pane
  Then the filtered lines are shown in the same columns under the same header
```

## BIG-016: JSON tree read from the file

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/BigJsonTree.tsx` — `BigJsonTree`, `flattenRows`, `load` (pages of 200), `jump`, `copyPath`, keyboard handling, dirty / error notes
  - `src/components/panels/JsonPanel.tsx` — shows `BigJsonTree` for `isBigJson` tabs, note for other big tabs
  - `src/lib/commands.ts` — `isBigJson` (extensions .json, .jsonc, .json5, .geojson, .har)
  - `src-tauri/src/json_tree.rs` — `root`, `children` (resume offset, JSONC comments and trailing commas), `count`, `skip_value`, `preview` (160 bytes)
  - `src-tauri/src/lib.rs` — `big_json_root`, `big_json_children`, `big_json_count`, `big_line_of_offset`, `with_unedited`, `tree_error`
  - `src-tauri/src/bigfile.rs` — `unedited_bytes`, `line_of_offset`
  - `src/lib/ipc.ts` — `BigJsonNode`, `big.jsonRoot`, `big.jsonChildren`, `big.jsonCount`, `big.lineOfOffset`
  - `src/lib/jsonPath.ts` — `formatPath`, `describeCopiedPath`
  - `src/lib/jsonModel.ts` — `PATH_STYLES`
- Tests: `src/__tests__/bigJsonTree.test.ts`, `src/__tests__/paths.test.ts`, `src-tauri/src/json_tree.rs`
- Docs: `docs/large-files.md`

**As a** someone exploring a multi-gigabyte JSON file
**I want** to browse its structure as a tree without loading it
**So that** I can find where things are and jump to them

```gherkin
Scenario: BIG-016.1 The tree opens with the top level listed
  Given a large file "dump.json" whose root is an array of 20,079,290 items
  When I open the JSON panel
  Then a chip reads "Read from the file"
  And the root row is expanded with its first 200 items listed
  And the root shows "[counting…]" until the total is known, then "[20,079,290]"

Scenario: BIG-016.2 Expanding a node reads just that node
  When I expand an object row
  Then its members appear with their type icon and a value preview
  And nested objects and arrays show how many members or items they have

Scenario: BIG-016.3 Long containers load 200 at a time
  Given an array with more than 200 items is expanded
  Then a row "Load 200 more" follows the 200th item with "200 of 20,079,290 shown"
  When I click it
  Then the next 200 items are listed

Scenario: BIG-016.4 Click a row to go to its line
  When I click a row in the tree
  Then the file view jumps to the line where that value starts
  And this works while the file is still being indexed

Scenario: BIG-016.5 Copy a path
  Given the path format is the default
  When I focus the row for the "id" member of the item at index 3 and press Ctrl+Shift+C
  Then the path to that value is copied in the chosen format and a toast confirms it

Scenario: BIG-016.6 Keyboard navigation
  Given a tree row has focus
  When I press navigation keys
  Then Up and Down move between rows, Right expands, Left collapses or goes to the parent
  And Enter goes to the row's line, or loads more on a "Load 200 more" row

Scenario: BIG-016.7 Unsaved changes hide the tree
  Given the large JSON file has unsaved line edits
  Then the panel says "Save the file to see its tree: in large-file mode the tree reads the file as saved."
  When I save
  Then the tree is read again

Scenario: BIG-016.8 A file that is not JSON
  Given a large ".json" file whose content is malformed at the top level
  When I open the JSON panel
  Then the panel says "Can't read this file as JSON:" with the problem and its line

Scenario: BIG-016.9 Only JSON extensions get a tree
  Given a large file "app.log" is active
  When I open the JSON panel
  Then the JSON panel says the file is open in large-file mode and isn't a .json file
  And a large "events.jsonl" or "events.ndjson" file (one JSON value per line, coloured as JSON) gets the same message, not a tree

Scenario: BIG-016.10 Collapse and re-read
  When I click "Collapse all"
  Then only the root's children remain listed
  When I click "Re-read the file"
  Then the tree is built again from the file
```

## BIG-017: Validate a large JSON file

- Status: draft
- Commands: `json.validate`
- Files:
  - `src/lib/commands.ts` — `jsonValidate` → `bigJsonValidate`, `isBigJson`, `enabled` of `json.validate`
  - `src-tauri/src/lib.rs` — `big_json_validate`
  - `src-tauri/src/json_tools.rs` — `validate_bytes` (invalid UTF-8 reported with line and column)
  - `src-tauri/src/bigfile.rs` — `unedited_bytes`
  - `src/lib/ipc.ts` — `big.jsonValidate`
  - `src/components/panels/JsonPanel.tsx` — Validate button in the panel header for big JSON tabs
- Tests: `src/__tests__/paths.test.ts`, `src-tauri/src/json_tools.rs`
- Docs: `docs/large-files.md`

**As a** someone who received a huge JSON export
**I want** to check that it is valid JSON without loading it
**So that** I know whether, and where, it is broken before feeding it to another tool

```gherkin
Scenario: BIG-017.1 A valid file
  Given an unedited large file "dump.json" of 3 GB that is valid JSON
  When I press Ctrl+Alt+V
  Then a toast "Validating dump.json…" appears if the check takes longer than 0.4 s
  And when it finishes a toast says "Valid JSON ✓" with the size checked and the seconds taken

Scenario: BIG-017.2 An invalid file
  Given the file has a syntax error on line 48,211
  When I run JSON: Validate
  Then a toast gives the error with its line and column
  And the file view jumps to line 48,211

Scenario: BIG-017.3 JSONC files allow comments and trailing commas
  Given a large file "settings.jsonc" with comments and a trailing comma
  When I run JSON: Validate
  Then it is reported valid

Scenario: BIG-017.4 Unsaved changes must be saved first
  Given the large JSON file has unsaved line edits
  When I run JSON: Validate
  Then a warning says "Save your changes first: JSON: Validate checks a large file as saved."
  And nothing is validated

Scenario: BIG-017.5 Only large files with a JSON extension
  Given a large file "app.log" is active
  When I open the JSON menu or the command palette
  Then JSON: Validate is disabled in the menu and the palette
  And it is disabled for a large ".jsonl" or ".ndjson" file too, since those hold one JSON value per line

Scenario: BIG-017.6 UTF-16 files are refused
  Given a large UTF-16 file "data.json"
  When I run JSON: Validate
  Then a warning starting "Cannot validate:" says JSON must be UTF-8
```

## BIG-018: Show large-file info

- Status: draft
- Commands: `big.info`
- Files:
  - `src/lib/commands.ts` — `big.info` ("Large File: Show Info")
  - `src-tauri/src/lib.rs` — `big_info`
  - `src-tauri/src/bigfile.rs` — `info`
  - `src/lib/dialogs.ts` — `inform`
- Tests: none
- Docs: `docs/large-files.md`

**As a** someone working with a large file
**I want** a summary of its path, size, line count and state
**So that** I can check what I am looking at

```gherkin
Scenario: BIG-018.1 Show the details
  Given a large-file tab is active
  When I run "Large File: Show Info" from the command palette
  Then a dialog "Large file info" lists Path, Size (also in bytes), Lines, Line endings, Indexed (yes / in progress) and Unsaved changes (yes / no)

Scenario: BIG-018.2 Large-file commands need a large-file tab
  Given a normal text tab is active
  When I open the command palette
  Then "Large File: Show Info", "Large File: Filter Lines" and "Large File: Follow" are disabled
```

## BIG-019: Reload when the file changes on disk

- Status: draft
- Commands: none
- Files:
  - `src/lib/actions.ts` — `checkExternalChanges` (big branch), `reloadBig` (opens the file again under a new `bigId`, closes the old one)
  - `src/App.tsx` — `BigFileView` remounts when `bigId` changes
  - `src/components/BigFilterPane.tsx` — re-runs its filter for the new `bigId`
- Tests: none
- Docs: `docs/large-files.md`

**As a** someone with a large file open while another program rewrites it
**I want** Quarry to notice and show the current content
**So that** I am not reading or saving a stale version

```gherkin
Scenario: BIG-019.1 An unedited tab reloads by itself
  Given an unedited large-file tab whose file was modified by another program
  When the Quarry window regains focus
  Then the tab is reloaded and indexed again
  And a toast says "<name> changed on disk and was reloaded."

Scenario: BIG-019.2 A tab with edits asks
  Given a large-file tab with unsaved edits whose file was modified by another program
  When the Quarry window regains focus
  Then a dialog offers "Reload from disk" or "Keep my version"
  And "Reload from disk" drops my edits and shows the file as it is on disk
  And "Keep my version" keeps my edits and does not ask again for that change

Scenario: BIG-019.3 A deleted file
  Given a large-file tab whose file was deleted or moved
  When the Quarry window regains focus
  Then a warning says the file was deleted or moved and that saving will recreate it
  And the tab is marked modified
```

## BIG-020: What large-file tabs do not offer

- Status: draft
- Commands: none
- Files:
  - `src/lib/commands.ts` — `applyDefaultEnabled` (`textOnly`, `fileOnly`, `hasText`, `hasFileDoc`), `file.revert` enabled only for text tabs
  - `src/lib/actions.ts` — `revertDocument` ignores big tabs
  - `src/components/StatusBar.tsx` — big tabs get plain encoding / line-ending labels instead of the pickers
  - `src/components/BigFileView.tsx` — banner key hints
- Tests: none
- Docs: `docs/large-files.md`

**As a** someone used to normal tabs
**I want** commands that cannot work on a large file to be visibly unavailable
**So that** I am not left wondering why nothing happened

```gherkin
Scenario: BIG-020.1 Text-editing commands are greyed out
  Given a large-file tab is active
  When I open the menus or the command palette
  Then the Edit, Code and Selection commands other than Undo and Redo are disabled in the menus and the palette
  And the word wrap and render whitespace toggles are disabled
  And the JSON commands other than JSON: Validate on a JSON file are disabled

Scenario: BIG-020.2 File commands that still work
  Given a large-file tab is active
  When I open the menus or the command palette
  Then Find, Replace, Find Next, Find Previous, Go to Line, Save and Save As are enabled
  And Revert File is disabled

Scenario: BIG-020.3 Encoding and line ending cannot be changed
  Given a large-file tab is active
  When I look at the status bar
  Then the status bar shows the encoding and line ending as plain labels that do not open a picker

Scenario: BIG-020.4 The banner lists the keys
  Given a large-file tab is active
  When I look at the banner
  Then the banner reads "Enter: edit line · Ctrl+Enter: insert · Del: delete · Shift+↑↓ / drag: select · Ctrl+F: find · Ctrl+G: go to line"
```
