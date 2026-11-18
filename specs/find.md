---
area: Find and Replace in a Document
prefix: FIND
---

# Find and Replace in a Document

The find bar over a text document: finding, stepping through matches, the match options, Find in Selection, Replace / Replace All, Preserve Case, the find and replace history, and the commands that turn matches or occurrences into multiple cursors. User documentation: `docs/find-and-replace.md` (section "Find in the current file"). Large-file tabs have their own find bar (see the large-file specs); Find in Files is `specs/search.md`.

## FIND-001: Open and close the find bar

- Status: verified
- Commands: `find.open`, `find.replace`, `ui.escape`
- Files:
  - `src/components/FindBar.tsx` — `FindBar`: seeds the query from the selection, opens CodeMirror's (hidden) search panel for highlighting, `close()`
  - `src/lib/commands.ts` — `find.open` / `find.replace` (large-file tabs get `big.find` instead), `ui.escape`
  - `src/lib/store.ts` — `findBar` state (`FindBarState`), `setFindBar`
  - `src/lib/bus.ts` — `big.find` event used when the active tab is a large file
  - `src/editor/cmSetup.ts` — `search({ createPanel: hiddenSearchPanel })`
  - `src/editor/manager.ts` — `editor.focus()`, `clearResultHighlights()`
- Tests: none
- Docs: `docs/find-and-replace.md`, `docs/keyboard-shortcuts.md`

**As a** person editing a text file
**I want** to open a find bar with Ctrl+F, or with a replace field with Ctrl+H
**So that** I can search the document without leaving the keyboard

```gherkin
Scenario: FIND-001.1 Ctrl+F opens the bar with the search box selected
  Given a text document is active and nothing is selected
  When I press Ctrl+F
  Then the find bar opens without the replace row
  And the cursor is in the "Find (Ctrl+Enter: newline)" box with its text selected

Scenario: FIND-001.2 A short single-line selection fills the search box
  Given the word "needle" is selected in the editor
  When I press Ctrl+F
  Then the search box contains "needle"

Scenario: FIND-001.3 A long or multi-line selection is not taken
  Given a selection of 500 or more characters, or one that spans two lines
  When I press Ctrl+F
  Then the search box keeps its previous text

Scenario: FIND-001.4 Ctrl+H shows the replace row
  Given a text document is active
  When I press Ctrl+H
  Then the find bar opens with the replace row shown
  And the chevron at the left of the bar hides and shows the replace row

Scenario: FIND-001.5 Escape closes the bar and returns to the editor
  Given the find bar is open
  When I press Escape in the search box, or click the "Close (Escape)" button
  Then the find bar closes and its match highlighting disappears
  And keyboard focus is back in the active document

Scenario: FIND-001.6 Nothing happens without a document
  Given no tab is open
  When I press Ctrl+F
  Then no find bar appears

Scenario: FIND-001.7 Opening the bar replaces Find in Files highlighting
  Given matches of a Find in Files search are highlighted in the document
  When I press Ctrl+F
  Then that highlighting is removed and only the find bar's matches are highlighted
```

## FIND-002: Step through matches and see the match count

- Status: verified
- Commands: `find.next`, `find.prev`
- Files:
  - `src/components/FindBar.tsx` — count effects (first match at or after the cursor, `{ current, total }`, 100 000 cap), `run()`, Next / Previous buttons
  - `src/lib/commands.ts` — `find.next` / `find.prev` (CodeMirror `findNext` / `findPrevious`; large-file tabs get `big.findNext` / `big.findPrev`)
  - `src/lib/store.ts` — `findBar.count`
  - `src/editor/manager.ts` — `onDocUpdate` keeps the current-match index in step with the selection
  - `src/App.tsx` — the window's capture-phase key handler lets F-keys through from text boxes, so F3 runs `find.next` before the find bar's own `onBarKey` (which stops propagation only in React's bubble phase); `cmCommand` then focuses the editor
- Tests: none
- Docs: `docs/find-and-replace.md`, `docs/keyboard-shortcuts.md`

**As a** person searching a document
**I want** to jump from match to match and see which one I am on
**So that** I know how many matches there are and where I am among them

```gherkin
Scenario: FIND-002.1 Typing selects the first match at or after the cursor
  Given a document with "foo" on lines 2, 5 and 9 and the cursor on line 4
  When I type "foo" in the search box
  Then the match on line 5 is selected and scrolled to the middle of the editor
  And the count reads "2 of 3"
  And every match is highlighted

Scenario: FIND-002.2 Typing wraps to the top when nothing follows the cursor
  Given a document with "foo" only on line 2 and the cursor on line 8
  When I type "foo" in the search box
  Then the match on line 2 is selected and the count reads "1 of 1"

Scenario: FIND-002.3 Enter and Shift+Enter move through the matches
  Given the count reads "2 of 3"
  When I press Enter in the search box
  Then the next match is selected and the count reads "3 of 3"
  And focus stays in the search box
  When I press Shift+Enter
  Then the count reads "2 of 3" again

Scenario: FIND-002.4 F3 and Shift+F3 work from the editor
  Given a search for "foo" was made and focus is in the editor
  When I press F3
  Then the next match of "foo" is selected
  When I press Shift+F3
  Then the previous match is selected

Scenario: FIND-002.5 No matches
  Given the document does not contain "zzz"
  When I type "zzz" in the search box
  Then the count reads "No results"

Scenario: FIND-002.6 Very many matches
  Given a document with more than 100,000 matches of "a"
  When I type "a" in the search box
  Then the count shows "100k+" as the total

Scenario: FIND-002.7 Empty search box
  Given the search box is empty
  When I look at the find bar
  Then no count is shown
  And the Previous Match and Next Match buttons are disabled

Scenario: FIND-002.8 The count follows the cursor
  Given the count reads "1 of 3"
  When I click somewhere in the document that is not a match
  Then the count reads "? of 3"

Scenario: FIND-002.9 F3 in the search box
  Given the find bar has focus, its search box contains "foo" and the count reads "1 of 3"
  When I press F3
  Then the next match is selected and the count reads "2 of 3"
  And the keyboard moves to the editor, unlike Enter, which keeps it in the search box
```

## FIND-003: Match Case, Whole Word, Regex and multi-line searches

- Status: verified
- Commands: none
- Files:
  - `src/components/FindBar.tsx` — `buildQuery`, `escapeRegex`, `onBarKey` (Alt+C / Alt+W / Alt+R), `onFindKey` (Ctrl+Enter), `invalid`
  - `src/lib/store.ts` — `findBar.caseSensitive` / `wholeWord` / `regex`
- Tests: `src/__tests__/findReplace.test.ts`
- Docs: `docs/find-and-replace.md`

**As a** person searching a document
**I want** to narrow a search by case, whole words or a regular expression, and to search across lines
**So that** I find exactly the text I mean

```gherkin
Scenario: FIND-003.1 Searches ignore case by default
  Given a document containing "Foo", "foo" and "FOO"
  When I type "foo" in the search box
  Then the count shows 3 matches
  When I turn on "Match Case (Alt+C)"
  Then the count shows 1 match

Scenario: FIND-003.2 Whole Word
  Given a document containing "cat" and "category"
  When I search for "cat" with "Match Whole Word (Alt+W)" on
  Then only the word "cat" matches

Scenario: FIND-003.3 Regex
  Given a document containing "a1" and "a22"
  When I search for "a\d+" with "Use Regular Expression (Alt+R)" on
  Then both "a1" and "a22" match
  And the replace box placeholder reads "Replace ($1, $&)"

Scenario: FIND-003.4 Without Regex the text is literal
  Given a document containing "a.b" and "axb"
  When I search for "a.b" with Regex off
  Then only "a.b" matches

Scenario: FIND-003.5 An invalid regular expression is flagged
  Given Regex is on
  When I type "(" in the search box
  Then the search box is marked invalid
  And the count area reads "Invalid regex"

Scenario: FIND-003.6 Keyboard toggles work anywhere in the bar
  Given focus is in the replace box
  When I press Alt+C, then Alt+W, then Alt+R
  Then Match Case, Whole Word and Regex are each toggled
  And the toggle buttons show their pressed state

Scenario: FIND-003.7 Ctrl+Enter searches across lines
  Given a document where a line "foo" is followed by a line "bar"
  When I type "foo", press Ctrl+Enter and type "bar" in the search box
  Then the search box grows to two lines (up to five)
  And the two-line text matches once

Scenario: FIND-003.8 A multi-line search without Regex is literal
  Given a document where a line "a.b" is followed by a line "c"
  When I search for "a.b", a line break and "c" with Regex off
  Then "a.b" followed by "c" matches
  And "axb" followed by "c" does not
```

## FIND-004: Replace the current match

- Status: verified
- Commands: none
- Files:
  - `src/components/FindBar.tsx` — `doReplaceNext`, `onReplaceKey` (Enter), Replace button
  - `src/editor/findReplace.ts` — `replaceNextSpec`, `cmReplacement` (used when Preserve Case is on; mirrors CodeMirror's `replaceNext`)
- Tests: `src/__tests__/findReplace.test.ts`
- Docs: `docs/find-and-replace.md`

**As a** person editing a document
**I want** to replace matches one at a time
**So that** I can decide about each one

```gherkin
Scenario: FIND-004.1 Enter in the replace box replaces the selected match
  Given the search box contains "foo", the replace box contains "bar"
  And the first of 3 matches is selected
  When I press Enter in the replace box
  Then that match becomes "bar"
  And the next match is selected

Scenario: FIND-004.2 The first Replace only selects when no match is selected
  Given the cursor is not on a match of "foo"
  When I click "Replace (Enter)"
  Then the next match is selected and nothing is changed
  When I click "Replace (Enter)" again
  Then that match is replaced

Scenario: FIND-004.3 Regex replacements can use groups
  Given Regex is on, the search box contains "(\w+)@(\w+)" and the replace box contains "$2 at $1 [$&]"
  And the match "bob@home" is selected
  When I press Enter in the replace box
  Then the text reads "home at bob [bob@home]"

Scenario: FIND-004.4 Without Regex the replacement is literal
  Given Regex is off and the replace box contains "$1"
  When I replace a match
  Then the text "$1" is inserted as typed

Scenario: FIND-004.5 Replace is unavailable with an empty search
  Given the search box is empty
  When I look at the replace row
  Then the Replace and Replace All buttons are disabled

Scenario: FIND-004.6 A read-only document is not changed
  Given the document is read-only
  When I press Enter in the replace box
  Then the document text is unchanged
```

## FIND-005: Replace all matches in the document

- Status: verified
- Commands: none
- Files:
  - `src/components/FindBar.tsx` — `doReplaceAll` (counts up to 100 000 for the message, CodeMirror `replaceAll`), `onReplaceKey` (Ctrl+Alt+Enter)
  - `src/editor/findReplace.ts` — `replaceAllSpec` (the Preserve Case path, one transaction)
- Tests: `src/__tests__/findReplace.test.ts`
- Docs: `docs/find-and-replace.md`

**As a** person editing a document
**I want** to replace every match at once
**So that** a rename takes one step and one undo

```gherkin
Scenario: FIND-005.1 Replace All changes every match
  Given a document with 3 matches of "foo" and the replace box contains "bar"
  When I press Ctrl+Alt+Enter in the replace box, or click "Replace All (Ctrl+Alt+Enter)"
  Then all 3 become "bar"
  And a message says "Replaced 3 occurrences."

Scenario: FIND-005.2 One undo step
  Given Replace All has just replaced 3 matches
  When I press Ctrl+Z once
  Then all 3 matches are back

Scenario: FIND-005.3 Nothing to replace
  Given the document has no match for the search text
  When I click "Replace All (Ctrl+Alt+Enter)"
  Then a message says "No occurrences to replace."
  And the document is unchanged

Scenario: FIND-005.4 A single match
  Given the document has exactly 1 match
  When I click "Replace All (Ctrl+Alt+Enter)"
  Then a message says "Replaced 1 occurrence."

Scenario: FIND-005.5 More than 100,000 matches
  Given the document has more than 100,000 matches
  When I click "Replace All (Ctrl+Alt+Enter)"
  Then every match is replaced
  And the message says "Replaced 100k+ occurrences."
```

## FIND-006: Preserve Case when replacing

- Status: verified
- Commands: none
- Files:
  - `src/components/FindBar.tsx` — Preserve Case toggle (`findBar.preserveCase`, Alt+P), routes Replace / Replace All to `findReplace.ts` when on
  - `src/editor/findReplace.ts` — `replaceNextSpec`, `replaceAllSpec`, `cmReplacement`, `withCase`
  - `src/lib/replace.ts` — `preserveCase`
- Tests: `src/__tests__/findReplace.test.ts`, `src/__tests__/replace.test.ts`
- Docs: `docs/find-and-replace.md`

**As a** person renaming something that appears in several capitalisations
**I want** each replacement to take the case of the text it replaces
**So that** FOO, Foo and foo all come out right in one pass

```gherkin
Scenario: FIND-006.1 Replace All follows each match's case
  Given a document containing "foo Foo FOO" and Match Case is off
  And the search box contains "foo" and the replace box contains "bar"
  When I turn on Preserve Case with Alt+P and replace all
  Then the document reads "bar Bar BAR"
  And one Ctrl+Z restores "foo Foo FOO"

Scenario: FIND-006.2 Mixed case is replaced as typed
  Given the document contains "fOO"
  When I replace "foo" with "bar" with Preserve Case on
  Then it becomes "bar"

Scenario: FIND-006.3 A single capital letter counts as a leading capital
  Given the document contains "X"
  When I replace "x" with "yes" with Preserve Case on
  Then it becomes "Yes"

Scenario: FIND-006.4 Regex groups are expanded before the case is applied
  Given Regex and Preserve Case are on, the search is "(a)(b)" and the replacement is "$2$1"
  And the document contains "AB"
  When I replace all
  Then it becomes "BA"

Scenario: FIND-006.5 Replace steps like the normal Replace
  Given Preserve Case is on and no match is selected
  When I press Enter in the replace box
  Then the next match is selected and nothing is changed
  When I press Enter again
  Then it is replaced in its own case and the following match is selected

Scenario: FIND-006.6 The toggle shows its state
  Given the replace row is shown
  When I click the "Preserve Case (Alt+P)" button in the replace box
  Then the button shows as pressed
```

## FIND-007: Find and replace history, and clearing a box

- Status: verified
- Commands: none
- Files:
  - `src/lib/searchHistory.ts` — `recordHistory`, `addEntry`, `sanitizeEntries`, `ensureHistoryLoaded` (lazy load of `search-history.json`), `removeHistoryEntry`, `clearHistory`, `applyHistoryLimit`, `MAX_ENTRY_CHARS`
  - `src/components/HistoryMenu.tsx` — `HistoryMenu` (list, pages of 100, keyboard), `ClearButton`, `openHistoryFromKey` (Alt+Down), `historyLabel`
  - `src/components/FindBar.tsx` — `run()` records find / replace texts (Enter / Shift+Enter, the Next / Previous / Replace / Replace All buttons; `find.next` / `find.prev` = F3 do not record); boxes host the buttons
  - `src/components/panels/SearchPanel.tsx` — records on Search and on Replace All; boxes host the same buttons
  - `src/components/panels/SettingsPanel.tsx` — "Find & replace history" row (`searchHistoryLimit`), clear history
  - `src/lib/ipc.ts` — `appData.read` / `appData.write`
- Tests: `src/__tests__/history.test.ts`
- Docs: `docs/find-and-replace.md`

**As a** person who repeats searches
**I want** my earlier find and replace texts kept in a list I can pick from
**So that** I do not retype them

```gherkin
Scenario: FIND-007.1 A search that is run is remembered
  Given the history is empty
  When I type "needle" in the find bar and press Enter
  Then the Search history list (clock icon, or Alt+Down in the box) shows "needle" with the date and time

Scenario: FIND-007.2 Typing alone is not remembered
  Given the history is empty
  When I type "needle" in the find bar and close it without pressing Enter or a button
  Then the Search history list reads "Nothing yet. Searches you run are listed here."

Scenario: FIND-007.3 Repeating a text moves it to the top and counts it
  Given the history lists "b" above "a"
  When I run a search for "a" again
  Then "a" is first, shown with "×2"
  And there is still only one "a" entry

Scenario: FIND-007.4 Frequent entries are highlighted
  Given an entry has been used 10 times
  When I open the history list
  Then its count "×10" is highlighted
  And its tooltip suggests a macro or script

Scenario: FIND-007.5 Find and replace have separate lists, shared with Find in Files
  Given I replaced "foo" with "bar" from the find bar
  When I open the Replace history in the Find in Files panel
  Then it lists "bar" and not "foo"
  And the panel's Search history lists "foo"

Scenario: FIND-007.6 Picking an entry
  Given the history list is open with "needle" highlighted
  When I press Enter, or click the entry
  Then "needle" is put in the box, the list closes and focus returns to the box

Scenario: FIND-007.7 Removing entries
  Given the history list is open on an entry
  When I press Delete, or click the entry's "×"
  Then that entry is removed
  When I click the bin icon
  Then the whole list for that box is cleared

Scenario: FIND-007.8 Long lists load as you scroll
  Given 250 history entries
  When I open the list
  Then 100 entries are shown and "Scroll for more…" appears at the end
  And scrolling near the end adds the next 100

Scenario: FIND-007.9 Limits
  Given Settings › Search › "Find & replace history" is limited to 2 entries
  When I run searches for "a", "b" and "c"
  Then the Search history lists "c" and "b" only
  And a text longer than 10,000 characters is never added
  And an empty text is never added

Scenario: FIND-007.10 History survives a restart
  Given I ran a search for "needle"
  When I restart Quarry and open the Search history
  Then "needle" is listed

Scenario: FIND-007.11 Clearing a box
  Given the search box contains "needle"
  When I click the "×" inside the box
  Then the box is empty and keeps focus
  And the "×" is no longer shown

Scenario: FIND-007.12 Multi-line and blank entries are readable
  Given history entries "a", line break, "b" and one of three spaces
  When I open the list
  Then they read "a ⏎ b" and "(3 whitespace characters)"

Scenario: FIND-007.13 F3 steps without adding to the history
  Given the history is empty and the search box contains "needle"
  When I press F3 three times
  Then the Search history list is still empty
  When I click the Next Match button
  Then "needle" is listed once

```

## FIND-008: Turn every find match into a cursor

- Status: verified
- Commands: `edit.selectAllMatches`
- Files:
  - `src/editor/bulkEdit.ts` — `selectAllFindMatches`, `findMatchSelection`, `MAX_OCCURRENCES` (200 000), `bulkEditing` (fast typing with many cursors)
  - `src/App.tsx` — Alt+Enter in the search box: the window's capture-phase key handler runs `edit.selectAllMatches` before the find bar sees the key
  - `src/lib/commands.ts` — `edit.selectAllMatches` (closes the find bar when it selected something)
- Tests: `src/__tests__/bulkedit.test.ts`
- Docs: `docs/find-and-replace.md`, `docs/keyboard-shortcuts.md`

**As a** person editing many matches in the same way
**I want** to select every match of my search as a separate cursor
**So that** I can type over all of them at once

```gherkin
Scenario: FIND-008.1 Alt+Enter selects every match and closes the bar
  Given the find bar shows 4 matches for "foo"
  When I press Alt+Enter in the search box
  Then all 4 matches are selected as separate selections
  And the find bar closes with focus in the editor
  And typing "bar" replaces all 4

Scenario: FIND-008.2 The command honours the find options
  Given Regex is on and the search is "a\d"
  When I run "Select All Find Matches"
  Then every text matching the regular expression is selected

Scenario: FIND-008.3 More than 200,000 matches
  Given a document with more than 200,000 matches
  When I press Alt+Enter in the search box
  Then the first 200,000 are selected
  And a warning says "Selected the first 200,000 matches."

Scenario: FIND-008.4 No match
  Given the search has no match in the document
  When I press Alt+Enter in the search box, or run "Select All Find Matches" from the menu
  Then the selection is unchanged
  And the find bar stays open
```

## FIND-009: Select occurrences of the selected text

- Status: verified
- Commands: `edit.selectNextOccurrence`, `edit.selectAllOccurrences`
- Files:
  - `src/lib/commands.ts` — `edit.selectNextOccurrence` (CodeMirror `selectNextOccurrence`), `edit.selectAllOccurrences`
  - `src/editor/bulkEdit.ts` — `occurrenceSelection`, `MAX_OCCURRENCES`
  - `src/editor/cmSetup.ts` — `highlightSelectionMatches({ minSelectionLength: 2 })`
- Tests: `src/__tests__/bulkedit.test.ts`
- Docs: `docs/find-and-replace.md`, `docs/keyboard-shortcuts.md`

**As a** person editing code
**I want** to add the other occurrences of the selected text to my selection
**So that** I can change them together without opening the find bar

```gherkin
Scenario: FIND-009.1 Ctrl+D adds the next occurrence
  Given "count" is selected and occurs again further down
  When I press Ctrl+D
  Then the next "count" is added as a second selection

Scenario: FIND-009.2 Ctrl+Shift+L selects all occurrences
  Given "count" is selected and occurs 5 times in the document
  When I press Ctrl+Shift+L
  Then all 5 occurrences are selected

Scenario: FIND-009.3 With no selection the word at the cursor is used
  Given the cursor is inside the word "total" and nothing is selected
  When I press Ctrl+Shift+L
  Then every "total" in the document is selected

Scenario: FIND-009.4 Occurrences are case-sensitive
  Given "Foo" is selected and the document also contains "foo"
  When I press Ctrl+Shift+L
  Then "foo" is not selected

Scenario: FIND-009.5 More than 200,000 occurrences
  Given the selected text occurs more than 200,000 times
  When I press Ctrl+Shift+L
  Then the first 200,000 are selected
  And a warning says "Selected the first 200,000 occurrences."

Scenario: FIND-009.6 Nothing to select
  Given nothing is selected and the cursor is not in a word
  When I press Ctrl+Shift+L
  Then the selection is unchanged
```

## FIND-010: Find in Selection

- Status: verified
- Commands: `find.toggleInSelection`
- Files:
  - `src/editor/findScope.ts` — `findScopeField` (the ranges, mapped through edits, drawn as `.cm-findScope`), `setFindScope`, `scopeFromSelection` (selection ranges, or the cursors' lines), `inScope`, `scopeSpans`
  - `src/components/FindBar.tsx` — the toggle button, `buildQuery` (`test: scopeTest` while on), skips seeding the search box when the toggle opened the bar, turns the option off on close / document switch
  - `src/lib/commands.ts` — `find.toggleInSelection` (Alt+L)
  - `src/lib/store.ts` — `findBar.inSelection`
  - `src/editor/manager.ts` — `clearFindScopes`
  - `src/editor/cmSetup.ts` — `findScopeField` in the editor extensions
  - `src/components/MenuBar.tsx` — Find › Toggle Find in Selection
  - `src/styles/tokens.css` — `--find-scope-bg`
- Tests: `src/__tests__/findScope.test.ts`
- Docs: `docs/find-and-replace.md`, `docs/keyboard-shortcuts.md`

**As a** person editing one part of a long file
**I want** to limit the find bar to the text I selected
**So that** I can count, step through and replace matches in that part without touching the rest

```gherkin
Scenario: FIND-010.1 Alt+L limits the search to the selection
  Given a document with "foo" on lines 1, 5, 6 and 20, and lines 4 to 8 selected
  When I press Alt+L and type "foo" in the search box
  Then the "Find in Selection (Alt+L)" toggle shows as pressed
  And the selected lines get a faint background
  And the count reads "1 of 2" and only the matches on lines 5 and 6 are highlighted

Scenario: FIND-010.2 Stepping stays inside the selection
  Given Find in Selection is on over lines 4 to 8 and the match on line 6 is selected
  When I press Enter, or F3 in the editor
  Then the match on line 5 is selected, not the one on line 20

Scenario: FIND-010.3 Replace and Replace All stay inside the selection
  Given Find in Selection is on over lines 4 to 8, the search is "foo" and the replace box contains "bar"
  When I click "Replace All (Ctrl+Alt+Enter)"
  Then the matches on lines 5 and 6 become "bar" and a message says "Replaced 2 occurrences."
  And the matches on lines 1 and 20 are unchanged
  And the same holds with Preserve Case on, and for Replace one match at a time

Scenario: FIND-010.4 Select All Find Matches stays inside the selection
  Given Find in Selection is on over lines 4 to 8 and the search is "foo"
  When I press Alt+Enter in the search box
  Then only the matches on lines 5 and 6 are selected

Scenario: FIND-010.5 Several selections
  Given the words "one" and "three" in "one two three" are selected as two selections
  When I press Alt+L and search for "e"
  Then the count shows 3 matches: one in "one" and two in "three"

Scenario: FIND-010.6 A match must lie wholly inside a range
  Given Find in Selection is on over "oo f" in "foo foo"
  When I search for "foo"
  Then the count reads "No results"

Scenario: FIND-010.7 The ranges follow edits
  Given Find in Selection is on over lines 4 to 8
  When I insert two lines above line 4
  Then the search is limited to the same text, now on lines 6 to 10
  And text typed inside the ranges is searched too

Scenario: FIND-010.8 With nothing selected the cursor's line is used
  Given nothing is selected and the cursor is on line 3, which contains "foo foo"
  When I press Alt+L and search for "foo"
  Then the count shows 2 matches, both on line 3

Scenario: FIND-010.9 Nothing to search in
  Given nothing is selected and the cursor is on an empty line
  When I press Alt+L
  Then the toggle stays off
  And a message says "Select the text to search in first."

Scenario: FIND-010.10 Turning it on with the find bar closed
  Given the find bar is closed and the word "needle" is selected
  When I press Alt+L
  Then the find bar opens with the toggle pressed
  And the search box keeps its previous text instead of taking "needle"

Scenario: FIND-010.11 Turning it off
  Given Find in Selection is on
  When I press Alt+L again, click the toggle, close the find bar or switch to another tab
  Then the toggle is off, the faint background disappears and the whole document is searched again

Scenario: FIND-010.12 Not for other kinds of tab
  Given a large-file tab or no tab is active
  When I look at Find › Toggle Find in Selection
  Then it is disabled
```
