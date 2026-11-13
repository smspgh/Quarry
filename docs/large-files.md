# Large files

Files at or above the **large-file threshold** (default **32 MB**) open in a disk-backed mode built for logs, dumps and data exports of many gigabytes. The file is memory-mapped and never loaded into memory as a whole, so it opens instantly whatever its size.

- [How it works](#how-it-works)
- [Viewing and navigating](#viewing-and-navigating)
- [Colours](#colours)
- [CSV and TSV grid](#csv-and-tsv-grid)
- [Find](#find)
- [Filter view](#filter-view)
- [Follow mode](#follow-mode)
- [Replace All](#replace-all)
- [Editing](#editing)
- [Saving](#saving)
- [Encodings and line endings](#encodings-and-line-endings)
- [JSON tree and validation](#json-tree-and-validation)
- [What is not available](#what-is-not-available)
- [Changing the threshold](#changing-the-threshold)

## How it works

- The file is memory-mapped by the Rust core. Only the lines on screen are read.
- A line index is built in the background, 64 MiB at a time. Progress shows in the tab's banner and the status bar ("indexing N%"). The index stores one 8-byte checkpoint per 1,024 lines, so a file with 100 million lines needs under a megabyte for its index.
- The view is virtualized. It fetches 256 lines at a time and keeps a bounded cache.
- Your edits are stored separately from the file (in a piece table) until you save. The original file is not modified before then.

The status bar shows the file size and line count. **Large File: Show Info** in the command palette gives more detail.

## Viewing and navigating

| Keys | Action |
| --- | --- |
| Arrows, Page Up/Down, **Ctrl+Home / Ctrl+End** | Move through the file. |
| **Home / End** | Scroll horizontally. |
| **Shift+arrows**, mouse drag | Select whole lines. |
| **Ctrl+A** | Select all lines. |
| **Ctrl+C** | Copy the selected lines (up to 200,000), or text selected inside one line. |
| **Ctrl+G** | Go to line. If indexing hasn't reached that line yet, the jump happens as soon as it does. |

Very long lines are shown up to 20,000 characters, followed by "… (N more chars)".

## Colours

Large files are coloured as you scroll: only the lines on screen are coloured, so it costs the same at any size.

| Files | Colours |
| --- | --- |
| `.json`, `.jsonc`, `.json5`, `.jsonl`, `.ndjson`, `.geojson`, `.har` | keys, strings, numbers, `true` / `false` / `null` |
| `.log`, `.out`, `.err` | timestamps, the log level (ERROR and FATAL in red, WARN in amber, DEBUG and TRACE dimmed), `[tags]`, `key=` names and numbers |
| `.csv`, `.tsv`, `.tab` | one colour per column, so a row is easy to follow; quoted fields stay in one column |
| `.xml`, `.html`, `.htm`, `.xhtml`, `.svg`, `.plist`, `.xsd`, `.kml`, `.gpx` | tags, attributes, values and comments |
| `.sql` | keywords, strings, numbers and comments |

A file with any other extension (`.txt`, say) is coloured as a log, JSON or XML when its first 40 non-empty lines look like one; otherwise it stays plain.

Each line is coloured on its own, so something that spans lines (an XML comment, say) is coloured only on its first line. Lines are coloured up to 4,000 characters. Turn it off with **Settings › Files › Colours in large-file mode**.

## CSV and TSV grid

A large `.csv`, `.tsv` or `.tab` file opens as a grid: each field in its own column, with the file's first line as a header that stays at the top while you scroll.

- Quoted fields are read as one cell (`"Smith, Jo"`), with `""` shown as `"`. Numbers are right-aligned.
- Columns are sized to fit the rows you have seen (up to 40 characters; hover a cut value to see all of it). They only widen as you scroll, so the layout doesn't jump.
- A search hit marks the cell it is in. The [filter view](#filter-view) shows its lines in the same columns, under the same header.
- **Grid** in the banner switches between the grid and the raw text. Editing a line (Enter) edits its raw text.
- Each line is read on its own, so a quoted field that contains a line break shows its parts on separate rows.

## Find

**Ctrl+F** opens the find bar. Type the search and press **Enter** to run it. There is no find-as-you-type, because each search reads the whole file.

- Options: **Match Case**, **Whole Word**, **Regex**, and **Dot matches newline** (regex only).
- Regex syntax is Rust's [`regex`](https://docs.rs/regex/latest/regex/#syntax) crate: Unicode-aware, `^` and `$` match at line boundaries, no look-around and no backreferences.
- Up to 20,000 hits are collected and the first 2,000 are listed. The total count stops at 5,000,000.
- **F3 / Shift+F3** go to the next / previous hit.

## Filter view

**Filter** in the large-file banner (or **Large File: Filter Lines** in the command palette) opens a pane under the file that shows only the lines matching a search: every one of them, however many, scrolled like the file itself.

- Type a search and press **Enter**. Match Case, Whole Word and Regex work as in Find, except that `.` never matches a line break (there is no option for it): a line is listed when a match starts on it.
- **Hide matching lines** (the crossed-out eye) shows the opposite: every line *without* a match, for example to hide all DEBUG lines.
- For logs, **Errors** and **Warnings** filter by log level in one click.
- Click a line, or move with the arrow keys, to show it in context in the file above. Each line shows its line number in the file.
- Long lines are shown up to 2,000 characters (20,000 in the grid), followed by "… (N more chars)"; click the line to see it in the file view.
- The filter runs once the file is fully indexed (a few seconds per gigabyte); until then it says it is waiting and runs by itself. It re-runs after you edit the file.
- Speed on the benchmark machine ([bench/RESULTS.md](../bench/RESULTS.md)): keeping the ERROR lines of a 5 GB log (7.4 million of 59 million) takes 0.6 s; hiding its DEBUG lines (44 million left) 1.0 s. The filter needs one bit per line of the file: about 7 MB for 60 million lines.

## Follow mode

**Follow** in the banner (or **Large File: Follow**) shows lines as they are added to the file, like `tail -f`: for a log that is still being written.

- Quarry checks the file once a second and reads only what was added. The view jumps to the end and stays there; scroll up to read and it stops moving, scroll back to the end and it follows again. An open filter picks up new matching lines too.
- If the file is rewritten instead of added to (a rotated log, say), Quarry reloads it.
- Follow mode needs the file unedited and fully indexed. Editing a line stops it.
- While a file is open, Windows doesn't let other programs **shrink** it, so a logger that rotates by truncating the file in place (copy-truncate) can't do so while Quarry has it open. Loggers that rename the file and start a new one are fine.

## Replace All

Large-file mode supports **Replace All** but not replacing one match at a time.

- It asks for confirmation, then streams the whole file into a new working copy in `%TEMP%`. The original file is untouched until you save.
- In regex mode, use `$1` or `${name}` for capture groups, and `$$` for a literal `$`. In plain-text mode, `$` is literal.
- **Preserve Case** (the **Aa** toggle in the replace box) matches the case of each replaced text: `FOO` → `BAR`, `Foo` → `Bar`, `foo` → `bar`.
- Replace All clears the undo history.
- It is available once indexing has finished.

## Editing

Editing works line by line and is available once indexing has finished.

| Keys | Action |
| --- | --- |
| **Enter**, **F2** or double-click | Edit the selected line in place. Enter (or leaving the field) commits; Esc cancels. A line break typed into the line is saved with the file's own line ending. |
| **Ctrl+Enter** | Insert an empty line below and edit it. |
| **Delete** | Delete the selected lines (up to 100,000 at a time). |
| **Ctrl+Z / Ctrl+Y** | Undo / redo, up to 200 steps. Undoing back to the saved state clears the modified mark. |

- Lines longer than 16 MB can't be edited.
- Lines containing invalid UTF-8 ask before editing, because the invalid bytes are replaced with U+FFFD (`�`) when you edit them.

## Saving

**Ctrl+S** and **Save As** stream the original file plus your edits to a temporary file in the same folder, then replace the target in one step. If anything fails, the original stays intact and the document stays open.

You can't save over a file that is open in large-file mode in another tab.

## Encodings and line endings

| File | Behaviour |
| --- | --- |
| UTF-8 (with or without BOM) | Full support. |
| Invalid UTF-8 bytes | Shown as `�`; the line is flagged and asks before editing. |
| UTF-16 LE / BE with a BOM | Viewing and Find work; the file is **read-only**. To edit, raise the threshold above the file's size and reopen it as a normal tab. |
| UTF-16 without a BOM, other encodings | Read as UTF-8. |
| CRLF, LF, CR-only line endings | Detected from the first 1 MiB and kept on save. |
| Mixed line endings | A stray CR inside a line shows as `␍`. |

## JSON tree and validation

For a large `.json`, `.jsonc`, `.json5`, `.geojson` or `.har` file, the **JSON** panel shows its tree, read from the file itself rather than loaded into memory, so it works at any size.

- The tree opens straight away with the top level listed. Expanding a node reads just that node: its children appear with their type, a value preview, and for objects and arrays how many members or items they have.
- Long objects and arrays list 200 children at a time; **Load 200 more** at the end lists the next ones ("400 of 20,079,290 shown").
- The top-level count is worked out in the background (it reads the whole file; a few seconds per gigabyte) and shows as "counting…" until then.
- Click a row to go to its line in the file, even while the file is still being indexed. **Copy path** (or **Ctrl+Shift+C**) copies its path in the chosen format, as in the normal tree.
- Arrow keys move through the tree: **→** / **←** expand and collapse, **Enter** goes to the line (or loads more).
- The tree reads the file as saved. With unsaved changes it asks you to save first; **Re-read the file** refreshes it after saving.

**JSON: Validate** (**Ctrl+Alt+V**) works on large `.json`, `.jsonc`, `.json5`, `.geojson` and `.har` files of any size. It checks the file in place, without loading it into memory: about 1 GB a second on a fast machine. A valid file says so, with the time taken. For an invalid one it gives the line and column and jumps to the line. Files ending in `.jsonc` or `.json5` are checked as JSONC (comments and trailing commas allowed).

JSON Lines files (`.jsonl`, `.ndjson`) are coloured as JSON but get neither the tree nor Validate: they hold one JSON value per line, not a single document. Use Find or the filter to work with them.

The file is checked as saved, so save your changes first; Quarry says so if you haven't.

## What is not available

Large-file tabs are a viewer with line editing, not a full editor. Compared with normal tabs, they have:

- no column mode, multi-cursor, or Edit / Code / Selection menu commands, and syntax colours only for the formats [listed above](#colours);
- no Format Document, and of the JSON commands only **JSON: Validate** ([above](#json-tree-and-validation));
- no scripts or macros;
- no word wrap or render-whitespace toggles;
- no single-match Replace, and no Revert;
- no encoding or line-ending changes.

Find in Files covers large files when it searches a folder, but not in the **Open Files** scope.

While a file is open in large-file mode, Quarry holds it memory-mapped. On Windows, other programs may be unable to delete or replace it until you close the tab. Quarry checks for outside changes when its window regains focus or you switch tabs, as it does for normal files (see [Editing › External changes](editing.md#external-changes)).

## Changing the threshold

**Settings › Files › Large-file threshold (MB)** accepts 1 to 4,096 (MiB). It applies to files opened after the change. Files below the threshold open as normal tabs with every feature, but their whole text is loaded into memory, so raise it with care.
