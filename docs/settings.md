# Settings

Open Settings with **Ctrl+,**, **Tools › Settings**, **View › Panels › Settings** or the gear icon at the bottom of the side rail. Changes apply immediately and are saved automatically. Settings opens at 35% of the window width so its descriptions are readable.

## Finding a setting

- **Filter.** Type in the box at the top. It matches a setting's name, its description, its section and group, and other words it is known by ("indent" finds Tab size, "dark" finds Theme). The matching text is highlighted, and sections with nothing left are hidden.
- **Jump bar.** The row of buttons under the filter jumps to a section and marks the one you're reading. When the panel is 700 px or wider, it becomes a list of sections on the left.
- **Collapse.** Click a section's heading to fold it away. Folded sections stay folded the next time you open Settings, but the filter and Modified still show their matching rows.
- **Modified.** A setting you changed from its default has an accent bar on its left edge. The **Modified** button next to the filter (with the count) shows only those settings.
- **More help.** A setting with a longer explanation has an **i** next to its name.

Each section is one card. Longer sections are split into groups, such as Editor › Typing and Editor › Display.

## Use previous and Restore default

Each setting has two buttons next to its name:

- **Use previous setting** (↶) puts back the value it had before your last change. Click it again to swap back, which makes it easy to compare two choices, such as two fonts. The previous values are remembered between sessions.
- **Restore default** (⟲) sets it back to Quarry's default.

A button with nothing to do is hidden until you point at the setting. **App › Reset all to defaults** resets everything.

Settings are stored in `%APPDATA%\com.quarry.app\settings.json`. If that file can't be read, Quarry starts with the defaults and keeps the unreadable file as `settings.json.bak`.

## Appearance

| Setting | Default | Description |
| --- | --- | --- |
| Theme | System | System (follows Windows), Light, Grey (neutral mid-grey, between Light and Dark) or Dark. Also on the panel rail's theme button (above the Settings gear) and in View › Theme. |
| Menu bar | Title bar | **Title bar**: the menus sit in the title bar next to the Quarry mark, and open documents get a tab row above it. **Top**: the menus get their own row below the title bar, and the tabs share the title bar. **Hidden**: like Top, but the menus show only when you press Alt or F10. |
| Mica material | On | Translucent Windows 11 background. Off gives an opaque background. |
| *Editor font* › Font family | `"Cascadia Code", "Cascadia Mono", Consolas, "Courier New", monospace` | Pick from the monospaced fonts installed on your PC, or choose **Custom…** and type a CSS font list. Quarry warns if the first font in a custom list isn't installed. |
| *Editor font* › Font size | 14 | 8–40. Ctrl+= / Ctrl+- / Ctrl+0 change it too. |

## Editor

| Setting | Default | Description |
| --- | --- | --- |
| *Typing* › Tab size | 4 | 1–16. Width of a tab and of one indent level. Also set from the status bar. |
| *Typing* › Insert spaces | On | Indent with spaces instead of tab characters. |
| *Typing* › Auto-close brackets and quotes | On | |
| *Display* › Word wrap | Off | Wrap long lines (Alt+Z). |
| *Display* › Line numbers | On | Show the line-number gutter. |
| *Display* › Highlight active line | On | |
| *Display* › Bracket matching | On | Highlight the bracket matching the one at the cursor. |
| *Display* › Render whitespace | Off | Show spaces, tabs and trailing whitespace. |

## Files & tabs

| Setting | Default | Description |
| --- | --- | --- |
| Restore session on start | On | Reopen the folder and tabs, including untitled tabs, from last time. See [Sessions and hot exit](editing.md#sessions-and-hot-exit). |
| Maximum open tabs | 50 | 1–1000. Opening more closes the least recently used tabs without unsaved changes, after asking. See [Tabs](editing.md#window-layout). |
| Default line endings | CRLF | Line endings for new files (CRLF or LF). |
| *Large files* › Large-file threshold (MB) | 128 | 1–256. Files this size or larger open in [large-file mode](large-files.md); smaller ones open as normal tabs with every feature. |
| *Large files* › Colours in large-file mode | On | Syntax colours for JSON, logs, CSV / TSV, XML and SQL files open in [large-file mode](large-files.md#colours). Only the lines on screen are coloured. |
| *Trusted folders* › Trust every folder I open | Off | On: git and language servers run in any folder and Quarry never asks. Also turned on by the tick box in the **Trust the files in …?** dialog. See [Trusted folders](editing.md#trusted-folders). |
| *Trusted folders* | none | The folders in which Quarry runs git and language servers, each with **Remove**. Folders are added when you answer **Trust Folder**; see [Trusted folders](editing.md#trusted-folders). Not a setting: **Reset all to defaults** leaves the list as it is. |

## Find

| Setting | Default | Description |
| --- | --- | --- |
| Find & replace history | Unlimited | How many [find and replace entries](find-and-replace.md#clearing-a-box-and-history) to remember. Choose **Limit** and a number to keep only that many of each; the oldest are dropped. |

**Clear find & replace history** asks first, then removes every remembered entry.

## Languages

| Setting | Default | Description |
| --- | --- | --- |
| *JSON* › Pretty-print indent | 2 | 1–8 spaces, used by Format and by CSV → JSON. Tabs are used instead when **Insert spaces** is off. |
| *Code intelligence* › Code intelligence | On | Suggestions, hover, Go to Definition, references, rename and problems from [language servers](code-intelligence.md). Off stops every server. |
| *Code intelligence* › *each server* | On | One line per server: a status dot (green installed, amber missing, hollow switched off), **Install…** when it's missing, and a switch to turn it off. Click the server's name to see where it's installed and to type your own command line (empty = the default). |

**Restart language servers** stops every server and connects the open files again.

## Terminal

| Setting | Default | Notes |
| --- | --- | --- |
| Shell | Automatic | The shell of new [terminal tabs](terminal.md): Automatic (the first one found: PowerShell 7, Windows PowerShell, Command Prompt), any installed shell including Git Bash, or Custom…. |
| Custom shell command | (empty) | Shown for Custom…: the program and its arguments, for example `"C:\msys64\usr\bin\bash.exe" --login -i` or `wsl.exe`. |

## Git

| Setting | Default | Description |
| --- | --- | --- |
| Allow merging with uncommitted changes | Off | Off: a [merge](git.md#merge-and-rebase) only starts when every tracked file is committed, so **Abort** can always bring everything back. On: a merge may start with uncommitted changes; git refuses one that would change those files, and if the merge stops on a conflict, Abort may not be able to bring your changes back exactly. A rebase always needs a clean state. |
| Compare with Branch shows | The two tips | **The two tips**: how the two branches differ right now. **Changes since split**: only what the picked branch changed since it split off from yours, as a pull request shows it. See [Comparing commits](git.md#comparing-commits). |

## Scripts & macros

| Setting | Default | Description |
| --- | --- | --- |
| Confirm script & macro runs | On | Ask before a script or macro started from a menu or shortcut edits the document. |
| Scripts folder | `%APPDATA%\com.quarry.app\scripts` | The root folder of your [scripts](scripting.md), subfolders included. The field always shows the folder in use, also when it is the default. |
| Macros folder | `%APPDATA%\com.quarry.app\macros` | Where [macros](macros.md) are loaded from and saved to. Shows the folder in use, like the scripts folder. |

When the panel is narrow, a folder's path is shortened in the middle; point at it to see all of it, click it to type a folder, or use **Browse…**. A folder that doesn't exist yet is created. If a folder you choose can't be used, Quarry switches back to the default and tells you. Changing the macros folder while a recorded macro is unsaved asks first; Cancel keeps the previous folder.

## Keyboard shortcuts

Says how many shortcuts you changed. **Edit shortcuts…** opens the **Keyboard Shortcuts** tab, which lists every command with Change, Remove and Restore default, and **Restore all** puts every shortcut back after asking. When the filter at the top of Settings matches commands, this row says how many and **Show matches** opens the tab with that search. See [Keyboard shortcuts › Changing shortcuts](keyboard-shortcuts.md#changing-shortcuts).

## App

| Setting | Default | Description |
| --- | --- | --- |
| Check for updates on start | On | Quietly looks for a new Quarry release while Quarry starts and offers it, once your tabs are back, if there is one. **Help › Check for Updates** works either way. |

- **Open settings folder** opens `%APPDATA%\com.quarry.app` in File Explorer.
- **Reset all to defaults** asks first, then resets every setting and reloads scripts and macros from the default folders.

## Files Quarry keeps

| Location | Contents |
| --- | --- |
| `%APPDATA%\com.quarry.app\settings.json` | Settings |
| `%APPDATA%\com.quarry.app\session.json` | Open folder and tabs, contents of untitled tabs, recent files and folders, panel layout |
| `%APPDATA%\com.quarry.app\search-history.json` | Find and replace history |
| `%APPDATA%\com.quarry.app\scripts\`, `…\macros\` | Default scripts and macros folders |
| `%LOCALAPPDATA%\com.quarry.app\logs\` | `crash.log` / `crash-last.log` |
| `%LOCALAPPDATA%\com.quarry.app\replace-undo\` | Backups for [Undo Replace in Files](find-and-replace.md#undo-replace-in-files), cleared on start |
| `%TEMP%\quarry-*` | Working copies made by large-file Replace All |
