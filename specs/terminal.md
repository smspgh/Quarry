---
area: Claude CLI Terminal Tabs
prefix: TERM
---

# Claude CLI Terminal Tabs

A Claude CLI tab (`kind: "terminal"`) runs the real `claude` command line in a Windows pseudo console (ConPTY), drawn by xterm.js. The same tab kind runs one-off install commands for language servers. Quarry's own chat interface is in `claude-code.md`. User documentation: `docs/claude-code.md` (section "Claude CLI tabs").

## TERM-001: Open a Claude CLI tab in a folder

- Status: draft
- Commands: `claude.openTerminal`
- Files:
  - `src/lib/commands.ts` — `claude.openTerminal` (args: folder or `{ folder, resume }`; fallback chain; `makeRoom`)
  - `src/lib/terminal.ts` — `openClaudeTerminal`
  - `src/components/TerminalView.tsx` — `start` (`pty_start`), error line "Press Enter to try again."
  - `src-tauri/src/pty.rs` — `pty_start`, `claude_command` (`claude.cmd` through `cmd.exe /d /c`), `spawn`
  - `src-tauri/src/claude.rs` — `find_exe` (same lookup as Claude tabs, `settings.claudePath`)
  - `src/components/panels/ExplorerPanel.tsx` — context-menu item "Claude Code Terminal Here"
  - `src/components/ClaudeView.tsx` — header button that runs `claude.openTerminal` for the tab's folder
  - `src/components/MenuBar.tsx` — Tools menu entry
  - `src/components/TitleBar.tsx` — tab icon
  - `src/App.tsx` — keeps every `TerminalView` mounted
  - `src/lib/store.ts` — `Doc.terminal`
- Tests: `src/__tests__/claudeSession.test.ts`
- Docs: `docs/claude-code.md`

**As a** developer who prefers the Claude Code command line
**I want** to run `claude` in a terminal tab inside Quarry
**So that** slash commands and everything else work exactly as in Windows Terminal

```gherkin
Scenario: TERM-001.1 From the Explorer
  Given the folder "C:\work\shop" is in the Explorer
  When I right-click it and choose "Claude Code Terminal Here"
  Then a tab "Claude CLI · shop" opens, becomes active and has the keyboard focus
  And the claude command line starts in "C:\work\shop"

Scenario: TERM-001.2 Folder fallback of the command
  Given a Claude tab for "C:\a" is the active tab
  When I run "Open Claude Code Terminal Here" from the Tools menu or the palette
  Then the terminal opens in "C:\a"
  Given instead a text tab is active and the open folder is "C:\work\shop"
  Then the terminal opens in "C:\work\shop"
  Given instead no folder is open and the active file is "C:\b\notes.txt"
  Then the terminal opens in "C:\b"
  Given instead there is no folder and no file
  Then a folder picker titled "Claude Code terminal in…" opens, and cancelling it opens nothing

Scenario: TERM-001.3 Every request opens a new terminal
  Given a Claude CLI tab for "C:\work\shop" is open
  When I choose "Claude Code Terminal Here" for the same folder again
  Then a second "Claude CLI · shop" tab opens with its own claude program

Scenario: TERM-001.4 From a Claude tab
  Given a Claude tab for "C:\work\shop"
  When I click the terminal button in its header
  Then a Claude CLI tab opens in "C:\work\shop" as a separate conversation

Scenario: TERM-001.5 The tab limit applies
  Given the open-tab limit is reached and no tab can be closed to make room
  When I run "Open Claude Code Terminal Here"
  Then no terminal tab is opened

Scenario: TERM-001.6 Claude Code is not installed
  Given Claude Code cannot be found
  When a Claude CLI tab opens
  Then the terminal shows "Claude Code was not found. Install it, or set its location in Settings › Claude Code." in red and "Press Enter to try again."
  When I press Enter
  Then Quarry tries to start it again

Scenario: TERM-001.7 Hidden while the integration is off
  When Settings › Claude Code › "Claude Code" is off
  Then "Open Claude Code Terminal Here" and "Claude Code Terminal Here" are not offered anywhere
```

## TERM-002: Continue a conversation in a terminal

- Status: draft
- Commands: `claude.openTerminal`
- Files:
  - `src/lib/commands.ts` — `claude.openTerminal` accepts `{ folder, resume }`
  - `src/lib/terminal.ts` — `openClaudeTerminal(folder, resume)`
  - `src/components/TerminalView.tsx` — `resume` passed on the first start only (`first`)
  - `src-tauri/src/pty.rs` — `claude_command`, `resume_id` (`--resume <id>` only when `claude::is_session_id` accepts it: hexadecimal digits and dashes, at most 64 characters)
  - `src-tauri/src/claude.rs` — `is_session_id` (shared with Claude tabs)
- Tests: `src-tauri/src/pty.rs`, `src/__tests__/claudeSession.test.ts`
- Docs: `docs/claude-code.md`

**As a** developer continuing earlier work in the command line
**I want** a terminal tab to be able to start in a given conversation
**So that** I do not have to find it again with /resume

```gherkin
Scenario: TERM-002.1 Started with a conversation
  When the command "claude.openTerminal" is run with the folder "C:\work\shop" and a conversation id
  Then the tab starts claude with that conversation resumed

Scenario: TERM-002.2 Only the first start resumes
  When that claude program exits and I press Enter to start it again
  Then claude starts without resuming the conversation

Scenario: TERM-002.3 An id that is not a conversation id is ignored
  When the resume value is "--dangerously-skip-permissions"
  Then claude is started without any resume option

Scenario: TERM-002.4 No built-in entry point passes a conversation
  When I open a terminal from the Explorer, the Tools menu, the palette or a Claude tab's header
  Then claude starts a fresh session, and I use "claude --resume" or "/resume" myself to continue one
```

## TERM-003: Keys go to the program

- Status: draft
- Commands: none
- Files:
  - `src/App.tsx` — global `keydown` handler: inside `.terminal-view` everything returns early except Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+Shift+P and Ctrl+F4
  - `src/components/TerminalView.tsx` — `t.onData` → `pty_write`, `editor.registerFocus`
  - `src-tauri/src/pty.rs` — `pty_write`
  - `src-tauri/src/writer.rs` — `ChannelWriter` (input written off the UI thread)
- Tests: none
- Docs: `docs/claude-code.md`

**As a** developer using the Claude Code command line
**I want** my keystrokes to reach it instead of triggering editor shortcuts
**So that** Esc, Ctrl+R, Ctrl+L, Ctrl+W and the rest behave as in a terminal

```gherkin
Scenario: TERM-003.1 Editor shortcuts do not fire
  Given a Claude CLI tab has the focus
  When I press Ctrl+W, Ctrl+S, Ctrl+F, Ctrl+B, Ctrl+P, F12 or Esc
  Then the key goes to the claude program
  And the tab is not closed, nothing is saved and no find bar, panel or palette opens

Scenario: TERM-003.2 The four keys Quarry keeps
  Given a Claude CLI tab has the focus
  When I press Ctrl+Tab or Ctrl+Shift+Tab
  Then Quarry switches to the next or previous tab
  When I press Ctrl+Shift+P
  Then the command palette opens
  When I press Ctrl+F4
  Then Quarry closes the tab (after asking while the program runs)

Scenario: TERM-003.3 Focus comes back to the terminal
  When I opened the command palette from a terminal tab and closed it with Esc
  Then the terminal has the keyboard focus again

Scenario: TERM-003.4 A dialog still owns the keyboard
  When a Quarry dialog is open over a terminal tab
  Then keys go to the dialog, not to the terminal
```

## TERM-004: Copy and paste in the terminal

- Status: draft
- Commands: none
- Files:
  - `src/components/TerminalView.tsx` — `attachCustomKeyEventHandler` (Ctrl+C with a selection, Ctrl+Shift+C, Ctrl+V, Ctrl+Shift+V; clipboard plugin `readText` / `writeText`)
- Tests: none
- Docs: `docs/claude-code.md`

**As a** developer
**I want** copy and paste to work as in Windows Terminal
**So that** Ctrl+C still interrupts when I have selected nothing

```gherkin
Scenario: TERM-004.1 Ctrl+C copies a selection
  Given text is selected in the terminal
  When I press Ctrl+C
  Then the text is on the clipboard, the selection is cleared and nothing is sent to the program

Scenario: TERM-004.2 Ctrl+C without a selection goes to the program
  Given nothing is selected
  When I press Ctrl+C
  Then the key is sent to the claude program

Scenario: TERM-004.3 Ctrl+Shift+C never interrupts
  Given nothing is selected
  When I press Ctrl+Shift+C
  Then nothing is sent to the program and the clipboard is unchanged

Scenario: TERM-004.4 Paste
  Given the clipboard holds "npm test"
  When I press Ctrl+V or Ctrl+Shift+V
  Then "npm test" is pasted into the terminal as text
  And with an empty clipboard nothing happens
```

## TERM-005: The terminal fits the tab and follows the theme

- Status: draft
- Commands: none
- Files:
  - `src/components/TerminalView.tsx` — `FitAddon`, `ResizeObserver`, `t.onResize` → `pty_resize`, refit when shown, `themeFromCss` + `MutationObserver` on `data-theme`, font settings effect, `scrollback: 10_000`
  - `src-tauri/src/pty.rs` — `pty_resize`, `size` (columns 10 to 2000, rows 2 to 1000), `take_utf8`, `pty:data`, `TERM` / `COLORTERM`
  - `src/styles/tokens.css` — `--term-bg`, `--term-fg`
  - `src/styles/app.css` — `.terminal-view`, `.terminal-host`
- Tests: `src-tauri/src/pty.rs`
- Docs: `docs/claude-code.md`

**As a** developer
**I want** the terminal to use the whole tab and look like the rest of Quarry
**So that** Claude Code's screen is laid out correctly and is easy on the eyes

```gherkin
Scenario: TERM-005.1 Resizing
  Given a Claude CLI tab is showing
  When I resize the window or a side panel
  Then the terminal's columns and rows change to fill the tab and the program redraws for the new size

Scenario: TERM-005.2 A hidden terminal keeps running
  Given claude is working in a Claude CLI tab
  When I switch to another tab and later back
  Then the program kept running, its screen and scrollback are intact
  And the terminal is fitted to the tab again and has the focus

Scenario: TERM-005.3 Theme
  When I switch Quarry between light and dark
  Then the terminal's background, text, cursor and selection colours change with it

Scenario: TERM-005.4 Font
  When I change the editor font or font size in Settings
  Then open terminals use the new font and are refitted

Scenario: TERM-005.5 Colour and Unicode output
  When the program prints true-colour text and characters such as "€"
  Then they are shown correctly, also when a character's bytes arrive in two pieces

Scenario: TERM-005.6 Scrollback
  When a program has printed more than fits on the screen
  Then the terminal keeps the last 10,000 lines for scrolling back
```

## TERM-006: When the program ends

- Status: draft
- Commands: none
- Files:
  - `src-tauri/src/pty.rs` — watcher thread in `spawn` (polls the child every 150 ms because ConPTY keeps the output pipe open), `pty:exit` (always with the exit code; a tab killed with `pty_kill` reports nothing)
  - `src/components/TerminalView.tsx` — `pty:exit` listener, Enter restarts (`t.reset()` + `start`)
  - `src/lib/terminal.ts` — `setTerminalPty`, `terminalPty`, `commandFinished` (code `null` only when a one-off command could not start)
- Tests: `src/__tests__/claudeSession.test.ts`
- Docs: `docs/claude-code.md`

**As a** developer who typed /exit
**I want** to see that Claude Code ended and start it again with one key
**So that** I do not have to open a new tab

```gherkin
Scenario: TERM-006.1 A normal exit
  Given claude is running in a Claude CLI tab
  When I exit it
  Then the terminal shows "[Claude Code ended. Press Enter to start it again.]"
  And the last output of the program is still shown above it

Scenario: TERM-006.2 An exit with an error code
  When claude exits with code 1
  Then the line reads "[Claude Code ended (exit code 1). Press Enter to start it again.]"

Scenario: TERM-006.3 Enter restarts
  Given the program has ended
  When I press Enter
  Then the screen is cleared and claude starts again in the same folder

Scenario: TERM-006.4 Other keys do nothing
  Given the program has ended
  When I type anything other than Enter
  Then nothing happens

Scenario: TERM-006.5 An ended terminal closes without asking
  Given the program has ended
  When I close the tab
  Then it closes at once
```

## TERM-007: Closing terminal tabs

- Status: draft
- Commands: none
- Files:
  - `src/lib/actions.ts` — `closeDocument` (asks while `terminalPty` is set, `disposeTerminal`); session save skips terminal tabs; window close → `stopAllClaude`
  - `src/lib/terminal.ts` — `disposeTerminal`, `killAllTerminals`
  - `src/lib/claude.ts` — `stopAllClaude` (also calls `pty_kill_all`)
  - `src-tauri/src/pty.rs` — `pty_kill`, `pty_kill_all`, `kill` (`taskkill /T /F`)
  - `src/lib/tabLimit.ts` — `inUse` (a terminal with a running program)
  - `src/components/panels/SettingsPanel.tsx` — turning Claude Code off closes terminal tabs
- Tests: `src/__tests__/claudeSession.test.ts`
- Docs: `docs/claude-code.md`

**As a** developer
**I want** closing a terminal tab to end what runs in it, after a warning
**So that** I neither lose work by accident nor leave processes behind

```gherkin
Scenario: TERM-007.1 Closing asks while the program runs
  Given claude is running in "Claude CLI · shop"
  When I close the tab
  Then a dialog "Stop Claude CLI · shop?" says "A program is still running in this tab. Closing the tab ends it and everything it started."
  When I click "Close tab"
  Then the tab closes and claude and every process it started are ended
  And cancelling keeps the tab and the program

Scenario: TERM-007.2 Quitting ends every terminal
  Given 2 Claude CLI tabs with running programs
  When I quit Quarry
  Then both programs and what they started are ended

Scenario: TERM-007.3 Terminal tabs are not restored
  Given a Claude CLI tab was open when Quarry closed
  When Quarry starts again
  Then the tab is not there
  And its conversation is still in Claude Code's history

Scenario: TERM-007.4 Closed with the integration
  Given a Claude CLI tab is open
  When I turn Settings › Claude Code › "Claude Code" off and confirm
  Then the tab closes and its program ends
```

## TERM-008: A clean environment for the program

- Status: draft
- Commands: none
- Files:
  - `src-tauri/src/claude.rs` — `SESSION_ENV` (the marker variables of a running Claude Code session)
  - `src-tauri/src/pty.rs` — `pty_start` (removes every `SESSION_ENV` variable, sets `TERM=xterm-256color` and `COLORTERM=truecolor`, checks the folder)
- Tests: none
- Docs: `docs/claude-code.md`

**As a** developer who starts Quarry from a Claude Code session
**I want** the Claude Code in Quarry's terminal not to think it is nested in that session
**So that** it behaves normally and saves its conversation

```gherkin
Scenario: TERM-008.1 Session markers are not inherited
  Given Quarry was started from a Claude Code session, so CLAUDECODE and CLAUDE_CODE_SESSION_ID are set
  When I open a Claude CLI tab
  Then the claude program does not see CLAUDECODE, CLAUDE_CODE_SESSION_ID or the other session marker variables

Scenario: TERM-008.2 My configuration is kept
  When CLAUDE_CODE_USE_BEDROCK is set in my environment
  Then the claude program in the terminal still sees it

Scenario: TERM-008.3 The program is told it has a colour terminal
  When a program starts in a terminal tab
  Then the program sees TERM "xterm-256color" and COLORTERM "truecolor"

Scenario: TERM-008.4 The folder must exist
  When the folder of a terminal tab does not exist
  Then the terminal shows "<folder> is not a folder" instead of starting the program
```

## TERM-009: One-off command terminals

- Status: draft
- Commands: none
- Files:
  - `src/lib/terminal.ts` — `openCommandTerminal`, `commandFinished`, `doneHandlers`
  - `src/components/TerminalView.tsx` — `command` branch (dimmed "> command" line, Done / Failed line, no restart on Enter)
  - `src-tauri/src/pty.rs` — `pty_start` with `command` (`cmd.exe /d /s /c <line>`)
  - `src/lib/lspInstall.ts` — `installServer` (the only caller)
- Tests: `src/__tests__/claudeSession.test.ts`
- Docs: `docs/code-intelligence.md`

**As a** developer installing a language server from Quarry
**I want** the install command to run in a terminal tab
**So that** I can see what it does and why it failed

```gherkin
Scenario: TERM-009.1 The command runs visibly
  When I chose to install Pyright support
  Then a tab "Install · Python (Pyright)" opens
  And it first shows the dimmed line "> npm install -g pyright" and then the command's output

Scenario: TERM-009.2 Success
  When the command exits with code 0
  Then the terminal shows "[Done. You can close this tab.]"
  And whoever started the command is told it succeeded

Scenario: TERM-009.3 Failure
  When the command exits with code 1
  Then the terminal shows "[Failed (exit code 1). You can close this tab.]"

Scenario: TERM-009.4 It does not restart
  Given the command has finished
  When I press Enter
  Then the command is not run again

Scenario: TERM-009.5 It could not be started
  When the command cannot be started
  Then the terminal shows the error in red and "[Could not start the command. You can close this tab.]"

Scenario: TERM-009.6 Closing while it runs asks
  Given the install command is still running
  When I close the tab
  Then Quarry asks before ending it, as for a Claude CLI tab

Scenario: TERM-009.7 Available without Claude Code
  When Settings › Claude Code › "Claude Code" is off
  Then install commands still open and run in terminal tabs
```
