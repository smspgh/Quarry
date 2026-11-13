# Settings

Open Settings with **Ctrl+,**, **Tools › Settings**, **View › Panels › Settings** or the gear icon at the bottom of the side rail. Changes apply immediately and are saved automatically. Use the search box at the top to filter. Settings opens at 35% of the window width so its descriptions are readable.

Each setting has two buttons next to its name:

- **Use previous setting** (↶) puts back the value it had before your last change. Click it again to swap back, which makes it easy to compare two choices, such as two fonts. The previous values are remembered between sessions.
- **Restore default** (⟲) sets it back to Quarry's default.

A button with nothing to do is hidden until you point at the setting. **Data › Reset all to defaults** resets everything.

Settings are stored in `%APPDATA%\com.quarry.app\settings.json`. If that file can't be read, Quarry starts with the defaults and keeps the unreadable file as `settings.json.bak`.

## Appearance

| Setting | Default | Description |
| --- | --- | --- |
| Theme | System | System (follows Windows), Light or Dark. |
| Menu bar | Title bar | **Title bar**: the menus sit in the title bar next to the Quarry mark, and open documents get a tab row above it. **Top**: the menus get their own row below the title bar, and the tabs share the title bar. **Hidden**: like Top, but the menus show only when you press Alt or F10. |
| Confirm script & macro runs | On | Ask before a script or macro started from a menu or shortcut edits the document. |
| Check for updates on start | On | Quietly looks for a new Quarry release shortly after launch and offers it if there is one. **Help › Check for Updates** works either way. |
| Mica material | On | Translucent Windows 11 background. Off gives an opaque background. |
| Font size | 14 | 8–40. Ctrl+= / Ctrl+- / Ctrl+0 change it too. |
| Editor font family | `"Cascadia Code", "Cascadia Mono", Consolas, "Courier New", monospace` | Pick from the monospaced fonts installed on your PC, or choose **Custom…** and type a CSS font list. Quarry warns if the first font in a custom list isn't installed. |

## Editor

| Setting | Default | Description |
| --- | --- | --- |
| Tab size | 4 | 1–16. Width of a tab and of one indent level. Also set from the status bar. |
| Insert spaces | On | Indent with spaces instead of tab characters. |
| Word wrap | Off | Wrap long lines (Alt+Z). |
| Line numbers | On | Show the line-number gutter. |
| Highlight active line | On | |
| Bracket matching | On | Highlight the bracket matching the one at the cursor. |
| Auto-close brackets and quotes | On | |
| Render whitespace | Off | Show spaces, tabs and trailing whitespace. |
| Default line endings | CRLF | Line endings for new files (CRLF or LF). |

## Tabs and panels

| Setting | Default | Description |
| --- | --- | --- |
| Maximum open tabs | 50 | 1–1000. Opening more closes the least recently used tabs without unsaved changes, after asking. See [Tabs](editing.md#window-layout). |

## Files

| Setting | Default | Description |
| --- | --- | --- |
| Large-file threshold (MB) | 32 | 1–4096. Files this size or larger open in [large-file mode](large-files.md). |
| Colours in large-file mode | On | Syntax colours for JSON, logs, CSV / TSV, XML and SQL files open in [large-file mode](large-files.md#colours). Only the lines on screen are coloured. |
| Restore session on start | On | Reopen the folder and tabs, including untitled tabs, from last time. See [Sessions and hot exit](editing.md#sessions-and-hot-exit). |

## Folders

| Setting | Default | Description |
| --- | --- | --- |
| Scripts folder | `%APPDATA%\com.quarry.app\scripts` | The root folder of your [scripts](scripting.md), subfolders included. The field always shows the folder in use, also when it is the default. |
| Macros folder | `%APPDATA%\com.quarry.app\macros` | Where [macros](macros.md) are loaded from and saved to. Shows the folder in use, like the scripts folder. |

A folder that doesn't exist yet is created. If a folder you choose can't be used, Quarry switches back to the default and tells you. Changing the macros folder while a recorded macro is unsaved asks first; Cancel keeps the previous folder.

## Search

| Setting | Default | Description |
| --- | --- | --- |
| Find & replace history | Unlimited | How many [find and replace entries](find-and-replace.md#clearing-a-box-and-history) to remember. Choose **Limit** and a number to keep only that many of each; the oldest are dropped. |

**Clear find & replace history** asks first, then removes every remembered entry.

## JSON

| Setting | Default | Description |
| --- | --- | --- |
| Pretty-print indent | 2 | 1–8 spaces, used by Format and by CSV → JSON. Tabs are used instead when **Insert spaces** is off. |

## Code intelligence

| Setting | Default | Description |
| --- | --- | --- |
| Code intelligence | On | Suggestions, hover, Go to Definition, references, rename and problems from [language servers](code-intelligence.md). Off stops every server. |
| *each server* | On | Whether the server is installed and where, a switch to turn it off, an **Install…** button when it's missing, and a box for your own command line (empty = the default). |

**Restart language servers** stops every server and connects the open files again.

## Claude Code

| Setting | Default | Description |
| --- | --- | --- |
| Claude Code | On | The whole [Claude Code integration](claude-code.md): Explorer items, menu items, commands, Claude and Claude CLI tabs. Turning it off closes those tabs, after asking. The other Claude settings are hidden while it's off. |
| Claude Code location | Found automatically | `claude.exe` or `claude.cmd`. Empty means search PATH and the usual install folders. The line under the name shows what was found and its version. |
| Model | Default | Default (Claude Code's own choice), Opus, Sonnet or Haiku. Applies the next time Claude Code starts for a tab, including when a conversation continues (a new tab, a past conversation, the first message after Claude Code was stopped). A Claude Code process that is already running keeps its model. |
| Permissions | Auto-accept edits | **Auto-accept edits**: file edits go ahead without asking, and commands and web access ask first. **Ask first**: Claude asks before every edit too. Open Claude tabs switch too: an idle tab continues its conversation with the new setting from its next message; a tab where Claude is working finishes the task first. |

## Data

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
| `%USERPROFILE%\.claude\projects\` | Claude Code's own conversation history, which Quarry reads to show [past conversations](claude-code.md#past-conversations) (Quarry doesn't write there) |
