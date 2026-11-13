# Claude Code

Quarry can run [Claude Code](https://claude.com/claude-code) in any folder, in two ways:

- A **Claude tab** is Quarry's own chat interface for a Claude Code session. It shows formatted replies, a card for each step Claude takes, diffs of every edit, and permission requests you answer with a click. It also has a message box that takes screenshots.
- A **Claude CLI tab** runs the `claude` command line itself in a terminal, exactly as in Windows Terminal.

Both use your own Claude Code installation and login. Quarry doesn't store API keys or send anything anywhere itself.

- [Requirements](#requirements)
- [Starting](#starting)
- [Claude tabs](#claude-tabs)
- [Permissions](#permissions)
- [Pictures and context](#pictures-and-context)
- [Past conversations](#past-conversations)
- [Claude CLI tabs](#claude-cli-tabs)
- [Turning it off](#turning-it-off)

## Requirements

Install Claude Code and sign in once from a terminal (`claude`, then follow the prompts). Quarry finds `claude.exe` from the native installer, or `claude.cmd` from npm, on your PATH or in the usual install folders. **Settings › Claude Code** shows which one it found and its version, and lets you browse to it if it isn't found.

## Starting

| Where | Item |
| --- | --- |
| Explorer, right-click a folder (or blank space, for the open folder) | **Work with Claude Code Here** / **Claude Code Terminal Here** |
| Tools menu, command palette | **Work with Claude Code Here**, **Work with Claude Code in Folder…**, **Open Claude Code Terminal Here** |

Without a folder, the commands first take the folder of the active Claude CLI tab (for **Work with Claude Code Here**) or Claude tab (for **Open Claude Code Terminal Here**), so you can switch between the two in the same folder; then the open folder, then the active file's folder, and otherwise ask. Each folder has one Claude tab: opening it again switches to the tab that's already open.

## Claude tabs

The tab's header shows the folder, the model, and whether Claude is ready or working. **Settings › Claude Code › Model** picks the model; it applies the next time Claude Code starts for a tab, including when a conversation continues (after a restart of Quarry, or a past conversation), while a Claude Code process that is already running keeps its model. It also has buttons for past conversations, a new conversation, a Claude CLI tab in the same folder, and showing the folder in the Explorer.

- **Replies** stream in as Claude writes them. Code blocks are highlighted and have a copy button. Links open in your browser, and file links (`src/app.ts:12`) open the file at that line.
- **Steps.** Each tool Claude uses is a card showing the command it ran, the file it read or the search it made. Click a card for the details and output. File cards have a button that opens the file.
- **Edits** show a diff with old and new line numbers and a +/− count. Small edits open by themselves. When Claude changes a file that's open in a tab, Quarry handles it like any other change made outside the editor.
- **Questions.** When Claude asks you to choose, its options appear as buttons. You can also type your own answer, or skip the question.
- **Task lists** from Claude's to-do tool appear as a checklist, in Claude Code versions that provide that tool.

**Sending.** Press **Enter** to send and **Shift+Enter** for a new line. While Claude is working you can still send a message; Claude reads it next. **Esc** (or the stop button) stops the current task. The conversation stays, so you can carry on. **New conversation** starts over in the same folder; the old conversation is still in the history.

Closing a Claude tab while Claude is working asks first. Closing it, or quitting Quarry, ends the Claude Code process and any command it started.

## Permissions

**Settings › Claude Code › Permissions** sets how much Claude can do without asking:

- **Auto-accept edits** (the default): file edits go ahead straight away. Shell commands, web access and other tools ask first.
- **Ask first**: Claude asks before every edit too.

Changing it applies to open tabs as well: an idle tab continues its conversation with the new setting from your next message, and a tab where Claude is working finishes the task first.

A request shows what Claude wants to do: the command it wants to run, or a diff of the edit. **Allow** permits it once. **Allow for this conversation** stops Claude asking again for the same thing in this conversation. **Deny** refuses, and Claude is told you declined.

Your own Claude Code permission rules (`settings.json`) still apply: anything they already allow doesn't ask.

## Pictures and context

- **Screenshots.** Paste a picture into the message box (Ctrl+V), drop image files on the tab, or use the paperclip button. The pictures appear as thumbnails, each with ×, and are sent with your message. Large pictures are scaled down to 2000 px on the longest side first.
- **Files.** Files that aren't pictures, dropped on the tab, are added to the message by their path.
- **Selection.** **Add Selection to Claude Code** (**Ctrl+Alt+L**, in an editor) adds the selected text as a code block with its file name and line numbers. It goes to the message box of the Claude tab for that file's folder, opening one if needed. **Mention This File to Claude Code** adds the file's path. The two buttons next to the paperclip do the same for the file you used last.

## Past conversations

Claude Code keeps every conversation, and Quarry reads its history from there:

- A Claude tab that is restored after you restart Quarry shows its earlier messages again, and your next message continues that conversation.
- The **history** button in the tab lists the folder's conversations, newest first. Pick one to show it and continue it.
- A new conversation's empty page lists the four most recent ones.

Very long conversations show only their most recent messages.

## Claude CLI tabs

A Claude CLI tab runs `claude` in a Windows pseudo console, so slash commands, `/resume`, `/model` and everything else in the command line work as usual.

- Every key goes to Claude Code except **Ctrl+Tab** / **Ctrl+Shift+Tab** (switch tabs), **Ctrl+Shift+P** (command palette) and **Ctrl+F4** (close the tab). So Esc, Ctrl+R, Ctrl+L, Ctrl+W and the rest behave exactly as in a terminal.
- **Ctrl+C** copies when text is selected, and otherwise goes to Claude Code. **Ctrl+V** and **Ctrl+Shift+V** paste text, and **Ctrl+Shift+C** copies.
- The terminal follows Quarry's theme and editor font.
- When Claude Code exits, press **Enter** to start it again. Closing the tab ends it and anything it started.

Claude CLI tabs aren't restored when Quarry restarts. Use `claude --resume` (or `/resume`) in a new one to continue a conversation.

## Turning it off

**Settings › Claude Code › Claude Code** switches the whole integration off or on. Off removes the menu items, Explorer items and commands, and closes any Claude and Claude CLI tabs (after asking). Your settings and Claude Code's own history are kept, so turning it back on brings everything back.
