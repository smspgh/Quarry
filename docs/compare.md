# Compare

A **Compare** tab shows two versions of a text side by side, or in one editor with the removed lines shown inline. It has syntax colours, a line-number gutter for each side, and the changed words highlighted within changed lines.

- [Opening a compare](#opening-a-compare)
- [Reading the differences](#reading-the-differences)
- [Editing and saving](#editing-and-saving)
- [Comparisons from Source Control](#comparisons-from-source-control)
- [Limits](#limits)

## Opening a compare

| Where | How |
| --- | --- |
| Explorer, Find in Files results | Right-click a file › **Select for Compare**, then right-click another › **Compare with "…"** |
| Explorer | Select two files (Ctrl+click) › right-click › **Compare Selected** |
| Tab right-click | **Compare with Saved** (your unsaved edits against the file on disk), **Compare with Clipboard**, **Select for Compare** / **Compare with Selected** |
| File › Compare | **Compare Two Files…**, **Compare Active File With…**, **Compare with Saved**, **Compare with Clipboard** |
| Commit graph | Click a file of a commit, or of a comparison of two commits, of a commit with your files, or with a branch ([Comparing commits](git.md#comparing-commits)) |

Comparisons opened from the commit graph are labelled `name @ commit id` and reuse one tab as you click through the files (double-click the tab to keep it). Versions from a commit are read-only; when a commit is compared with your files, the right side is the file on disk and can be edited and saved.

The first file is the left (original) side and the second the right (changed) side. If the two have the same name, each side is labelled with its folder, as in `old\stats.ts` and `new\stats.ts`.

## Reading the differences

- **Colours.** Removed lines are red on the left, added lines green on the right, and the words that changed are highlighted more strongly.
- **Moving between changes.** **F7** / **Shift+F7** (or the arrows in the toolbar) go to the next / previous change. The toolbar shows where you are, for example **Change 2 of 5**.
- **Layout.** **Side by side** / **Inline** switches the layout. In inline mode the removed lines appear above the lines that replaced them.
- **A narrow tab.** Below about 1000 px the layout switch shows only its icons and the Source Control buttons read **Stage Lines** / **Discard Lines** / **Unstage Lines**; below about 680 px the file names get a row of their own above the buttons.
- **Unchanged lines.** The fold button hides long unchanged stretches. Click a folded stretch to show it.
- **Swap** (⇄) puts each side on the other side. **Reload** reads the files from disk again and takes a tab's current text; clipboard and git versions keep the text they had, except in a comparison opened from Source Control, which reads its git side again too (it is off while a side has unsaved edits). A comparison with a file side also reloads by itself when that file changes on disk and nothing in the comparison is edited (see [Editing › External changes](editing.md#external-changes)).

## Editing and saving

- **What you can edit.** Sides that are files can be edited directly. The other kinds are read-only snapshots: a tab's text, the clipboard, and versions from git. In Inline layout there is only one editor, holding the right side: only that side can be edited there (switch to side by side to edit the left one).
- **Copying a change across.** In side-by-side layout, the arrows between the two sides copy a change from the left side into the right one. When the right side is read-only and the left one is a file, they copy from right to left instead. There are no arrows when both sides are read-only, or in Inline layout.
- **Saving.** An edited side is tagged **edited**. Save with **Ctrl+S** or the **Save** button. Each file keeps its encoding, byte order mark and line-ending style.
- **Closing.** Closing a compare with unsaved edits asks first.
- **Other tabs.** If the file is also open in a normal tab, that tab notices the change like any other change made outside it.

## Comparisons from Source Control

A Compare tab opened by clicking a file under **Changes** or **Staged Changes** in the Source Control panel can also stage, unstage or discard part of the file:

- A bar above each change has **Stage Change** and **Discard Change** (from Changes) or **Unstage Change** (from Staged Changes). In side-by-side layout the bar is in the right side; the Inline layout has it too.
- The toolbar has **Stage Selected Lines** / **Discard Selected Lines** (or **Unstage Selected Lines**), which act on the lines selected in the right side; a bare cursor counts as its line. They are off when the selection touches no change.
- The arrows between the sides are unchanged: they edit the right side (an edit you can undo and must save), they don't stage or discard anything.
- The tab follows the index: after a staging action or a commit it is refreshed in place, its left side relabelled **(staged)** or **(HEAD)**, without moving away from where you were. A tab with unsaved edits is not refreshed.
- While the sides are swapped the staging controls are hidden; swap back to get them.

What each action does, when it asks and what it saves first is in [Git: Source Control panel](git.md#source-control-panel).

## Limits

- Files at or above the large-file threshold (Settings › Files, default 32 MB) and binary files can't be compared.
- Compare tabs aren't restored when Quarry restarts.
- Very different texts are compared with a time limit of a few seconds; past it, the comparison is less precise.
