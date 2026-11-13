---
area: Formatting
prefix: FMT
---

# Formatting

Format Document for text tabs: which formatter runs for which language (Quarry's JSON formatter, bundled Prettier, an installed command-line tool, or a bundled WebAssembly / JS formatter), formatting a selection, and how failures are reported. User documentation: `docs/formatting.md`.

## FMT-001: Format the current document

- Status: draft
- Commands: `code.format`
- Files:
  - `src/lib/format.ts` — `formatDocument` (read-only guard, picks the formatter from the document's language, "Already formatted", success toast), `canFormat`
  - `src/lib/commands.ts` — `code.format` (`textDocOnly`, Shift+Alt+F)
  - `src/editor/manager.ts` — `replaceAll` (one transaction replacing only the part between the common prefix and suffix)
  - `src/components/MenuBar.tsx` — Code › Format Document
- Tests: `src/__tests__/format.test.ts`
- Docs: `docs/formatting.md`

**As a** developer
**I want** one command that reformats the file in front of me according to its language
**So that** I don't have to remember a different tool for each language

```gherkin
Scenario: FMT-001.1 Format with the shortcut
  Given a TypeScript tab with badly indented code
  When I press Shift+Alt+F
  Then the code is reformatted
  And a notice says "Formatted (TypeScript)"
  And the tab is marked as changed

Scenario: FMT-001.2 Format from the menu or the palette
  Given a CSS tab with badly indented rules
  When I choose Code › Format Document
  Then the rules are reformatted
  And running "Code: Format Document" from the command palette does the same

Scenario: FMT-001.3 The formatter follows the tab's language
  Given the same text in two tabs, one with the language "JSON" and one with the language "YAML"
  When I press Shift+Alt+F in each
  Then the first is formatted as JSON and the second as YAML

Scenario: FMT-001.4 A read-only document is not formatted
  Given "data.json" opened read-only and badly indented
  When I press Shift+Alt+F
  Then the document is unchanged
  And a notice says "data.json is read-only."
```

## FMT-002: Format Document is one undo step and reports when nothing changed

- Status: draft
- Commands: `code.format`
- Files:
  - `src/lib/format.ts` — `formatDocument` (`out === text` → "Already formatted"; "No formatter for …")
  - `src/editor/manager.ts` — `replaceAll`, `dispatchTo` (marks the tab changed only when the text changed)
- Tests: `src/__tests__/format.test.ts`
- Docs: `docs/formatting.md`

**As a** developer
**I want** formatting to be undoable in one step and to tell me when it had nothing to do
**So that** I can trust it and back out of it

```gherkin
Scenario: FMT-002.1 One undo step
  Given I formatted a 300-line CSS file and many lines changed
  When I press Ctrl+Z once
  Then the file is exactly as it was before formatting

Scenario: FMT-002.2 Already formatted
  Given a saved CSS file that is already formatted
  When I press Shift+Alt+F
  Then a notice says "Already formatted"
  And the tab is not marked as changed

Scenario: FMT-002.3 A language without a formatter
  Given a tab with the language "Plain Text"
  When I press Shift+Alt+F
  Then the document is unchanged
  And a notice says "No formatter for Plain Text. Use Code › Language to pick the right language."

Scenario: FMT-002.4 Only text tabs
  Given the active tab is a large-file tab
  When I open the Code menu
  Then Format Document is greyed out
```

## FMT-003: Format JSON with Quarry's own formatter

- Status: draft
- Commands: `code.format`
- Files:
  - `src/lib/format.ts` — `formatDocument`, the `lang === "JSON"` branch (`jsonIndent`, tabs when `insertSpaces` is off, error toast and cursor to the error via `editor.goTo`; an error at line 0 = valid JSON whose output is too large)
  - `src/lib/ipc.ts` — `json.format` → Tauri `json_format`
  - `src-tauri/src/lib.rs` — `json_format`
  - `src-tauri/src/json_tools.rs` — `format` (token-preserving pretty printer: key order, number text, comments kept), `PRETTY_MIN_CAP`
- Tests: `src-tauri/src/json_tools.rs`, `src/__tests__/format.test.ts`
- Docs: `docs/formatting.md`, `docs/json.md`

**As a** person working with JSON files
**I want** Format Document to pretty-print JSON without changing its data
**So that** key order and long numbers are exactly as they were

```gherkin
Scenario: FMT-003.1 Pretty-print with the JSON indent setting
  Given a JSON tab containing {"b":1,"a":[1,2]} and "Pretty-print indent" set to 2
  When I press Shift+Alt+F
  Then the document is spread over several lines indented by 2 spaces
  And the key "b" still comes before "a"

Scenario: FMT-003.2 Numbers are kept as written
  Given a JSON tab containing {"n": 12345678901234567890.10}
  When I press Shift+Alt+F
  Then the number still reads 12345678901234567890.10

Scenario: FMT-003.3 Tabs when Insert spaces is off
  Given "Insert spaces" is off
  When I format a JSON tab
  Then each nesting level is indented with one tab character

Scenario: FMT-003.4 Comments and trailing commas are accepted and kept
  Given a JSON tab containing a "// note" comment and a trailing comma
  When I press Shift+Alt+F
  Then the document is pretty-printed
  And the comment is still there

Scenario: FMT-003.5 Invalid JSON is left alone
  Given a JSON tab with a missing closing brace on line 3
  When I press Shift+Alt+F
  Then the document is unchanged
  And the cursor is moved to the place of the error on line 3
  And an error says "JSON is not valid:" followed by the parser's message and "(line 3)"

Scenario: FMT-003.6 Valid JSON whose pretty-printed text would be too large
  Given a JSON tab nested so deeply that the pretty-printed text would exceed both 64 MB and 16 times the document's size
  When I press Shift+Alt+F
  Then the document is unchanged
  And a warning starts with "Cannot pretty-print:", not "JSON is not valid"
```

## FMT-004: Format web languages with the bundled Prettier

- Status: draft
- Commands: `code.format`
- Files:
  - `src/lib/format.ts` — `PRETTIER` table (language → parser and plugins, all loaded with dynamic `import()` on first use), Prettier options in `formatDocument` (`tabWidth`, `useTabs`, `printWidth: 100`, `endOfLine: "lf"`, `xmlWhitespaceSensitivity: "ignore"`, `bracketSameLine: false`)
- Tests: `src/__tests__/format.test.ts`
- Docs: `docs/formatting.md`

**As a** web developer
**I want** JavaScript, TypeScript, CSS, HTML, Markdown, YAML and similar files formatted by Prettier with nothing to install
**So that** formatting works on any machine

```gherkin
Scenario Outline: FMT-004.1 Languages Prettier formats
  Given a tab with the language <language>
  When I press Shift+Alt+F
  Then the document is formatted by Prettier
  And a notice says "Formatted (<language>)"

  Examples:
    | language   |
    | JavaScript |
    | JSX        |
    | TypeScript |
    | TSX        |
    | CSS        |
    | SCSS       |
    | Less       |
    | HTML       |
    | Vue        |
    | Angular    |
    | Markdown   |
    | YAML       |
    | GraphQL    |
    | XML        |
    | SVG        |

Scenario: FMT-004.2 Tab size and Insert spaces are used
  Given "Tab size" 2 and "Insert spaces" on
  When I format a JavaScript tab holding a function with a nested block
  Then nested lines are indented in steps of 2 spaces

Scenario: FMT-004.3 Lines are wrapped at 100 columns
  Given a JavaScript tab with one call expression 160 characters long
  When I press Shift+Alt+F
  Then the call is broken over several lines, none longer than 100 characters

Scenario: FMT-004.4 XML ignores whitespace between tags
  Given an XML tab with all elements on one line
  When I press Shift+Alt+F
  Then each element is on its own line, indented by nesting level

Scenario: FMT-004.5 The language of the tab decides, not the file name
  Given an untitled tab holding JavaScript whose language is "Plain Text"
  When I set the language to "JavaScript" and press Shift+Alt+F
  Then the document is formatted
```

## FMT-005: Format only the selection

- Status: draft
- Commands: `code.format`
- Files:
  - `src/lib/format.ts` — `hasRange` (non-empty main selection and a Prettier target with `range`: the babel, typescript, graphql and vue parsers, the only ones Prettier 3 range-formats; other parsers return the text unchanged for a range), `rangeStart` / `rangeEnd`, "Formatted selection" toast
- Tests: `src/__tests__/format.test.ts`
- Docs: `docs/formatting.md`

**As a** developer touching one function in a file I don't own
**I want** to format just what I selected
**So that** I don't reformat the rest of the file

```gherkin
Scenario: FMT-005.1 Format a selected function
  Given a JavaScript tab with two badly formatted functions and the second one selected
  When I press Shift+Alt+F
  Then the second function is reformatted
  And the first function is unchanged
  And a notice says "Formatted selection"

Scenario: FMT-005.2 No selection formats the whole document
  Given a JavaScript tab with nothing selected
  When I press Shift+Alt+F
  Then the whole document is formatted
  And a notice says "Formatted (JavaScript)"

Scenario: FMT-005.3 Other formatters always take the whole document
  Given a Python tab with 3 lines selected
  When I press Shift+Alt+F
  Then the whole document is formatted
  And the notice names the formatter, not "Formatted selection"

Scenario: FMT-005.4 Prettier languages without range formatting take the whole document
  Given a CSS tab with two badly formatted rules and the first one selected
  When I press Shift+Alt+F
  Then both rules are reformatted
  And a notice says "Formatted (CSS)"
  And the same holds for SCSS, Less, HTML, Angular, Markdown, YAML and XML
```

## FMT-006: Prefer the formatter installed on the machine

- Status: draft
- Commands: `code.format`
- Files:
  - `src/lib/format.ts` — `CODE` table (`external`: tool, arguments, install hint, `missing` pattern), the external branch of `formatDocument` (working folder = the document's folder, "Formatted (Python, ruff)")
  - `src/lib/ipc.ts` — `sys.formatExternal`
  - `src-tauri/src/lib.rs` — `format_external` / `run_formatter` (spawns the tool without a console window, document on stdin from a feeder thread, stdout returned, stderr or stdout as the error, `not_found`)
- Tests: `src/__tests__/format.test.ts`, `src-tauri/src/lib.rs`
- Docs: `docs/formatting.md`

**As a** developer whose project has its own formatter configuration
**I want** Quarry to run my installed formatter in the file's folder
**So that** the result matches my command line, my other editor and CI

```gherkin
Scenario Outline: FMT-006.1 The installed tool is used when it is on PATH
  Given <tool> is installed and on PATH
  And a saved <language> file is open
  When I press Shift+Alt+F
  Then the document is replaced by the output of "<command>"
  And a notice says "Formatted (<language>, <tool>)"

  Examples:
    | language | tool               | command                              |
    | Rust     | rustfmt            | rustfmt --edition 2021 --emit stdout |
    | Go       | gofmt              | gofmt                                |
    | Python   | ruff               | ruff format -                        |
    | C        | clang-format       | clang-format                         |
    | C++      | clang-format       | clang-format                         |
    | C#       | dotnet             | dotnet csharpier --                  |
    | Java     | google-java-format | google-java-format -                 |
    | Shell    | shfmt              | shfmt -                              |
    | SQL      | sqlfluff           | sqlfluff fix -                       |

Scenario: FMT-006.2 Project configuration is found
  Given "C:\proj\src\main.rs" is open and "C:\proj\src\rustfmt.toml" sets max_width = 60
  When I press Shift+Alt+F
  Then the result is wrapped at 60 columns

Scenario: FMT-006.3 No console window
  Given ruff is installed
  When I format a Python tab
  Then no console window appears

Scenario: FMT-006.4 The tool's error is shown and nothing is changed
  Given gofmt is installed and the Go tab has a syntax error on line 2
  When I press Shift+Alt+F
  Then the document is unchanged
  And an error starts with "gofmt failed:" followed by gofmt's own message
  And the built-in formatter is not tried

Scenario: FMT-006.5 An untitled document is formatted too
  Given rustfmt is installed and an untitled tab has the language "Rust"
  When I press Shift+Alt+F
  Then the document is formatted
```

## FMT-007: Built-in formatters when the tool isn't installed

- Status: draft
- Commands: `code.format`
- Files:
  - `src/lib/format.ts` — `CODE` table (`builtin`), `clangFormat` / `clangStyle`, `sqlBuiltin`, fallback when the tool is not found or matches `missing` (C#: dotnet with an SDK prints "Could not execute because the specified command or file was not found"; dotnet with only a runtime prints "The command could not be loaded … The application 'csharpier' does not exist"; the pattern matches both); each formatter is a dynamic `import()` (`@wasm-fmt/gofmt`, `@wasm-fmt/ruff_fmt`, `@wasm-fmt/clang-format`, `@wasm-fmt/shfmt`, `prettier-plugin-java`, `sql-formatter`)
  - `src-tauri/src/lib.rs` — `format_external` reports `not_found` when the program cannot be started
- Tests: `src/__tests__/format.test.ts`, `src-tauri/src/lib.rs`
- Docs: `docs/formatting.md`

**As a** person on a machine without developer tools
**I want** Go, Python, C, C++, C#, Java, Shell and SQL formatted by formatters that ship with Quarry
**So that** Format Document works out of the box, offline

```gherkin
Scenario Outline: FMT-007.1 Built-in formatter per language
  Given no formatter for <language> is installed
  And a tab with the language <language>
  When I press Shift+Alt+F
  Then the document is formatted
  And a notice says "Formatted (<language>, <formatter>)"

  Examples:
    | language    | formatter                     |
    | Go          | built-in gofmt                |
    | Python      | built-in ruff                 |
    | C           | built-in clang-format         |
    | C++         | built-in clang-format         |
    | C#          | built-in clang-format         |
    | Java        | built-in prettier-plugin-java |
    | Shell       | built-in shfmt                |
    | SQL         | built-in sql-formatter        |
    | MySQL       | built-in sql-formatter        |
    | MariaDB SQL | built-in sql-formatter        |
    | PostgreSQL  | built-in sql-formatter        |
    | MS SQL      | built-in sql-formatter        |
    | SQLite      | built-in sql-formatter        |
    | PLSQL       | built-in sql-formatter        |

Scenario: FMT-007.2 Tab size and Insert spaces are used
  Given "Tab size" 2, "Insert spaces" on and clang-format not installed
  When I format a C++ tab
  Then nested blocks are indented in steps of 2 spaces
  And lines are wrapped at 100 columns

Scenario: FMT-007.3 gofmt always uses tabs
  Given "Insert spaces" is on and Go is not installed
  When I format a Go tab
  Then the code is indented with tab characters

Scenario: FMT-007.4 SQL dialect tabs never look for an installed tool
  Given sqlfluff is installed and a tab has the language "PostgreSQL"
  When I press Shift+Alt+F
  Then a notice says "Formatted (PostgreSQL, built-in sql-formatter)"

Scenario: FMT-007.5 dotnet without CSharpier falls back
  Given dotnet is installed but the csharpier tool is not
  When I format a C# tab
  Then a notice says "Formatted (C#, built-in clang-format)"
  And the same happens when dotnet has a runtime but no SDK
```

## FMT-008: Rust needs rustfmt

- Status: draft
- Commands: `code.format`
- Files:
  - `src/lib/format.ts` — `CODE.Rust` (external only, `install` hint), the "is not installed" warning in `formatDocument`
  - `src-tauri/src/lib.rs` — `format_external` (`not_found`)
- Tests: `src/__tests__/format.test.ts`, `src-tauri/src/lib.rs`
- Docs: `docs/formatting.md`

**As a** person opening a Rust file without the Rust toolchain
**I want** to be told how to get the formatter
**So that** I know why nothing happened and what to install

```gherkin
Scenario: FMT-008.1 rustfmt is missing
  Given rustfmt is not on PATH and a Rust tab is open
  When I press Shift+Alt+F
  Then the document is unchanged
  And a warning says "rustfmt is not installed. To format Rust: rustup component add rustfmt"

Scenario: FMT-008.2 rustfmt is installed
  Given rustfmt is on PATH and a Rust tab is open
  When I press Shift+Alt+F
  Then a notice says "Formatted (Rust, rustfmt)"
```

## FMT-009: Syntax errors leave the document unchanged

- Status: draft
- Commands: `code.format`
- Files:
  - `src/lib/format.ts` — `formatDocument`'s `catch` ("Format failed: " + the first line of the formatter's message, shown for 6 s; returns false)
- Tests: `src/__tests__/format.test.ts`
- Docs: `docs/formatting.md`

**As a** developer formatting a file I'm in the middle of editing
**I want** a formatter that can't parse the file to change nothing and say where the problem is
**So that** I never get half-formatted or damaged code

```gherkin
Scenario: FMT-009.1 Prettier cannot parse the file
  Given a JavaScript tab containing "function f(a {" on line 1
  When I press Shift+Alt+F
  Then the document is unchanged
  And an error says 'Format failed: Unexpected token, expected "," (1:14)'
  And for an unclosed CSS block it says "Format failed: CssSyntaxError: Unclosed block (1:1)"

Scenario: FMT-009.2 A built-in formatter cannot parse the file
  Given Go is not installed and the Go tab has a syntax error on line 2, column 12
  When I press Shift+Alt+F
  Then the document is unchanged
  And an error says "Format failed:" followed by the position "2:12" and gofmt's message, for example "Format failed: 2:12: expected '}', found 'EOF'"

Scenario: FMT-009.3 Only the first line of a long message is shown
  Given a formatter fails with a message of several lines, including a code frame
  When the error is shown
  Then it contains only the first line of that message

Scenario: FMT-009.4 The built-in ruff gives a byte range, not a line
  Given ruff is not installed and a Python tab starts with "def f(:"
  When I press Shift+Alt+F
  Then the document is unchanged
  And an error says "Format failed: Expected a parameter or the end of the parameter list at byte range 6..7"
```

## FMT-010: JSON pretty-print and minify commands

- Status: draft
- Commands: `json.format`, `json.minify`
- Files:
  - `src/lib/commands.ts` — `jsonTransform` (error → cursor to the error and one toast via `toastOnce`; line 0 → "Cannot pretty-print / minify"; `dropJsonTree`), `jsonErrorText`, the two registrations (enabled only for JSON text tabs)
  - `src/lib/ipc.ts` — `json.format`, `json.minify`
  - `src-tauri/src/lib.rs` — `json_format`, `json_minify`
  - `src-tauri/src/json_tools.rs` — `format`, `minify` (`stripped` when comments or trailing commas were removed), `PRETTY_MIN_CAP`
  - `src/editor/manager.ts` — `replaceAll`, `goTo`
- Tests: `src-tauri/src/json_tools.rs`
- Docs: `docs/json.md`, `docs/keyboard-shortcuts.md`

**As a** person working with JSON
**I want** shortcuts that pretty-print or minify the document and take me to the error when it isn't valid
**So that** I can switch between readable and compact JSON and fix mistakes quickly

```gherkin
Scenario: FMT-010.1 Pretty-print
  Given a JSON tab containing {"a":1,"b":[1,2]}
  When I press Ctrl+Alt+F
  Then the document is pretty-printed with the "Pretty-print indent" setting
  And a notice says "JSON formatted"

Scenario: FMT-010.2 Minify
  Given a pretty-printed JSON tab
  When I press Ctrl+Alt+M
  Then the document is one line with no spaces between tokens
  And key order and the text of every number are unchanged
  And a notice says "JSON minified"

Scenario: FMT-010.3 Minify removes comments and trailing commas, and says so
  Given a JSON tab with a "// note" comment and a trailing comma
  When I press Ctrl+Alt+M
  Then the result is strict JSON without the comment or the trailing comma
  And a notice says "JSON minified (comments and trailing commas removed)"

Scenario: FMT-010.4 Invalid JSON moves the cursor to the error
  Given a JSON tab with a stray comma at line 3, column 5
  When I press Ctrl+Alt+F
  Then the document is unchanged
  And the cursor is at line 3, column 5
  And an error starts with "Invalid JSON at line 3, column 5:"

Scenario: FMT-010.5 Pressing the shortcut again does not stack errors
  Given the error from pretty-printing invalid JSON is still on screen
  When I press Ctrl+Alt+F again
  Then there is still only one copy of that error

Scenario: FMT-010.6 Output too large to build
  Given a JSON tab nested so deeply that the pretty-printed text would exceed both 64 MB and 16 times the document's size
  When I press Ctrl+Alt+F
  Then the document is unchanged
  And a warning starts with "Cannot pretty-print:"

Scenario: FMT-010.7 Only for JSON tabs
  Given a tab with the language "Plain Text"
  When I press Ctrl+Alt+F
  Then the document is unchanged
  And a notice says "JSON: Format / Pretty-print is not available here"
```
