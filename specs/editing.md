---
area: Text Editing
prefix: EDIT
---

# Text Editing

Editing text in a normal (not large-file) tab: undo, clipboard, multi-cursor and column mode, line and text commands, folding, the fold line's right-click menu, Go to Line, languages and highlighting, and the view toggles that act on the editor. User documentation: `docs/editing.md` and `docs/keyboard-shortcuts.md`.

## EDIT-001: Undo and redo

- Status: draft
- Commands: `edit.undo`, `edit.redo`, `edit.redoAlt`
- Files:
  - `src/lib/commands.ts` — `edit.undo` / `edit.redo` / `edit.redoAlt`, `cmCommand` (routes to `editor.historyView`), `editorFocused` shortcut guard, large-file tabs get `big.undo` / `big.redo` on the bus
  - `src/editor/manager.ts` — per-document `EditorState` kept across tab switches (`show`, `states`), `historyView`, `Mod-z` / `Mod-y` / `Mod-Shift-z` keymap
  - `src/editor/cmSetup.ts` — `history()` and `historyKeymap` in `baseExtensions`
  - `src/components/MenuBar.tsx` — Edit › Undo / Redo
- Tests: none
- Docs: `docs/keyboard-shortcuts.md`

**As a** person editing a text file
**I want** to undo and redo my changes, per document
**So that** a mistake never costs me more than a keystroke

```gherkin
Scenario: EDIT-001.1 Undo and redo an edit
  Given a text tab containing "hello"
  And I typed " world" at the end
  When I press Ctrl+Z
  Then the document contains "hello"
  When I press Ctrl+Y
  Then the document contains "hello world"

Scenario: EDIT-001.2 Ctrl+Shift+Z also redoes
  Given I have just undone an edit in a text tab
  When I press Ctrl+Shift+Z
  Then the edit is applied again

Scenario: EDIT-001.3 History survives switching tabs
  Given I edited tab "a.txt" and then switched to tab "b.txt"
  When I switch back to "a.txt" and press Ctrl+Z
  Then the last edit to "a.txt" is undone
  And "b.txt" is unchanged

Scenario: EDIT-001.4 The shortcut is left to text boxes
  Given the find bar's search box has the keyboard
  When I press Ctrl+Z
  Then the search box undoes its own typing
  And the document is unchanged

Scenario: EDIT-001.5 Not available without a file tab
  Given the active tab is a Compare tab
  When I open the Edit menu
  Then Undo and Redo are greyed out
```

## EDIT-002: Cut, copy and paste

- Status: draft
- Commands: `edit.cut`, `edit.copy`, `edit.paste`
- Files:
  - `src/editor/lineMenu.ts` — `clipboardText` (selections, or whole lines of empty ones), `cutSpec`, `pasteSpec` (one clipboard line per cursor when the counts match)
  - `src/lib/commands.ts` — `edit.cut` / `edit.copy` / `edit.paste` (Tauri clipboard plugin, read-only guard); Ctrl+X / C / V themselves are CodeMirror's own handling
  - `src/components/EditorMenu.tsx` — Cut / Copy / Paste items, disabled for read-only documents
  - `src/components/MenuBar.tsx` — Edit › Cut / Copy / Paste (shortcut text given in the item, Cut / Paste disabled for read-only documents)
- Tests: `src/__tests__/lineMenu.test.ts`
- Docs: `docs/editing.md`, `docs/keyboard-shortcuts.md`

**As a** person editing a text file
**I want** Cut, Copy and Paste to work on the selection, or on the whole line when nothing is selected
**So that** I can move text around quickly with the keyboard or the right-click menu

```gherkin
Scenario: EDIT-002.1 Copy a selection
  Given the text "alpha beta" with "beta" selected
  When I run "Edit: Copy" from the command palette
  Then the clipboard contains "beta"
  And the document is unchanged

Scenario: EDIT-002.2 Copy with nothing selected takes the whole line
  Given a document with the lines "one", "two", "three" and the cursor on "two"
  When I run "Edit: Copy"
  Then the clipboard contains the line "two" followed by a line break

Scenario: EDIT-002.3 Cut with nothing selected removes the line
  Given a document with the lines "one", "two", "three" and the cursor on "two"
  When I run "Edit: Cut"
  Then the clipboard contains the line "two" followed by a line break
  And the document contains the lines "one", "three"

Scenario: EDIT-002.4 Paste gives each cursor its own line when the counts match
  Given 3 cursors on 3 different lines
  And the clipboard contains the 3 lines "a", "b", "c"
  When I run "Edit: Paste"
  Then "a" is inserted at the first cursor, "b" at the second and "c" at the third

Scenario: EDIT-002.5 Paste the whole text at every cursor otherwise
  Given 2 cursors
  And the clipboard contains the 3 lines "a", "b", "c"
  When I run "Edit: Paste"
  Then all 3 lines are inserted at each of the 2 cursors

Scenario: EDIT-002.6 A read-only document is not changed
  Given a file that opened read-only
  When I right-click a line that starts a foldable region
  Then Cut and Paste are disabled in the menu
  And Copy is available

Scenario: EDIT-002.7 Cut, Copy and Paste in the Edit menu
  Given a text tab with "beta" selected
  When I open the Edit menu
  Then it lists Cut, Copy and Paste with the shortcuts Ctrl+X, Ctrl+C and Ctrl+V
  When I choose Copy
  Then the clipboard contains "beta"
  And for a read-only document Cut and Paste are greyed out there
```

## EDIT-003: Select all, and select occurrences of the selection

- Status: draft
- Commands: `edit.selectAll`, `edit.selectNextOccurrence`, `edit.selectAllOccurrences`
- Files:
  - `src/lib/commands.ts` — `edit.selectAll` (only while the editor has focus), `edit.selectNextOccurrence` (CodeMirror `selectNextOccurrence`), `edit.selectAllOccurrences` and its limit toast
  - `src/editor/bulkEdit.ts` — `occurrenceSelection`, `MAX_OCCURRENCES` (200 000)
  - `src/editor/manager.ts` — `publishCursor` (selection count and selected characters for the status bar)
  - `src/components/StatusBar.tsx` — "(N selected, M ranges)" / "(M cursors)" after Ln / Col
  - `src/components/MenuBar.tsx` — Selection menu
- Tests: `src/__tests__/bulkedit.test.ts`
- Docs: `docs/editing.md`

**As a** developer renaming something in one file
**I want** to select the next, or every, occurrence of the selected text
**So that** I can edit all of them at once

```gherkin
Scenario: EDIT-003.1 Add the next occurrence
  Given the text "foo bar foo baz foo" with the first "foo" selected
  When I press Ctrl+D
  Then the first and second "foo" are selected
  And the status bar shows "2 ranges"

Scenario: EDIT-003.2 Select every occurrence
  Given the text "foo bar foo baz foo" with the first "foo" selected
  When I press Ctrl+Shift+L
  Then all 3 "foo" are selected
  And typing "qux" turns the text into "qux bar qux baz qux"

Scenario: EDIT-003.3 The word at the cursor is used when nothing is selected
  Given the text "foo bar foo" with the cursor inside the first "foo" and nothing selected
  When I press Ctrl+Shift+L
  Then both "foo" are selected

Scenario: EDIT-003.4 Matching is case-sensitive
  Given the text "Foo foo FOO" with "foo" selected
  When I press Ctrl+Shift+L
  Then only the one "foo" is selected

Scenario: EDIT-003.5 More than 1 000 occurrences are selected
  Given a document with 100 000 lines that each contain "ERROR", and one "ERROR" selected
  When I press Ctrl+Shift+L
  Then 100 000 ranges are selected

Scenario: EDIT-003.6 The selection stops at 200 000 occurrences
  Given a document with 250 000 occurrences of the selected text
  When I press Ctrl+Shift+L
  Then the first 200 000 occurrences are selected
  And a warning says "Selected the first 200,000 occurrences."

Scenario: EDIT-003.7 Select All leaves text boxes alone
  Given the find bar's search box has the keyboard
  When I press Ctrl+A
  Then the text in the search box is selected
  And the document's selection is unchanged
```

## EDIT-004: Turn every find match into a selection

- Status: draft
- Commands: `edit.selectAllMatches`
- Files:
  - `src/editor/bulkEdit.ts` — `findMatchSelection`, `selectAllFindMatches`
  - `src/lib/commands.ts` — `edit.selectAllMatches` (closes the find bar on success)
- Tests: `src/__tests__/bulkedit.test.ts`
- Docs: `docs/editing.md`

**As a** person who has just searched a document
**I want** to turn all the find bar's matches into selections
**So that** I can edit every match at once, including regex matches

```gherkin
Scenario: EDIT-004.1 Select every match of the find bar's query
  Given the find bar is open with the regex "\d+" and the document has 4 matches
  When I press Alt+Enter
  Then the 4 matches are selected
  And the find bar closes so typing goes to the selections

Scenario: EDIT-004.2 Nothing to select
  Given the find bar's query has no match in the document
  When I press Alt+Enter
  Then the selection is unchanged
  And the find bar stays open

Scenario: EDIT-004.3 The selection stops at 200 000 matches
  Given the find bar's query has 250 000 matches
  When I press Alt+Enter
  Then the first 200 000 matches are selected
  And a warning says "Selected the first 200,000 matches."
```

## EDIT-005: Add cursors above and below

- Status: draft
- Commands: `selection.addCursorAbove`, `selection.addCursorBelow`, `selection.blockToCursors`
- Files:
  - `src/editor/columnMode.ts` — `blockCommands` (`addCursorBelow` / `addCursorAbove` = `extend(±1, 0)`), `blockSelection` (visual columns, short rows), `blockToCursors`
  - `src/lib/commands.ts` — the three `selection.*` registrations
  - `src/editor/cmSetup.ts` — `allowMultipleSelections`, `rectangularSelection` (Alt+drag) via `columnModeExtensions(false)`, `crosshairCursor`, Esc (`simplifySelection` in `defaultKeymap`)
  - `src/components/MenuBar.tsx` — Selection › Add Cursor Above / Below, Split Block Selection into Cursors
- Tests: none
- Docs: `docs/editing.md`

**As a** person editing several lines the same way
**I want** to add cursors on neighbouring lines and edit them together
**So that** I don't repeat the same edit line by line

```gherkin
Scenario: EDIT-005.1 Add a cursor below at the same column
  Given 3 lines of 10 characters and the cursor on line 1 at column 5
  When I press Ctrl+Alt+Down twice
  Then there are 3 cursors, on lines 1 to 3, all at column 5
  And typing "x" inserts "x" on each of the 3 lines

Scenario: EDIT-005.2 A line too short gets its cursor at its end
  Given line 1 is "abcdefghij", line 2 is "ab", and the cursor is on line 1 after "abcdefgh"
  When I press Ctrl+Alt+Down
  Then line 2 has a cursor after "ab"

Scenario: EDIT-005.3 Columns are visual, so tabs count as their width
  Given tab size 4, line 1 is "abcdefgh" with the cursor after "abcd", and line 2 starts with one tab followed by "xyz"
  When I press Ctrl+Alt+Down
  Then line 2 has its cursor just after the tab

Scenario: EDIT-005.4 Alt+drag selects a rectangle
  Given column mode is off
  When I drag with Alt held from line 1 column 3 to line 4 column 8
  Then lines 1 to 4 each have columns 3 to 8 selected

Scenario: EDIT-005.5 Split a block selection into cursors
  Given a rectangular selection over 4 lines
  When I press Alt+Shift+I
  Then each of the 4 lines has one cursor, where its selection ended, and nothing is selected

Scenario: EDIT-005.6 Escape goes back to one cursor
  Given 5 cursors
  When I press Esc
  Then only the main cursor remains
```

## EDIT-006: Column (block) selection mode

- Status: draft
- Commands: `selection.toggleColumnMode`
- Files:
  - `src/editor/columnMode.ts` — `columnModeExtensions`, `columnKeymap` (Shift+arrows, Home / End, Page Up / Down by 20 rows), `extend`, `extendHome`, `extendEnd`, `currentBlock`, `blockSelection`, `columnModeEnabled` / `setColumnMode`
  - `src/lib/commands.ts` — `selection.toggleColumnMode` (store `columnMode`, toast)
  - `src/editor/manager.ts` — `applyColumnMode` (both panes), `columnModeEffects`, re-applied in `show` when a tab is swapped in
  - `src/editor/cmSetup.ts` — `compartments.columnMode`
  - `src/lib/store.ts` — `columnMode` (starts false, not saved in the session)
  - `src/components/StatusBar.tsx` — Column / COLUMN button
  - `src/styles/app.css` — `.cm-editor.column-mode .cm-cursor`
- Tests: none
- Docs: `docs/editing.md`

**As a** person working with column-aligned text
**I want** a mode where every drag and Shift+arrow selects a rectangle
**So that** I can edit a column of text without holding Alt

```gherkin
Scenario: EDIT-006.1 Turn column mode on
  Given a text tab with column mode off
  When I press Alt+Shift+C
  Then a notice says "Column mode ON — drag or Shift+arrows select a block. Typing edits every row."
  And the status bar button reads "COLUMN" in the accent colour

Scenario: EDIT-006.2 A plain drag selects a rectangle
  Given column mode is on
  When I drag from line 2 column 4 to line 6 column 9 without holding Alt
  Then lines 2 to 6 each have columns 4 to 9 selected

Scenario: EDIT-006.3 Shift+arrows grow the block
  Given column mode is on and the cursor is on line 1 at column 0
  When I press Shift+Down 3 times and Shift+Right twice
  Then lines 1 to 4 each have their first 2 columns selected

Scenario: EDIT-006.4 Typing edits every row
  Given column mode is on and a block covers columns 0 to 2 of lines 1 to 4
  When I type "#"
  Then each of the 4 lines has its first 2 characters replaced by "#"

Scenario: EDIT-006.5 Shift+End reaches the longest line of the block
  Given column mode is on and a block over 3 lines whose lengths are 5, 12 and 8
  When I press Shift+End
  Then the block extends to column 12
  And the 5 and 8 character lines are selected up to their own ends

Scenario: EDIT-006.6 Shift+Page Down moves 20 rows
  Given column mode is on and the cursor is on line 1 of a 100-line document
  When I press Shift+Page Down
  Then the block covers lines 1 to 21

Scenario: EDIT-006.7 One switch for every tab
  Given column mode is on in tab "a.txt"
  When I switch to tab "b.txt"
  Then column mode is on there too
  When I press Alt+Shift+C
  Then a notice says "Column mode off" and the status bar button reads "Column"

Scenario: EDIT-006.8 Off when Quarry starts
  Given column mode was on when I closed Quarry
  When I start Quarry again
  Then column mode is off
```

## EDIT-007: Huge multi-cursor selections stay responsive

- Status: draft
- Commands: none
- Files:
  - `src/editor/bulkEdit.ts` — `bulkEditing` (input handler and Backspace / Delete keys from `BULK_MIN` = 500 ranges), `bulkReplace`, `deletionSpans`
  - `src/editor/viewportSelection.ts` — `viewportDrawSelection`, `rangesInWindow` (only ranges in the rendered viewport are measured and drawn)
  - `src/editor/cmSetup.ts` — both installed in `baseExtensions`
- Tests: `src/__tests__/bulkedit.test.ts`
- Docs: none

**As a** person editing a column across a very long file
**I want** typing and deleting with hundreds of thousands of cursors to stay instant
**So that** column edits and Select All Occurrences are usable on big documents

```gherkin
Scenario: EDIT-007.1 Type at 200 000 cursors
  Given a 200 000-line document with a cursor at the start of every line
  When I type "x"
  Then every line starts with "x"
  And each cursor sits just after its "x"
  And the edit takes well under a second

Scenario: EDIT-007.2 Backspace removes one character per cursor, never the same one twice
  Given 500 or more cursors, two of them next to each other on the same character boundary
  When I press Backspace
  Then each cursor removes at most the one character before it
  And no character is removed twice

Scenario: EDIT-007.3 Whole characters are removed
  Given 500 or more cursors, each just after an emoji made of several code units
  When I press Backspace
  Then each whole emoji is removed

Scenario: EDIT-007.4 One undo step
  Given I typed "x" at 20 000 cursors
  When I press Ctrl+Z
  Then all 20 000 insertions are undone together

Scenario: EDIT-007.5 Fewer than 500 cursors behave as before
  Given 10 cursors
  When I type "("
  Then each cursor gets "()" as with a single cursor, when "Auto-close brackets and quotes" is on

Scenario: EDIT-007.6 Cursors appear as they scroll into view
  Given 100 000 selected ranges, most of them outside the window
  When I scroll down
  Then the selections and cursors of the lines that come into view are drawn
```

## EDIT-008: Duplicate, delete and move lines

- Status: draft
- Commands: `edit.duplicateLine`, `edit.duplicateLineUp`, `edit.deleteLine`, `edit.moveLineUp`, `edit.moveLineDown`
- Files:
  - `src/lib/commands.ts` — registrations over CodeMirror's `copyLineDown` / `copyLineUp` / `deleteLine` / `moveLineUp` / `moveLineDown`; `applyDefaultEnabled` (text tabs only)
  - `src/components/MenuBar.tsx` — Edit › Line submenu
- Tests: none
- Docs: `docs/editing.md`, `docs/keyboard-shortcuts.md`

**As a** person editing a text file
**I want** to duplicate, delete and move whole lines with one key
**So that** I can rearrange text without selecting and pasting

```gherkin
Scenario: EDIT-008.1 Duplicate the current line
  Given the lines "one", "two" and the cursor on "one"
  When I press Ctrl+Shift+D
  Then the lines are "one", "one", "two"

Scenario: EDIT-008.2 Delete the current line
  Given the lines "one", "two", "three" and the cursor on "two"
  When I press Ctrl+Shift+K
  Then the lines are "one", "three"

Scenario: EDIT-008.3 Move the selected lines
  Given the lines "one", "two", "three", "four" with "two" and "three" selected
  When I press Alt+Up
  Then the lines are "two", "three", "one", "four"
  When I press Alt+Down
  Then the lines are "one", "two", "three", "four"

Scenario: EDIT-008.4 Greyed out outside text tabs
  Given the active tab is a large-file tab
  When I open Edit › Line
  Then every item in it is greyed out
```

## EDIT-009: Sort, reverse, de-duplicate, clean up, join and number lines

- Status: draft
- Commands: `code.sortAsc`, `code.sortDesc`, `code.reverseLines`, `code.dedupe`, `code.removeBlank`, `code.removeEmpty`, `code.trimTrailing`, `code.joinLines`, `edit.numberLines`
- Files:
  - `src/lib/commands.ts` — `lineTransform` (`cmEdit`: nothing on a read-only document) and the nine registrations after it
  - `src/lib/lineTransforms.ts` — the line functions (`Intl.Collator` with `numeric` and `sensitivity: "base"`) and `lineTransformSpec` (whole document but the empty line after a final line break when the selection is empty, otherwise the lines each selection touches, without a last line it reaches only at column 0; selections on the same or adjacent lines merge into one block, other blocks are transformed separately; one transaction, `input.transform`)
  - `src/components/MenuBar.tsx` — Edit › Lines submenu
- Tests: `src/__tests__/lineTransforms.test.ts`
- Docs: `docs/editing.md`

**As a** person cleaning up a list or a log excerpt
**I want** commands that sort, reverse, de-duplicate, strip, join and number lines
**So that** I don't need an external tool or a script for routine clean-up

```gherkin
Scenario: EDIT-009.1 Sort in natural order, ignoring case
  Given the lines "file10", "File2", "file1" and nothing selected
  When I choose Edit › Lines › Sort Lines Ascending
  Then the lines are "file1", "File2", "file10"

Scenario: EDIT-009.2 Only the selected lines are changed
  Given the lines "d", "c", "b", "a" with a selection from inside "c" to inside "b"
  When I choose Sort Lines Ascending
  Then the lines are "d", "b", "c", "a"
  And the two changed lines are selected

Scenario: EDIT-009.3 Sort descending and reverse
  Given the lines "a", "c", "b" and nothing selected
  When I choose Sort Lines Descending
  Then the lines are "c", "b", "a"
  When I choose Reverse Lines
  Then the lines are "a", "b", "c"

Scenario: EDIT-009.4 Remove duplicates keeps the first of each
  Given the lines "a", "b", "a", "A", "b"
  When I choose Remove Duplicate Lines
  Then the lines are "a", "b", "A"
  And on 200,000 lines, most of them different, it finishes in well under a second

Scenario: EDIT-009.5 Blank versus empty lines
  Given the lines "a", "", "   ", "b"
  When I choose Delete Empty Lines
  Then the lines are "a", "   ", "b"
  When I choose Delete Blank Lines
  Then the lines are "a", "b"

Scenario: EDIT-009.6 Trim trailing whitespace
  Given a line "value" followed by 2 spaces and a tab
  When I choose Trim Trailing Whitespace
  Then the line is "value"
  And leading whitespace on other lines is unchanged

Scenario: EDIT-009.7 Join lines
  Given the lines "  one", "", "two  ", "three"
  When I choose Join Lines
  Then the document is the single line "one two three"

Scenario: EDIT-009.8 Number lines
  Given 12 lines and nothing selected
  When I choose Number Lines
  Then line 1 starts with " 1  " and line 12 starts with "12  "

Scenario: EDIT-009.9 One undo step, and none when nothing changes
  Given lines that are already sorted
  When I choose Sort Lines Ascending
  Then the document is not marked as changed
  And after a sort that does change the text, one Ctrl+Z restores the previous order

Scenario: EDIT-009.10 A read-only document is not changed
  Given a file that opened read-only, with the lines "b" and "a"
  When I choose Sort Lines Ascending
  Then the lines are still "b", "a"

Scenario: EDIT-009.11 A final line break stays at the end
  Given the lines "c", "a", "b" followed by a line break, and nothing selected
  When I choose Sort Lines Ascending
  Then the document is "a", "b", "c" followed by a line break
  And Number Lines on that document numbers 3 lines, not 4

Scenario: EDIT-009.12 A line the selection only reaches at its start is left out
  Given the lines "c", "b", "a" selected from the start of "c" to the start of "a"
  When I choose Sort Lines Ascending
  Then the lines are "b", "c", "a"

Scenario: EDIT-009.13 Every selection is transformed, each on its own
  Given the lines "c", "b", "m", "z", "y" with "c" to "b" selected and "z" to "y" selected
  When I choose Sort Lines Ascending
  Then the lines are "b", "c", "m", "y", "z"
  And both blocks are still selected

Scenario: EDIT-009.14 A column selection is sorted as one block
  Given a column selection over the first character of the lines "c1", "b2", "a3"
  When I choose Sort Lines Ascending
  Then the lines are "a3", "b2", "c1"
```

## EDIT-010: Change case and wrap selections in quotes

- Status: draft
- Commands: `edit.upper`, `edit.lower`, `code.titleCase`, `edit.quoteSelections`
- Files:
  - `src/lib/commands.ts` — the four registrations (`cmEdit`: nothing on a read-only document; `changeByRange` over every selection; `edit.quoteSelections` uses `JSON.stringify` and its own `enabled`)
  - `src/lib/lineTransforms.ts` — `titleCase` (Unicode letters, an apostrophe inside a word does not start a new word, other letters unchanged)
  - `src/components/MenuBar.tsx` — Edit › Transform submenu
- Tests: `src/__tests__/lineTransforms.test.ts`
- Docs: `docs/editing.md`

**As a** person editing a text file
**I want** to change the case of the selected text or wrap it in quotes
**So that** I can fix capitalisation and build string literals without retyping

```gherkin
Scenario: EDIT-010.1 Uppercase and lowercase
  Given the text "Hello World" with "Hello" selected
  When I choose Edit › Transform › Transform to Uppercase
  Then the text is "HELLO World" and "HELLO" is still selected
  When I choose Transform to Lowercase
  Then the text is "hello World"

Scenario: EDIT-010.2 Title case capitalises the first letter of each word
  Given the text "the quick fox" fully selected
  When I choose Transform to Title Case
  Then the text is "The Quick Fox"
  And "don't stop" becomes "Don't Stop", and "élan" becomes "Élan"
  And "HTML parser" becomes "HTML Parser": letters after the first are left as they are

Scenario: EDIT-010.3 Every selection is transformed
  Given 3 selections on 3 lines
  When I choose Transform to Uppercase
  Then the text of all 3 selections is uppercase

Scenario: EDIT-010.4 Nothing selected, nothing changed
  Given a cursor with nothing selected
  When I choose Transform to Uppercase
  Then the document is unchanged

Scenario: EDIT-010.5 Wrap selections in quotes, escaping as JSON does
  Given the text say "hi" with all of it selected
  When I choose Wrap Selections in Quotes
  Then the text is "say \"hi\"" including the outer double quotes
  And the quoted text is selected

Scenario: EDIT-010.6 Wrap in Quotes needs a selection
  Given a cursor with nothing selected
  When I open Edit › Transform
  Then Wrap Selections in Quotes is greyed out

Scenario: EDIT-010.7 A read-only document is not changed
  Given a file that opened read-only with "hello" selected
  When I choose Transform to Uppercase, Transform to Title Case or Wrap Selections in Quotes
  Then the text is still "hello"
```

## EDIT-011: Indent, outdent and convert indentation

- Status: draft
- Commands: `edit.indent`, `edit.outdent`, `code.indentToSpaces`, `code.indentToTabs`, `view.setTabSize`
- Files:
  - `src/lib/commands.ts` — `edit.indent` / `edit.outdent` (`indentMore` / `indentLess`, only while the editor has focus), `code.indentToSpaces` / `code.indentToTabs` (via `lineTransform`; `cmEdit` = nothing on a read-only document), `view.setTabSize` (1–16, otherwise opens the status-bar picker)
  - `src/lib/lineTransforms.ts` — `indentToSpaces` / `indentToTabs` (the whole leading run of spaces and tabs, rewritten at the same width; the rest of the line untouched)
  - `src/editor/cmSetup.ts` — `compartments.indent` (`tabSize`, `indentUnit` from `insertSpaces`), `indentOnInput`, `indentWithTab`, `defaultKeymap` (Ctrl+[ / Ctrl+])
  - `src/editor/manager.ts` — `applySettings`
  - `src/components/StatusBar.tsx` — "Spaces: 4" / "Tab Size: 4" picker (2, 4, 8)
  - `src/components/MenuBar.tsx` — Edit › Indent / Outdent, Code › Indentation
- Tests: `src/__tests__/lineTransforms.test.ts`
- Docs: `docs/editing.md`, `docs/keyboard-shortcuts.md`

**As a** developer
**I want** to indent and outdent lines and switch a file between tabs and spaces
**So that** the file's indentation matches the project's style

```gherkin
Scenario: EDIT-011.1 Tab indents the selected lines
  Given Tab size 4 and Insert spaces on, and 3 lines selected
  When I press Tab
  Then each of the 3 lines starts with 4 more spaces
  When I press Shift+Tab
  Then the 4 spaces are removed again

Scenario: EDIT-011.2 Tab characters when Insert spaces is off
  Given Insert spaces is off and the cursor on a line
  When I press Tab
  Then the line is indented by one tab character

Scenario: EDIT-011.3 Tab in a text box is not an indent
  Given the find bar's search box has the keyboard
  When I press Tab
  Then the document is unchanged

Scenario: EDIT-011.4 Convert leading tabs to spaces
  Given Tab size 4 and a line that starts with 2 tabs followed by "x" and another tab
  When I choose Code › Indentation › Indentation: Convert to Spaces
  Then the line starts with 8 spaces
  And the tab after "x" is unchanged

Scenario: EDIT-011.5 Convert leading spaces to tabs
  Given Tab size 4 and a line that starts with 6 spaces
  When I choose Code › Indentation › Indentation: Convert to Tabs
  Then the line starts with 1 tab followed by 2 spaces

Scenario: EDIT-011.6 Change the tab size from the status bar
  Given the status bar shows "Spaces: 4"
  When I click it and pick "2"
  Then the status bar shows "Spaces: 2"
  And tab characters in every open tab are drawn 2 columns wide
  And the setting is kept for the next start

Scenario: EDIT-011.7 Mixed indentation is converted as a whole
  Given Tab size 4 and a line that starts with a tab followed by 4 spaces
  When I choose Indentation: Convert to Tabs
  Then the line starts with 2 tabs
  And Indentation: Convert to Spaces on a line starting with a tab, 2 spaces and a tab gives 8 spaces
```

## EDIT-012: Toggle line and block comments

- Status: draft
- Commands: `edit.toggleComment`, `code.toggleBlockComment`
- Files:
  - `src/lib/commands.ts` — `withCommentSyntax` (explains a no-op), `edit.toggleComment`, `code.toggleBlockComment`
  - `src/components/MenuBar.tsx` — Code › Toggle Line Comment / Toggle Block Comment
- Tests: none
- Docs: `docs/editing.md`

**As a** developer
**I want** to comment and uncomment code with a shortcut, in the syntax of the file's language
**So that** I can disable code quickly

```gherkin
Scenario: EDIT-012.1 Toggle a line comment
  Given a JavaScript tab with the cursor on the line "let a = 1;"
  When I press Ctrl+/
  Then the line is "// let a = 1;"
  When I press Ctrl+/ again
  Then the line is "let a = 1;"

Scenario: EDIT-012.2 Toggle a block comment
  Given a JavaScript tab with "a + b" selected
  When I press Shift+Alt+A
  Then the selection is wrapped in "/*" and "*/"

Scenario: EDIT-012.3 The language decides the comment syntax
  Given a Python tab with 3 lines selected
  When I press Ctrl+/
  Then each of the 3 lines starts with "# "

Scenario: EDIT-012.4 A language without comments says so
  Given a Plain Text tab
  When I press Ctrl+/
  Then the document is unchanged
  And a notice says "No comment syntax for Plain Text"
```

## EDIT-013: Fold and unfold regions

- Status: draft
- Commands: `code.fold`, `code.unfold`, `code.foldAll`, `code.unfoldAll`
- Files:
  - `src/lib/commands.ts` — the four registrations over CodeMirror's `foldCode` / `unfoldCode` / `foldAll` / `unfoldAll`
  - `src/editor/cmSetup.ts` — `foldGutter({ openText: "⌄", closedText: "›" })`, `foldKeymap`
  - `src/styles/app.css` — `.cm-foldGutter` (arrows show on gutter hover)
  - `src/components/MenuBar.tsx` — Code › Fold Region / Unfold Region / Fold All / Unfold All
- Tests: none
- Docs: `docs/editing.md`, `docs/keyboard-shortcuts.md`

**As a** person reading a long structured file
**I want** to collapse regions I'm not interested in
**So that** I can see the outline of the document

```gherkin
Scenario: EDIT-013.1 Fold the region at the cursor
  Given a JSON tab whose line 2 opens an object that closes on line 9, with the cursor on line 2
  When I press Ctrl+Shift+[
  Then lines 3 to 8 are hidden behind a fold marker on line 2
  When I press Ctrl+Shift+]
  Then lines 3 to 8 are visible again

Scenario: EDIT-013.2 Fold with the gutter arrow
  Given a line that starts a foldable region
  When I click the "⌄" arrow next to its line number
  Then the region is folded and the arrow becomes "›"

Scenario: EDIT-013.3 Fold All and Unfold All
  Given a document with several foldable regions
  When I choose Code › Fold All
  Then every region is folded
  When I choose Code › Unfold All
  Then no region is folded

Scenario: EDIT-013.4 Folding does not change the text
  Given a saved document with no unsaved changes
  When I fold a region
  Then the tab is not marked as changed
```

## EDIT-014: Right-click menu on a foldable line

- Status: draft
- Commands: `code.foldLine`, `code.unfoldLine`, `code.foldTree`, `code.unfoldTree`
- Files:
  - `src/components/CodeEditor.tsx` — `onContextMenu` (line under the pointer, in the text or the gutter; only when `foldTargetAt` finds something)
  - `src/components/EditorMenu.tsx` — the menu: Collapse or Expand, Collapse All, Expand All, Cut / Copy / Paste, Select All; arrow keys, Escape, closes on click elsewhere or window blur
  - `src/editor/lineMenu.ts` — `foldTargetAt`, `foldLineSpec`, `foldTreeSpec`
  - `src/lib/commands.ts` — `foldLine` helper and the four hidden `code.*Line` / `code.*Tree` commands (take `{ line }`)
- Tests: `src/__tests__/lineMenu.test.ts`
- Docs: `docs/editing.md`

**As a** person reading a deeply nested JSON or code file
**I want** to collapse or expand the region of the line I right-click, with or without everything inside it
**So that** I can fold exactly the part I point at without moving the cursor there

```gherkin
Scenario: EDIT-014.1 The menu opens on a line that starts a region
  Given a JSON tab whose line 3 opens an object
  When I right-click line 3, on its text or on its fold arrow
  Then a menu offers Collapse, Collapse All, Expand All, Cut, Copy, Paste and Select All

Scenario: EDIT-014.2 Other lines keep the usual menu
  Given a line that neither starts a foldable region nor holds a fold
  When I right-click it
  Then Quarry's fold menu does not open

Scenario: EDIT-014.3 Collapse the clicked line, not the cursor's
  Given the cursor is on line 20 and line 3 opens an object
  When I right-click line 3 and choose Collapse
  Then the object starting on line 3 is folded
  And right-clicking line 3 again offers Expand instead of Collapse

Scenario: EDIT-014.4 Collapse All folds the region and everything inside it only
  Given line 3 opens an object that contains 2 nested objects, and line 30 opens a sibling object
  When I right-click line 3 and choose Collapse All
  Then the object on line 3 and its 2 nested objects are folded
  And the sibling on line 30 and the levels above line 3 stay as they were

Scenario: EDIT-014.5 Children stay folded when only the parent is expanded
  Given I used Collapse All on line 3
  When I right-click line 3 and choose Expand
  Then the object on line 3 is open
  And its 2 nested objects are still folded

Scenario: EDIT-014.6 Expand All opens the region and everything inside it
  Given the object on line 3, its nested objects and the sibling on line 30 are folded
  When I right-click line 3 and choose Expand All
  Then the object on line 3 and its nested objects are open
  And the sibling on line 30 is still folded

Scenario: EDIT-014.7 Keyboard in the menu
  Given the fold menu is open
  When I press Down and then Esc
  Then the menu closes without doing anything
  And the keyboard is back in the editor
```

## EDIT-015: Brackets: matching, jumping and auto-closing

- Status: draft
- Commands: `code.gotoBracket`
- Files:
  - `src/lib/commands.ts` — `code.gotoBracket` (`cursorMatchingBracket`)
  - `src/editor/cmSetup.ts` — `compartments.brackets` (`bracketMatching`, setting `bracketMatching`), `compartments.closeBrackets` (`closeBrackets` + `closeBracketsKeymap`, setting `autoCloseBrackets`), `settingsReconfigure`
  - `src/styles/app.css` — `.cm-matchingBracket`
  - `src/components/MenuBar.tsx` — Go to Matching Bracket
- Tests: none
- Docs: `docs/editing.md`, `docs/settings.md`

**As a** developer
**I want** matching brackets highlighted, a key to jump between them, and closing brackets typed for me
**So that** I can keep nested code balanced

```gherkin
Scenario: EDIT-015.1 The matching bracket is highlighted
  Given "Bracket matching" is on in Settings
  When I put the cursor next to a "{"
  Then that "{" and its matching "}" are highlighted

Scenario: EDIT-015.2 Jump to the matching bracket
  Given the cursor is next to a "(" whose ")" is 40 lines below
  When I press Ctrl+Shift+\
  Then the cursor moves to the matching ")"

Scenario: EDIT-015.3 Brackets and quotes close themselves
  Given "Auto-close brackets and quotes" is on
  When I type "("
  Then the text is "()" with the cursor between the two

Scenario: EDIT-015.4 Both can be turned off
  Given "Bracket matching" and "Auto-close brackets and quotes" are off
  When I type "(" and move the cursor next to a "{"
  Then only "(" is inserted
  And no bracket is highlighted
```

## EDIT-016: Go to Line

- Status: draft
- Commands: `goto.line`
- Files:
  - `src/lib/commands.ts` — `goto.line` (opens palette mode `goto`; enabled for text and large-file tabs)
  - `src/components/CommandPalette.tsx` — `parseGoto` (`120`, `120:8`, `120,8`), live preview effect, `gotoOrigin` restored by `cancel`, `gotoHint`, out-of-range toast; a large-file tab gets `big.goto` instead
  - `src/editor/manager.ts` — `goTo` (clamps line and column, centres the line, `GOTO_CONTEXT` horizontal scroll)
  - `src/components/StatusBar.tsx` — "Ln, Col" button runs the command
- Tests: none
- Docs: `docs/editing.md`

**As a** person following a line number from an error message
**I want** to jump to a line, and optionally a column, with a preview as I type
**So that** I get to the right place without scrolling

```gherkin
Scenario: EDIT-016.1 Jump to a line
  Given a 500-line text tab
  When I press Ctrl+G, type "120" and press Enter
  Then the cursor is at line 120, column 1, with the line centred in the window
  And the editor has the keyboard

Scenario: EDIT-016.2 Line and column
  Given a 500-line text tab
  When I press Ctrl+G and type "120:8"
  Then the hint reads "Press Enter to jump to line 120, column 8. Escape restores the previous position."
  When I press Enter
  Then the cursor is at line 120, column 8

Scenario: EDIT-016.3 A comma also separates line and column
  Given a 500-line text tab
  When I press Ctrl+G, type "120,8" and press Enter
  Then the cursor is at line 120, column 8

Scenario: EDIT-016.4 The target is previewed while typing, and Escape puts everything back
  Given the cursor is at line 10 with 3 characters selected
  When I press Ctrl+G and type "300"
  Then the editor shows line 300
  When I press Esc
  Then the cursor is back at line 10 with the same 3 characters selected
  And the editor is scrolled where it was

Scenario: EDIT-016.5 A line past the end
  Given a 500-line text tab
  When I press Ctrl+G and type "999"
  Then the box is marked invalid and the hint reads "Line 999 is out of range (1–500). Enter jumps to the nearest line."
  When I press Enter
  Then the cursor is on line 500
  And a notice says "Line 999 is out of range; jumped to line 500."

Scenario: EDIT-016.6 A column past the end of the line
  Given line 5 is 10 characters long
  When I press Ctrl+G, type "5:99" and press Enter
  Then the cursor is at the end of line 5

Scenario: EDIT-016.7 Enter without a number does nothing
  Given the cursor is at line 10
  When I press Ctrl+G, type "abc" and press Enter
  Then the palette closes and the cursor is still at line 10

Scenario: EDIT-016.8 From the status bar
  Given a text tab
  When I click "Ln 10, Col 1" in the status bar
  Then the Go to Line box opens showing "Current: line 10 of 500. Type a line number and press Enter."
```

## EDIT-017: Detect a document's language

- Status: draft
- Commands: `code.detectLanguage`
- Files:
  - `src/editor/cmSetup.ts` — `detectLanguage` (extension, then `@codemirror/language-data` file name match, then `sniffLanguage`), `sniffLanguage`, `languageByName`
  - `src/editor/manager.ts` — `create` (detects from the name and the first 200 characters), `maybeSniffAfterInsert` (first insert of more than 40 characters into a near-empty untitled Plain Text tab), `setLanguage`, `languageOf`
  - `src/lib/commands.ts` — `code.detectLanguage` (first 400 characters; a saved file's extension still wins)
  - `src/components/MenuBar.tsx` — `languageMenu` (Auto-detect Language first)
- Tests: `src/__tests__/text.test.ts`
- Docs: `docs/editing.md`

**As a** person opening or pasting text
**I want** Quarry to work out which language it is
**So that** highlighting and the language's tools work without my setting anything

```gherkin
Scenario: EDIT-017.1 The file extension decides
  Given a file "notes.py" whose text starts with "{"
  When I open it
  Then the status bar shows the language "Python"

Scenario: EDIT-017.2 JSON-like extensions
  Given the files "a.jsonc", "b.json5", "c.har" and "d.webmanifest"
  When I open each of them
  Then each shows the language "JSON"

Scenario: EDIT-017.3 An unknown extension falls back to the content
  Given a file "data.xyz" whose text starts with "<?xml version="1.0"?>"
  When I open it
  Then the status bar shows the language "XML"

Scenario Outline: EDIT-017.4 Content recognised at the start of the text
  Given an untitled Plain Text tab containing <text>
  When I choose Code › Language › Auto-detect Language
  Then the language becomes <language>
  And a notice says "Language: <language>"

  Examples:
    | text                                    | language   |
    | {"a": 1}                                | JSON       |
    | [1, 2]                                  | JSON       |
    | <!DOCTYPE html><html>                   | HTML       |
    | #!/usr/bin/env python3                  | Python     |
    | use std::fs;                            | Rust       |
    | import x from 'y'; const a: string = '' | TypeScript |
    | const a = 1;                            | JavaScript |
    | #include <stdio.h>                      | C++        |
    | SELECT * FROM t                         | SQL        |
    | # Title                                 | Markdown   |
    | key: value                              | YAML       |

Scenario: EDIT-017.5 Prose stays Plain Text
  Given an untitled tab containing "just some prose"
  When I choose Auto-detect Language
  Then the language is "Plain Text"

Scenario: EDIT-017.6 Pasting into an empty untitled tab detects again
  Given a new, empty untitled tab with the language "Plain Text"
  When I paste a JSON document of 2 000 characters
  Then the language becomes "JSON" without my doing anything

Scenario: EDIT-017.7 Later typing never changes the language
  Given an untitled Plain Text tab that already holds 500 characters of prose
  When I paste a JSON document into it
  Then the language is still "Plain Text"

Scenario: EDIT-017.8 A short first insert is not enough
  Given a new, empty untitled tab
  When I paste the 8 characters {"a": 1}
  Then the language is still "Plain Text"
```

## EDIT-018: Change the language of a document

- Status: draft
- Commands: `code.setLanguage`
- Files:
  - `src/lib/commands.ts` — `code.setLanguage` (a name argument sets it; no argument opens palette mode `language`), chord key "Ctrl+K M"
  - `src/components/CommandPalette.tsx` — `language` mode over `allLanguageNames`, current language marked
  - `src/components/MenuBar.tsx` — `languageMenu`, `COMMON_LANGUAGES`, "All languages…"
  - `src/components/StatusBar.tsx` — language picker (runs `code.setLanguage` with the name)
  - `src/editor/manager.ts` — `setLanguage` (reconfigures `compartments.language`), `effectsTo`
  - `src/editor/cmSetup.ts` — `languageByName`, `allLanguageNames` ("Plain Text" first)
- Tests: none
- Docs: `docs/editing.md`

**As a** person whose file was given the wrong language
**I want** to pick the language myself
**So that** highlighting, comments and formatting use the right syntax

```gherkin
Scenario: EDIT-018.1 Pick a language with the keyboard
  Given a text tab with the language "Plain Text"
  When I press Ctrl+K, release, press M, type "pyth" and press Enter
  Then the status bar shows "Python"
  And the text is highlighted as Python

Scenario: EDIT-018.2 Pick from the Code menu
  Given a text tab with the language "JavaScript"
  When I open Code › Language
  Then "JavaScript" is marked with a bullet
  When I choose "TypeScript"
  Then the status bar shows "TypeScript"

Scenario: EDIT-018.3 Pick from the status bar
  Given a text tab
  When I click the language in the status bar and choose "Markdown"
  Then the status bar shows "Markdown"

Scenario: EDIT-018.4 Plain Text turns highlighting off
  Given a JSON tab
  When I set the language to "Plain Text"
  Then the text has no syntax colours

Scenario: EDIT-018.5 Changing the language does not change the file
  Given a saved file with no unsaved changes
  When I change its language
  Then the tab is not marked as changed

Scenario: EDIT-018.6 Only for text tabs
  Given the active tab is a large-file tab
  When I open the Code menu
  Then the languages in Code › Language are greyed out

Scenario: EDIT-018.7 A recorded macro replays a status-bar language change
  Given I am recording a macro
  When I click the language in the status bar and choose "Markdown"
  Then the macro has a Change Language Mode step for "Markdown"
  And playing the macro on another tab sets its language to "Markdown"
```

## EDIT-019: Syntax highlighting

- Status: draft
- Commands: none
- Files:
  - `src/editor/cmSetup.ts` — `highlight` (`HighlightStyle` mapping Lezer tags to `--syn-*` variables), `syntaxHighlighting`, `builtin` (JSON, JavaScript, TypeScript, JSX, TSX loaded directly), other languages loaded on demand from `@codemirror/language-data`
  - `src/editor/manager.ts` — `create` / `setLanguage` load the language support and put it in `compartments.language`
  - `src/styles/tokens.css` — `--syn-keyword`, `--syn-string`, … for light and `[data-theme="dark"]`
- Tests: none
- Docs: `docs/editing.md`

**As a** developer
**I want** code coloured by its syntax, in colours that follow the theme
**So that** I can read structure at a glance

```gherkin
Scenario: EDIT-019.1 A known language is coloured
  Given a file "main.rs"
  When I open it
  Then keywords, strings, numbers and comments each have their own colour
  And comments are in italics

Scenario: EDIT-019.2 Colours follow the theme
  Given a highlighted TypeScript tab in the light theme
  When I switch to the dark theme
  Then the syntax colours change to the dark theme's set without reopening the file

Scenario: EDIT-019.3 Plain Text has no colours
  Given a file "notes.txt" of prose
  When I open it
  Then all of its text is in the normal text colour
```

## EDIT-020: Word wrap and visible whitespace

- Status: draft
- Commands: `view.toggleWrap`, `view.toggleWhitespace`
- Files:
  - `src/lib/commands.ts` — `view.toggleWrap`, `view.toggleWhitespace` (update the setting, `editor.applySettings`, `persistSettings`); text tabs only via `applyDefaultEnabled`
  - `src/editor/cmSetup.ts` — `compartments.wrap` (`EditorView.lineWrapping`), `compartments.whitespace` (`highlightWhitespace` + `highlightTrailingWhitespace`), `settingsReconfigure`
  - `src/editor/manager.ts` — `applySettings` (open panes and stored states)
  - `src/styles/app.css` — `.cm-highlightSpace`
  - `src/components/MenuBar.tsx` — View › Toggle Word Wrap / Toggle Render Whitespace
- Tests: none
- Docs: `docs/keyboard-shortcuts.md`, `docs/settings.md`

**As a** person reading long lines or checking indentation
**I want** to switch word wrap and visible whitespace on and off from the keyboard
**So that** I can see the text the way the task needs

```gherkin
Scenario: EDIT-020.1 Toggle word wrap
  Given a text tab with a 400-character line and word wrap off
  When I press Alt+Z
  Then the line wraps at the edge of the editor and there is no horizontal scroll bar
  When I press Alt+Z again
  Then the line is on one row again

Scenario: EDIT-020.2 Show whitespace
  Given a line indented with a tab and ending in 2 spaces
  When I choose View › Toggle Render Whitespace
  Then the tab and the spaces are drawn with visible marks
  And the trailing spaces are highlighted

Scenario: EDIT-020.3 Applies to every tab and is remembered
  Given 3 open text tabs
  When I turn word wrap on in one of them
  Then the other 2 wrap as well
  And "Word wrap" is on in Settings after Quarry restarts

Scenario: EDIT-020.4 Not available without a text tab
  Given no tab is open
  When I open the View menu
  Then Toggle Word Wrap and Toggle Render Whitespace are greyed out
```

## EDIT-021: Zoom the editor text

- Status: draft
- Commands: `view.zoomIn`, `view.zoomInPlus`, `view.zoomOut`, `view.zoomReset`
- Files:
  - `src/lib/commands.ts` — the four registrations (font size ±1 between 8 and 40, reset to 14, `persistSettings`)
  - `src/editor/cmSetup.ts` — `fontTheme` in `compartments.fontTheme`
  - `src/editor/manager.ts` — `applySettings`
  - `src/components/MenuBar.tsx` — View › Zoom In / Zoom Out / Reset Zoom
- Tests: none
- Docs: `docs/editing.md`, `docs/keyboard-shortcuts.md`

**As a** person presenting or reading on a small screen
**I want** to make the editor text bigger or smaller with a shortcut
**So that** it's comfortable to read

```gherkin
Scenario: EDIT-021.1 Zoom in and out
  Given the font size is 14
  When I press Ctrl+=
  Then the editor text is drawn at 15 px
  When I press Ctrl+- twice
  Then the editor text is drawn at 13 px

Scenario: EDIT-021.2 Reset
  Given the font size is 22
  When I press Ctrl+0
  Then the font size is 14

Scenario: EDIT-021.3 Limits
  Given the font size is 40
  When I press Ctrl+=
  Then the font size stays 40
  And with the font size at 8, Ctrl+- leaves it at 8

Scenario: EDIT-021.4 The zoom is the Font size setting
  Given the font size is 14
  When I press Ctrl+= 3 times
  Then Settings shows "Font size" 17
  And the size is still 17 after Quarry restarts
```

## EDIT-022: Let Tab leave the editor

- Status: draft
- Commands: `view.toggleTabFocus`
- Files:
  - `src/lib/commands.ts` — `view.toggleTabFocus` (store `tabMovesFocus`, `view.setTabFocusMode` on the focused pane's view, toast)
  - `src/App.tsx` — global key handler: Tab in the editor is left to the browser while `tabMovesFocus` is on or within 2 s of Escape (`tabEscapeUntil`)
  - `src/lib/store.ts` — `tabMovesFocus` (starts false)
  - `src/components/StatusBar.tsx` — "Tab moves focus" button
  - `src/components/MenuBar.tsx` — View › Toggle Tab Key Moves Focus
- Tests: none
- Docs: `docs/editing.md`

**As a** keyboard or screen-reader user
**I want** a way to make Tab move focus out of the editor instead of indenting
**So that** the editor is never a keyboard trap

```gherkin
Scenario: EDIT-022.1 Turn it on
  Given the editor has the keyboard
  When I press Ctrl+M
  Then a notice says "Tab moves focus. Press Ctrl+M again to indent with Tab."
  And the status bar shows "Tab moves focus"
  When I press Tab
  Then focus moves to the next control and the document is unchanged

Scenario: EDIT-022.2 Turn it off
  Given "Tab moves focus" is on
  When I click "Tab moves focus" in the status bar
  Then a notice says "Tab indents again"
  And Tab indents the line again

Scenario: EDIT-022.3 Escape then Tab leaves once
  Given "Tab moves focus" is off and the editor has the keyboard
  When I press Esc and then Tab within 2 seconds
  Then focus moves out of the editor and the document is unchanged
  And the next Tab pressed in the editor indents

Scenario: EDIT-022.4 Any other key cancels Escape then Tab
  Given the editor has the keyboard
  When I press Esc, then type "a", then press Tab
  Then the line is indented
```

## EDIT-023: Line numbers, active line and selection-match highlighting

- Status: draft
- Commands: none
- Files:
  - `src/editor/cmSetup.ts` — `compartments.lineNumbers` (`lineNumbers` + `highlightActiveLineGutter`), `compartments.activeLine` (`highlightActiveLine`), `highlightSelectionMatches({ minSelectionLength: 2 })`, `highlightSpecialChars`, `dropCursor`, `settingsReconfigure`
  - `src/editor/manager.ts` — `applySettings`
  - `src/components/panels/SettingsPanel.tsx` — "Line numbers" and "Highlight active line" switches
- Tests: none
- Docs: `docs/settings.md`

**As a** person editing a text file
**I want** line numbers, a highlighted current line and the other occurrences of what I selected marked
**So that** I can keep my place and spot repeated text

```gherkin
Scenario: EDIT-023.1 Line numbers can be hidden
  Given "Line numbers" is on in Settings
  When I turn it off
  Then the number column disappears from every open text tab
  And the fold arrows are still there

Scenario: EDIT-023.2 The current line is highlighted
  Given "Highlight active line" is on
  When I move the cursor to line 7
  Then line 7 has the active-line background and its number is in the normal text colour

Scenario: EDIT-023.3 Other occurrences of the selection are marked
  Given the text "count = count + 1"
  When I select the first "count"
  Then the second "count" is highlighted as a match

Scenario: EDIT-023.4 A one-character selection marks nothing
  Given the text "a b a"
  When I select the first "a"
  Then the other "a" is not highlighted
```
