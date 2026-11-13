# Macros

A macro records what you do in the editor (typing, editing keys and commands) and plays it back, once, a set number of times, or line by line down to the end of the file. A whole playback, however many repetitions, is undone with a single **Ctrl+Z**.

- [Recording](#recording)
- [What is recorded](#what-is-recorded)
- [Playing](#playing)
- [Editing steps](#editing-steps)
- [Where macros live](#where-macros-live)
- [File format](#file-format)
- [Tips and limitations](#tips-and-limitations)

## Recording

1. Open a text document and put the cursor where the macro should start.
2. Press **Ctrl+Shift+R** (or **Macros › Start/Stop Recording**). The status bar shows **REC** and the number of steps so far.
3. Do the edit once.
4. Press **Ctrl+Shift+R** again.

The recording becomes a new, **unsaved** macro called `Macro N` at the top of the **Macros** panel. Rename it there and click **Save** to keep it. Unsaved macros are lost when Quarry closes.

To add steps to an existing macro, select it and use **Record more** in its step editor.

## What is recorded

| Recorded | As |
| --- | --- |
| Text you type in the editor (consecutive typing is merged into one step) | `Type "…"` |
| Editing and navigation keys in the editor: arrows, Home/End, Page Up/Down, Enter, Backspace, Delete, Tab, and their Ctrl/Shift/Alt combinations | `Key: Ctrl+Shift+Left` |
| Commands, whether run from a shortcut, a menu, the command palette or a panel button | `Command: Sort Lines Ascending` |

A registered shortcut is recorded as its **command**, not as a key. For example, Ctrl+D is recorded as "Add Selection to Next Find Match", so playback does the same thing even if the binding changes.

**Not recorded:**

- Mouse clicks and mouse selections.
- Text typed into the find bar, the palette or other input boxes. A recorded Find opens the find bar and steps to the next match, but the search term is not stored. Type the term in the find bar before recording, and record only **F3** (Find Next).
- Macro commands themselves, so a macro can't start another macro.

## Playing

| How | What it does |
| --- | --- |
| **Ctrl+Shift+M** / **Macros › Play Last** | Plays the last recorded or played macro once. |
| **Play** in the panel or **Macros › *name* › Play** | Plays that macro once. |
| **Play ×N** in the panel | Plays it N times in a row (1 to 100,000). |
| **To end** in the panel, or **Play Until End of File** | Repeats the macro while each pass moves the cursor down at least one line, stopping once a pass starts on the last line. The safety limit is 10,000 passes. |
| **Shift+Esc** / **Stop** | Stops playback. |
| **Pause / Resume** | In the panel, the status bar or **Macros › Pause/Resume**. |

Stop and Pause take effect at the next checkpoint (every 20 steps), not instantly.

By default, a macro started from a menu or shortcut first asks **Run / Review first / Cancel**. Turn this off with **Settings › Confirm script & macro runs**.

**Undo:** while a macro plays, its individual edits are kept out of the undo history, and the net change is applied as one step at the end. A single **Ctrl+Z** therefore undoes the entire playback, including all repetitions of ×N or To end. The exception is a macro that itself contains an Undo or Redo step. It plays with normal step-by-step history, so undoing it takes one Ctrl+Z per edit.

## Editing steps

Select a macro in the **Macros** panel to see its numbered steps.

- **Text steps:** edit the text (pencil, then Enter to apply or Esc to cancel).
- **Key steps:** re-capture the key (pencil, then press the new combination).
- **Command steps:** can be moved or deleted but not changed.
- **Move up / down** and **Delete** work on every step.
- **+ Text** and **+ Key** add a step at the end.

Changes mark the macro unsaved (`•`) until you click **Save**.

## Where macros live

Each macro is a file named `<name>.macro.json`.

- Default folder: `%APPDATA%\com.quarry.app\macros`.
- Change it in **Settings › Folders › Macros folder** or with the panel's folder button.
- Saving a renamed macro renames its file: the file under the old name is deleted, not moved to the Recycle Bin, since its steps are now in the new one. **Delete** asks first and moves the file to the Recycle Bin.
- The list reloads when Quarry regains focus, unless a macro is unsaved, recording or playing.

## File format

```json
{
  "steps": [
    { "type": "key", "key": "Home", "code": "Home", "ctrl": false, "shift": false, "alt": false, "meta": false },
    { "type": "input", "text": "// " },
    { "type": "key", "key": "ArrowDown", "code": "ArrowDown", "ctrl": false, "shift": false, "alt": false, "meta": false },
    { "type": "command", "id": "code.trimTrailing" }
  ],
  "createdAt": 1761480000000
}
```

| Step | Fields |
| --- | --- |
| `key` | `key` and `code` as in a browser `KeyboardEvent`, plus the four modifier flags. |
| `input` | `text` to insert at every cursor. |
| `command` | `id` of a Quarry command (the palette shows titles; see [keyboard shortcuts](keyboard-shortcuts.md) for ids), and optional `args`. |

`createdAt` is a Unix time in milliseconds. A file without a `steps` array, or with invalid JSON, is skipped without a message.

The example above comments out a line and moves down. Played with **To end**, it comments out every line from the cursor to the end of the file.

## Tips and limitations

- For **To end**, the macro must finish each pass at least one line lower than it started, usually by ending with **↓** or **Home ↓**. Otherwise it stops after one pass.
- Commands that aren't available at that moment (for example, a JSON command in a non-JSON file) are skipped.
- Running a script by name from a menu doesn't work inside a macro, because script runs are blocked while a macro plays.
- Macros run only on regular text tabs, not on files open in [large-file mode](large-files.md).
- If a macro switches tabs, the single-undo grouping may not apply.
