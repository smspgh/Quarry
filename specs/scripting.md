---
area: Scripts
prefix: SCRIPT
---

# Scripts

User scripts: plain `.js` files under the scripts folder, browsed in the Scripts panel, run on the document in front inside a Web Worker, with the result applied as one undoable edit. The tree itself (rename, cut / copy / paste, delete, keyboard) is the Explorer's `FileTree` and is specified in the Explorer area. User documentation: `docs/scripting.md`.

## SCRIPT-001: Browse and select scripts in the Scripts panel

- Status: draft
- Commands: `script.panel`, `view.scripts`
- Files:
  - `src/components/panels/ScriptsPanel.tsx` — `ScriptsPanel` (`TreeVariant` over the scripts root, `onSelect` sets `activeScriptId`, run bar text)
  - `src/components/panels/ExplorerPanel.tsx` — `FileTree` / `TreeVariant` (`onSelect` instead of opening on click, reload on panel open / window focus)
  - `src/lib/scripting.ts` — `scriptsDir`, `isScriptPath`, `scriptNameOf`
  - `src/lib/store.ts` — `activeScriptId`, `scriptsExpanded`
  - `src/components/MenuBar.tsx` — `scriptsMenu`
- Tests: `src/__tests__/scripts.test.ts`
- Docs: `docs/scripting.md`

**As a** developer who keeps a collection of text-transforming scripts
**I want** to see my scripts folder as a tree and pick a script without leaving my document
**So that** the document I want to transform stays in front while I choose what to run

```gherkin
Scenario: SCRIPT-001.1 Open the panel
  Given the scripts folder contains sort.js and a subfolder csv with pick-column.js
  When I choose Scripts › Scripts
  Then the Scripts panel shows the folder as a tree with sort.js and the folder csv
  And a run bar under the tree reads "Select a script to run it. Double-click to edit."

Scenario: SCRIPT-001.2 A click selects, it does not open
  Given the tab data.csv is in front
  When I click sort.js in the tree
  Then data.csv is still the tab in front and no new tab is opened
  And the run bar reads "sort → data.csv"
  And Scripts › Run Script "sort" names that script

Scenario: SCRIPT-001.3 Only .js files become the current script
  Given the scripts folder also contains notes.txt
  When I click notes.txt
  Then the current script does not change

Scenario: SCRIPT-001.4 Files changed outside Quarry
  Given I add trim.js to the scripts folder in File Explorer
  When I switch back to Quarry
  Then trim.js is listed in the tree

Scenario: SCRIPT-001.5 No scripts are built in
  Given a new installation
  When I open the Scripts panel
  Then the tree is empty and says to use New Script
```

## SCRIPT-002: Create a script

- Status: draft
- Commands: `script.new`
- Files:
  - `src/lib/commands.ts` — `script.new` (shows the panel, then emits the `script.new` bus event)
  - `src/components/panels/ScriptsPanel.tsx` — `variant.newFile`, `newFileEvent`, labels "New Script" / "New Script Folder"
  - `src/lib/scripting.ts` — `newScriptFileName`, `NEW_SCRIPT_SOURCE`
  - `src/components/panels/ExplorerPanel.tsx` — `startCreate`, `commitCreate` (writes the file and opens it)
  - `src/lib/bus.ts` — event bus carrying `script.new`
- Tests: `src/__tests__/scripts.test.ts`
- Docs: `docs/scripting.md`

**As a** developer with a repetitive edit to automate
**I want** to create a script file from inside the editor with a starting template
**So that** I can begin writing it straight away

```gherkin
Scenario: SCRIPT-002.1 New script from the menu
  Given the Scripts panel is closed
  When I choose Scripts › New Script
  Then the Scripts panel opens with a name box in the tree, with the placeholder "script name"
  When I type "upper" and press Enter
  Then the file upper.js is created in the scripts folder
  And it opens in a tab containing a short template that ends with doc.mapLines((line, i) => line);

Scenario: SCRIPT-002.2 The .js extension is added only when none is typed
  When I create a script named "clean"
  Then the file is clean.js
  When I create a script named "notes.txt"
  Then the file is notes.txt

Scenario: SCRIPT-002.3 Header buttons create in the selected folder
  Given the folder csv is selected in the tree
  When I click "New Script" in the panel header and type "split"
  Then csv\split.js is created
  When I click "New Script Folder" and type "json"
  Then a folder json is created inside csv

Scenario: SCRIPT-002.4 Existing name
  Given upper.js already exists
  When I create a script named "upper"
  Then an error reads "upper.js already exists"
  And the existing file is not changed
```

## SCRIPT-003: Open a script to edit it

- Status: draft
- Commands: `script.edit`
- Files:
  - `src/components/panels/ScriptsPanel.tsx` — `editScript`, `onActivate`, Edit button, context-menu Edit (`menuLead`)
  - `src/lib/commands.ts` — `script.edit` (opens a path given as argument)
  - `src/lib/scripting.ts` — `readScript` (prefers the open tab's text)
- Tests: none
- Docs: `docs/scripting.md`

**As a** developer refining a script
**I want** to open it in an ordinary editor tab
**So that** I can edit, save and try it with the tools I use for any other file

```gherkin
Scenario: SCRIPT-003.1 Double-click opens the script
  Given sort.js is listed in the Scripts panel
  When I double-click it
  Then sort.js opens in a kept tab (not a preview tab) and the editor has focus

Scenario: SCRIPT-003.2 Other ways to open it
  Given sort.js is selected
  When I press Enter in the tree, click "Edit" in the run bar, or right-click › Edit
  Then sort.js opens in a tab

Scenario: SCRIPT-003.3 Edit needs a selection
  Given no script is selected
  When I look at the run bar
  Then "Edit" is disabled with the tooltip "Select a script"

Scenario: SCRIPT-003.4 Unsaved edits are what runs
  Given sort.js is open in a tab with unsaved changes
  When I switch to data.csv and run sort
  Then the script runs as it is in the tab, not as it is on disk
```

## SCRIPT-004: Run a script on the document in front

- Status: draft
- Commands: `script.runActive`, `script.run`
- Files:
  - `src/lib/commands.ts` — `runScriptPath` (own-tab guard, `readScript`, sets `activeScriptId`, `confirmRun`), `script.runActive`, `script.run`
  - `src/lib/scripting.ts` — `runScript` (snapshot, worker message, busy guard), `readScript`, `getWorker`, run state store
  - `src/lib/scriptWorker.ts` — worker `onmessage`, `AsyncFunction` wrapper with `"use strict"` prelude
  - `src/components/panels/ScriptsPanel.tsx` — Run button, context-menu Run, `why` (disabled reasons)
- Tests: none
- Docs: `docs/scripting.md`

**As a** developer with a script that transforms text
**I want** to run it on the document I am looking at with one click or one shortcut
**So that** the transformation is applied without copying text in and out of another tool

```gherkin
Scenario: SCRIPT-004.1 Run from the panel
  Given sort.js contains doc.lines = util.sort(doc.lines); and is selected
  And the tab words.txt contains the lines "pear", "apple", "fig"
  And "Confirm script & macro runs" is off
  When I click "Run" in the run bar
  Then words.txt contains "apple", "fig", "pear"
  And the Console shows "▶ Running script on words.txt" then "✓ Done in N ms"

Scenario: SCRIPT-004.2 Run the current script again with the shortcut
  Given sort was the last script selected or run and the Scripts panel is closed
  When I press Ctrl+Shift+Enter in another text tab
  Then sort runs on that tab

Scenario: SCRIPT-004.3 Right-click a script to run it
  Given upper.js is not the current script
  When I right-click upper.js and choose Run
  Then upper runs on the document in front and becomes the current script

Scenario: SCRIPT-004.4 A script never runs on its own tab
  Given the tab in front is sort.js itself
  When I look at the run bar
  Then "Run" is disabled with the tooltip "This tab is the script itself: go to the document it should change"
  When I press Ctrl+Shift+Enter
  Then nothing runs and a warning reads "This tab is the script itself. Go to the document it should change, then run it."

Scenario: SCRIPT-004.5 Text tabs only
  Given the tab in front is a file open in large-file mode
  When I look at the run bar
  Then "Run" is disabled with the tooltip "Open a text document to run scripts"
  And Scripts › Run Script is greyed out

Scenario: SCRIPT-004.6 No current script
  Given no script has been selected in this session
  When I open the Scripts menu
  Then "Run Current Script" is greyed out
  And the run bar's Run button has the tooltip "Select a script"

Scenario: SCRIPT-004.7 One script at a time
  Given a script is running
  When I try to start another script
  Then the panel's Run buttons are replaced or disabled ("A script is running")
  And a run started another way is refused with "A script is already running. Cancel it first."

Scenario: SCRIPT-004.8 Script file cannot be read
  Given the current script's file was deleted outside Quarry
  When I press Ctrl+Shift+Enter
  Then an error starts "Could not read the script:" and nothing runs

Scenario: SCRIPT-004.9 Top-level await and return
  Given a script whose body uses await and ends with return "done";
  When I run it
  Then it runs without a syntax error, because the body is an async function in strict mode
```

## SCRIPT-005: Confirm before a script runs

- Status: draft
- Commands: none
- Files:
  - `src/lib/commands.ts` — `confirmRun` (shared with macros), detail text chosen in `runScriptPath`
  - `src/lib/dialogs.ts` — `choose`
  - `src/lib/types.ts` — `confirmRuns` setting, default `true`
  - `src/components/panels/SettingsPanel.tsx` — "Confirm script & macro runs" row
- Tests: none
- Docs: `docs/scripting.md`

**As a** developer running scripts that rewrite my document
**I want** to be asked first and be able to read the script instead
**So that** I do not run the wrong script on the wrong file by accident

```gherkin
Scenario: SCRIPT-005.1 Prompt with three choices
  Given "Confirm script & macro runs" is on and the tab data.csv is in front
  When I run the script sort
  Then a dialog asks 'Run script "sort"?' and says it will edit data.csv and can be undone with Ctrl+Z
  And it offers "Run", "Review first" and "Cancel"

Scenario: SCRIPT-005.2 Run
  When I choose "Run" in that dialog
  Then the script runs

Scenario: SCRIPT-005.3 Review first
  When I choose "Review first"
  Then sort.js opens in a tab and the script does not run

Scenario: SCRIPT-005.4 Cancel or Escape
  When I choose "Cancel" or dismiss the dialog
  Then nothing runs and the document is unchanged

Scenario: SCRIPT-005.5 Repeated runs ask once
  When I start the script with ×5
  Then the dialog adds "Runs 5 times in a row." and is shown once, not five times

Scenario: SCRIPT-005.6 Setting off
  Given "Confirm script & macro runs" is off
  When I run a script
  Then it runs without a dialog
```

## SCRIPT-006: A script's result is applied as one undo step

- Status: draft
- Commands: none
- Files:
  - `src/lib/scripting.ts` — `runScript` `onmessage` (selection changes → document text → `newSelection`; both-changed and switched-tab failures; `userEvent: "input.script"`)
  - `src/lib/scriptWorker.ts` — `done` message (`text`, `selectionTexts`, `newSelection`, returned string)
  - `src/editor/manager.ts` — `replaceAll` (minimal change), `selectRange`
- Tests: none
- Docs: `docs/scripting.md`

**As a** developer trying a script on real work
**I want** everything it changed to be a single edit in the undo history
**So that** one Ctrl+Z puts my document back exactly as it was

```gherkin
Scenario: SCRIPT-006.1 One Ctrl+Z undoes the run
  Given a script that rewrites every line of a 1,000-line document
  When I run it and then press Ctrl+Z once
  Then the document is exactly as it was before the run

Scenario: SCRIPT-006.2 The script works on a snapshot
  Given a script that takes 5 seconds
  When it is running
  Then the document on screen does not change until the script finishes

Scenario: SCRIPT-006.3 Document changes
  Given a script that assigns doc.text or calls doc.mapLines
  When it finishes
  Then the new text replaces the document and the tab is marked modified

Scenario: SCRIPT-006.4 Selection changes
  Given three cursors each selecting a word, and the script selection.map(t => t.toUpperCase());
  When I run it
  Then only the three selected words change, each to upper case

Scenario: SCRIPT-006.5 Returned string
  Given a script that changes neither doc nor selection and ends with return "hello";
  When I run it
  Then the document's text becomes "hello"
  And any other kind of return value is ignored

Scenario: SCRIPT-006.6 doc and selection in the same run
  Given a script that assigns both doc.text and selection.text
  When I run it
  Then nothing is changed
  And an error reads "The script changed both the document (doc) and the selection. Use one or the other in a run; nothing was changed."

Scenario: SCRIPT-006.7 Selection after the run
  Given a script that replaces the text and calls doc.select(0, 5)
  When it finishes
  Then characters 0 to 5 of the new text are selected

Scenario: SCRIPT-006.8 Switching tabs during a run
  Given a script is running on data.csv
  When I switch to another tab before it finishes
  Then neither tab is changed
  And an error reads "The script finished after you switched away from data.csv, so its changes were not applied."

Scenario: SCRIPT-006.9 A script that changes nothing
  Given a script that only calls console.log
  When I run it
  Then the document is not marked modified and no undo step is added
```

## SCRIPT-007: Script API for the whole document (doc)

- Status: draft
- Commands: none
- Files:
  - `src/lib/scriptWorker.ts` — `doc` object (`text`, `lines`, `lineCount`, `length`, `name`, `path`, `eol`, `mapLines`, `filterLines`, `replace`, `insert`, `append`, `prepend`, `lineAt`, `select`), `splitLines`
  - `src/lib/scripting.ts` — `runScript` request (`text`, `path`, `name`, `eol`), `SCRIPT_API` entries for `doc`
- Tests: none
- Docs: `docs/scripting.md`

**As a** script author
**I want** a small object for reading and rewriting the document by text, by line or by pattern
**So that** common whole-file transformations are one-liners

```gherkin
Scenario: SCRIPT-007.1 Read the document
  Given a tab C:\data\people.csv with CRLF line endings and 3 lines
  When a script reads doc.name, doc.path, doc.eol and doc.lineCount
  Then it gets "people.csv", "C:\data\people.csv", "\r\n" and 3
  And doc.path is null for an untitled tab

Scenario: SCRIPT-007.2 Lines are joined with the document's line ending
  Given a document with mixed LF and CRLF line endings whose line ending setting is CRLF
  When a script runs doc.lines = doc.lines;
  Then every line ends with CRLF

Scenario: SCRIPT-007.3 mapLines and filterLines
  Given the lines "a", "", "b"
  When a script runs doc.mapLines((line, i) => line ? i + ":" + line : null);
  Then the document is "0:a" and "2:b"
  When a script runs doc.filterLines(line => line !== "");
  Then blank lines are removed

Scenario: SCRIPT-007.4 replace with a string pattern
  Given the text "a.b a.b"
  When a script runs doc.replace(".", "-");
  Then the text is "a-b a-b": every occurrence, matched literally

Scenario: SCRIPT-007.5 replace with a RegExp
  Given the text "a1 b2"
  When a script runs doc.replace(/\d/, "#");
  Then only the first digit is replaced
  When a script runs doc.replace(/(\w)(\d)/g, "$2$1");
  Then the text is "1a 2b"

Scenario: SCRIPT-007.6 insert, append, prepend and lineAt
  Given the text "one" then a line break then "two"
  When a script calls doc.prepend("# "), doc.append("!") and doc.insert(2, "x")
  Then each text is added at the start, the end and character offset 2
  And doc.lineAt gives 1 for an offset in the first line and 2 for one in the second
```

## SCRIPT-008: Script API for the selection

- Status: draft
- Commands: none
- Files:
  - `src/lib/scriptWorker.ts` — `selection` object (`all`, `text`, `lines`, `isEmpty`, `map`), `selectionTexts`
  - `src/lib/scripting.ts` — `runScript` (`selections` snapshot of every range; applies `selectionTexts` per range), `SCRIPT_API` entries for `selection`
- Tests: none
- Docs: `docs/scripting.md`

**As a** script author
**I want** to read and replace just what is selected, including every cursor of a multi-cursor or column selection
**So that** a script can act on part of a document instead of all of it

```gherkin
Scenario: SCRIPT-008.1 Every range is available
  Given two selections "foo" and "bar"
  When a script reads selection.all
  Then it gets two entries with from, to and text "foo" and "bar"
  And selection.text is "foo" and "bar" joined with the document's line ending

Scenario: SCRIPT-008.2 Assign with one selection
  Given one selection "foo"
  When a script runs selection.text = "X";
  Then "foo" is replaced by "X" and the rest of the document is unchanged

Scenario: SCRIPT-008.3 Assign with several selections
  Given three selections
  When a script assigns selection.text a value of two lines
  Then line 1 goes into the first selection, line 2 into the second, and the third becomes empty

Scenario: SCRIPT-008.4 selection.lines
  Given one selection of three lines
  When a script runs selection.lines = selection.lines.map((l, i) => `${i + 1}. ${l}`);
  Then the three selected lines are numbered 1., 2., 3.

Scenario: SCRIPT-008.5 map transforms each range on its own
  Given a column selection over 4 rows
  When a script runs selection.map((text, i) => text + i);
  Then each of the 4 ranges gets its own result

Scenario: SCRIPT-008.6 Empty cursors
  Given a single cursor with nothing selected
  When a script reads selection.isEmpty
  Then it is true
  When a script runs selection.text = "inserted";
  Then "inserted" is inserted at the cursor
```

## SCRIPT-009: Script helpers, clipboard and console

- Status: draft
- Commands: none
- Files:
  - `src/lib/scriptWorker.ts` — `util` (`sort`, `unique`, `trimLines`, `pad`, `csvSplit`, `json`), `clipboard`, `console`, `fmt`, `args`
  - `src/lib/scripting.ts` — clipboard read before the run and write after success; `store.log` of worker `logs`; `SCRIPT_API`
- Tests: none
- Docs: `docs/scripting.md`

**As a** script author
**I want** ready-made helpers for sorting, de-duplicating, CSV and JSON, plus access to the clipboard and a console
**So that** I do not rewrite the same utility code in every script

```gherkin
Scenario: SCRIPT-009.1 Sorting
  Given the lines "10", "2", "b", "A"
  When a script calls util.sort(lines, { numeric: true })
  Then "2" comes before "10"
  And { desc: true } reverses the order
  And { caseInsensitive: true } ignores case and accents when comparing
  And the array passed in is not modified

Scenario: SCRIPT-009.2 unique, trimLines and pad
  When a script calls util.unique(["a", "b", "a"])
  Then it gets ["a", "b"]
  When it calls util.trimLines(["x  ", "y"]) and util.pad("7", 3, "0")
  Then it gets ["x", "y"] and "007"

Scenario: SCRIPT-009.3 csvSplit
  When a script calls util.csvSplit('a,"b,c","d ""e"""')
  Then it gets the three cells a / b,c / d "e"
  And util.csvSplit("a;b", ";") gives two cells

Scenario: SCRIPT-009.4 JSON helpers
  When a script calls util.json.stringify(util.json.parse('{"a":1}'))
  Then it gets the object indented by 2 spaces

Scenario: SCRIPT-009.5 Clipboard
  Given the clipboard holds "hello"
  When a script reads clipboard.text and then assigns clipboard.text = "bye"
  Then it reads "hello"
  And after the run succeeds the system clipboard holds "bye"

Scenario: SCRIPT-009.6 Clipboard is not written when the script fails
  Given a script that assigns clipboard.text and then throws
  When I run it
  Then the system clipboard is unchanged

Scenario: SCRIPT-009.7 Console output
  Given a script that calls console.log("n =", { a: 1 }) and console.error("bad")
  When it finishes
  Then the Console shows "n =" followed by the object as indented JSON, and "bad" as an error line
  And the lines appear when the script finishes, not while it runs

Scenario: SCRIPT-009.8 args
  When a script started from the panel, the menu or the shortcut reads args
  Then it is undefined
```

## SCRIPT-010: Limit a script to certain languages or file types

- Status: draft
- Commands: none
- Files:
  - `src/lib/scripting.ts` — `parseWhen` (first 20 lines, `@languages` / `@extensions`), `scriptApplies`, `describeWhen`, guard in `runScript`
  - `src/components/panels/ScriptsPanel.tsx` — `info` / `known` / `applies`, run bar note, disabled Run with reason
  - `src/lib/types.ts` — `Script.when`
- Tests: `src/__tests__/scripts.test.ts`
- Docs: `docs/scripting.md`

**As a** script author
**I want** to declare in the script which documents it is meant for
**So that** a CSV script cannot be run on a JSON file by mistake

```gherkin
Scenario: SCRIPT-010.1 Language filter
  Given flatten.js starts with the line // @languages JSON, YAML
  And a Markdown tab is in front
  When I select flatten in the Scripts panel
  Then the run bar reads "flatten · JSON / YAML only → " followed by the tab's name
  And "Run", "×N" and "To end" are disabled with the tooltip "This script is for JSON / YAML only"

Scenario: SCRIPT-010.2 Extension filter ignores case
  Given pick.js starts with // @extensions .csv, .tsv
  When the tab in front is REPORT.CSV
  Then Run is enabled

Scenario: SCRIPT-010.3 Either filter is enough
  Given a script with both // @languages JSON and // @extensions .har
  When the tab in front is trace.har with the language Plain Text
  Then Run is enabled

Scenario: SCRIPT-010.4 Language names are matched exactly
  Given a script with // @languages json
  When the tab in front has the language JSON
  Then Run is disabled

Scenario: SCRIPT-010.5 Refused when started another way
  Given flatten (JSON / YAML only) is the current script and a Markdown tab is in front
  When I press Ctrl+Shift+Enter and confirm
  Then the script does not run and a warning says "flatten" is for JSON / YAML documents

Scenario: SCRIPT-010.6 No header means any text document
  Given a script without @languages or @extensions
  When any text tab is in front
  Then Run is enabled

Scenario: SCRIPT-010.7 Header is read on each run
  Given the script is open in a tab and I add // @extensions .log without saving
  When I switch to a .txt tab and select the script
  Then Run is disabled for that tab

Scenario: SCRIPT-010.8 Only the first 20 lines count
  Given // @languages JSON appears on line 30 of a script
  When a Markdown tab is in front
  Then Run is enabled
```

## SCRIPT-011: Run a script several times or until nothing changes

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/ScriptsPanel.tsx` — times input (1 to 100,000), "×N" and "To end" buttons
  - `src/lib/scripting.ts` — `runScriptTimes`, `runScriptToEnd` (`maxIterations` 10,000)
  - `src/lib/commands.ts` — `runScriptPath` (`ScriptRunHow`, "Ran N times" message)
- Tests: none
- Docs: `docs/scripting.md`

**As a** developer with a script that does one step of a job
**I want** to repeat it a set number of times or until it has nothing left to do
**So that** I do not click Run over and over

```gherkin
Scenario: SCRIPT-011.1 Run N times
  Given a script that appends "x" to the document and the times box set to 3
  When I click "×3"
  Then "xxx" has been appended
  And a message reads "Ran 3 times"
  And each run is its own undo step, so three presses of Ctrl+Z undo them all

Scenario: SCRIPT-011.2 The times box is clamped
  When I type 0 in the times box
  Then it shows 1
  When I type 250000
  Then it shows 100000

Scenario: SCRIPT-011.3 Stops at the first failure
  Given a script that throws on its second run
  When I click "×5"
  Then the first run's change is kept, the error is reported and a message reads "Ran 1 time"

Scenario: SCRIPT-011.4 To end
  Given a script that removes one blank line per run and a document with 4 blank lines
  When I click "To end"
  Then it runs until a run leaves both the text and the selection unchanged
  And a message reads "Ran 5 times"

Scenario: SCRIPT-011.5 Safety limit
  Given a script that changes the document on every run
  When I click "To end"
  Then it stops after 10,000 runs
```

## SCRIPT-012: Cancel a running script; runaway scripts time out

- Status: draft
- Commands: none
- Files:
  - `src/lib/scripting.ts` — `cancelScript`, `TIMEOUT_MS` (60 s), `kill` (terminates and drops the worker), `useScriptRunState`
  - `src/components/panels/ScriptsPanel.tsx` — Cancel button, `ScriptStatusItem`
  - `src/components/StatusBar.tsx` — hosts `ScriptStatusItem`
- Tests: none
- Docs: `docs/scripting.md`

**As a** developer whose script is taking too long or looping forever
**I want** to stop it, and have Quarry stop it for me eventually
**So that** a bad script never locks up the editor or leaves a half-applied change

```gherkin
Scenario: SCRIPT-012.1 Running indicator
  Given a slow script named crunch
  When it is running
  Then the status bar shows "SCRIPT" with a stop button and the tooltip 'Running script "crunch"'
  And the run bar reads "Running crunch…" and shows "Cancel" in place of "Run"
  And I can still scroll and type in the editor

Scenario: SCRIPT-012.2 Cancel
  When I click "Cancel" in the run bar or the stop button in the status bar
  Then the script stops, the document is unchanged and a message reads "Script cancelled."
  And the running indicator disappears

Scenario: SCRIPT-012.3 Timeout
  Given a script containing while (true) {}
  When it has run for 60 seconds
  Then it is terminated, the document is unchanged and an error reads "Script timed out after 60s and was terminated."
  And anything it logged is not shown

Scenario: SCRIPT-012.4 The next run works after a cancel or timeout
  Given a script was cancelled
  When I run another script
  Then it runs normally in a fresh worker
  And a value the cancelled script stored on globalThis is gone

Scenario: SCRIPT-012.5 Sandbox
  When a script refers to document, window or Quarry's own modules
  Then they are not available: a script sees only doc, selection, util, clipboard, console and args
```

## SCRIPT-013: Script errors and Console output

- Status: draft
- Commands: none
- Files:
  - `src/lib/scripting.ts` — `formatScriptError` (maps wrapper lines to script lines, drops worker frames), `runScript` error path, `store.log`
  - `src/lib/scriptWorker.ts` — `error` message with `lineOffset` (`wrapperLineOffset`)
  - `src/components/BottomPanel.tsx` — Console tab, Clear console, auto-scroll
  - `src/lib/store.ts` — `log` / `consoleLines` (trimmed to about 2,000 lines), `clearConsole`
- Tests: `src/__tests__/scripts.test.ts`
- Docs: `docs/scripting.md`

**As a** script author debugging a script
**I want** to see its output and the script line an error came from
**So that** I can fix it without guessing

```gherkin
Scenario: SCRIPT-013.1 A run opens the Console
  Given the bottom panel is closed
  When I run a script on data.csv
  Then the bottom panel opens on the Console tab
  And it shows "▶ Running script on data.csv", the script's output, then "✓ Done in N ms", each with a time stamp

Scenario: SCRIPT-013.2 Error with a line number
  Given a script whose line 12 calls an undefined function foo
  When I run it
  Then an error message reads "Script failed at line 12: ReferenceError: foo is not defined"
  And the Console shows the stack with positions written as script:12:COLUMN and no worker or blob URLs
  And the document is unchanged

Scenario: SCRIPT-013.3 Error without a script line
  Given an error whose stack does not point into the script
  When the run fails
  Then the message reads "Script failed: " followed by the error, without a line number

Scenario: SCRIPT-013.4 Output before the error is kept
  Given a script that logs "step 1" and then throws
  When I run it
  Then the Console shows "step 1" before the error

Scenario: SCRIPT-013.5 Console housekeeping
  Given the Console holds output from earlier runs
  When I click "Clear console"
  Then it is emptied and reads "Script output and messages appear here."
  And without clearing, only about the last 2,000 lines are kept
```

## SCRIPT-014: Script API Reference tab

- Status: draft
- Commands: `help.scriptApi`
- Files:
  - `src/lib/commands.ts` — `showScriptApi` (reuses an open tab, clears `dirty`)
  - `src/lib/scripting.ts` — `SCRIPT_API`, `SCRIPT_API_HELP`
  - `src/components/MenuBar.tsx` — Help menu item
- Tests: none
- Docs: `docs/scripting.md`

**As a** script author who does not remember the API
**I want** the reference one menu click away, as searchable text
**So that** I can look up a member and copy it into my script

```gherkin
Scenario: SCRIPT-014.1 Open the reference
  When I choose Help › Script API Reference
  Then an untitled tab named "Script API Reference.js" opens
  And it lists, as comments, the members of doc, selection, util, clipboard / console and the header comments @languages and @extensions

Scenario: SCRIPT-014.2 Closing it never asks to save
  Given the reference tab is open and I have not edited it
  When I close it
  Then it closes without a save prompt

Scenario: SCRIPT-014.3 One reference tab
  Given the reference tab is already open
  When I choose Help › Script API Reference again
  Then that tab comes to the front and no second tab is opened
```

## SCRIPT-015: Scripts folder location

- Status: draft
- Commands: none
- Files:
  - `src/lib/scripting.ts` — `scriptsDir`, `migrateLegacyScripts`
  - `src/lib/macros.ts` — `resolveFolder` (creates the folder, falls back and resets the setting), `cleanDirSetting`, `safeFileName`
  - `src/components/panels/SettingsPanel.tsx` — "Scripts folder" row (`changeFolder`)
  - `src/components/panels/ScriptsPanel.tsx` — re-roots the tree when `settings.scriptsDir` changes
  - `src/App.tsx` — runs `migrateLegacyScripts` at startup
- Tests: `src/__tests__/paths.test.ts`
- Docs: `docs/scripting.md`

**As a** developer who keeps scripts in a synced or version-controlled folder
**I want** to choose where Quarry looks for scripts, with a safe default
**So that** my scripts live where I manage them and are never lost to a bad setting

```gherkin
Scenario: SCRIPT-015.1 Default folder
  Given the Scripts folder setting is empty
  When I open the Scripts panel for the first time
  Then the folder "scripts" under Quarry's app data folder is created if missing and shown as the tree's root

Scenario: SCRIPT-015.2 Custom folder
  When I set Settings › Folders › Scripts folder to D:\tools\quarry-scripts
  Then the folder is created if it does not exist
  And the Scripts panel shows that folder, subfolders included

Scenario: SCRIPT-015.3 Unusable folder falls back
  Given the Scripts folder is set to a path that cannot be created
  When Quarry resolves the scripts folder
  Then the setting is reset to the default folder
  And one warning says the folder is not usable and that the setting was reset

Scenario: SCRIPT-015.4 Scripts from an old version are imported once
  Given app data holds a scripts.json from a version that stored scripts in one file
  When Quarry starts
  Then each script that was not built in is written as NAME.js in the scripts folder, unless a file of that name exists
  And characters not allowed in file names are replaced with "_"
  And the import does not happen again on the next start
```
