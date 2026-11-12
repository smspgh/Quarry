# Editing

- [Window layout](#window-layout)
- [Opening files and folders](#opening-files-and-folders)
- [Command palette, Quick Open and Go to Line](#command-palette-quick-open-and-go-to-line)
- [Multi-cursor and column mode](#multi-cursor-and-column-mode)
- [Line and text commands](#line-and-text-commands)
- [Languages](#languages)
- [Encodings and line endings](#encodings-and-line-endings)
- [Saving](#saving)
- [External changes](#external-changes)
- [Sessions and hot exit](#sessions-and-hot-exit)
- [Explorer](#explorer)
- [Appearance and accessibility](#appearance-and-accessibility)
- [Crash reports](#crash-reports)

## Window layout

- **Title bar.** By default it holds the Quarry mark and the menus (File, Edit, View, …). **Alt** or **F10** opens the menus from the keyboard.
- **Tabs.** Once a document is open, its tab appears in a row above the title bar. The active tab is always highlighted with an accent bar and bold name. Right-click a tab for Close, Close Others, Copy Path, **Show in Quarry Explorer** and **Show in Windows Explorer** (the last three for saved files only).
  - **More tabs than fit** wrap onto another row below, starting under the first tab, so every tab stays visible. The tab area grows a row at a time.
  - **New files** are named Untitled-1, Untitled-2, … using the lowest number no open tab has, so closing Untitled-1 makes the next new file Untitled-1 again.
  - **Preview tabs.** A file you single-click in the Explorer opens in a *preview* tab, with its name in italics. Clicking another file in the Explorer replaces it, so browsing the tree doesn't pile up tabs. The tab is kept once you edit the file, double-click its tab, or double-click the file in the Explorer.
  - **Tab limit.** **Settings › Tabs and panels › Maximum open tabs** (default 50) caps how many tabs are open at once. Opening a file past the limit asks first, naming the least recently used tabs without unsaved changes that Quarry would close to make room. **Cancel** opens nothing, so you can close tabs yourself. Tabs with unsaved changes are never closed for you; when every tab has changes, Quarry says so and opens nothing.
  - **Show in Quarry Explorer** opens the Explorer panel, expands the tree down to the file, selects it and puts keyboard focus on it. If the file isn't inside the folder open in the Explorer, its own folder is opened there.
  - **Show in Windows Explorer** opens Windows File Explorer at the file's folder with the file selected.
  - Both are also in the **File** menu and the command palette, for the active document. New documents come from **File › New**, **Ctrl+N** or the welcome screen.
- **Menu position.** **Settings › Appearance › Menu bar** can instead put the menus on their own row (**Top**) or hide them (**Hidden**, shown with Alt or F10). In both of those, the tabs share the title bar.
- **Quarry mark.** Clicking the icon at the left of the title bar collapses every open side panel. Clicking it again brings back the pinned ones.
- **Panel rail and side panels.** A strip of coloured icons on the left edge opens the panels: Search, Explorer, Source Control ([Git](git.md)), JSON Tools, Scripts, Macros and, at the bottom, Settings. Hover an icon to see its name ("Explorer Panel", …); click it to open the panel, and click it again to close it. The panels are also in **View › Panels**. **Ctrl+B** collapses the open panels, or brings them back.
  - **Floating or pinned.** A panel opens floating over the editor and closes when you click back into the document (or press **Escape**). Click the pin button at the top of a panel to keep it open beside the editor. Pinned panels stay visible together, side by side in the order you pinned them, and a panel you open next floats just to their right. A pinned panel has a pin in its top-left corner, in the panel's colour, and a dot on its rail icon. Click the pin button again to unpin it; the panel-close button unpins and closes it. Only pinned panels reopen when Quarry starts.
  - **Search with results.** While Find in Files has results, the Search panel docks beside the editor as if pinned (without the pin), so a file you open from the results isn't hidden behind it. It goes back to floating when you close it or clear the results.
  - **Width.** Drag a panel's right edge; each panel keeps its own width. Settings always opens at 35% of the window width; a width you drag it to lasts until you close it.
- **Split editor** (**Ctrl+\\**, **View › Split Editor**). Shows a second pane to the right with the same document; both panes edit it, with one undo history. The tab strip is shared: picking a tab changes the pane that has the keyboard (the one with the accent line on top), and the other pane's tab gets a lighter accent line. Picking the tab the other pane shows moves the keyboard there; so do a click in it and **Ctrl+1** / **Ctrl+2** (left / right). **Open to the Side** on a tab's right-click menu shows it in the other pane, splitting the editor if needed. Only text documents go in the right pane; Claude, terminal, Compare and large-file tabs always open on the left. Drag the bar between the panes to resize them (double-click it for half and half). **Ctrl+\\** again, or closing the right pane's document, closes the split. The split comes back with the session.
- **Bottom panel** (**Ctrl+J**). The Console used by scripts.
- **Status bar.** Cursor position, column mode, indentation, encoding, line endings and language. Click any of these to change it.

With no tabs open, the welcome screen offers New, Open file, Open folder, the command list and your recent files. Quarry starts on this screen when there is nothing to restore; it doesn't create an empty Untitled document.

**Help tips.** An **ⓘ** icon next to a panel title shows tips for that panel. Hover it to read them, or click it to keep them open while you work; click it again, click elsewhere or press **Escape** to close them.

## Opening files and folders

- **Ctrl+O / Ctrl+Shift+O** open a file / folder. **File › Open Recent** keeps the last 12 files and 10 folders.
- Drop files anywhere on the window to open them. Dropping a folder opens it in the Explorer.
- In File Explorer, right-click any file and choose **Open with Quarry**, or any folder and choose **Open folder in Quarry**. On Windows 11 these are under **Show more options**. Quarry is also listed in **Open with** for common text, data and code files. The installer adds these entries without changing your default apps.
- `quarry.exe <path> [<path> …]` opens files or a folder from the command line. Quarry runs as a single instance, so opening a file while it's running sends the file to the existing window.
- Files that look binary (a NUL byte near the start) open read-only with a warning.
- Files at or above the large-file threshold (32 MB by default) open in [large-file mode](large-files.md).

## Command palette, Quick Open and Go to Line

| Keys | Opens |
| --- | --- |
| **Ctrl+Shift+P** or **F1** | **Command palette.** Every command with its shortcut, matched fuzzily against "Category: Title", so typing `json` lists all JSON commands. With an empty box, recently used commands come first. Unavailable commands are hidden. |
| **Ctrl+P** | **Quick Open.** Fuzzy search over the files in the open folder (up to 30,000 files; `.git`, `node_modules` and `target` skipped). With no folder, it lists open and recent files. |
| **Ctrl+G** | **Go to Line.** Accepts `120`, `120:8` or `120,8`. The cursor previews the target as you type, and Esc puts it back. |
| **Ctrl+K M** | **Language picker.** |

In every list, ↑/↓ or Tab/Shift+Tab move, Page Up/Down jump 10, Enter runs and Esc cancels.

## Multi-cursor and column mode

**Multi-cursor**

| Keys | Action |
| --- | --- |
| **Ctrl+D** | Add the next occurrence of the selection (or the word) as another cursor. |
| **Ctrl+Shift+L** | Select every occurrence. |
| **Alt+Enter** (in the find bar) | Select every find match. |
| **Ctrl+Alt+↑ / ↓** | Add a cursor above / below, at the same column. |
| **Alt+drag** | Rectangular selection. |
| **Alt+Shift+I** | Split a block selection into one cursor per line. |
| **Esc** | Back to a single cursor. |

**Column (block) mode** — **Alt+Shift+C**, **Selection › Toggle Column Mode**, or the **Column** button in the status bar:

- Any mouse drag selects a rectangle; no Alt is needed.
- **Shift+arrows** grow or shrink the block. **Shift+Home / End** extend it to column 0 or to the longest line in the block. **Shift+Page Up / Down** move 20 rows.
- Typing, deleting and pasting edit every row of the block at once.
- Columns are visual, so tabs count as their width. A row too short to reach the block gets a cursor at its end.
- Column mode is a single switch for all tabs and is off when Quarry starts.

## Line and text commands

From the **Edit** menu or the palette. With no selection, the **Lines** commands work on the whole document. With a selection, they work on the lines it touches.

- **Line:** Duplicate Line Down (**Ctrl+Shift+D**) / Up, Delete Line (**Ctrl+Shift+K**), Move Line Up / Down (**Alt+↑ / ↓**).
- **Lines:** Sort Ascending / Descending (natural order, case-insensitive, so `file2` sorts before `file10`), Reverse, Remove Duplicates, Delete Blank Lines (whitespace-only lines too), Delete Empty Lines, Trim Trailing Whitespace, Join Lines, Number Lines.
- **Transform:** Uppercase, Lowercase, Title Case, Wrap Selections in Quotes.
- **Code menu:**
  - Toggle Line Comment (**Ctrl+/**) and Block Comment (**Shift+Alt+A**).
  - Fold / Unfold (**Ctrl+Shift+[** / **]**), Fold All / Unfold All. Right-click a line that starts a foldable region (a JSON object or array, a code block…), or its fold arrow, for **Collapse** (or **Expand**, when it is folded), **Collapse All** and **Expand All** (that region and every region inside it; its siblings and the levels above it stay as they are, and children folded this way stay folded when you expand just the parent), next to Cut / Copy / Paste / Select All. Other lines keep the usual right-click menu.
  - Go to Matching Bracket (**Ctrl+Shift+\\**).
  - Indentation › Convert to Spaces / Tabs.
  - [Format Document](formatting.md) (**Shift+Alt+F**).

CodeMirror's standard keys also work, for example **Ctrl+Space** for the language's completions, where it has any, **Alt+L** to select a line, **Ctrl+[ / ]** to outdent / indent, and **Shift+Alt+↑ / ↓** to copy a line up / down.

## Languages

Syntax highlighting covers about 140 languages through [`@codemirror/language-data`](https://github.com/codemirror/language-data), plus Plain Text.

Quarry picks the language from the file extension. For untitled files and unknown extensions, it looks at the start of the text and recognises:

- JSON, XML/SVG, HTML and PHP;
- shebang scripts (Node, Python, shell);
- YAML, Rust, TypeScript, JavaScript, Go, C/C++, C#, Java and Python;
- SQL, CSS and Markdown.

Text pasted into an empty untitled tab is checked again, so pasting JSON into a new tab gives you JSON highlighting and the JSON tools straight away.

To change the language, click it in the status bar, use **Code › Language**, or press **Ctrl+K M**. **Auto-detect Language** checks the text again.

## Encodings and line endings

**On open**

- A byte-order mark decides the encoding: UTF-8, UTF-16 LE or UTF-16 BE.
- Without one, the encoding is detected from the first 1 MiB with [chardetng](https://github.com/hsivonen/chardetng), the detector Firefox uses.
- If a file can't be decoded cleanly, Quarry warns you.
- Line endings are detected by majority (CRLF, LF or CR). If a file mixes them, Quarry warns you, and saving converts them all to the detected style.

**In the status bar**

- The **encoding** picker sets the encoding the file is **saved** in. It offers UTF-8, UTF-16LE, UTF-16BE, windows-1252, ISO-8859-1, ISO-8859-2, windows-1251, Shift_JIS, GBK and EUC-KR. It does not reload the file in that encoding.
- If the text contains characters the chosen encoding can't represent (for example `€` or Japanese text in ISO-8859-1), Save stops and tells you how many there are and where the first one is. You can then save as UTF-8 instead or cancel. Quarry never silently replaces characters.
- `BOM` after the encoding means the file had a byte-order mark. It is kept on save.
- The **line endings** picker switches between CRLF and LF. CR-only files keep CR.

New files use UTF-8 without a BOM and the line ending set in **Settings › Editor › Default line endings** (CRLF by default).

## Saving

- **Ctrl+S** saves, **Ctrl+Shift+S** is Save As, and **Ctrl+Alt+S** saves all.
- Saves are atomic. Quarry writes a temporary file in the same folder, flushes it to disk and then replaces the original, so a crash or power cut can't leave a half-written file.
- Missing parent folders are created.
- If the file changed on disk after you opened it, Save asks before overwriting.
- **File › Revert File** discards your changes and reloads the file.

## External changes

When Quarry's window regains focus, or you switch tabs, it checks whether open files changed on disk.

- **No unsaved changes:** the file reloads, with a short notice.
- **Unsaved changes:** Quarry asks whether to reload from disk or keep your version.
- **File deleted or moved:** Quarry tells you. The tab stays open with your text, and saving recreates the file.

The Explorer tree also updates by itself when files are added, removed or renamed in the open folder.

## Sessions and hot exit

With **Settings › Files › Restore session on start** on (the default), Quarry reopens your folder, tabs, cursor positions and side-panel layout. Untitled tabs are restored with their contents, so you can close Quarry without saving scratch notes. Their text is written to the session file whenever you pause typing, and at least every 10 seconds while you type, so a crash loses very little.

When you close the window, Quarry asks to save only what the session can't keep:

- unsaved changes to files on disk;
- unsaved changes in large-file tabs;
- untitled tabs over 2 MB.

With session restore off, it asks for every unsaved tab.

Files given on the command line take the place of the restored tabs.

## Explorer

**Ctrl+Shift+E** shows the Explorer for the open folder.

- **Toolbar:** New File, New Folder, Refresh, Close Folder. The tree follows the active tab, and a tab's **Show in Quarry Explorer** finds its file in the tree. New items are named inline, and a new file opens straight away.
- **Mouse:** click a file to open it; keyboard focus stays in the tree, so Ctrl+C, Ctrl+X and Delete act on that file. **Double-click** opens it and moves you into the editor. **Ctrl+click** adds a file or folder to the selection (or takes it out), and **Shift+click** selects every row from the last one you clicked; neither opens anything.
- **Right-click** a file or folder (or a selection of several) for:
  - on a folder, **Expand** (when it's closed) and **Expand All** (when it has folders inside; opens it and every folder below it, up to 500, passing over `.git` and `node_modules`), or **Collapse** (when it's open) and **Collapse All** (when folders inside it are open too; closes them all);
  - **Open All Files** (on a folder, or a selection of several): opens each file in its own tab. For a selected folder, that means the files directly inside it, unless you also selected some of the files in it; then only the selected ones open. The [tab limit](#window-layout) applies, with one question for the whole batch;
  - **Find in File** / **Find in Folder** / **Find in Selected**, and **Rename** (**F2**);
  - **Cut** (**Ctrl+X**), **Copy** (**Ctrl+C**), **Paste** (**Ctrl+V**) and **Delete** (**Del**);
  - **Copy Path** and **Copy File Name** (one per line for several);
  - **Show in Windows Explorer**.

  Right-click on the blank space below the rows to paste into the open folder itself.
- **Copy, Cut and Paste** use the Windows clipboard, so you can copy files in Quarry and paste them in File Explorer, or the other way round. Paste goes into the folder you right-clicked (or the folder of the file). Nothing is overwritten: a name that's taken gets " - Copy" for a copy, as in File Explorer, or " (2)" for a move. Pasting after Cut moves the items, and open tabs follow the files they show.
- **Find in Files** searches what you last clicked or selected here when its scope is Folder / Selection; see [Find in Files](find-and-replace.md#where-it-searches).
- **Keyboard:**
  - ↑/↓ move, ←/→ collapse or expand, Enter opens.
  - Type the start of a name to jump to it.
- **Delete** asks first, then moves the file or folder (or everything selected) to the Recycle Bin.
- **Renaming** a file updates any open tab for it.
- **What's shown:** hidden files are included. Folders are listed first, then natural sort order.

## Appearance and accessibility

- **Theme:** System (follows Windows), Light or Dark. **View › Toggle Light/Dark Theme** switches between light and dark, leaving System mode.
- **Mica:** the translucent Windows 11 background. Turn it off in Settings for an opaque one.
- **Font:** size and family are in Settings. **Ctrl+= / Ctrl+-** zoom and **Ctrl+0** resets. The default font is Cascadia Code, falling back to Consolas.
- **High Contrast:** Windows High Contrast themes are followed: solid system colours, visible focus and borders.
- **Reduced motion:** with Windows' *Animation effects* turned off, Quarry turns off its animations.
- **Keyboard and screen readers:** every control is keyboard-reachable and labelled for screen readers.
  - **Ctrl+M** makes Tab move focus instead of inserting a tab; the status bar shows **Tab moves focus** while this is on.
  - **Esc** then **Tab** also leaves the editor once.

## Crash reports

If Quarry stops unexpectedly, it writes `crash.log` to its log folder, `%LOCALAPPDATA%\com.quarry.app\logs`. On the next start a notice tells you where the file is. **Help › About Quarry** has **Copy Version Info** and **Open Log Folder**, for including in a bug report.
