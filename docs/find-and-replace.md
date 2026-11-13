# Find and replace

- [Find in the current file](#find-in-the-current-file)
- [Find in Files](#find-in-files)
- [Clearing a box, and history](#clearing-a-box-and-history)
- [Replace in Files](#replace-in-files)
- [Undo Replace in Files](#undo-replace-in-files)
- [Regex flavours](#regex-flavours)

Files open in large-file mode have their own find bar; see [Large files › Find](large-files.md#find).

## Find in the current file

**Ctrl+F** opens the find bar and **Ctrl+H** opens it with the replace field. If you have a short single-line selection, it fills the search box.

| Keys | Action |
| --- | --- |
| **Enter / Shift+Enter** (or **F3 / Shift+F3**) | Next / previous match. |
| **Alt+C / Alt+W / Alt+R** | Toggle Match Case / Whole Word / Regex. |
| **Alt+P** | Toggle Preserve Case (for Replace). |
| **Ctrl+Enter** in the search box | Insert a line break, to search across lines. |
| **Alt+Enter** | Select every match as a separate cursor (up to 200,000), then type to edit them all. |
| **Enter** in the replace box | Replace the current match. |
| **Ctrl+Alt+Enter** | Replace all matches (one undo step). |
| **Esc** | Close the find bar and return to the editor. |

- The match count updates as you type (it shows "100k+" above 100,000).
- A multi-line search without Regex is matched literally.
- In regex mode the replacement can use `$1`, `$2`, … and `$&` for the whole match.
- **Preserve Case** (the **Aa** toggle in the replace box, or **Alt+P**) matches the case of each replaced text, as in [Replace in Files](#replace-in-files): `foo` → `bar` also turns `FOO` into `BAR` and `Foo` into `Bar`.
- Related commands: **Ctrl+D** adds the next occurrence of the selection as a cursor, and **Ctrl+Shift+L** selects all occurrences.

## Clearing a box, and history

These work the same in the find bar and in Find in Files.

- **×** inside a find or replace box clears it. It shows only while the box has text.
- **History** (the clock icon, or **Alt+↓** in the box) lists what you searched for or replaced with before, newest first, with the date and time each was last used. Click an entry, or move to it with the arrow keys and press **Enter**, to put it back in the box.
  - Find and replace have separate lists. Entries are shared between the find bar and Find in Files.
  - An entry is added when you run it: a search (Enter / Shift+Enter in the box, the Next / Previous Match buttons, or the Search button) or a replace. **F3 / Shift+F3** only step to the next / previous match and add nothing, so a macro that repeats them does not fill the history. Running the same text again doesn't add a copy: the entry moves to the top with the new time and its use count goes up, shown as **×3**, **×12** and so on. From 10 uses the count is highlighted, a hint that a search you repeat that often might be worth a [macro](macros.md) or [script](scripting.md).
  - In the list, **Delete** or the **×** on an entry removes that entry, and the bin icon clears the whole list.
  - The list is long-scrolling. It shows 100 entries at a time and adds more as you scroll, so a long history stays fast.
  - History is saved to `search-history.json` in the settings folder and survives restarts. It's read only when first needed, not at start-up.
  - It's unlimited by default. **Settings › Search › Find & replace history** can limit it to a number of entries instead. Entries longer than 10,000 characters aren't kept.

## Find in Files

**Ctrl+Shift+F** opens the Search panel; **Ctrl+Shift+H** opens it with the replace field.

### Where it searches

| Scope | Searches |
| --- | --- |
| **Current File** (default) | The active document, including unsaved changes. A large-file tab is searched on disk. |
| **Open Files** | The text in every open tab, including unsaved changes. Large-file tabs are skipped. |
| **Folder** / **Selection** | The folder open in the Explorer, recursively, or what you last clicked or selected in the Explorer: a folder, a file, or several of each (**Ctrl+click** / **Shift+click**). The button reads **Folder** for a folder and **Selection** otherwise, and the line under it shows what is searched ("In Quarry\src", "In 3 items: a.txt, src, b.md"). **Whole folder** goes back to the whole open folder. Right-click in the Explorer and choose **Find in File**, **Find in Folder** or **Find in Selected** to jump straight here. |
| **Choose…** | One or more folders you pick. |

Find in Files starts on **Current File** each time Quarry opens. A scope you pick stays selected until you close Quarry. The selected scope is highlighted in the accent colour, so it's clear at a glance whether you're searching the file or a folder. **Current File** is shown only while a file is open, and **Open Files** only while tabs are open; until then, the search falls back to the next scope that applies. When the panel is too narrow for the buttons in one row, they wrap onto more rows rather than being cut off, and the Search panel can't be made narrower than 280 pixels, so the search box always has room.

### Options

**Match Case**, **Whole Word** and **Regex** are the toggles inside the search box. The rest are under the **Filters** button (next to the scope buttons), which shows how many filters differ from their defaults:

- **Dot matches newline**.
- **Use .gitignore** (on by default) skips files ignored by `.gitignore`, `.ignore`, `.git/info/exclude` and your global gitignore.
- **Include / exclude**: comma-separated glob patterns such as `*.ts, src/**` or `*.min.js, dist/**`. With an include pattern, only matching files are searched. Include / exclude and **Use .gitignore** apply only to the folder scopes.
- `.git`, `node_modules` and `target` folders are skipped, unless you give an include pattern.
- Hidden files are searched. Symbolic links are not followed.
- Binary files (any containing a NUL byte) are not searched past that byte.
- A pattern that contains a line break, or any regex, can match across lines.
- **Max** (results) defaults to 20,000 (adjustable up to 1,000,000). The status line says "(limit reached)" when the limit was hit.

Results stream in as they are found, grouped by file, and you can cancel a running search. While there are results, the Search panel sits beside the editor instead of floating over it, so the documents you open from it stay fully visible; see [Window layout](editing.md#window-layout). Long searches show the first 1,500 rows; **Show more results** adds more.

Each result row shows the match with a few whole words before it (up to three) and the rest of the line after it, so the match is always in view. **…** marks text left out at the start; a match at the start of a line is shown from the line's first word.

Opening a result scrolls the editor so the whole match is in view. If the match is off to the side on a long line, the editor scrolls sideways to bring it near the left edge, with 10 characters of the line before it, so the text after it shows too; a match near the start of a line is shown from the line's beginning. (With word wrap on there is no sideways scrolling.) **Go to Line** positions the cursor the same way.

Opening a result highlights every match in that document the same way the find bar (**Ctrl+F**) does, with the selected match in the stronger colour. The highlighting stays while you move through the results, and clears when you press **Escape** in the editor, open the find bar, clear the results or run a new search.

### Moving through results

| Keys | Action |
| --- | --- |
| **↑ / ↓** | Move through the results, previewing each in the editor. |
| **Enter** | Open the result and move focus to the editor. |
| **← / →** | Collapse / expand a file's results. |
| **F4 / Shift+F4** | Next / previous result, from anywhere. The **↓ / ↑** buttons next to the Search button do the same, and show which result you're on ("3 of 12"). |
| **Delete** | Leave the result (or, on a file row, the whole file) out of the list and of Replace All. |

If a file has changed since the search ran, its results are marked as stale.

Right-click a file's name in the results for Cut, Copy, Paste (into that file's folder), Delete (to the Recycle Bin; the file leaves the results), Copy Path, Copy File Name, **Show in Quarry Explorer** and **Show in Windows Explorer**. **Ctrl+click** and **Shift+click** on file names select several, and the menu then acts on all of them. These work like the [Explorer's](editing.md#explorer). In the results, the **Delete** key still means "leave this result out", not delete the file.

Hovering a result or file row shows an **×** that does the same as **Delete**: the row leaves the list, and Replace All will not touch it. The status line counts what you left out ("12 results in 3 files · 2 left out"). Running the search again brings everything back.

## Replace in Files

With the replace field shown, each result previews the change: the match struck through, followed by the replacement. **Replace All** asks for confirmation and then:

- edits every matching file on disk, writing each file atomically;
- **skips files that are open with unsaved changes** and lists them, so your edits are never overwritten;
- reloads open tabs whose files it changed;
- refuses files over 256 MB, which you can open in [large-file mode](large-files.md#replace-all) and use Replace All there;
- changes nothing you left out of the results (see above);
- keeps each file's encoding: a file is decoded as it would be when opened (its BOM, else the detected encoding, such as Windows-1252 or UTF-16), replaced, and written back in the same encoding with the same BOM;
- leaves a file unchanged if its encoding can't store the result (for example, a Chinese character in a Windows-1252 file) or if it doesn't decode cleanly, and says why;
- reports per-file failures under the file ("Replace failed: …").

**Preserve Case** (the **Aa** toggle in the replace box) matches the case of each replaced text: replacing `foo` with `bar` turns `FOO` into `BAR`, `Foo` into `Bar` and `foo` into `bar`. Mixed case such as `fOO` gets the replacement as typed. The preview in the results shows the result.

In regex mode the replacement uses Rust syntax: `$1` or `${name}` for groups, and `$$` for a literal `$`. In plain-text mode, `$` is literal.

With the **Current File** and **Open Files** scopes, Replace All edits the open documents in the editor instead of the files on disk. Each document can then be undone with **Ctrl+Z**, and the changes are saved when you save.

## Undo Replace in Files

Before a Replace in Files changes a file, Quarry keeps a backup copy. **Find › Undo Replace in Files**, or the **Undo** link in the Search panel's status line, restores them byte for byte.

- Only the **most recent** Replace in Files can be undone.
- Backups are cleared when the next Replace in Files starts and when Quarry starts, so undo is available only until then.
- Backups are limited to 1 GiB in total. Files beyond that are still replaced, but without a backup, and can't be restored.
- A file that has changed again since the replace is not restored. It is listed instead.

## Regex flavours

| Where | Engine |
| --- | --- |
| Find bar (current file), and Find in Files with the **Current File** and **Open Files** scopes | JavaScript `RegExp` |
| Find in Files with the **Folder** or **Choose…** scopes, Replace in Files on disk, and large-file Find / Replace All | Rust [`regex`](https://docs.rs/regex/latest/regex/#syntax) (the engine used by ripgrep): no look-around and no backreferences, but guaranteed linear-time matching |

Everyday patterns (`\d+`, `^\s*$`, `(foo|bar)`, `[A-Z]\w*`) behave the same in both. Look-around (`(?=…)`, `(?<!…)`) and backreferences (`\1`) work only in the JavaScript engine. Quarry checks a Find in Files pattern as you type and flags an invalid one.
