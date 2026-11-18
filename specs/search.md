---
area: Find in Files
prefix: SEARCH
---

# Find in Files

The Search panel: searching the current file, the open tabs or folders on disk, the filters, the streamed results list, leaving results out, Replace in Files (with encoding preservation and undo) and stepping through results. User documentation: `docs/find-and-replace.md` (sections "Find in Files", "Replace in Files", "Undo Replace in Files", "Regex flavours"). The find bar of a single document is `specs/find.md`; the find and replace history shared by both is FIND-007.

## SEARCH-001: Open the Search panel

- Status: verified
- Commands: `find.inFiles`, `find.replaceInFiles`
- Files:
  - `src/lib/commands.ts` — `find.inFiles`, `find.replaceInFiles` (`showPanelOnly("search")`, `search.focus`)
  - `src/components/panels/SearchPanel.tsx` — `search.focus` handler (focus, selection → pattern, `resultSel` guard), auto-growing search box (`FIND_MAX_HEIGHT`), `SEARCH_TIP`
  - `src/lib/bus.ts` — `search.focus` event
  - `src/lib/panels.ts` — `showPanelOnly`, `isAutoDocked` / `searchDocked` (the panel docks while it has results), `minPanelWidth` (280)
  - `src/lib/store.ts` — `SearchState`, `DEFAULT_SEARCH_QUERY`, `setSearch`
- Tests: `src/__tests__/panels.test.ts`
- Docs: `docs/find-and-replace.md`, `docs/keyboard-shortcuts.md`

**As a** developer working in a project
**I want** to open a Find in Files panel from the keyboard
**So that** I can search more than the lines I am looking at

```gherkin
Scenario: SEARCH-001.1 Ctrl+Shift+F opens the panel with the search box selected
  Given the Search panel is closed
  When I press Ctrl+Shift+F
  Then the "Find in Files" panel opens
  And the cursor is in the "Search" box with its text selected

Scenario: SEARCH-001.2 The editor selection becomes the search text
  Given "needle" is selected in the editor
  When I press Ctrl+Shift+F
  Then the search box contains "needle"

Scenario: SEARCH-001.3 A long selection is not taken
  Given 300 or more characters are selected in the editor
  When I press Ctrl+Shift+F
  Then the search box keeps its previous text

Scenario: SEARCH-001.4 A match selected by opening a result is not taken
  Given I searched for "ne+dle" with Regex on and opened a result, which selected "needle" in the editor
  When I press Ctrl+Shift+F
  Then the search box still contains "ne+dle"

Scenario: SEARCH-001.5 Ctrl+Shift+H shows the replace field
  Given the Search panel is closed
  When I press Ctrl+Shift+H
  Then the panel opens with the "Replace" box shown
  And the chevron left of the search box hides and shows the replace box

Scenario: SEARCH-001.6 The panel sits beside the editor while it has results
  Given a search has returned results
  When I open a result
  Then the Search panel stays open next to the editor instead of floating and closing
  When I click "Clear results"
  Then the results, the search text and the highlighting in the editor are cleared
  And the panel floats again

Scenario: SEARCH-001.7 A long search text stays visible
  Given the search box contains a text that wraps to 12 lines
  When I look at the panel
  Then the box has grown to about eight lines and scrolls for the rest
  And the panel cannot be dragged narrower than 280 pixels
```

## SEARCH-002: Search the current file or all open files

- Status: verified
- Commands: none
- Files:
  - `src/components/panels/SearchPanel.tsx` — `effectiveScope`, `searchOpenDocs`, `searchTexts` ("Max" across all documents, `truncated`), `buildJsRegex`, `run()` (in-memory branch, large-file branch), scope buttons
  - `src/lib/store.ts` — `search.scope` (default `"doc"`), `search.inMemory`
  - `src/editor/manager.ts` — `editor.textOf(docId)`
- Tests: `src/__tests__/replace.test.ts`
- Docs: `docs/find-and-replace.md`

**As a** person with files open
**I want** to list every match in the current file or in all open tabs, unsaved changes included
**So that** I see what is in the editor, not what was last saved

```gherkin
Scenario: SEARCH-002.1 Current File is the default scope
  Given Quarry has just started and a text file is open
  When I open the Search panel
  Then "Current File" is the highlighted scope button

Scenario: SEARCH-002.2 Current File searches the text in the editor
  Given the active document has an unsaved line "needle here"
  When I search for "needle" with the Current File scope
  Then the results list that line under the document's name
  And no other file is searched

Scenario: SEARCH-002.3 Open Files searches every open text tab
  Given 3 text tabs are open, 2 of them containing "needle", one of those untitled
  When I search for "needle" with the Open Files scope
  Then results are listed for both documents, the untitled one under its tab name
  And large-file tabs and other non-text tabs are not searched

Scenario: SEARCH-002.4 A large-file tab is searched on disk
  Given the active tab is a large file
  When I search with the Current File scope
  Then that file alone is searched on disk
  And include / exclude patterns and .gitignore are not applied to it

Scenario: SEARCH-002.5 Scope buttons appear only when they apply
  Given no tab is open
  When I look at the scope buttons
  Then "Current File" and "Open Files" are not shown
  And a search uses the Folder scope
  When I open a file
  Then "Current File" is shown and selected again

Scenario: SEARCH-002.6 Fallback from Current File to Open Files
  Given the scope is Current File and tabs are open but none is active
  When I run a search
  Then the open tabs are searched

Scenario: SEARCH-002.7 These scopes use JavaScript regular expressions
  Given Regex is on and the scope is Current File
  When I search for "ne+dle"
  Then the pattern is run by the JavaScript engine against the document text
  And the files on disk are not read

Scenario: SEARCH-002.8 The result limit covers all open documents
  Given "Max" is 4 and two open tabs each contain "x" 3 times
  When I search for "x" with the Open Files scope
  Then 4 results are listed in total, 3 in the first tab and 1 in the second
  And the status ends with "(limit reached)"

Scenario: SEARCH-002.9 Nothing found counts only the documents searched
  Given 2 text tabs, a large-file tab and a Compare tab are open, none containing "needle"
  When I search for "needle" with the Open Files scope
  Then the status reads "No results in 2 files"
```

## SEARCH-003: Search a folder, the Explorer selection or chosen folders

- Status: verified
- Commands: none
- Files:
  - `src/components/panels/SearchPanel.tsx` — `explorerRoots`, `targetSummary`, `folderLabel`, Folder / Selection button, "Whole folder" link, "Choose…" (folder picker, `customRoots`), `run()` roots
  - `src/lib/store.ts` — `search.treeTargets`, `search.customRoots`
  - `src/components/panels/ExplorerPanel.tsx` — `pickTargets` writes `search.treeTargets` (the Explorer side is specified with the Explorer)
  - `src/lib/ipc.ts` — `search.start`
  - `src-tauri/src/lib.rs` — `search_start` (thread per search, `search:results` / `search:done` / `search:error` events)
  - `src-tauri/src/search.rs` — `search_paths`, `walker` (roots may mix files and folders)
- Tests: `src/__tests__/replace.test.ts`, `src-tauri/src/search.rs`
- Docs: `docs/find-and-replace.md`

**As a** developer working in a project folder
**I want** to search the whole folder, or just the files and folders I picked
**So that** I get matches from the part of the project I care about

```gherkin
Scenario: SEARCH-003.1 Folder searches the open folder recursively
  Given the folder "C:\work\Quarry" is open and nothing was picked in the Explorer
  When I select the "Folder" scope
  Then the line under the buttons reads "In Quarry"
  And a search for "needle" lists matches from files in the folder and its subfolders

Scenario: SEARCH-003.2 The Explorer selection narrows the search
  Given "C:\work\Quarry" is open and I last clicked the folder "src" in the Explorer
  When I select the Folder scope
  Then the line reads "In Quarry\src" with a "Whole folder" link
  And only files under "src" are searched

Scenario: SEARCH-003.3 Several picked items
  Given I Ctrl+clicked "a.txt", "src" and "b.md" in the Explorer
  When I look at the Search panel
  Then the scope button reads "Selection"
  And the line reads "In 3 items: a.txt, src, b.md"
  And a search covers "a.txt", "b.md" and everything under "src", and nothing else

Scenario: SEARCH-003.4 A single picked file
  Given I last clicked the file "notes.txt" in the Explorer
  When I look at the Search panel
  Then the scope button reads "Selection"

Scenario: SEARCH-003.5 Overlapping picks are searched once
  Given "src" and "src\lib\a.ts" are both picked in the Explorer
  When I search with the Folder scope
  Then "src" alone is the search location and "a.ts" matches are listed once

Scenario: SEARCH-003.6 Whole folder
  Given the line reads "In Quarry\src"
  When I click "Whole folder"
  Then the line reads "In Quarry" and the next search covers the whole open folder

Scenario: SEARCH-003.7 Picks outside the open folder are ignored
  Given the remembered Explorer picks all lie outside the folder that is open now
  When I search with the Folder scope
  Then the whole open folder is searched

Scenario: SEARCH-003.8 Choose folders
  Given any scope is selected
  When I click "Choose…" and pick 2 folders
  Then the button reads "2 folders" and is selected
  And a search covers those 2 folders
  When I click the button again and cancel the folder dialog
  Then the scope and the chosen folders are unchanged

Scenario: SEARCH-003.9 No folder to search
  Given no folder is open and the scope is Folder
  When I run a search
  Then a warning says "Open a folder (Ctrl+Shift+O) or choose a search location first."
  And no search runs
```

## SEARCH-004: Search options and regular-expression checking

- Status: verified
- Commands: none
- Files:
  - `src/components/panels/SearchPanel.tsx` — Match Case / Whole Word / Regex toggles, Ctrl+Enter, "Dot matches newline", `regexEngine` (JavaScript-only check for Current File on a text tab and Open Files), debounced `validateRegex` (150 ms, Rust scopes only), `jsRegexError`, `invalidRegex`, `regexMessage`, `multiline` flag sent with the query
  - `src/lib/ipc.ts` — `search.validateRegex`
  - `src-tauri/src/lib.rs` — `validate_regex` command
  - `src-tauri/src/search.rs` — `pattern_source` (plain-text line break → `\r?\n`), `build_matcher`, `validate_regex`, `one_line_regex_error`, `build_searcher` (multi-line), Whole Word in `replace_in_files` (`\b{start-half}` / `\b{end-half}`, as `RegexMatcherBuilder::word`)
  - `src/components/panels/SearchPanel.tsx` — `buildJsRegex` (Whole Word as `(?<!\w)` / `(?!\w)` for open documents and the replace preview)
  - `src/lib/types.ts` — `SearchQuery`
- Tests: `src-tauri/src/search.rs`, `src/__tests__/replace.test.ts`
- Docs: `docs/find-and-replace.md`

**As a** person searching files
**I want** case, whole-word, regex and multi-line options, and to be told at once when a pattern is wrong
**So that** a search finds what I mean and never fails silently

```gherkin
Scenario: SEARCH-004.1 Searches ignore case and are literal by default
  Given files containing "Foo.bar", "foo.bar" and "fooxbar"
  When I search for "foo.bar"
  Then "Foo.bar" and "foo.bar" are found and "fooxbar" is not

Scenario: SEARCH-004.2 Match Case and Whole Word
  Given files containing "cat", "Cat" and "category"
  When I search for "cat" with Match Case and Match Whole Word on
  Then only "cat" is found

Scenario: SEARCH-004.3 Enter runs the search, Ctrl+Enter adds a line
  Given the search box contains "foo"
  When I press Ctrl+Enter and type "bar"
  Then the box holds two lines and no search has run
  When I press Enter
  Then the search runs and finds "foo" at the end of one line followed by "bar" at the start of the next

Scenario: SEARCH-004.4 A regular expression can match across lines
  Given the scope is Folder and Regex is on
  When I search for "end\nstart"
  Then a line ending in "end" followed by a line starting with "start" is found
  And the result is listed at the line where the match begins

Scenario: SEARCH-004.5 Dot matches newline
  Given Regex is on and a file has "a" on one line and "b" on the next
  When I search for "a.b" with "Dot matches newline" off
  Then nothing is found
  When I turn "Dot matches newline" on in Filters and search again
  Then the two-line match is found

Scenario: SEARCH-004.6 An invalid pattern is flagged while typing
  Given Regex is on
  When I type "(" in the search box
  Then the box is marked invalid and the message "unclosed group" appears under it
  And the Search button is disabled and Enter does not start a search

Scenario: SEARCH-004.7 The pattern is checked with the engine that will run it
  Given Regex is on, the scope is Current File and the active tab is a normal text tab containing "foobar foobaz"
  When I type the look-ahead pattern "foo(?=bar)" and search
  Then the box is not marked invalid
  And one result is found, the "foo" of "foobar"
  And the same holds for Open Files, and for a backreference such as "(\w)\1"
  When I switch the scope to Folder, or the current file is a large-file tab
  Then the box is marked invalid with the folder-search engine's message
  And the Search button is disabled

Scenario: SEARCH-004.8 Empty search
  Given the search box is empty
  When I look at the panel
  Then the Search button is disabled

Scenario: SEARCH-004.9 Whole Word around a pattern that starts or ends with a non-word character
  Given a file containing "x -2 y a-2 -2b"
  When I search for "-2" with Match Whole Word on
  Then only the "-2" between spaces is found
  And Replace All replaces exactly that one match, in any scope, and the preview shows it

Scenario: SEARCH-004.10 A multi-line plain-text search finds Windows line ends
  Given the scope is Folder, Regex is off, and one file has "foo" and "bar" on consecutive lines with CRLF line ends and another with LF
  When I type "foo", press Ctrl+Enter, type "bar" and search
  Then both files are listed, each at the line where "foo" is
  And Replace All replaces the two lines in both files and keeps each file's line ends elsewhere
  And with Regex on, "foo\nbar" finds only the LF file ("foo\r?\nbar" finds both)
```

## SEARCH-005: Filter which files are searched

- Status: verified
- Commands: none
- Files:
  - `src/components/panels/SearchPanel.tsx` — Filters button and badge (`activeFilterCount`), include / exclude boxes, "Use .gitignore", "Max" field, `showFilters`
  - `src-tauri/src/search.rs` — `walker` (include / exclude overrides, `.git` / `node_modules` / `target` skipped unless an include is given, hidden files searched, links not followed, gitignore switches), `build_searcher` (binary detection)
  - `src/lib/store.ts` — `DEFAULT_SEARCH_QUERY` (`respectGitignore: true`, `maxResults: 20000`), `search.showFilters`
- Tests: `src/__tests__/replace.test.ts`
- Docs: `docs/find-and-replace.md`

**As a** developer searching a project
**I want** to include or exclude files by pattern and to skip ignored and generated files
**So that** results are not buried in build output and dependencies

```gherkin
Scenario: SEARCH-005.1 Include patterns
  Given the Folder scope and the Filters section open
  When I type "*.ts, src/**" in "Include" and search
  Then only files matching one of those patterns are searched

Scenario: SEARCH-005.2 Exclude patterns
  Given the Folder scope
  When I type "*.min.js, dist/**" in "Exclude" and search
  Then no result comes from a ".min.js" file or from "dist"

Scenario: SEARCH-005.3 .gitignore is respected by default
  Given the folder's .gitignore lists "build/" and "Use .gitignore" is checked
  When I search the folder
  Then files under "build" are not searched
  When I uncheck "Use .gitignore" and search again
  Then files under "build" are searched

Scenario: SEARCH-005.4 Noise folders are always skipped without an include pattern
  Given "Use .gitignore" is unchecked and Include is empty
  When I search the folder
  Then nothing under ".git", "node_modules" or "target" is searched
  When I set Include to "node_modules/**" and search again
  Then files under "node_modules" are searched

Scenario: SEARCH-005.5 Hidden files, links and binary files
  Given the folder holds a hidden file ".env", a symbolic link to another folder and a binary file with a NUL byte
  When I search the folder
  Then ".env" is searched
  And the link is not followed
  And the binary file is not searched past its first NUL byte

Scenario: SEARCH-005.6 A bad glob is reported
  Given Include contains "{a"
  When I search the folder
  Then the status line shows an error naming the bad include glob
  And no results are listed

Scenario: SEARCH-005.7 The Filters button counts what is set
  Given the Folder scope with default filters
  When I set an Include pattern and uncheck "Use .gitignore"
  Then the Filters button shows the badge "2"
  And changing "Max" or checking "Dot matches newline" each add one

Scenario: SEARCH-005.8 File filters do not apply to Current File and Open Files
  Given the scope is Open Files
  When I open Filters
  Then the note "Include / exclude patterns and .gitignore apply when searching a folder." replaces those controls
  And "Dot matches newline" and "Max" are still offered
  And stored include / exclude patterns are not counted in the badge
```

## SEARCH-006: Streamed results, cancelling and limits

- Status: verified
- Commands: none
- Files:
  - `src/components/panels/SearchPanel.tsx` — `run()`, `cancel()`, `onResults` / `onDone` / `onError` listeners (stale `searchId` ignored), `status`, "Max" field (1 to 1,000,000)
  - `src/lib/ipc.ts` — `search.start`, `search.cancel`, `onResults`, `onDone`, `onError`
  - `src-tauri/src/lib.rs` — `search_start`, `search_cancel`, `AppState.searches`
  - `src-tauri/src/search.rs` — `search_paths`, `Batcher`, `should_flush` (`BATCH_MAX` 200, `BATCH_INTERVAL` 100 ms), `CollectSink` (`max_results`, `BLOCK_MATCH_CAP` 1,000 per line, UTF-16 columns, legacy encodings), `SearchDone`
- Tests: `src-tauri/src/search.rs`
- Docs: `docs/find-and-replace.md`

**As a** person searching a large folder
**I want** results to appear while the search runs, and to stop or cap it
**So that** the editor stays usable and I am not flooded

```gherkin
Scenario: SEARCH-006.1 Results stream in
  Given a folder where a search takes several seconds
  When I click Search
  Then the status reads "Searching… N found" with N growing, under a progress bar
  And results appear grouped by file before the search ends
  And the Search button is replaced by "Cancel"

Scenario: SEARCH-006.2 Finished
  Given a search that finds 12 matches in 3 of 40 files
  When it ends
  Then the status reads "12 results in 3 files"

Scenario: SEARCH-006.3 Nothing found
  Given a search of 40 files with no match
  When it ends
  Then the status reads "No results in 40 files"

Scenario: SEARCH-006.4 Cancel
  Given a search is running
  When I click "Cancel"
  Then the search stops and the results found so far stay listed
  And the status ends with "(cancelled, stopped after N files)", or reads "Cancelled after N files" when nothing was found

Scenario: SEARCH-006.5 The result limit
  Given "Max" is 20000 (the default) and the folder has more matches
  When the search ends
  Then 20,000 results are listed and the status ends with "(limit reached)"

Scenario: SEARCH-006.6 Changing the limit
  Given the Filters section is open
  When I type 5000000 in "Max"
  Then the limit becomes 1,000,000
  And a value below 1 is not accepted

Scenario: SEARCH-006.7 A new search replaces a running one
  Given a search for "foo" is still running
  When I search for "bar"
  Then the "foo" search is cancelled and its results are cleared
  And results that still arrive from the "foo" search are not shown

Scenario: SEARCH-006.8 A single huge file streams too
  Given one file with 1,000 matching lines
  When I search it
  Then its results arrive in several batches of at most 200

Scenario: SEARCH-006.9 Positions are right in files that are not UTF-8 or contain wide characters
  Given a file with the line "😀 é needle"
  When I search for "needle" and open the result
  Then exactly "needle" is selected in the editor

Scenario: SEARCH-006.10 A search error is shown
  Given the search cannot start because of a bad pattern or glob
  When I click Search
  Then the error is shown in the status line in the danger colour
  And the Search button is available again

Scenario: SEARCH-006.11 At most 1,000 results of one line
  Given a folder search and a minified file whose first line has 1,500 matches and whose second line has 10
  When the search ends
  Then 1,010 results are listed for the file: the first 1,000 of line 1 and all 10 of line 2
  And the status counts 1,010 results and does not say "(limit reached)"
```

## SEARCH-007: Browse the results list

- Status: verified
- Commands: none
- Files:
  - `src/components/panels/SearchPanel.tsx` — results tree, `previewBefore`, `relativeDir`, `budgetRows` (`ROW_BUDGET` 1500, `MAX_SHOWN` 500 per file), `visibleKeys`, `onListKeyDown`, `focusItem`, `toggleCollapse`
  - `src-tauri/src/search.rs` — `FileMatch` preview (starts up to 40 bytes before the match, at most 400 bytes, `preview_cut`)
  - `src/lib/store.ts` — `search.files`, `search.collapsed`, `search.activeKey`
- Tests: `src/__tests__/search-budget.test.ts`, `src/__tests__/ui.test.ts`, `src/__tests__/paths.test.ts`
- Docs: `docs/find-and-replace.md`

**As a** person reading search results
**I want** a compact list grouped by file that I can walk with the keyboard
**So that** I can scan many matches quickly

```gherkin
Scenario: SEARCH-007.1 Results are grouped by file
  Given a folder search found 2 matches in "C:\work\Quarry\src\lib\a.ts"
  When I look at the results
  Then a file row shows "a.ts", the folder "src\lib" relative to the open folder, and the count 2
  And under it each result shows its line number and the line's text with the match highlighted

Scenario: SEARCH-007.2 The match is always in view
  Given a match preceded on its line by "the quick brown fox jumps over "
  When I look at its row
  Then the row starts with "…fox jumps over " followed by the highlighted match and the rest of the line
  And a match after only indentation is shown from the line's first word without "…"

Scenario: SEARCH-007.3 Collapse and expand a file
  Given a file row with 5 results under it
  When I click the file row, or press Left on it
  Then its results are hidden
  When I press Right on it
  Then they are shown again
  And pressing Right again moves to its first result

Scenario: SEARCH-007.4 Arrow keys preview results
  Given focus is in the search box and there are results
  When I press Down
  Then focus moves to the first row of the list
  When I press Down again
  Then the next result is opened in the editor and focus stays in the list
  And Home, End, Page Up and Page Down move the same way (15 rows per page)

Scenario: SEARCH-007.5 Left on a result goes to its file row
  Given a result row has focus
  When I press Left
  Then focus moves to that result's file row

Scenario: SEARCH-007.6 At most 500 results of one file are listed
  Given one file with 800 matches
  When I look at its results
  Then 500 are listed, followed by "… 300 more in this file"
  And Replace All still replaces all 800, and its confirmation says the 300 that are not listed will be replaced too

Scenario: SEARCH-007.7 Long result lists are shown in parts
  Given a search found 1 match in each of 5,000 files
  When the results are shown
  Then about 1,500 rows are rendered
  And a button "Show more results (N more files)" adds more
  And moving past the last rendered row with the keyboard also adds more

Scenario: SEARCH-007.8 An empty match
  Given Regex is on and the pattern matches an empty string
  When I look at a result
  Then the match is shown as "∅"
```

## SEARCH-008: Open a result in the editor

- Status: verified
- Commands: none
- Files:
  - `src/components/panels/SearchPanel.tsx` — `openMatch`, `locateMatch`, `stale` set, `ranQuery`, `resultSel`, `keyOf`
  - `src/editor/resultHighlight.ts` — `resultHighlight` extension, `setResultQuery`, `resultQuery` (visible range only, selected match marked)
  - `src/editor/manager.ts` — `setResultHighlight`, `clearResultHighlights`, `goTo` (centres the line, `GOTO_CONTEXT` sideways scrolling)
  - `src/lib/actions.ts` — `openPath(path, { line, col })`
  - `src/lib/bus.ts` — `big.goto` for results in large-file tabs
  - `src/App.tsx` — Escape in the editor clears the result highlighting
- Tests: `src/__tests__/text.test.ts`
- Docs: `docs/find-and-replace.md`

**As a** person who found something
**I want** to open a result with the match selected and every match in that file highlighted
**So that** I land exactly on the text and see its neighbours

```gherkin
Scenario: SEARCH-008.1 Click opens the file at the match
  Given a result at line 120 of a file that is not open
  When I click the result
  Then the file opens in a tab, the match is selected and scrolled into view
  And keyboard focus is in the editor
  And the result row is marked as the active one

Scenario: SEARCH-008.2 A result in an open document uses its tab
  Given the result's file is already open in another tab
  When I press Enter on the result
  Then that tab becomes active with the match selected

Scenario: SEARCH-008.3 Every match in the document is highlighted
  Given a search for "needle" and a document containing it 4 times
  When I open one of its results
  Then all 4 are highlighted like find bar matches, the selected one in the stronger colour
  And the highlighting stays while I open other results

Scenario: SEARCH-008.4 Highlighting is cleared
  Given a document shows Find in Files highlighting
  When I press Escape in the editor, open the find bar, click "Clear results" or run a new search
  Then the highlighting is removed

Scenario: SEARCH-008.5 A match that moved is found nearby and marked stale
  Given a result at line 3, and 2 lines were inserted above it since the search
  When I open the result
  Then the match is selected at line 5
  And the result row is shown as stale with the tooltip ending "text has changed since the search"

Scenario: SEARCH-008.6 A match that is gone
  Given the matched text was deleted, or moved more than 5 lines away
  When I open the result
  Then the cursor goes to the start of the result's original line
  And the result row is shown as stale

Scenario: SEARCH-008.7 A result in a large-file tab
  Given a result in a file that is open as a large-file tab
  When I open the result
  Then that tab becomes active and scrolls to the result's line

Scenario: SEARCH-008.8 Space previews without leaving the list
  Given a result row has focus
  When I press Space
  Then the result is shown in the editor and focus stays on the row
```

## SEARCH-009: Step through results with F4

- Status: verified
- Commands: `find.nextResult`, `find.prevResult`
- Files:
  - `src/lib/commands.ts` — `stepResult` (`find.nextResult` / `find.prevResult`, enabled only with results, shows the Search panel first)
  - `src/components/panels/SearchPanel.tsx` — `search.step` handler, `allMatches`, `activeIndex`, result-position label and ↑ / ↓ buttons
  - `src/lib/bus.ts` — `search.step` event
- Tests: none
- Docs: `docs/find-and-replace.md`, `docs/keyboard-shortcuts.md`

**As a** person working through a list of matches
**I want** to go to the next or previous result from anywhere
**So that** I can fix each one without going back to the panel

```gherkin
Scenario: SEARCH-009.1 F4 opens the next result
  Given 12 results and the third one is active
  When I press F4 with focus in the editor
  Then the fourth result opens with focus in the editor
  And the panel shows "4 of 12" next to the ↑ / ↓ buttons

Scenario: SEARCH-009.2 Shift+F4 goes back and wraps
  Given 12 results and the first one is active
  When I press Shift+F4
  Then the twelfth result opens

Scenario: SEARCH-009.3 The first step
  Given 12 results and none has been opened
  When I press F4
  Then the first result opens

Scenario: SEARCH-009.4 A collapsed file is expanded
  Given the next result is in a file whose results are collapsed
  When I press F4
  Then that file is expanded and the result opens

Scenario: SEARCH-009.5 The panel is shown
  Given there are results and the Search panel is hidden
  When I press F4
  Then the Search panel is shown and the next result opens

Scenario: SEARCH-009.6 No results
  Given there are no search results
  When I open the Find menu
  Then "Next Search Result" and "Previous Search Result" are disabled
  And F4 does nothing

Scenario: SEARCH-009.7 Results beyond the first 500 of a file are skipped
  Given one file with 800 matches
  When I step with F4
  Then stepping covers that file's first 500 results and the position reads "… of 500"
  And the other 300 cannot be stepped to, though Replace All replaces them (SEARCH-012.12)
```

## SEARCH-010: Leave results out

- Status: verified
- Commands: none
- Files:
  - `src/components/panels/SearchPanel.tsx` — `leaveOut`, `leaveOutPatch`, × buttons (`results-dismiss`), Delete key, status "left out"
  - `src/lib/store.ts` — `search.excluded` (`line:col` per file), `search.leftOut`
- Tests: `src/__tests__/replace.test.ts`
- Docs: `docs/find-and-replace.md`

**As a** person reviewing matches before a replace
**I want** to remove the results I do not want from the list
**So that** Replace All changes only what I approved

```gherkin
Scenario: SEARCH-010.1 Leave one result out
  Given 12 results in 3 files
  When I press Delete on a result, or click the × that appears on it
  Then the result leaves the list and focus moves to the next row
  And the status reads "11 results in 3 files · 1 left out"

Scenario: SEARCH-010.2 Leave a whole file out
  Given a file row with 4 results
  When I press Delete on the file row, or click its ×
  Then the file and its 4 results leave the list
  And the left-out count grows by 4

Scenario: SEARCH-010.3 The last result of a file
  Given a file with 1 result
  When I leave that result out
  Then the file row is removed too

Scenario: SEARCH-010.4 Everything left out
  Given 2 results
  When I leave both out
  Then the status reads "All 2 results left out"
  And Replace All is disabled

Scenario: SEARCH-010.5 Not while searching
  Given a search is running
  When I look at the result rows
  Then no × is offered and Delete leaves nothing out

Scenario: SEARCH-010.6 Searching again brings everything back
  Given 2 results were left out
  When I run the search again
  Then all results are listed and nothing is counted as left out

Scenario: SEARCH-010.7 The × explains what it does
  Given the replace box is shown
  When I hover the × of a result
  Then its tooltip reads "Leave out of Replace All (Delete)"
  And with the replace box hidden it reads "Dismiss (Delete)"
```

## SEARCH-011: File actions on result file rows

- Status: verified
- Commands: none
- Files:
  - `src/components/panels/SearchPanel.tsx` — `selFiles`, `fileAnchor`, `fileMenu`, `onDeleted` + `deletedPatch` (deleted files leave the results, with their left-out results and the current result)
  - `src/components/FileMenu.tsx` — the shared file menu (specified with the Explorer)
  - `src/lib/fileOps.ts` — the actions behind the menu
  - `src/components/panels/ExplorerPanel.tsx` — `rangeOf`, `toggleIn` selection helpers reused here
- Tests: `src/__tests__/replace.test.ts`
- Docs: `docs/find-and-replace.md`

**As a** person looking at the files a search found
**I want** the Explorer's file menu on a result's file row
**So that** I can copy, delete or reveal those files without finding them in the tree

```gherkin
Scenario: SEARCH-011.1 Right-click a file row
  Given results for the file "a.ts"
  When I right-click its file row
  Then the file menu opens for "a.ts"
  And Paste would put files into the folder that contains "a.ts"

Scenario: SEARCH-011.2 Several files
  Given results for "a.ts", "b.ts" and "c.ts"
  When I click "a.ts", Shift+click "c.ts" and right-click one of them
  Then all three rows are shown selected and the menu acts on all three
  And Ctrl+click adds or removes a single file row from the selection

Scenario: SEARCH-011.3 Right-click outside the selection
  Given "a.ts" and "b.ts" are selected
  When I right-click the file row of "c.ts"
  Then the selection is dropped and the menu acts on "c.ts" only

Scenario: SEARCH-011.4 A deleted file leaves the results
  Given 12 results in 3 files, 3 of them in "a.ts"
  When I choose Delete from its menu and confirm
  Then "a.ts" is removed from the list and the status reads "9 results in 2 files"

Scenario: SEARCH-011.5 The Delete key never deletes a file
  Given a file row has focus
  When I press Delete
  Then the file is only left out of the results and stays on disk

Scenario: SEARCH-011.6 A plain click still collapses
  Given two file rows are selected
  When I click a file row without Ctrl or Shift
  Then the selection is cleared and that file's results collapse or expand

Scenario: SEARCH-011.7 Results left out of a deleted file are forgotten
  Given 12 results in 3 files, and I left out 2 results of "a.ts" and 1 of "b.ts"
  And the current result (F4) is in "a.ts"
  When I delete "a.ts" from its menu
  Then the status ends with "· 1 left out"
  And the Replace All dialog mentions 1 left-out result
  And F4 starts again from the first result
```

## SEARCH-012: Replace in Files on disk

- Status: verified
- Commands: none
- Files:
  - `src/components/panels/SearchPanel.tsx` — `replaceAllInResults` (targets, dirty-tab skip, confirmation, `searchedAt`, `replaceNote`, `fileErrors`), `unlistedNote` (matches replaced but not listed: past 500 of a file, past Max, past the per-line cap), `previewReplacement`, Replace All button
  - `src/lib/dialogs.ts` — `choose()` confirmation
  - `src/lib/ipc.ts` — `search.replaceInFiles`
  - `src/lib/replaceUndo.ts` — `reloadOpenDocs` (clean open tabs show the new contents), `undoEntriesOf`
  - `src-tauri/src/lib.rs` — `replace_in_files` command
  - `src-tauri/src/search.rs` — `replace_in_files`, `ReplaceTarget` (`skip`, `searched_ms`), `replace_text`, `write_atomic`, `REPLACE_MAX_BYTES` (256 MB); `SearchDone.capped_paths` (files with a line at `BLOCK_MATCH_CAP`)
- Tests: `src-tauri/src/search.rs`, `src/__tests__/replace.test.ts`, `src/__tests__/search-budget.test.ts`
- Docs: `docs/find-and-replace.md`

**As a** developer renaming something across a project
**I want** to replace every reviewed match in the files on disk after one confirmation
**So that** a project-wide change is quick and never destroys unsaved or unexpected work

```gherkin
Scenario: SEARCH-012.1 Results preview the change
  Given a folder search for "foo" and the replace box contains "bar"
  When I look at a result
  Then the match "foo" is struck through and followed by "bar"

Scenario: SEARCH-012.2 Replace All asks first
  Given 12 results in 3 files from a folder search
  When I click "Replace All in results"
  Then a dialog asks "Replace 12 occurrences in 3 files?"
  And it says the files on disk will be rewritten and that Find › Undo Replace in Files restores them
  When I choose "Cancel"
  Then no file is changed

Scenario: SEARCH-012.3 Replace
  Given the confirmation for 12 occurrences in 3 files
  When I choose "Replace"
  Then the 3 files are rewritten with "bar" in place of "foo"
  And the status reads "Replaced 12 occurrence(s) in 3 file(s)" with an "Undo" link
  And the replaced result rows are shown as stale
  And open, unmodified tabs of those files show the new text and stay unmodified

Scenario: SEARCH-012.4 Files open with unsaved changes are skipped
  Given one of the 3 files is open in a tab with unsaved changes
  When I click "Replace All in results"
  Then the dialog counts only the other 2 files and lists the skipped file with its number of matches
  And after replacing, the status includes "skipped 1 unsaved" and that file is unchanged on disk and in the editor

Scenario: SEARCH-012.5 Every file is unsaved
  Given all matching files are open with unsaved changes
  When I click "Replace All in results"
  Then a warning says "All matching files are open with unsaved changes; save them first."
  And no dialog appears

Scenario: SEARCH-012.6 Left-out results are not changed
  Given I left 2 of the results out
  When I click "Replace All in results"
  Then the dialog says "2 results you left out will not be changed."
  And after replacing, those 2 places still contain "foo", also when other matches in the same file were replaced

Scenario: SEARCH-012.7 A file changed since the search is left alone
  Given a matching file was modified by another program after the search ran
  When I replace all
  Then that file is not changed
  And "Replace failed: changed since the search; file left unchanged (search again)" is shown under its file row
  And the status includes "1 failed"

Scenario: SEARCH-012.8 The replace uses the search that produced the results
  Given results for "foo" and I then changed the search box to "food" without searching
  When I click "Replace All in results"
  Then the dialog says it uses the search for "foo" that produced these results
  And only "foo" matches are replaced

Scenario: SEARCH-012.9 Files over 256 MB are refused
  Given a matching file of 300 MB
  When I replace all
  Then that file is unchanged
  And the message under it says it is too large for Replace in Files and to open the file and use Replace All

Scenario: SEARCH-012.10 Replace All is unavailable without results or while searching
  Given there are no results, or a search is running
  When I look at the replace row
  Then the "Replace All in results" button is disabled

Scenario: SEARCH-012.11 Enter in the replace box searches
  Given the replace box has focus
  When I press Enter
  Then the search runs and nothing is replaced

Scenario: SEARCH-012.12 The confirmation counts matches that are not listed
  Given a folder search listed 800 matches in one file, of which 500 are shown
  When I click "Replace All in results"
  Then the dialog asks "Replace 800 occurrences in 1 file?"
  And it says "300 of them are not listed (only the first 500 results of a file are) and will be replaced too."

Scenario: SEARCH-012.13 The confirmation says when more may be replaced
  Given a folder search stopped at "Max" 20,000, or a line of a matching file had more than 1,000 matches
  When I click "Replace All in results"
  Then the dialog says "More matches that are not listed may also be replaced:" followed by "the search stopped at Max (20,000)" or "a line in 1 file has more than 1,000 matches"
  And choosing "Replace" replaces every match in the listed files, including those
```

## SEARCH-013: Replace in Files keeps each file's encoding

- Status: verified
- Commands: none
- Files:
  - `src-tauri/src/search.rs` — `replace_in_files` (decode with `detect_encoding`, strict decode, `encode_text`, `encode_error`), `file_encoding` / `utf16_len` (previews and columns of non-UTF-8 files)
  - `src-tauri/src/files.rs` — `detect_encoding`, `encode_text`, `UNMAPPABLE_PREFIX`
  - `src/components/panels/SearchPanel.tsx` — per-file "Replace failed: …" rows
- Tests: `src-tauri/src/search.rs`
- Docs: `docs/find-and-replace.md`

**As a** person maintaining files in older encodings
**I want** Replace in Files to write each file back in the encoding it had
**So that** a replace never corrupts characters or changes a file's BOM

```gherkin
Scenario: SEARCH-013.1 Encoding and BOM are kept
  Given matching files in UTF-8, UTF-8 with BOM, UTF-16 LE with BOM and Windows-1252 (containing "é")
  When I replace "foo" with "bar" in all of them
  Then each file is still in its original encoding, with its BOM if it had one
  And "é" in the Windows-1252 file is still the single byte it was

Scenario: SEARCH-013.2 A replacement the encoding cannot store
  Given a Windows-1252 file with a match and the replacement "中"
  When I replace all
  Then that file is left unchanged
  And the message under its file row names the encoding, the character "中" and the line, ending "file left unchanged"

Scenario: SEARCH-013.3 A file that does not decode cleanly
  Given a matching file whose bytes are not valid text in its detected encoding
  When I replace all
  Then that file is left unchanged
  And the message under it says it is not valid text in that encoding

Scenario: SEARCH-013.4 Other files still succeed
  Given 3 matching files of which 1 cannot be written
  When I replace all
  Then the other 2 are replaced
  And the status reads "Replaced … in 2 file(s); 1 failed" as a warning

Scenario: SEARCH-013.5 Files are written atomically
  Given a matching file
  When it is replaced
  Then the new contents are written to a temporary file in the same folder and moved over the original
```

## SEARCH-014: Replacement text: groups and Preserve Case

- Status: verified
- Commands: none
- Files:
  - `src-tauri/src/search.rs` — `parse_replacement`, `expand_replacement`, `preserve_case`, `replace_text` (literal when Regex is off)
  - `src/lib/replace.ts` — `expandReplacement`, `preserveCase`, `replaceMatches` (the open-document path; must stay in step with search.rs)
  - `src/components/panels/SearchPanel.tsx` — `previewReplacement`, Preserve Case toggle (`query.preserveCase`)
- Tests: `src-tauri/src/search.rs`, `src/__tests__/replace.test.ts`
- Docs: `docs/find-and-replace.md`

**As a** person doing a pattern-based rename across files
**I want** capture groups and case-preserving replacements that behave the same in the preview, on disk and in open documents
**So that** what I reviewed is what gets written

```gherkin
Scenario: SEARCH-014.1 Groups in regex mode
  Given Regex is on, the search is "(\w+)=(\w+)" and the replacement is "$2=$1"
  When I replace a match "a=b"
  Then it becomes "b=a"
  And the result row previewed "b=a" before the replace

Scenario: SEARCH-014.2 Special references
  Given Regex is on and a match "x" in the text "axb"
  When the replacement is "[$&]", "$$" or "$<name>" for a named group
  Then "$&" gives the whole match, "$$" a single "$" and "$<name>" the named group's text

Scenario: SEARCH-014.3 References to groups that do not exist
  Given Regex is on and the pattern has 1 group
  When the replacement is "$12" and then "$9"
  Then "$12" gives group 1 followed by "2"
  And "$9" stays as the text "$9"
  And "${name}" (the Rust regex crate's form) stays as the text "${name}"

Scenario: SEARCH-014.4 Plain-text mode is literal
  Given Regex is off and the replacement is "$1"
  When I replace all
  Then each match becomes the text "$1"

Scenario: SEARCH-014.5 Preserve Case
  Given files containing "foo", "Foo", "FOO" and "fOO" and the search "foo" without Match Case
  When I turn on "Preserve Case" in the replace box and replace all with "bar"
  Then they become "bar", "Bar", "BAR" and "bar"
  And the result rows previewed those texts

Scenario: SEARCH-014.6 Preserve Case can be changed after the search
  Given results for "foo" listed with Preserve Case off
  When I turn Preserve Case on and click "Replace All in results"
  Then the replace preserves case without searching again
```

## SEARCH-015: Replace in the open documents

- Status: verified
- Commands: none
- Files:
  - `src/components/panels/SearchPanel.tsx` — `replaceAllInResults` (`st.inMemory` branch, `editedSince`, count of what was replaced, exact count beyond Max for `unlistedNote`), `searchedText` (each document's text as the search read it, from `searchOpenDocs`), `buildJsRegex`
  - `src/editor/manager.ts` — `editor.docOf(docId)`
  - `src/lib/replace.ts` — `replaceMatches` (`skip` set of `line:col`), `expandReplacement`, `preserveCase`
  - `src/editor/manager.ts` — `editor.replaceAll(docId, text)` (one undoable change per document)
- Tests: `src/__tests__/replace.test.ts`, `src/__tests__/search-budget.test.ts`
- Docs: `docs/find-and-replace.md`

**As a** person with several files open
**I want** Replace All for the Current File and Open Files scopes to edit the documents in the editor
**So that** I can undo it per document and decide when to save

```gherkin
Scenario: SEARCH-015.1 Open documents are edited, not files
  Given an Open Files search found 5 matches in 2 documents
  When I click "Replace All in results"
  Then the dialog asks "Replace 5 occurrences in 2 files?" and says the changes are applied to the open documents and can be undone per file
  When I choose "Replace"
  Then both documents are changed in the editor and marked as modified
  And the files on disk are unchanged until I save
  And the status reads "Replaced 5 occurrence(s) in 2 open document(s)" without an Undo link

Scenario: SEARCH-015.2 Undo per document
  Given the replace changed 3 matches in a document
  When I press Ctrl+Z in that document
  Then all 3 are restored in one step
  And the other document keeps its replacements

Scenario: SEARCH-015.3 Unsaved documents are not skipped
  Given a document with unsaved changes has matches in an Open Files search
  When I replace all
  Then its matches are replaced like any other document's

Scenario: SEARCH-015.4 Left-out results are kept
  Given I left out the match at line 4 of a document
  When I replace all
  Then line 4 still has the original text and the other matches are replaced

Scenario: SEARCH-015.5 Results become stale
  Given the replace has finished
  When I look at the result list
  Then every result of a document it changed is shown as stale

Scenario: SEARCH-015.6 A document edited since the search is left alone
  Given an Open Files search found 3 matches in "a.txt" and 2 in "b.txt"
  And I have typed in "b.txt" since the search
  When I click "Replace All in results"
  Then the dialog asks "Replace 3 occurrences in 1 file?" and lists "b.txt (2)" under "Skipped (edited since the search)"
  When I choose "Replace"
  Then only "a.txt" is changed
  And the status reads "Replaced 3 occurrence(s) in 1 open document(s)"
  When every matching document was edited since the search
  Then nothing is replaced and a warning says to search again

Scenario: SEARCH-015.7 The status counts what was replaced
  Given "Max" is 4 and an Open Files search listed 4 of the 6 matches in one document
  When I replace all
  Then all 6 matches in the document are replaced, as Replace in Files does on disk
  And the status reads "Replaced 6 occurrence(s) in 1 open document(s)"

Scenario: SEARCH-015.8 The confirmation counts the matches beyond Max
  Given "Max" is 4 and an Open Files search listed 4 of the 6 matches in one document
  When I click "Replace All in results"
  Then the dialog asks "Replace 4 occurrences in 1 file?"
  And it says "2 more matches that are not listed (past Max, 4) will also be replaced."
```

## SEARCH-016: Undo Replace in Files

- Status: verified
- Commands: `find.undoReplaceInFiles`
- Files:
  - `src/lib/replaceUndo.ts` — `undoReplaceInFiles` (confirmation, restore, reload, toast), `undoEntriesOf`, `reloadOpenDocs`
  - `src/lib/commands.ts` — `find.undoReplaceInFiles` (enabled only while `replaceUndo` is set)
  - `src/components/panels/SearchPanel.tsx` — "Undo" link in the status line, `replaceUndo` record, "can't be undone (no backup)" note
  - `src/lib/store.ts` — `replaceUndo`
  - `src/lib/ipc.ts` — `search.undoReplaceInFiles`
  - `src-tauri/src/lib.rs` — `replace_in_files` (empties the backup folder first), `undo_dir` (cleared at startup), `undo_replace_in_files`
  - `src-tauri/src/search.rs` — backups in `replace_in_files` (`UNDO_BUDGET_BYTES` 1 GiB, `digest`), `undo_replace`
- Tests: `src/__tests__/replace-undo.test.ts`, `src-tauri/src/search.rs`
- Docs: `docs/find-and-replace.md`

**As a** person who just ran Replace in Files
**I want** to put the changed files back exactly as they were
**So that** a wrong project-wide replace is not a disaster

```gherkin
Scenario: SEARCH-016.1 Undo restores the files
  Given a Replace in Files of "foo" with "bar" changed 3 files
  When I click "Undo" in the Search panel's status line, or choose Find › Undo Replace in Files
  Then a dialog "Undo Replace in Files?" says it restores 3 files to their contents before "foo → bar"
  When I choose "Restore"
  Then the 3 files are byte for byte what they were before the replace
  And open, unmodified tabs of those files show the restored text
  And a message says "Restored 3 files"

Scenario: SEARCH-016.2 Cancel keeps the replace
  Given the "Undo Replace in Files?" dialog is open
  When I choose "Cancel"
  Then no file is changed and the undo is still available

Scenario: SEARCH-016.3 A file edited since the replace is not restored
  Given one of the 3 replaced files was changed again afterwards
  When I undo the replace
  Then the other 2 files are restored
  And a warning says "Restored 2 files; 1 not restored" and names the file with "changed since the replace; not restored"

Scenario: SEARCH-016.4 Only the most recent replace, and only once
  Given I undid the last Replace in Files, or none has run since Quarry started
  When I open the Find menu
  Then "Undo Replace in Files" is disabled

Scenario: SEARCH-016.5 A new replace discards the previous backups
  Given a Replace in Files that can be undone
  When I run another Replace in Files
  Then only the second one can be undone

Scenario: SEARCH-016.6 Backups do not survive a restart
  Given a Replace in Files that can be undone
  When I restart Quarry
  Then "Undo Replace in Files" is disabled

Scenario: SEARCH-016.7 Files beyond the backup budget
  Given a replace whose original files total more than 1 GiB
  When the replace finishes
  Then every matching file is replaced
  And the status says how many "can't be undone (no backup)"
  And undo restores only the files that were backed up

Scenario: SEARCH-016.8 Replacing in open documents offers no file undo
  Given a Replace All with the Open Files scope
  When it finishes
  Then "Undo Replace in Files" is not enabled by it
```
