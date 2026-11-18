---
area: Terminal Tabs
prefix: TERM
---

# Terminal Tabs

A terminal tab (`kind: "terminal"`) runs a program in a Windows pseudo console (ConPTY), drawn by xterm.js: a shell (PowerShell, Command Prompt, Git Bash or your own; TERM-010), or a one-off install command for a language server (TERM-009). User documentation: `docs/terminal.md`.

## TERM-003: Keys go to the program

- Status: verified
- Commands: none
- Files:
  - `src/App.tsx` — global `keydown` handler: inside `.terminal-view` everything returns early except Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+Shift+P, Ctrl+F4 and the keys of New Terminal (`terminalPassesToQuarry`)
  - `src/components/TerminalView.tsx` — `t.onData` → `pty_write`, `editor.registerFocus`
  - `src-tauri/src/pty.rs` — `pty_write`
  - `src-tauri/src/writer.rs` — `ChannelWriter` (input written off the UI thread)
- Tests: `src/__tests__/terminalView.test.tsx`
- Docs: `docs/terminal.md`

**As a** developer working in a shell tab
**I want** my keystrokes to reach the shell instead of triggering editor shortcuts
**So that** Esc, Ctrl+R, Ctrl+L, Ctrl+W and the rest behave as in a terminal

```gherkin
Scenario: TERM-003.1 Editor shortcuts do not fire
  Given a shell tab has the focus
  When I press Ctrl+W, Ctrl+S, Ctrl+F, Ctrl+B, Ctrl+P, F12 or Esc
  Then the key goes to the shell
  And the tab is not closed, nothing is saved and no find bar, panel or palette opens

Scenario: TERM-003.2 The keys Quarry keeps
  Given a shell tab has the focus
  When I press Ctrl+Tab or Ctrl+Shift+Tab
  Then Quarry switches to the next or previous tab
  When I press Ctrl+Shift+P
  Then the command palette opens
  When I press Ctrl+F4
  Then Quarry closes the tab (after asking while the program runs)
  When I press Ctrl+` (or the keys I gave New Terminal)
  Then a new terminal tab opens in the same folder

Scenario: TERM-003.3 Focus comes back to the terminal
  When I opened the command palette from a terminal tab and closed it with Esc
  Then the terminal has the keyboard focus again

Scenario: TERM-003.4 A dialog still owns the keyboard
  When a Quarry dialog is open over a terminal tab
  Then keys go to the dialog, not to the terminal
```

## TERM-004: Copy and paste in the terminal

- Status: verified
- Commands: none
- Files:
  - `src/components/TerminalView.tsx` — `attachCustomKeyEventHandler` (Ctrl+C with a selection, Ctrl+Shift+C, Ctrl+V, Ctrl+Shift+V; clipboard plugin `readText` / `writeText`)
- Tests: `src/__tests__/terminalView.test.tsx`
- Docs: `docs/terminal.md`

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
  Then the key is sent to the program running in the tab

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

- Status: verified
- Commands: none
- Files:
  - `src/components/TerminalView.tsx` — `FitAddon`, `ResizeObserver`, `t.onResize` → `pty_resize`, refit when shown, `themeFromCss` + `MutationObserver` on `data-theme`, font settings effect, `scrollback: 10_000`
  - `src-tauri/src/pty.rs` — `pty_resize`, `size` (columns 10 to 2000, rows 2 to 1000), `take_utf8`, `pty:data`, `pty_start` sets `TERM` / `COLORTERM`
  - `src/styles/tokens.css` — `--term-bg`, `--term-fg`
  - `src/styles/app.css` — `.terminal-view`, `.terminal-host`
- Tests: `src-tauri/src/pty.rs`
- Docs: `docs/terminal.md`

**As a** developer
**I want** the terminal to use the whole tab and look like the rest of Quarry
**So that** full-screen programs are laid out correctly and the output is easy on the eyes

```gherkin
Scenario: TERM-005.1 Resizing
  Given a shell tab is showing
  When I resize the window or a side panel
  Then the terminal's columns and rows change to fill the tab and the program redraws for the new size

Scenario: TERM-005.2 A hidden terminal keeps running
  Given a build is running in a shell tab
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

Scenario: TERM-005.7 The program is told it has a colour terminal
  When a program starts in a terminal tab
  Then the program sees TERM "xterm-256color" and COLORTERM "truecolor"
```

## TERM-006: When the shell ends

- Status: verified
- Commands: none
- Files:
  - `src-tauri/src/pty.rs` — watcher thread in `spawn` (polls the child every 150 ms because ConPTY keeps the output pipe open), `pty:exit` (always with the exit code; a tab killed with `pty_kill` reports nothing)
  - `src/components/TerminalView.tsx` — `pty:exit` listener (a shell's exit code 0 → `closeDocument(id, true)`; any other code → the "[<shell> ended (exit code N). Press Enter to start it again.]" line), Enter restarts (`t.reset()` + `start`)
  - `src/lib/terminal.ts` — `setTerminalPty`, `terminalPty`
- Tests: `src/__tests__/terminalView.test.tsx`
- Docs: `docs/terminal.md`

**As a** developer whose shell ended
**I want** a normal exit to close the tab and a failure to stay readable, with a restart one key away
**So that** I can see why it stopped without opening a new tab

```gherkin
Scenario: TERM-006.1 A normal exit closes the tab
  Given PowerShell 7 is running in a shell tab
  When I type exit and the shell ends with code 0
  Then the tab closes without a question

Scenario: TERM-006.2 An exit with an error code
  When the shell exits with code 1
  Then the tab stays and the last output of the shell is still shown
  And below it the line reads "[PowerShell 7 ended (exit code 1). Press Enter to start it again.]"

Scenario: TERM-006.3 Enter restarts
  Given the shell has ended with an error code
  When I press Enter
  Then the screen is cleared and the shell starts again in the same folder

Scenario: TERM-006.4 Other keys do nothing
  Given the shell has ended with an error code
  When I type anything other than Enter
  Then nothing happens

Scenario: TERM-006.5 An ended terminal closes without asking
  Given the shell has ended with an error code
  When I close the tab
  Then it closes at once
```

## TERM-007: Closing terminal tabs

- Status: verified
- Commands: none
- Files:
  - `src/lib/actions.ts` — `closeDocument` (asks while `terminalPty` is set, `disposeTerminal`), `closeMany` (one question for every running tab); `sessionDocs` skips terminal tabs; window close (`installCloseGuard`)
  - `src/lib/terminal.ts` — `disposeTerminal`, `killAllTerminals`
  - `src-tauri/src/pty.rs` — `pty_kill`, `pty_kill_all`, `kill` (`taskkill /T /F`)
  - `src/lib/tabLimit.ts` — `inUse` (a terminal with a running program)
- Tests: `src/__tests__/tabLimit.test.ts`
- Docs: `docs/terminal.md`

**As a** developer
**I want** closing a terminal tab to end what runs in it, after a warning
**So that** I neither lose work by accident nor leave processes behind

```gherkin
Scenario: TERM-007.1 Closing asks while the program runs
  Given a shell is running in "PowerShell 7 · shop"
  When I close the tab
  Then a dialog "Stop PowerShell 7 · shop?" says "A program is still running in this tab. Closing the tab ends it and everything it started."
  When I click "Close tab"
  Then the tab closes and the shell and every process it started are ended
  And cancelling keeps the tab and the program

Scenario: TERM-007.2 Quitting ends every terminal
  Given 2 shell tabs with running programs
  When I quit Quarry
  Then both programs and what they started are ended

Scenario: TERM-007.3 Terminal tabs are not restored
  Given a shell tab was open when Quarry closed
  When Quarry starts again
  Then the tab is not there
```

## TERM-009: One-off command terminals

- Status: verified
- Commands: none
- Files:
  - `src/lib/terminal.ts` — `openCommandTerminal`, `commandFinished` (code `null` only when the command could not start), `doneHandlers`
  - `src/components/TerminalView.tsx` — `command` branch (dimmed "> command" line, Done / Failed line, no restart on Enter)
  - `src-tauri/src/pty.rs` — `pty_start` with `command` (`cmd.exe /d /s /c <line>`)
  - `src/lib/lspInstall.ts` — `installServer` (the only caller)
- Tests: `src/__tests__/lspInstall.test.ts`, `src/__tests__/terminalView.test.tsx`
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
  Then Quarry asks before ending it, as for a shell tab (TERM-007.1)
```

## TERM-010: Shell terminal tabs

- Status: verified
- Commands: `terminal.new`
- Files:
  - `src/lib/shells.ts` — `loadShells` / `knownShells` (the list from Rust, asked once), pure `pickShell` (Automatic, a shell id, Custom), `shellOptions`, `terminalTitle`
  - `src/lib/terminal.ts` — `openShellTerminal`
  - `src/lib/commands.ts` — `terminal.new` (folder order, `{ folder, shell }` argument, tab limit)
  - `src/components/TerminalView.tsx` — `shell` passed to `pty_start`; a shell that exits with code 0 closes its tab, any other code keeps it with "Press Enter to start it again"
  - `src/components/panels/SettingsPanel.tsx` — `TerminalSection`: Shell list, Custom shell command
  - `src/components/MenuBar.tsx` — Tools › New Terminal, Tools › New Terminal With (one entry per installed shell)
  - `src/components/panels/ExplorerPanel.tsx` — "Open in Terminal" on a folder and on blank space
  - `src/App.tsx` — `terminalPassesToQuarry` (New Terminal's keys work inside a terminal)
  - `src/lib/types.ts` — `terminalShell` (default ""), `terminalCustom`
  - `src/lib/actions.ts` — `sanitizeSettings` for both
  - `src-tauri/src/pty.rs` — `shells` / `pty_shells` (PowerShell 7, Windows PowerShell, Command Prompt, Git Bash, as installed; never WSL's `bash.exe`), `shell_command` (`CHERE_INVOKING` for bash), `pty_start` `shell` argument
- Tests: `src/__tests__/shells.test.ts`, `src/__tests__/terminalView.test.tsx`, `src-tauri/src/pty.rs`
- Docs: `docs/terminal.md`, `docs/settings.md`

**As a** developer
**I want** a shell in a tab, in the folder I am working in
**So that** I can run builds, tests and git commands without leaving the editor

```gherkin
Scenario: TERM-010.1 A terminal in the open folder
  Given the folder C:\work\proj is open and PowerShell 7 is installed
  When I press Ctrl+` or choose Tools › New Terminal
  Then a tab "PowerShell 7 · proj" opens with a PowerShell prompt in C:\work\proj
  And it has the keyboard focus

Scenario: TERM-010.2 Which folder
  Given a terminal tab is active
  When I run New Terminal
  Then the new terminal starts in that tab's folder
  Given no such tab is active
  When I run New Terminal
  Then it starts in the open folder, else the active file's folder, else my home folder

Scenario: TERM-010.3 From the Explorer
  When I right-click a folder in the Explorer and choose "Open in Terminal"
  Then a terminal opens in that folder
  When I right-click blank space in the Explorer and choose "Open in Terminal"
  Then a terminal opens in the open folder

Scenario: TERM-010.4 The shell is a setting
  Given Settings › Terminal › Shell is "Automatic"
  When I look at the list
  Then it offers Automatic (naming the first shell found), every installed shell of PowerShell 7, Windows PowerShell, Command Prompt and Git Bash, and "Custom…"
  When I choose Git Bash and open a new terminal
  Then the tab is "Git Bash · proj" and bash starts in the tab's folder, not in my home folder
  And terminals already open keep their shell

Scenario: TERM-010.5 A custom shell
  When I choose "Custom…" and type "C:\msys64\usr\bin\bash.exe" --login -i
  Then new terminals run that program with those arguments, in a tab named after the program ("bash · proj")
  When the custom command is empty and I run New Terminal
  Then no tab opens and a notification says to type the shell's command line in Settings › Terminal first

Scenario: TERM-010.6 Another shell just this once
  Given more than one shell is installed
  When I choose Tools › New Terminal With › Command Prompt
  Then a "Command Prompt · proj" tab opens and the setting is unchanged

Scenario: TERM-010.7 The shell ends
  Given a shell tab is open
  When I type exit and the shell ends with code 0
  Then the tab closes without a question
  When a shell ends with another exit code
  Then the tab stays and says "[PowerShell 7 ended (exit code 1). Press Enter to start it again.]"
  When I press Enter
  Then the shell starts again in the same folder

Scenario: TERM-010.8 The shell cannot start
  Given the custom shell command names a program that does not exist
  When I run New Terminal
  Then the tab shows the error in red and "Press Enter to try again."

Scenario: TERM-010.9 Like every terminal tab
  When I use a shell tab
  Then keys, copy and paste, size, theme, what happens when the shell ends and the question before closing a running tab are those of TERM-003 to TERM-007
  And the tab is not reopened after a restart

Scenario: TERM-010.10 A shell that was uninstalled
  Given the setting names Git Bash and Git Bash is no longer installed
  When I run New Terminal
  Then the first shell found starts instead
  And Settings › Terminal says that shell is no longer installed

Scenario: TERM-010.11 The folder must exist
  Given the folder of a terminal tab no longer exists
  When the shell is started
  Then the terminal shows "<folder> is not a folder" in red and "Press Enter to try again." instead of starting the shell
```
