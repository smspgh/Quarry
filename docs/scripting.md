# Scripts

A Quarry script is a plain JavaScript file that transforms the current document: reorder lines, rewrite selections, pull values out of CSV, reshape JSON, and so on. Scripts run in a sandboxed Web Worker, and whatever a script changes is applied back to the editor as **one undo step**.

- [Where scripts live](#where-scripts-live)
- [Writing and running a script](#writing-and-running-a-script)
- [How a script runs](#how-a-script-runs)
- [API reference](#api-reference)
- [Limiting a script to certain files](#limiting-a-script-to-certain-files)
- [Sandbox and limits](#sandbox-and-limits)
- [Errors and the Console](#errors-and-the-console)
- [Examples](#examples)

## Where scripts live

Each script is one `.js` file in the scripts folder or in a subfolder of it. The file name without `.js` is the script's name.

- Default folder: `%APPDATA%\com.quarry.app\scripts` (created on first use).
- **Settings › Folders › Scripts folder** always shows the folder in use, and is where you change it. If a custom folder can't be used, Quarry falls back to the default and says so.
- Subfolders are yours to organise scripts with; the Scripts panel shows the whole tree.
- The tree reloads when the panel opens and when Quarry regains focus, so you can also manage scripts in File Explorer or another editor.

Quarry ships with no scripts. Common conversions (JSON ↔ CSV, listing keys) are built-in [JSON commands](json.md#converting-between-json-and-csv) instead.

## Writing and running a script

The Scripts panel (**Scripts › Scripts**, or the Scripts icon in the panel rail) is the scripts folder as a tree, with a run bar under it. It works like the [Explorer](editing.md) with one difference: a click only *selects* a script, so the document you want to run it on stays in front. Double-click a script to open it in a tab.

| Action | How |
| --- | --- |
| New script | **New Script** in the panel header, or **Scripts › New Script**. Type a name; `.js` is added, and the file opens in a tab with a short starting template. |
| New folder | **New Script Folder** in the panel header. From the header, both go into the selected folder (or the folder of the selected script); **Scripts › New Script** always creates at the top of the scripts folder. |
| Run on the current document | Select the script and press **Run** below the tree, or right-click › **Run**. |
| Edit | Double-click the script, press **Enter**, use **Edit** in the run bar, or right-click › **Edit**. It opens in a tab; edit and save it like any other file. |
| Run several times | **×N** (1 to 100,000; each run is its own undo step, stops at the first error). |
| Run until nothing changes | **To end** repeats until a run leaves both the text and the selection unchanged, up to 10,000 runs. |
| Cancel | **Cancel** in the run bar, or the stop button beside **SCRIPT** in the status bar. |
| Rename / Cut / Copy / Paste / Delete | Right-click, or **F2**, **Ctrl+X / C / V**, **Delete**, as in the Explorer. Delete moves the file to the Recycle Bin. |
| API reference | **Help › Script API Reference** opens the list below in a tab. |

The script you last selected or ran is the *current script*: **Ctrl+Shift+Enter** (**Scripts › Run Script "name"**) runs it again on the document in front, with the panel open or not.

A script that is open in a tab runs as it is in the tab, unsaved changes included, so you can try an edit before saving it. A script never runs on its own tab: switch to the document it should change first.

By default, a script first asks **Run / Review first / Cancel**. **Review first** opens the script in a tab without running it. Turn the prompt off with **Settings › Confirm script & macro runs**.

Scripts run on regular text tabs only, not on files open in [large-file mode](large-files.md). Only one script runs at a time, and none runs while a [macro](macros.md) is recording or playing: the Run buttons are disabled and **Ctrl+Shift+Enter** shows a message saying why.

## How a script runs

When you run a script, Quarry takes a snapshot of the current document: its text, every selection range (including multi-cursor and column selections), its name, path and line ending, and the clipboard text. The script works on that snapshot in a worker. When it finishes, Quarry applies the result:

1. **If the script assigned to `selection`** (`selection.text`, `selection.lines` or `selection.map`), those selection replacements are applied. A script can't change both `doc` and `selection` in one run, because selection offsets refer to the original text. If it does, nothing is applied and the Console explains why.
2. **Otherwise, if the document text changed**, the new text replaces the old. Quarry only rewrites the part that actually changed.
3. **Otherwise, if the script returned a string**, that string replaces the document.
4. Then `doc.select(from, to)`, if called, sets the selection in the new text.

Either way the edit is one transaction, so a single **Ctrl+Z** undoes it.

If you switch to another tab, or edit the document, while a script is running, its changes are not applied, and a message tells you so. Moving the cursor is fine: selection changes go to the ranges the script was given.

The script body is wrapped in an `async` function in strict mode, so top-level `await` and `return` are allowed. `doc`, `selection`, `util`, `clipboard`, `console` and `args` are its parameters.

## API reference

### `doc`

| Member | Description |
| --- | --- |
| `doc.text` | The whole text. Read it or assign a new string. |
| `doc.lines` | The text as an array of lines. Assigning joins them with `doc.eol`. |
| `doc.lineCount` | Number of lines. |
| `doc.length` | Number of characters (UTF-16 code units). |
| `doc.name` | File name, e.g. `data.csv`. Read-only in practice; assigning it does nothing. |
| `doc.path` | Full path, or `null` for an unsaved document. |
| `doc.eol` | The line ending in use, as the actual characters: `"\r\n"`, `"\n"` or `"\r"`. |
| `doc.mapLines((line, i) => …)` | Replaces every line with the function's result. Return `null` or `undefined` to delete the line. `i` is 0-based. |
| `doc.filterLines((line, i) => bool)` | Keeps only the lines where the function returns a truthy value. |
| `doc.replace(pattern, replacement)` | A **string** pattern replaces *every* occurrence (matched literally). A **RegExp** is used as given, so add the `g` flag to replace all matches. `replacement` may be a string (`$1`, `$&`, …) or a function, as in `String.prototype.replace`. |
| `doc.insert(offset, text)` | Inserts text at a character offset. |
| `doc.append(text)` / `doc.prepend(text)` | Adds text at the end / start. |
| `doc.lineAt(offset)` | 1-based line number of a character offset in the current text. |
| `doc.select(from, to)` | Sets the selection after the run. Offsets refer to the new text. |

`doc.lines`, `mapLines` and `filterLines` split on any line ending and join with `doc.eol`, so they also normalise mixed line endings.

### `selection`

| Member | Description |
| --- | --- |
| `selection.all` | Array of `{ from, to, text }`, one per selection range or cursor, with offsets in the original document. |
| `selection.text` | All selected text, joined with `doc.eol`. Assigning with **one** range replaces it; with **several** ranges, the new value is split into lines and line *i* goes into range *i* (missing lines become empty). |
| `selection.lines` | `selection.text` as an array of lines. Assigning joins them and assigns `selection.text`. |
| `selection.isEmpty` | `true` when every range is an empty cursor. |
| `selection.map((text, i, range) => …)` | Replaces each range with the function's result, independently. |

Assigning to an empty cursor inserts text at the cursor.

### `util`

| Function | Description |
| --- | --- |
| `util.sort(lines, { numeric, desc, caseInsensitive })` | Returns a new sorted array using locale-aware comparison. `numeric` sorts `2` before `10`; `caseInsensitive` also ignores accents. |
| `util.unique(lines)` | Removes duplicates, keeping the first occurrence and the original order. |
| `util.trimLines(lines)` | Removes trailing whitespace from each line. |
| `util.pad(text, width, ch = " ")` | Left-pads to `width`. |
| `util.csvSplit(line, delim = ",")` | Splits one CSV line, honouring quotes and `""`. Does not handle line breaks inside quoted cells. |
| `util.json.parse(s)` | `JSON.parse`. |
| `util.json.stringify(value, indent = 2)` | `JSON.stringify` with indentation. |

### `clipboard`, `console`, `args`, `return`

| Member | Description |
| --- | --- |
| `clipboard.text` | Clipboard text read just before the run (empty if it holds no text). Assign to write it to the clipboard after a successful run. |
| `console.log / info / warn / error` | Writes to the Console panel. Objects are printed as JSON. Output appears when the script finishes. |
| `args` | Reserved for passing values to a script. Runs started from the UI pass `undefined`. |
| `return "…"` | A returned string replaces the document, unless the script assigned to `selection` (see [How a script runs](#how-a-script-runs)). Other return values are ignored. |

## Limiting a script to certain files

Header comments in the first 20 lines restrict where a script can run:

```js
// @languages JSON, YAML
// @extensions .csv, .tsv
```

- `@languages` matches the language shown in the status bar, **exactly and case-sensitively** (`JSON`, `JavaScript`, `TypeScript`, `YAML`, …). Values are separated by commas or spaces, so a two-word language name such as `Plain Text` can't be used. There is no CSV language; use `@extensions .csv` for CSV files.
- `@extensions` matches the end of the file name, ignoring case.
- If both are given, matching **either** is enough.
- A script with neither tag runs on any text document.

In the run bar, the selected script shows a note such as "JSON / YAML only", and its **Run** is greyed out for a document it doesn't apply to; running it another way shows a message. The header is read each time the script runs.

## Sandbox and limits

- Each run gets its own Web Worker with no DOM and no access to the editor, the file system or Quarry's internal APIs. A script only sees the snapshot described above.
- A script has no network: `fetch`, `WebSocket`, `EventSource`, `import()` and `importScripts` of anything outside Quarry fail, and so do `eval` and `new Function`. So a script you were given cannot send your text anywhere; what it can do is change the document and the clipboard, which you can undo.
- A run is stopped after **60 seconds**, and anything the script logged is lost.
- Nothing carries over from one run to the next: a value a script stores on `globalThis` is gone when the run ends.

## Errors and the Console

A run opens the **Console** tab of the bottom panel (**Ctrl+J** toggles it). It shows `▶ Running script on <file>`, the script's output, then `✓ Done in N ms` or the error. When the error comes from a line of your script, the toast and the Console give the line number (`script:12:5`). The Console keeps the last 2,000 lines.

## Examples

Sort lines, numbers in natural order, and drop duplicates:

```js
doc.lines = util.unique(util.sort(doc.lines, { numeric: true }));
```

Remove blank lines and trailing whitespace:

```js
doc.lines = util.trimLines(doc.lines).filter(l => l !== "");
```

Upper-case every selection (works with multi-cursor and column mode):

```js
selection.map(t => t.toUpperCase());
```

Number the lines of the selection:

```js
selection.lines = selection.lines.map((l, i) => `${i + 1}. ${l}`);
```

Keep only the second column of a CSV file:

```js
// @extensions .csv
doc.mapLines(line => util.csvSplit(line)[1] ?? "");
```

Wrap each line in quotes and join them with commas, ready for an SQL `IN (...)` list, and copy the result:

```js
const list = doc.lines.filter(Boolean).map(l => `'${l.replace(/'/g, "''")}'`).join(", ");
clipboard.text = list;
console.log(`Copied ${doc.lineCount} values`);
```

Pretty-print every JSON object in a JSON Lines file:

```js
// @extensions .jsonl, .ndjson
doc.mapLines(line => line.trim() ? util.json.stringify(util.json.parse(line), 0) : null);
```
