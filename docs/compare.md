# Compare

A **Compare** tab shows two versions of a text side by side, or in one editor with the removed lines shown inline. It has syntax colours, a line-number gutter for each side, and the changed words highlighted within changed lines.

- [Opening a compare](#opening-a-compare)
- [Reading the differences](#reading-the-differences)
- [Editing and saving](#editing-and-saving)
- [Limits](#limits)

## Opening a compare

| Where | How |
| --- | --- |
| Explorer, Find in Files results | Right-click a file › **Select for Compare**, then right-click another › **Compare with "…"** |
| Explorer | Select two files (Ctrl+click) › right-click › **Compare Selected** |
| Tab right-click | **Compare with Saved** (your unsaved edits against the file on disk), **Compare with Clipboard**, **Select for Compare** / **Compare with Selected** |
| File › Compare | **Compare Two Files…**, **Compare Active File With…**, **Compare with Saved**, **Compare with Clipboard** |

The first file is the left (original) side and the second the right (changed) side. If the two have the same name, each side is labelled with its folder, as in `old\stats.ts` and `new\stats.ts`.

## Reading the differences

- **Colours.** Removed lines are red on the left, added lines green on the right, and the words that changed are highlighted more strongly.
- **Moving between changes.** **F7** / **Shift+F7** (or the arrows in the toolbar) go to the next / previous change. The toolbar shows where you are, for example **Change 2 of 5**.
- **Layout.** **Side by side** / **Inline** switches the layout. In inline mode the removed lines appear above the lines that replaced them.
- **Unchanged lines.** The fold button hides long unchanged stretches. Click a folded stretch to show it.
- **Swap** (⇄) puts each side on the other side. **Reload** reads the files from disk again.

## Editing and saving

- **What you can edit.** Sides that are files can be edited directly. The other kinds are read-only snapshots: a tab's unsaved text, and the clipboard.
- **Copying a change across.** The arrows between the two sides copy a change from the left side into the right one.
- **Saving.** An edited side is tagged **edited**. Save with **Ctrl+S** or the **Save** button. Each file keeps its encoding, byte order mark and line-ending style.
- **Closing.** Closing a compare with unsaved edits asks first.
- **Other tabs.** If the file is also open in a normal tab, that tab notices the change like any other change made outside it.

## Limits

- Files at or above the large-file threshold (Settings › Files, default 32 MB) and binary files can't be compared.
- Compare tabs aren't restored when Quarry restarts.
- Very different texts are compared with a time limit of a few seconds; past it, the comparison is less precise.
