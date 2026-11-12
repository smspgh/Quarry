# JSON tools

- [When a file counts as JSON](#when-a-file-counts-as-json)
- [The JSON panel](#the-json-panel)
- [Paths](#paths)
- [Validate](#validate)
- [Format and minify](#format-and-minify)
- [Converting between JSON and CSV](#converting-between-json-and-csv)
- [Commands and shortcuts](#commands-and-shortcuts)

## When a file counts as JSON

A document is treated as JSON when:

- its extension is `.json`, `.jsonc`, `.json5`, `.har` or `.webmanifest`, or one known as JSON to CodeMirror;
- it is untitled, or of an unknown type, and its text starts like JSON: `{"`, `{}`, `[{`, `[[`, `["`, `[` followed by a digit, or `[]`. This includes JSON pasted into a new tab;
- you choose **JSON** with **Code › Language** or **Ctrl+K M**.

**JSON with comments (JSONC).** Quarry treats these files as JSONC, which allows `//` and `/* */` comments and trailing commas:

- `.jsonc` files;
- `.code-workspace` files;
- `tsconfig*.json` and `jsconfig*.json`;
- `.json` files inside a `.vscode` folder.

`.json5` files are checked as JSONC too. JSON5-only syntax, such as unquoted keys or single quotes, is reported as an error.

Opening a JSON file shows the JSON panel when that panel is pinned (see [Window layout](editing.md#window-layout)); otherwise open it from its rail icon or with **Ctrl+Shift+J**. The **JSON** commands are available only when the document's language is JSON.

## The JSON panel

**Ctrl+Shift+J** or **View › Panels › JSON Tools** opens the panel.

- **Tree.** A tree of the document that updates 250 ms after you stop typing. Objects show their number of keys (`{3}`), arrays their length (`[5]`), and numbers their exact source text.
- **Follow cursor.** When on, the tree reveals and highlights the node under the editor cursor.
- **Click a node**, or press Enter on it, to select that value in the editor.
- **Expand all / Collapse all.** Expand all opens up to 12 levels deep or 50,000 nodes.
- **Keyboard.** Arrow keys move through and expand the tree.
  - **Ctrl+C** copies the node's value. Strings are copied without quotes; objects and arrays as their source text.
  - **Ctrl+Shift+C** copies its path.
- **Status.**
  - **Parsed**: valid JSON.
  - **Lenient**: parsed, but uses something JSON doesn't allow, such as comments or a trailing comma. The reason is shown.
  - **Invalid**: click the error to jump to it.
  - **Not JSON** or **Empty**.
- **While you edit.** If the document stops being valid JSON, the last good tree stays visible, dimmed, until it parses again.
- **Size limit.** Documents over 64 MB or 2,000,000 nodes don't get a tree.

The tree's parser is tolerant on purpose so it keeps working while you type. It accepts `//` and `/* */` comments, trailing commas, single-quoted strings, unquoted keys, and `NaN` / `Infinity` / hex numbers. **Validate** and **Format** are strict, as described below.

## Paths

The path format box in the JSON panel sets the style used when copying from the tree. From the editor, **Copy Path at Cursor** (**Ctrl+Alt+P**) always copies the dot style, and the JSON menu has a command for each of the other styles.

For the value `"Ada"` in `{"users": [{"name": "Ada", "e-mail": "ada@example.com"}]}`:

| Style | Path to `name` | Path to `e-mail` |
| --- | --- | --- |
| Dot (default) | `users[0].name` | `users[0].e-mail` |
| JSONPath ([RFC 9535](https://www.rfc-editor.org/rfc/rfc9535)) | `$.users[0].name` | `$.users[0]['e-mail']` |
| JavaScript | `users[0].name` | `users[0]["e-mail"]` |
| Bracket | `["users"][0]["name"]` | `["users"][0]["e-mail"]` |
| JSON Pointer ([RFC 6901](https://www.rfc-editor.org/rfc/rfc6901)) | `/users/0/name` | `/users/0/e-mail` |

The dot style never quotes keys, so it's best for display. Use JSONPath, JavaScript or bracket style when keys contain special characters. In JSON Pointer, `~` is written `~0` and `/` is written `~1`.

The breadcrumb bar above the editor shows the path of the value under the cursor.

## Validate

**Ctrl+Alt+V** checks the document against strict JSON ([RFC 8259](https://www.rfc-editor.org/rfc/rfc8259)). It also works on files open in large-file mode, whatever their size; see [Large files › JSON tree and validation](large-files.md#json-tree-and-validation).

On an error, Quarry marks it in the editor, moves the cursor to it, and reports the line and column with a specific message: "trailing comma", "expected `,` or `}`", "key must be a string", "invalid escape", "invalid number (leading zero)", "trailing characters", and so on. The mark clears on your next edit.

A leading byte-order mark is allowed. In a plain JSON file, a comment is reported as "comments are not allowed in JSON (they are in JSONC)". In a JSONC file, comments and trailing commas pass, and the result reads "Valid JSONC ✓".

## Format and minify

**Ctrl+Alt+F** pretty-prints and **Ctrl+Alt+M** minifies. **Format Document** (**Shift+Alt+F**) on a JSON file pretty-prints too.

They change **only whitespace**, apart from comments:

- Key order is kept, and duplicate keys are kept as written.
- Numbers keep their exact text: `1e400`, `-0`, `0.10` and 40-digit integers come out unchanged, without being rounded or converted to floating point.
- Escapes are kept as written, including `é` and unpaired surrogates.
- There is no nesting limit; 100,000 levels deep is tested.
- **Comments and trailing commas** are accepted in any file.
  - Format keeps them. A comment that followed a value on the same line stays there; other comments go on their own line.
  - Minify removes them, so the minified result is always strict JSON. The message says when it did this.

The indent comes from **Settings › JSON › Pretty-print indent** (default 2, from 1 to 8). It uses tabs when **Insert spaces** is off. Formatting is one undo step.

## Converting between JSON and CSV

| Command | Input | Result |
| --- | --- | --- |
| **JSON: Convert to CSV** | An object or an array of objects | One column per top-level key (in first-seen order), one row per object. Nested objects and arrays are written as JSON text in the cell; `null` and missing keys become empty cells. Comma-delimited; cells containing `"`, `,` or a line break are quoted. |
| **JSON: Convert CSV to JSON** | A `.csv` or `.tsv` file | An array of objects keyed by the header row. The delimiter (`,` `;` tab or `|`) is detected. Quoted cells may contain delimiters, `""` and line breaks. **All values stay strings.** Blank header names become `column_N`, duplicates become `name_2`, missing cells become `""`, and extra cells go into an `_extra` array. Quarry warns about each of these. |
| **JSON: Copy Top-level Keys** | An object, or an array whose first element is an object | Copies the keys, one per line. |

Both conversions replace the current document (one undo step) and keep its file name, so use **Save As** to save the result under a new extension.

## Commands and shortcuts

| Command | Keys |
| --- | --- |
| Format / Pretty-print | Ctrl+Alt+F |
| Minify | Ctrl+Alt+M |
| Validate | Ctrl+Alt+V |
| Copy Path at Cursor | Ctrl+Alt+P |
| Copy Value at Cursor | Ctrl+Alt+C |
| Copy JSONPath / JSON Pointer / Bracket Path at Cursor | – |
| Show JSON Tools | Ctrl+Shift+J |
| Convert to CSV, Convert CSV to JSON, Copy Top-level Keys | – |

All of these are in the **JSON** menu and the command palette (type `json`).
