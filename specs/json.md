---
area: JSON Tools
prefix: JSON
---

# JSON Tools

The JSON panel (tree view of the current document), the path bar above the editor, paths and values copied from the cursor, strict validation, whitespace-only format / minify, and the JSON ↔ CSV and key-listing conversions. The tree of a file open in large-file mode belongs to the Large Files area. User documentation: `docs/json.md`.

## JSON-001: See the document as a tree in the JSON panel

- Status: draft
- Commands: `view.json`
- Files:
  - `src/components/panels/JsonPanel.tsx` — `JsonPanel` (windowed rows of 24 px, `rows` pre-order walk, `expandAll`, `nodeLabel`, 250 ms re-parse timer)
  - `src/lib/jsonModel.ts` — `getJsonTree` (cache per document version), `dropJsonTree`
  - `src/lib/jsonPath.ts` — `parseJsonTree`, `nodePreview`, `nodeKey`
- Tests: `src/__tests__/text.test.ts`, `src/__tests__/hostile.test.ts`
- Docs: `docs/json.md`

**As a** developer reading a JSON document
**I want** a collapsible tree of its structure beside the editor
**So that** I can see its shape without scrolling through the text

```gherkin
Scenario: JSON-001.1 Tree of the current document
  Given a text tab containing {"users": [{"name": "Ada"}], "total": 1e400}
  When I press Ctrl+Shift+J
  Then the JSON panel shows a root row "{root}" with the preview "{2}"
  And the row "users" shows "[1]"
  And the row "total" shows "1e400" exactly as written in the source

Scenario: JSON-001.2 The tree follows edits
  Given the JSON panel is open on a JSON document
  When I add a key "extra" in the editor and stop typing
  Then the row "extra" appears in the tree about 250 ms later

Scenario: JSON-001.3 Expand all and collapse all
  Given a document nested 20 levels deep
  When I click "Expand all"
  Then containers are opened down to 12 levels and no more than 50,000 containers are opened
  When I click "Collapse all"
  Then only the root row is open

Scenario: JSON-001.4 Empty and duplicate keys stay visible
  Given a document {"": 1, "a": 2, "a": 3}
  When I open the JSON panel
  Then the tree shows a row labelled "" (two quote characters) and two rows labelled "a"

Scenario: JSON-001.5 No text document
  Given no tab is open
  When I open the JSON panel
  Then it says "Open a JSON document to see its structure here."
  And the Format, Minify and Validate buttons are not shown
```

## JSON-002: Move between the tree and the editor

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/JsonPanel.tsx` — `reveal`, `updateCursor` (Follow cursor), `onRowKeyDown`, `focusRow`, roving `tabKey`
  - `src/lib/jsonPath.ts` — `nodeAtOffset` (binary search over children)
  - `src/lib/jsonModel.ts` — `getJsonTree`
- Tests: `src/__tests__/text.test.ts`, `src/__tests__/hostile.test.ts`
- Docs: `docs/json.md`

**As a** developer working in a large JSON document
**I want** the tree and the editor to point at the same value
**So that** I can jump to a value from the tree and see in the tree where my cursor is

```gherkin
Scenario: JSON-002.1 Click a node to select it in the editor
  Given the tree of {"users": [{"name": "Ada"}]}
  When I click the row "name"
  Then the editor selects from the key "name" to the end of its value "Ada"
  And the row is highlighted
  And keyboard focus stays in the tree

Scenario: JSON-002.2 Enter goes to the editor
  Given the row "name" has keyboard focus
  When I press Enter
  Then the value is selected in the editor and the editor has focus

Scenario: JSON-002.3 Follow cursor reveals the node under the cursor
  Given "Follow cursor" is on and the tree is collapsed to the root
  When I put the editor cursor inside "Ada"
  Then the ancestors of "name" are expanded
  And the row "name" is highlighted and scrolled into view

Scenario: JSON-002.4 Follow cursor off
  Given "Follow cursor" is off
  When I move the editor cursor to another value
  Then the highlighted row and the expanded rows do not change

Scenario: JSON-002.5 Keyboard navigation
  Given a tree row has keyboard focus
  When I press a navigation key
  Then Down and Up move to the next and previous row
  And Home and End move to the first and last row
  And Page Down and Page Up move by one panel height
  And Right opens a closed container or moves to its first child when it is open
  And Left closes an open container or moves to the parent row
  And Space opens or closes a container

Scenario: JSON-002.6 Double-click toggles a container
  When I double-click the row "users"
  Then the row opens if it was closed and closes if it was open
```

## JSON-003: Parse status while editing, and the tree's limits

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/JsonPanel.tsx` — status chip (Parsed / Lenient / Invalid / Empty document / Not JSON), `lastGood` stale tree, error button → `editor.goTo`
  - `src/lib/jsonPath.ts` — `parseJsonTree` (tolerant parser, `lenient` reason, `maxNodes` 2,000,000, iterative so depth is not limited by the call stack)
  - `src/lib/jsonModel.ts` — `MAX_TREE_BYTES` (64 MB) in `getJsonTree`
- Tests: `src/__tests__/hostile.test.ts`, `src/__tests__/text.test.ts`
- Docs: `docs/json.md`

**As a** developer editing JSON by hand
**I want** the panel to tell me whether the text parses and to keep the tree usable while it does not
**So that** a half-typed edit does not make the structure disappear

```gherkin
Scenario: JSON-003.1 Strict JSON
  Given a document {"a": 1}
  When I open the JSON panel
  Then the panel shows the chip "Parsed"

Scenario: JSON-003.2 Lenient constructs are accepted and named
  Given a document {"a": 1, } // note
  When I open the JSON panel
  Then the tree is shown
  And the chip reads "Lenient"
  And its tooltip names the first such construct and its line, and says Validate and Format need strict JSON

Scenario: JSON-003.3 What the tolerant parser accepts
  Given a document using // and /* */ comments, trailing commas, single-quoted strings, unquoted keys, NaN, Infinity or hex numbers
  When I open the JSON panel
  Then the tree is built and the chip reads "Lenient"

Scenario: JSON-003.4 Invalid text keeps the last good tree
  Given the tree of a valid document is shown
  When I delete a closing brace
  Then the chip reads "Invalid"
  And the last tree that parsed stays visible, dimmed
  And a button shows the error message followed by "— click to jump"
  When I click that button
  Then the editor cursor moves to the error position

Scenario: JSON-003.5 Empty and non-JSON documents
  Given an empty text tab
  When I open the JSON panel
  Then the chip reads "Empty document"
  When I switch to a Plain Text tab containing "hello"
  Then the chip reads "Invalid" and no tree is shown

Scenario: JSON-003.6 Size limits
  Given a document longer than 64 MB, or one with more than 2,000,000 values
  When I open the JSON panel
  Then no tree is built
  And the panel reports "Document too large for tree view"

Scenario: JSON-003.7 Deep nesting does not crash the panel
  Given a document of 10,000 nested arrays
  When I open the JSON panel
  Then the tree is built without an error
```

## JSON-004: Copy a value or its path from the tree

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/JsonPanel.tsx` — `copyPath`, `copyValue`, path format `Select`, row action buttons, Ctrl+C / Ctrl+Shift+C in `onRowKeyDown`
  - `src/lib/jsonPath.ts` — `formatPath`, `pathSegments`, `valueClipboardText`, `describeCopiedPath`
  - `src/lib/jsonModel.ts` — `PATH_STYLES`, `previewValue`
- Tests: `src/__tests__/text.test.ts`, `src/__tests__/hostile.test.ts`
- Docs: `docs/json.md`

**As a** developer writing code or a query against a JSON document
**I want** to copy a node's value or its path in the notation I need
**So that** I can paste it without typing it out or fixing the quoting

```gherkin
Scenario: JSON-004.1 Path in the chosen style
  Given the tree of {"users": [{"name": "Ada", "e-mail": "ada@example.com"}]}
  And the path format box is set to "JSONPath"
  When I press Ctrl+Shift+C on the row "e-mail"
  Then the clipboard contains $.users[0]['e-mail']
  And a message reads "Copied path: $.users[0]['e-mail']"

Scenario: JSON-004.2 The five styles
  Given the row "name" of the same document
  When I copy its path with each path format in turn
  Then the styles give these paths
    | Dot notation     | users[0].name         |
    | JSONPath         | $.users[0].name       |
    | JavaScript       | users[0].name         |
    | Bracket notation | ["users"][0]["name"]  |
    | JSON Pointer     | /users/0/name         |

Scenario: JSON-004.3 Awkward keys
  Given a key "a/b~c"
  When I copy its path
  Then its JSON Pointer is /a~1b~0c
  And the dot style writes the key unquoted
  And the JavaScript style writes ["a/b~c"]

Scenario: JSON-004.4 Root path
  Given the root row
  When I copy its path
  Then every style except JSON Pointer gives "$"
  And JSON Pointer gives the empty string, with the message 'Copied root pointer: "" (empty string)'

Scenario: JSON-004.5 Copy a value
  When I press Ctrl+C on the row "name"
  Then the clipboard contains Ada without quotes
  When I press Ctrl+C on the row "users"
  Then the clipboard contains the array's source text with the surrounding indentation removed
  And a message starting "Copied value:" shows at most 60 characters of it

Scenario: JSON-004.6 Row buttons
  When I hover a row and click "Copy value (Ctrl+C)" or "Copy path (Ctrl+Shift+C)"
  Then the same text is copied as with the keys
  And the editor selection does not change

Scenario: JSON-004.7 Row tooltip
  When I hover a row
  Then its tooltip is the node's path in the chosen style
```

## JSON-005: Copy the path of the value under the cursor

- Status: draft
- Commands: `json.copyPath`, `json.copyJsonPath`, `json.copyPointer`, `json.copyBracket`
- Files:
  - `src/lib/jsonModel.ts` — `copyJsonPath`, `jsonPathAtCursor`
  - `src/lib/jsonPath.ts` — `nodeAtOffset`, `pathSegments`, `formatPath`, `describeCopiedPath`
  - `src/lib/commands.ts` — registrations wrapped in `textDocOnly`
- Tests: `src/__tests__/text.test.ts`, `src/__tests__/hostile.test.ts`
- Docs: `docs/json.md`

**As a** developer editing a JSON file
**I want** to copy the path of the value my cursor is in without opening the panel
**So that** I can reference that value in code, a query or a message

```gherkin
Scenario: JSON-005.1 Dot path with the shortcut
  Given a JSON document {"users": [{"name": "Ada"}]} with the cursor inside "Ada"
  When I press Ctrl+Alt+P
  Then the clipboard contains users[0].name
  And a message reads "Copied path: users[0].name"

Scenario: JSON-005.2 Other styles from the JSON menu
  Given the same cursor position
  When I choose JSON › Copy JSONPath at Cursor
  Then the clipboard contains $.users[0].name
  When I choose JSON › Copy JSON Pointer at Cursor
  Then the clipboard contains /users/0/name
  When I choose JSON › Copy Bracket Path at Cursor
  Then the clipboard contains ["users"][0]["name"]

Scenario: JSON-005.3 Cursor on a key
  Given the cursor is inside the key "name"
  When I press Ctrl+Alt+P
  Then the clipboard contains users[0].name

Scenario: JSON-005.4 Nothing under the cursor
  Given the document does not parse, or the cursor is after the end of the root value
  When I press Ctrl+Alt+P
  Then a warning reads "Cursor is not inside a JSON value."
  And the clipboard is not changed
```

## JSON-006: Copy the value under the cursor

- Status: draft
- Commands: `json.copyValue`
- Files:
  - `src/lib/jsonModel.ts` — `copyJsonValue`, `previewValue`
  - `src/lib/jsonPath.ts` — `valueClipboardText`
  - `src/lib/commands.ts` — registration
- Tests: `src/__tests__/text.test.ts`
- Docs: `docs/json.md`

**As a** developer editing a JSON file
**I want** to copy the whole value my cursor is in
**So that** I get a string without its quotes, or a complete object, without selecting it by hand

```gherkin
Scenario: JSON-006.1 String value
  Given the cursor inside "Ada" in {"name": "Ada"}
  When I press Ctrl+Alt+C
  Then the clipboard contains Ada
  And a message reads "Copied value: Ada"

Scenario: JSON-006.2 Nested object is dedented
  Given a pretty-printed document and the cursor on the key of a nested object
  When I press Ctrl+Alt+C
  Then the clipboard contains the object's source text
  And its continuation lines have the smallest common indent removed

Scenario: JSON-006.3 Numbers are copied as written
  Given the cursor inside 0.10
  When I press Ctrl+Alt+C
  Then the clipboard contains 0.10

Scenario: JSON-006.4 Nothing under the cursor
  Given the document does not parse
  When I press Ctrl+Alt+C
  Then a warning reads "Cursor is not inside a JSON value."
```

## JSON-007: Path bar above the editor

- Status: draft
- Commands: none
- Files:
  - `src/components/CodeEditor.tsx` — `Breadcrumb` (60 ms after a cursor move, 300 ms after an edit, stale state)
  - `src/lib/jsonPath.ts` — `breadcrumbWindow`, `formatPath`, `nodeAtOffset`, `pathSegments`
  - `src/lib/jsonModel.ts` — `looksLikeJson`, `getJsonTree`
  - `src/styles/app.css` — `.breadcrumb`
- Tests: `src/__tests__/hostile.test.ts`
- Docs: `docs/json.md`

**As a** developer moving around a JSON document
**I want** a bar above the editor showing the path of the value under the cursor
**So that** I always know where I am and can copy that path with one click

```gherkin
Scenario: JSON-007.1 Path of the cursor
  Given a JSON document {"users": [{"name": "Ada"}]} open in a tab
  When I put the cursor inside "Ada"
  Then the bar above the editor shows $ › users › [0] › name
  And a button at its end shows users[0].name

Scenario: JSON-007.2 Copy from the bar
  When I click the segment "[0]"
  Then the clipboard contains users[0] and a message reads "Copied: users[0]"
  When I click the full-path button
  Then the clipboard contains users[0].name
  When I click "$"
  Then the clipboard contains $

Scenario: JSON-007.3 Shown for JSON-looking documents only
  Given a tab whose language is JSON, or whose text starts with { or [
  When I look above the editor
  Then the bar is shown, with only "$" when the cursor is not inside a value
  When I switch to a Plain Text tab containing "hello"
  Then no path bar is shown

Scenario: JSON-007.4 Invalid document keeps the last path
  Given the bar shows users › [0] › name
  When an edit makes the document invalid
  Then the bar keeps that path, greyed out, with the tooltip "Document has errors; showing the last known path"

Scenario: JSON-007.5 Very deep paths are shortened
  Given a document nested 100 levels deep
  When I put the cursor in the innermost value
  Then the bar shows the first 2 segments, "…" and the last 4 segments
  And the tooltip of "…" reads "94 more levels"
  And a segment label longer than 40 characters is cut with "…"
```

## JSON-008: Validate a JSON document

- Status: draft
- Commands: `json.validate`
- Files:
  - `src/lib/commands.ts` — `jsonValidate`, `jsoncDialect`, `jsonErrorText`, `toastOnce`, `clearValidationOnEdit`; `bigJsonValidate` hands a large-file tab to the Large Files area
  - `src/lib/ipc.ts` — `json.validate`
  - `src-tauri/src/lib.rs` — `json_validate` Tauri command
  - `src-tauri/src/json_tools.rs` — `validate`, `Scan::run`, `position` (line and UTF-16 column), error messages
  - `src/components/panels/JsonPanel.tsx` — Validate button in the panel header
- Tests: `src-tauri/src/json_tools.rs`
- Docs: `docs/json.md`

**As a** developer about to ship or send a JSON file
**I want** to check it against strict JSON and be taken to the first error
**So that** I find the exact mistake instead of a vague parse failure downstream

```gherkin
Scenario: JSON-008.1 Valid document
  Given a tab data.json containing {"a": [1, 2]}
  When I press Ctrl+Alt+V
  Then a message reads "Valid JSON ✓"
  And no error mark is shown in the editor

Scenario: JSON-008.2 Error is marked and the cursor moves to it
  Given data.json whose line 3 is  "b": 2,  followed by a closing brace on line 4
  When I press Ctrl+Alt+V
  Then a message reads "Invalid JSON at line 4, column 1: trailing comma"
  And the cursor moves to line 4, column 1
  And that position is marked in the editor with the message "trailing comma"

Scenario: JSON-008.3 The mark clears on the next edit
  Given Validate has marked an error
  When I type a character in that document
  Then the mark disappears

Scenario: JSON-008.4 Comments in plain JSON
  Given data.json containing a // comment
  When I validate
  Then the error message is "comments are not allowed in JSON (they are in JSONC)"

Scenario: JSON-008.5 JSONC files accept comments and trailing commas
  Given a tab named settings.jsonc, tsconfig.json, jsconfig.app.json, app.code-workspace, or a .json file inside a .vscode folder
  And it contains comments and a trailing comma
  When I validate
  Then a message reads "Valid JSONC ✓"

Scenario: JSON-008.6 JSON5 files are checked as JSONC
  Given a tab config.json5 containing an unquoted key
  When I validate
  Then the error message names the dialect JSON5
  And it adds that Quarry checks JSON5 files as JSONC: comments and trailing commas are fine, unquoted keys and single quotes are not

Scenario: JSON-008.7 Byte-order mark and repeated presses
  Given a valid document that starts with a byte-order mark
  When I validate
  Then it is reported valid
  Given an invalid document
  When I press Ctrl+Alt+V three times
  Then the same error message is shown once, not stacked three times

Scenario: JSON-008.8 Specific messages
  Given a document with one syntax error
  When I validate
  Then Validate reports, as the case may be, "expected `,` or `}`", "expected `,` or `]`", "expected `:`", "key must be a string", "invalid escape", "invalid \u escape (expected 4 hex digits)", "invalid number (leading zero)", "trailing characters", "expected value" or "unterminated comment"
  And columns count UTF-16 code units, as the editor's status bar does
```

## JSON-009: Pretty-print JSON without changing its values

- Status: draft
- Commands: `json.format`
- Files:
  - `src/lib/commands.ts` — `jsonTransform("format")`, `jsonErrorText`
  - `src/lib/ipc.ts` — `json.format`
  - `src-tauri/src/lib.rs` — `json_format` Tauri command
  - `src-tauri/src/json_tools.rs` — `format`, `Layout::Pretty`, `Scan::comment`, `Scan::newline`, `PRETTY_MIN_CAP`
  - `src/lib/jsonModel.ts` — `dropJsonTree` after the replacement
  - `src/components/panels/JsonPanel.tsx` — Format button in the panel header
- Tests: `src-tauri/src/json_tools.rs`
- Docs: `docs/json.md`

**As a** developer handed a minified or badly indented JSON file
**I want** to pretty-print it with my indent settings
**So that** I can read it, knowing no number, string or key was altered

```gherkin
Scenario: JSON-009.1 Pretty-print
  Given a JSON document {"b":1,"a":[1,2]} and Settings › JSON › Pretty-print indent = 2
  When I press Ctrl+Alt+F
  Then the document becomes 8 lines: each key and each array element on its own line, indented 2 spaces per level, with ": " after keys
  And "b" still comes before "a"
  And a message reads "JSON formatted"
  And one Ctrl+Z restores the original text

Scenario: JSON-009.2 Indent settings
  Given Pretty-print indent = 4
  When I format a JSON document
  Then nested lines are indented 4 spaces per level
  Given "Insert spaces" is off
  When I format a JSON document
  Then nested lines are indented with one tab per level

Scenario: JSON-009.3 Only whitespace changes
  Given a document containing 1e400, -0, 0.10, a 40-digit integer, a "é" escape, an unpaired "\ud800" escape and two keys named "a"
  When I format it
  Then every one of those is present exactly as written, and both "a" keys are kept in order

Scenario: JSON-009.4 Empty containers stay on one line
  Given {"a":{},"b":[]}
  When I format it
  Then "a" is followed by {} and "b" by [] on their own lines

Scenario: JSON-009.5 Comments and trailing commas are kept
  Given a document with a // comment after a value on the same line, a comment on its own line and a trailing comma
  When I format it
  Then the first comment stays beside its value, the second stays on its own line, and the trailing comma is kept

Scenario: JSON-009.6 Invalid JSON is not changed
  Given a document with an error at line 2, column 7
  When I press Ctrl+Alt+F
  Then the text is unchanged
  And the cursor moves to line 2, column 7
  And a message starts "Invalid JSON at line 2, column 7:"

Scenario: JSON-009.7 Deep nesting
  Given 1,000 nested arrays
  When I format it
  Then it succeeds
  Given nesting so deep that the indented output would exceed 64 MB and 16 times the input size
  When I format it
  Then a warning starts "Cannot pretty-print: the formatted output would exceed"
  And the text is unchanged
```

## JSON-010: Minify JSON

- Status: draft
- Commands: `json.minify`
- Files:
  - `src/lib/commands.ts` — `jsonTransform("minify")`
  - `src/lib/ipc.ts` — `json.minify`
  - `src-tauri/src/lib.rs` — `json_minify` Tauri command
  - `src-tauri/src/json_tools.rs` — `minify`, `Layout::Minify`, `stripped`
  - `src/components/panels/JsonPanel.tsx` — Minify button in the panel header
- Tests: `src-tauri/src/json_tools.rs`
- Docs: `docs/json.md`

**As a** developer preparing JSON for a request body or a config value
**I want** to collapse the document to its shortest strict-JSON form
**So that** I can paste it on one line without changing its content

```gherkin
Scenario: JSON-010.1 Minify
  Given a pretty-printed JSON document with keys "b" then "a"
  When I press Ctrl+Alt+M
  Then all whitespace between tokens is removed
  And "b" still comes before "a"
  And a message reads "JSON minified"
  And one Ctrl+Z restores the original text

Scenario: JSON-010.2 Number text and duplicate keys are kept
  Given { "a": 1e400, "a": -0, "n": 0.10 }
  When I minify it
  Then the result is {"a":1e400,"a":-0,"n":0.10}

Scenario: JSON-010.3 Comments and trailing commas are removed
  Given { "a": 1, /* note */ "b": [1, 2,], }
  When I minify it
  Then the result is {"a":1,"b":[1,2]}
  And the message reads "JSON minified (comments and trailing commas removed)"

Scenario: JSON-010.4 Invalid JSON is not changed
  Given a document with a missing colon
  When I press Ctrl+Alt+M
  Then the text is unchanged, the cursor moves to the error and a message starts "Invalid JSON at line"
```

## JSON-011: Convert JSON to CSV

- Status: draft
- Commands: `json.toCsv`
- Files:
  - `src/lib/convert.ts` — `jsonToCsv`, `csvCell`
  - `src/lib/commands.ts` — `json.toCsv` registration (replaces the document with `editor.replaceAll`)
- Tests: `src/__tests__/text.test.ts`, `src/__tests__/csv-hostile.test.ts`
- Docs: `docs/json.md`

**As a** data analyst with records in a JSON file
**I want** to turn them into CSV in place
**So that** I can open them in a spreadsheet

```gherkin
Scenario: JSON-011.1 Array of objects
  Given a JSON document [{"a":1,"b":"x,y"},{"a":2,"c":{"d":1}}]
  When I choose JSON › Convert JSON → CSV
  Then the document becomes three lines
    | a,b,c           |
    | 1,"x,y",        |
    | 2,,"{""d"":1}"  |
  And a message reads "Converted 2 records, 3 columns. Use Save As to keep it as .csv."
  And one Ctrl+Z restores the JSON

Scenario: JSON-011.2 Columns and cells
  Given an array of objects with different keys, nulls and nested values
  When I convert it
  Then columns are the top-level keys in first-seen order across all records
  And null and missing keys become empty cells
  And nested objects and arrays are written as JSON text
  And cells containing a double quote, a comma or a line break are quoted, with quotes doubled

Scenario: JSON-011.3 A single object
  Given {"a":1,"b":2}
  When I convert it
  Then the result is a header row "a,b" and one row "1,2"
  And the message reads "Converted 1 record, 2 columns. Use Save As to keep it as .csv."

Scenario: JSON-011.4 Not records
  Given [1, 2, 3]
  When I convert it
  Then an error reads "Cannot convert: Expected an object or an array of objects."
  And the document is unchanged

Scenario: JSON-011.5 Invalid JSON
  Given a document that is not strict JSON, for example one with a comment
  When I convert it
  Then an error starting "Cannot convert:" gives the parser's message
  And the document is unchanged

Scenario: JSON-011.6 File name is kept
  Given the tab data.json
  When I convert it to CSV
  Then the tab is still named data.json and is marked modified
```

## JSON-012: Convert CSV or TSV to JSON

- Status: draft
- Commands: `json.fromCsv`
- Files:
  - `src/lib/convert.ts` — `csvToJson`, `csvRecords` (RFC 4180 records), `sniffDelimiter`, `csvSplit`
  - `src/lib/commands.ts` — `json.fromCsv` registration, `isCsvDoc`, `autoShowJsonPanel`
- Tests: `src/__tests__/csv-hostile.test.ts`, `src/__tests__/text.test.ts`
- Docs: `docs/json.md`

**As a** data analyst with a CSV export
**I want** to turn it into a JSON array of objects in place
**So that** I can feed it to a tool or API that expects JSON

```gherkin
Scenario: JSON-012.1 Comma-separated file
  Given a tab people.csv containing the lines "name,age" and "Ada,36"
  When I choose JSON › Convert CSV → JSON
  Then the document becomes an array with one object {"name": "Ada", "age": "36"}, indented with the Pretty-print indent
  And "36" is a string
  And the tab's language becomes JSON
  And a message reads "Converted 1 row to JSON (values kept as strings). Use Save As to keep it as .json."
  And one Ctrl+Z restores the CSV text

Scenario: JSON-012.2 Only offered for CSV and TSV files
  Given a tab named notes.txt
  When I open the JSON menu
  Then Convert CSV → JSON is greyed out
  When I switch to a tab named data.tsv and open the JSON menu
  Then it is available

Scenario: JSON-012.3 Delimiter is detected
  Given a file whose columns are separated by semicolons, tabs or pipes
  When I convert it
  Then the columns are split on that delimiter
  And a warning reads "Detected semicolon-separated values.", "Detected tab-separated values." or "Detected pipe-separated values."

Scenario: JSON-012.4 Quoted cells
  Given a cell written as "a ""quoted"", cell" followed by a line break inside the quotes
  When I convert the file
  Then that cell is one string containing the quotes, the comma and the line break

Scenario: JSON-012.5 Header problems are repaired and reported
  Given the header row "name,,name"
  When I convert the file
  Then the keys are "name", "column_2" and "name_2"
  And a warning reads '2 header names were empty or duplicated and renamed (e.g. "name_2").'

Scenario: JSON-012.6 Rows of the wrong length
  Given a header of 2 columns, a row with 3 cells and a row with 1 cell
  When I convert the file
  Then the first row's third cell is kept in an "_extra" array
  And the second row's missing cell is the empty string
  And one warning reports the row with more cells and another the row with fewer

Scenario: JSON-012.7 Blank lines and line endings
  Given a file with blank lines between rows, CR-only line endings, or no final line break
  When I convert it
  Then blank lines produce no objects and every row is converted

Scenario: JSON-012.8 Nothing to convert
  Given an empty .csv tab
  When I convert it
  Then an error reads "Cannot convert: The document is empty."
  Given a .csv tab with only a header row
  When I convert it
  Then an error reads "Cannot convert: Only a header row was found; there are no data rows to convert."
  Given a .csv tab with one column and no delimiter anywhere
  When I convert it
  Then an error says that it does not look like CSV or TSV
  And in each case the document is unchanged
```

## JSON-013: Copy the top-level keys

- Status: draft
- Commands: `json.copyKeys`
- Files:
  - `src/lib/convert.ts` — `topLevelKeys`
  - `src/lib/commands.ts` — `json.copyKeys` registration
- Tests: `src/__tests__/text.test.ts`
- Docs: `docs/json.md`

**As a** developer documenting or mapping a JSON payload
**I want** the list of its top-level keys on the clipboard
**So that** I can paste the field names somewhere else

```gherkin
Scenario: JSON-013.1 Keys of an object
  Given a JSON document {"id": 1, "name": "Ada", "tags": []}
  When I choose JSON › Copy Top-level Keys
  Then the clipboard contains "id", "name" and "tags", one per line
  And a message reads "Copied 3 keys to the clipboard"
  And the document is unchanged

Scenario: JSON-013.2 Array of objects uses the first element
  Given [{"a": 1, "b": 2}, {"c": 3}]
  When I copy the top-level keys
  Then the clipboard contains "a" and "b"

Scenario: JSON-013.3 No keys to list
  Given a document containing only 42
  When I copy the top-level keys
  Then an error reads "Cannot read keys: Root value has no keys."

Scenario: JSON-013.4 Invalid JSON
  Given a document that is not strict JSON
  When I copy the top-level keys
  Then an error starting "Cannot read keys:" gives the parser's message
```

## JSON-014: JSON commands are offered only where they apply

- Status: draft
- Commands: `json.format`, `json.minify`, `json.validate`, `json.copyPath`, `json.copyJsonPath`, `json.copyPointer`, `json.copyBracket`, `json.copyValue`, `json.toCsv`, `json.copyKeys`, `json.fromCsv`
- Files:
  - `src/lib/commands.ts` — `applyDefaultEnabled` (`json.*` → `hasJson`), `isBigJson`, `isCsvDoc`, `textDocOnly`, `runCommand` / `handleKeyEvent` (disabled commands are no-ops)
  - `src/components/MenuBar.tsx` — JSON menu items
  - `src/components/panels/JsonPanel.tsx` — header buttons run the same commands and are disabled when the command is (`getCommand` + `isEnabled`)
- Tests: none
- Docs: `docs/json.md`

**As a** developer switching between JSON and other files
**I want** the JSON commands greyed out where they cannot work
**So that** a shortcut never reformats or converts the wrong kind of document

```gherkin
Scenario: JSON-014.1 Available in a JSON document
  Given a text tab whose language is JSON
  When I open the JSON menu
  Then Format, Minify, Validate, the Copy … at Cursor commands, Convert JSON → CSV and Copy Top-level Keys are enabled in the JSON menu
  And they are listed in the command palette when I type "json"

Scenario: JSON-014.2 Greyed out elsewhere
  Given a text tab whose language is Markdown
  Then those commands are greyed out in the JSON menu and absent from the command palette
  When I press Ctrl+Alt+F
  Then the document is unchanged
  And a message reads "JSON: Format / Pretty-print is not available here"

Scenario: JSON-014.3 Pasted JSON counts as JSON
  Given a new untitled tab
  When I paste {"a": 1} into it
  Then the tab's language is JSON and the JSON commands are enabled

Scenario: JSON-014.4 Large-file JSON tabs offer Validate only
  Given a file big.json open in large-file mode
  When I open the JSON menu
  Then Validate is enabled
  And Format, Minify, the copy commands and the conversions are greyed out

Scenario: JSON-014.5 Panel buttons obey the same rule
  Given a Plain Text tab whose text happens to parse as JSON, with the JSON panel open
  When I look at the panel header
  Then the Format, Minify and Validate buttons are greyed out
  And their tooltips say to set the language to JSON first
  When I set the tab's language to JSON
  Then the three buttons are enabled
```
