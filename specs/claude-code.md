---
area: Claude Code Tabs
prefix: CLAUDE
---

# Claude Code Tabs

A Claude tab (`kind: "claude"`) is Quarry's own chat interface over one headless `claude` process per tab: streamed replies, a card per tool step, edit diffs, permission requests, questions, pictures and past conversations. The terminal variant (Claude CLI tabs) is in `terminal.md`. User documentation: `docs/claude-code.md`.

## CLAUDE-001: Turn the Claude Code integration off and on

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/SettingsPanel.tsx` — `ClaudeSection`, `setEnabled` (asks, closes Claude and Claude CLI tabs with `closeDocument(id, true)`)
  - `src/lib/commands.ts` — every `claude.*` command has `enabled: claudeEnabled` (or `claudeDoc` / `textForClaude`), so the palette and shortcuts drop them
  - `src/components/MenuBar.tsx` — Tools menu items are left out (not greyed) while `settings.claudeEnabled` is false
  - `src/components/panels/ExplorerPanel.tsx` — `claudeOn` hides the two context-menu items
  - `src/lib/actions.ts` — session restore skips Claude tabs while the setting is off; `mergeSettings` default
  - `src/lib/types.ts` — `claudeEnabled` (default `true`)
  - `src/lib/claude.ts` — `claudeEnabled()`
- Tests: none
- Docs: `docs/claude-code.md`

**As a** user who does not use Claude Code
**I want** one switch that removes the whole integration
**So that** no Claude menu items, commands or tabs get in my way

```gherkin
Scenario: CLAUDE-001.1 Off hides it everywhere
  When Settings › Claude Code › "Claude Code" is switched off
  Then the Tools menu has no "Work with Claude Code Here", "Work with Claude Code in Folder…", "Open Claude Code Terminal Here", "Add Selection to Claude Code" or "Mention This File to Claude Code"
  And the Explorer context menu has no "Work with Claude Code Here" or "Claude Code Terminal Here"
  And the command palette lists no "Claude Code" commands
  And Ctrl+Alt+L does nothing
  And the Claude Code section of Settings shows only the switch

Scenario: CLAUDE-001.2 Turning it off with tabs open asks first
  Given 1 Claude tab and 1 Claude CLI tab are open
  When I switch "Claude Code" off
  Then a dialog "Turn off Claude Code?" says "The 2 Claude Code tabs close and anything Claude is doing stops. Conversations stay in Claude Code's history."
  When I click "Turn off"
  Then both tabs close without further questions and their processes end
  And the setting is off

Scenario: CLAUDE-001.3 Cancelling keeps everything
  Given a Claude tab is open
  When I switch "Claude Code" off and cancel the dialog
  Then the tab stays open and the setting stays on

Scenario: CLAUDE-001.4 Off without tabs does not ask
  Given no Claude or Claude CLI tab is open
  When I switch "Claude Code" off
  Then the setting changes at once with no dialog

Scenario: CLAUDE-001.5 Claude tabs are not restored while off
  Given the saved session contains a Claude tab and the setting is off
  When Quarry starts
  Then that Claude tab is not opened

Scenario: CLAUDE-001.6 On brings it back
  Given the setting is off
  When I switch "Claude Code" on
  Then the menu items, Explorer items and commands are available again
  And the location, Model and Permissions rows are shown again with their earlier values
```

## CLAUDE-002: Find the Claude Code installation

- Status: draft
- Commands: none
- Files:
  - `src-tauri/src/claude.rs` — `find_exe` (hint, PATH `claude.exe` / `claude.cmd`, `%USERPROFILE%\.local\bin\claude.exe`, `%APPDATA%\npm\claude.cmd`), `claude_detect`, the not-found messages of `claude_start`
  - `src/components/panels/SettingsPanel.tsx` — `ClaudeSection`: "Claude Code location" row, `browse`
  - `src/lib/claude.ts` — `detectClaude`, `spawn` (start error becomes an error note)
  - `src/lib/types.ts` — `claudePath`
- Tests: `src-tauri/src/claude.rs`
- Docs: `docs/claude-code.md`

**As a** developer with Claude Code installed
**I want** Quarry to find my `claude` program by itself and tell me which one it uses
**So that** I only have to point at it when it is somewhere unusual

```gherkin
Scenario: CLAUDE-002.1 Found automatically
  Given "Claude Code location" is empty and claude.exe is on PATH
  When I open Settings › Claude Code
  Then the row first says "Looking for Claude Code…"
  And then shows the version and the full path of claude.exe

Scenario: CLAUDE-002.2 Usual install folders are searched when PATH has none
  When claude is not on PATH but "%APPDATA%\npm\claude.cmd" exists
  Then Settings shows that path as the one found

Scenario: CLAUDE-002.3 Not found
  When no claude.exe or claude.cmd can be found
  Then the row says "Claude Code was not found on PATH. Install it from claude.com/claude-code, or browse to claude.exe"

Scenario: CLAUDE-002.4 A location I set must exist
  When "Claude Code location" is "C:\tools\claude.exe" and that file does not exist
  Then the row says "C:\tools\claude.exe does not exist. Install it from claude.com/claude-code, or browse to claude.exe"
  And PATH is not searched instead

Scenario: CLAUDE-002.5 Browse to it
  When I click "Browse…" and pick a .exe or .cmd file
  Then its path becomes the location and is checked again

Scenario: CLAUDE-002.6 Sending without an installation
  Given Claude Code cannot be found and a Claude tab is open
  When I send a message
  Then an error note "Claude Code was not found. Install it, or set its location in Settings › Claude Code." appears in the conversation
  And the tab shows "Idle", not "Working"
```

## CLAUDE-003: Open a Claude tab for a folder

- Status: draft
- Commands: `claude.openHere`, `claude.openFolder`
- Files:
  - `src/lib/commands.ts` — `claude.openHere` (folder fallback chain, `makeRoom`), `claude.openFolder` (folder picker)
  - `src/lib/claude.ts` — `openClaudeTab`, `sameFolder`, `start` / `spawn`
  - `src-tauri/src/claude.rs` — `claude_start`, `build_args` (`-p`, stream-json in and out, `--verbose`, `--include-partial-messages`, `--permission-prompt-tool stdio`)
  - `src/components/ClaudeView.tsx` — header, `Empty` (start page, `SUGGESTIONS`)
  - `src/components/panels/ExplorerPanel.tsx` — context-menu items "Work with Claude Code Here"
  - `src/components/MenuBar.tsx` — Tools menu entries
  - `src/components/TitleBar.tsx` — tab icon (`ClaudeMark`)
  - `src/App.tsx` — keeps every `ClaudeView` mounted, `installClaudeEvents()` at start-up
  - `src/lib/tabLimit.ts` — `makeRoom`, `inUse` (a working Claude tab counts as in use)
- Tests: `src-tauri/src/claude.rs`
- Docs: `docs/claude-code.md`

**As a** developer
**I want** to start working with Claude Code in a folder from the Explorer, the Tools menu or the palette
**So that** Claude works in the project I am looking at

```gherkin
Scenario: CLAUDE-003.1 From the Explorer
  Given the folder "C:\work\shop" is in the Explorer
  When I right-click it and choose "Work with Claude Code Here"
  Then a tab "Claude · shop" opens and becomes active
  And its header shows "shop", the path "C:\work\shop", a model chip and the state
  And Claude Code starts in that folder: the state goes from "Starting" to "Ready"
  And the message box has the focus

Scenario: CLAUDE-003.2 The empty page
  Given a new Claude tab for "shop" with Permissions set to "Auto-accept edits"
  Then it shows "What should Claude do in shop?" and "File edits are applied automatically; commands ask you first."
  And four suggestions, the first being "Explain how this project is organised"
  When I click a suggestion
  Then its text is put in the message box and is not sent

Scenario: CLAUDE-003.3 Without a folder the command picks one
  Given the open folder is "C:\work\shop"
  When I run "Work with Claude Code Here" from the palette
  Then the Claude tab opens for "C:\work\shop"

Scenario: CLAUDE-003.4 Fallback order
  Given a Claude CLI tab for "C:\a" is the active tab
  When I run "Work with Claude Code Here"
  Then the Claude tab opens for "C:\a"
  Given instead no folder is open and the active file is "C:\b\notes.txt"
  Then the Claude tab opens for "C:\b"
  Given instead no folder is open and no file is active
  Then a folder picker titled "Work with Claude Code in…" opens, and cancelling it opens nothing

Scenario: CLAUDE-003.5 Pick any folder
  When I run "Work with Claude Code in Folder…" and pick "D:\other"
  Then a tab "Claude · other" opens for that folder

Scenario: CLAUDE-003.6 One Claude tab per folder
  Given a Claude tab for "C:\work\shop" is open
  When I choose "Work with Claude Code Here" for "c:/work/shop/"
  Then the existing tab becomes active and no second tab or process is started

Scenario: CLAUDE-003.7 The tab limit applies
  Given the open-tab limit is reached and no tab can be closed to make room
  When I run "Work with Claude Code Here" for a folder with no Claude tab
  Then no Claude tab is opened

Scenario: CLAUDE-003.8 The folder must exist
  Given a Claude tab whose folder has been deleted
  When I send a message
  Then an error note "<folder> is not a folder" is shown and nothing is running
```

## CLAUDE-004: Send messages and read streamed replies

- Status: draft
- Commands: none
- Files:
  - `src/components/ClaudeView.tsx` — composer (`send`, Enter handling, `autoHeight`, placeholders), status label, auto-scroll (`stick`), `ItemView`, `Working`, `formatMs`
  - `src/lib/claude.ts` — `sendToClaude`, `write`, `flush` (one store update per animation frame), `setClaudeDraft`
  - `src/lib/claudeProtocol.ts` — `userMessage`, `addUser`, `reduce`, `streamEvent`, `assistant`, `result`
  - `src-tauri/src/claude.rs` — `claude_send` (one JSON line to stdin), stdout lines as `claude:out`
  - `src-tauri/src/writer.rs` — `ChannelWriter` (stdin written off the UI thread)
- Tests: `src/__tests__/claude.test.ts`
- Docs: `docs/claude-code.md`

**As a** developer talking to Claude Code
**I want** to send a message and watch the reply appear as it is written
**So that** I can follow the work without waiting for the end

```gherkin
Scenario: CLAUDE-004.1 Send with Enter
  Given the message box contains "List the routes"
  When I press Enter
  Then my message appears in the conversation at once and the message box is empty
  And the state shows "Working" with a line "Working… 3s · Esc to stop" that counts up
  And the reply text appears piece by piece as Claude writes it
  And when the turn ends a line "Done in 2.5 s" appears and the state shows "Ready"

Scenario: CLAUDE-004.2 Shift+Enter makes a new line
  When I press Shift+Enter in the message box
  Then a line break is added and nothing is sent
  And the box grows with the text up to about 12 lines

Scenario: CLAUDE-004.3 Nothing to send
  When the message box is empty or only spaces and no picture is attached
  Then the Send button is disabled and Enter sends nothing

Scenario: CLAUDE-004.4 Sending while Claude is working
  Given Claude is working
  Then the placeholder reads "Add to the request (Claude reads it next)…"
  When I send "Also update the README"
  Then the message is shown and passed to Claude Code, which reads it next
  And the elapsed time of the running task is not reset

Scenario: CLAUDE-004.5 The draft survives tab switches
  Given I typed "half a thought" in a Claude tab
  When I switch to another tab and back
  Then the message box still contains "half a thought" and the conversation is at the same scroll position

Scenario: CLAUDE-004.6 The view follows the conversation only at the bottom
  Given I scrolled up more than 48 px from the bottom
  When more reply text arrives
  Then the view does not jump
  When I send a message
  Then the view follows the bottom again

Scenario: CLAUDE-004.7 A failed request says why
  When Claude Code ends a turn with an error such as a usage limit
  Then an error note with Claude Code's reason is shown, or "The request failed." when it gave none
  And no "Done in" line is shown

Scenario: CLAUDE-004.8 Sub-agent chatter is not shown
  When Claude runs a sub-agent
  Then only the sub-agent's card appears; the sub-agent's own messages and tool steps are not listed
```

## CLAUDE-005: Stop the running task

- Status: draft
- Commands: `claude.stop`
- Files:
  - `src/lib/claude.ts` — `interruptClaude` (drops pending asks, writes the interrupt request)
  - `src/lib/claudeProtocol.ts` — `interruptRequest`, `toolResults` ("[Request interrupted" → "Stopped."), `result` (`error_during_execution` ends the turn without a Done line)
  - `src/components/ClaudeView.tsx` — Escape in the composer, stop button
  - `src/lib/commands.ts` — `claude.stop` (enabled only on a working Claude tab)
- Tests: `src/__tests__/claude.test.ts`
- Docs: `docs/claude-code.md`

**As a** developer watching Claude go the wrong way
**I want** to stop the current task without losing the conversation
**So that** I can correct it and carry on

```gherkin
Scenario: CLAUDE-005.1 Esc stops
  Given Claude is working and the message box has the focus
  When I press Esc
  Then the task stops, a note "Stopped." appears and the state shows "Ready"
  And no "Done in" line is added
  And the conversation is kept: my next message continues it

Scenario: CLAUDE-005.2 The stop button and the command
  When Claude is working
  Then a square stop button is shown next to Send
  And clicking it, or running "Claude Code: Stop" from the palette, stops the task the same way

Scenario: CLAUDE-005.3 Nothing to stop
  When Claude is not working
  Then no stop button is shown, Esc in the message box does nothing here and "Stop" is not offered in the palette

Scenario: CLAUDE-005.4 Open permission requests go away
  Given Claude is waiting on a permission request
  When I stop the task
  Then the request card disappears
```

## CLAUDE-006: See each step Claude takes

- Status: draft
- Commands: none
- Files:
  - `src/components/ClaudeView.tsx` — `ToolCard`, `ToolInput`, `clip` (`RESULT_MAX` 12,000)
  - `src/lib/claudeProtocol.ts` — `assistant` (tool_use → card), `toolResults`, `resultText`, `toolSummary`, `toolFile`, `ended`
  - `src/lib/actions.ts` — `openPath` (open-file button)
- Tests: `src/__tests__/claude.test.ts`
- Docs: `docs/claude-code.md`

**As a** developer supervising Claude
**I want** a card for every tool it uses, with the details one click away
**So that** I know what it ran, read and searched

```gherkin
Scenario: CLAUDE-006.1 A step from start to finish
  Given Claude runs the command "npm test"
  Then a card "Bash  npm test" appears with a spinner
  And when the command finishes the spinner becomes a check mark
  When I click the card
  Then it opens and shows the command and its output

Scenario: CLAUDE-006.2 A failed step
  When a command ends with an error
  Then its card shows a cross and its output is shown in the error style when opened

Scenario: CLAUDE-006.3 Summaries are short and relative
  When Claude reads "C:\work\shop\src\app.ts" in a tab for "C:\work\shop"
  Then the card reads "Read  src\app.ts"
  And a search card shows the pattern and, when given, "in <folder>"

Scenario: CLAUDE-006.4 Open the file of a step
  Given a card for a step on a file
  When I click its open button
  Then that file opens in a tab

Scenario: CLAUDE-006.5 Very long output is cut
  Given a step printed 50,000 characters
  When I open its card
  Then the first 12,000 characters are shown followed by "… 38,000 more characters"

Scenario: CLAUDE-006.6 Steps cut short
  When a step is still running when the Claude Code process ends
  Then its card stops spinning and shows as failed
```

## CLAUDE-007: See what an edit changes

- Status: draft
- Commands: none
- Files:
  - `src/components/ClaudeView.tsx` — `editHunks`, `PatchView`, `ToolCard` (auto-open ≤ 30 changed lines), `EDIT_TOOLS`, `WRITE_PREVIEW_LINES` (400)
  - `src/lib/claudeProtocol.ts` — `toolResults` (`structuredPatch` from `tool_use_result`), `lineDiff` (`DIFF_CELLS`), `patchStats`, `Hunk`
  - `src/lib/actions.ts` — `checkExternalChanges` / `installExternalChangeWatch` (nothing in the Claude code triggers a check: an edited file's tab is checked when it is activated, or when the Quarry window gets focus)
- Tests: `src/__tests__/claude.test.ts`
- Docs: `docs/claude-code.md`

**As a** developer letting Claude edit my files
**I want** every edit shown as a diff
**So that** I can see exactly what changed without opening the file

```gherkin
Scenario: CLAUDE-007.1 A finished edit shows the real patch
  When Claude edited "src/app.ts", adding 3 lines and removing 1
  Then its card shows "+3 −1"
  And the card is open and shows the changed lines with old and new line numbers of the file, removals marked "−" and additions "+"

Scenario: CLAUDE-007.2 Large edits stay closed
  When an edit that changes more than 30 lines
  Then its card stays closed until I click it

Scenario: CLAUDE-007.3 An edit that has not happened yet
  When Claude asks permission for an edit
  Then the request shows a line diff of the old and new text without line numbers, removals before additions

Scenario: CLAUDE-007.4 A new file
  When Claude writes a new file of 1,000 lines
  Then the diff shows the first 400 lines as additions followed by "… 600 more lines"

Scenario: CLAUDE-007.5 Several hunks
  When an edit changed two separate places of a file
  Then both hunks are shown with "⋯" between them

Scenario: CLAUDE-007.6 A failed edit shows the error
  When an edit fails
  Then the opened card shows the attempted change and Claude Code's error text

Scenario: CLAUDE-007.7 The file is open in a tab
  Given "src/app.ts" is open in a tab when Claude edits it
  When I switch to that tab, or come back to the Quarry window
  Then Quarry treats it like any other change made outside the editor
  And a tab without unsaved edits is reloaded, while a tab with unsaved edits asks first
  And nothing happens to the tab while I stay in the Claude tab
```

## CLAUDE-008: Answer permission requests

- Status: draft
- Commands: none
- Files:
  - `src/components/ClaudeView.tsx` — `AskCard`, `VERBS`, `useGrabFocus`, `answered` (focus returns to the composer)
  - `src/lib/claude.ts` — `answerClaude`
  - `src/lib/claudeProtocol.ts` — `controlRequest` (`can_use_tool`), `permissionResponse` (allow / `updatedPermissions` with `destination: "session"` / deny), `control_cancel_request`
  - `src-tauri/src/claude.rs` — `build_args` (`--permission-prompt-tool stdio`)
- Tests: `src/__tests__/claude.test.ts`, `src-tauri/src/claude.rs`
- Docs: `docs/claude-code.md`

**As a** developer who wants control over what Claude does
**I want** to allow or refuse each command, edit or web access with a click
**So that** nothing risky runs without my say

```gherkin
Scenario: CLAUDE-008.1 A request appears
  When Claude wants to run "git push"
  Then a card "Claude wants to run a command" shows the command
  And it has the buttons "Allow", "Allow for this conversation" and "Deny", with "Allow" focused
  And the "Working…" line is hidden while the request waits

Scenario: CLAUDE-008.2 Allow once
  When I click "Allow"
  Then the card disappears and the command runs
  And the next "git push" asks again

Scenario: CLAUDE-008.3 Allow for this conversation
  When I click "Allow for this conversation"
  Then the command runs and the rules Claude Code suggested are applied to this conversation only
  And Claude does not ask again for the same thing in this conversation

Scenario: CLAUDE-008.4 Deny
  When I click "Deny"
  Then the command does not run and Claude is told "The user declined this action in Quarry."

Scenario: CLAUDE-008.5 A request does not steal a half-typed message
  When I am typing a message when a request appears
  Then the focus stays in the message box
  And after answering a request the focus returns to the message box unless another request took it

Scenario: CLAUDE-008.6 Requests Claude Code withdraws
  When a request is waiting and Claude Code cancels it
  Then its card disappears without an answer from me

Scenario: CLAUDE-008.7 Wording for other tools
  When Claude wants to use a tool Quarry has no wording for, named "Frobnicate"
  Then the card reads "Claude wants to use Frobnicate" and shows the tool's input
```

## CLAUDE-009: Choose how much Claude may do without asking

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/SettingsPanel.tsx` — `ClaudeSection`: "Permissions" (`Segmented` "Auto-accept edits" / "Ask first")
  - `src/lib/claude.ts` — `spawn` (passes `claudePermissionMode`, remembers `mode`), `applyModeWhenIdle`, settings subscription in `installClaudeEvents`
  - `src-tauri/src/claude.rs` — `build_args` (`--permission-mode`; only `default` and `acceptEdits` get through)
  - `src/components/ClaudeView.tsx` — `.claude-mode` text in the composer, `modePending`
  - `src/lib/actions.ts` — `mergeSettings` (anything but `default` becomes `acceptEdits`)
  - `src/lib/types.ts` — `claudePermissionMode` (default `acceptEdits`)
- Tests: `src-tauri/src/claude.rs`
- Docs: `docs/claude-code.md`

**As a** developer
**I want** to choose between automatic edits and being asked about everything
**So that** Claude's freedom matches how much I trust the task

```gherkin
Scenario: CLAUDE-009.1 Auto-accept edits is the default
  When a fresh installation
  Then Permissions is "Auto-accept edits"
  And a Claude tab's message box says "Edits are applied automatically · commands ask first"
  And file edits happen without a request while commands and web access ask

Scenario: CLAUDE-009.2 Ask first
  When Permissions is "Ask first"
  Then the message box says "Asks before edits and commands"
  And Claude asks before every edit too

Scenario: CLAUDE-009.3 Changing it while Claude is idle
  Given a Claude tab that is ready and not working, started with "Auto-accept edits"
  When I switch Permissions to "Ask first"
  Then the tab's Claude Code process is stopped quietly and the state shows "Idle"
  And my next message continues the same conversation with "Ask first"

Scenario: CLAUDE-009.4 Changing it while Claude is working
  Given Claude is working in a tab started with "Auto-accept edits"
  When I switch Permissions to "Ask first"
  Then the running task keeps its mode and the message box adds "· the new setting applies when this task ends"
  And the new mode applies from the next message after the task ends

Scenario: CLAUDE-009.5 No other mode can be started
  When the settings file names a permission mode other than "default" or "acceptEdits"
  Then Claude Code is started with "acceptEdits"
```

## CLAUDE-010: Answer Claude's questions

- Status: draft
- Commands: none
- Files:
  - `src/components/ClaudeView.tsx` — `QuestionCard` (`choose`, `answerOf`, `ready`, own-answer input, Skip)
  - `src/lib/claude.ts` — `answerQuestions`, `answerClaude` (Skip = deny)
  - `src/lib/claudeProtocol.ts` — `questionResponse` (allow + `updatedInput.answers`), `toolSummary` (AskUserQuestion)
- Tests: `src/__tests__/claude.test.ts`
- Docs: `docs/claude-code.md`

**As a** developer
**I want** Claude's multiple-choice questions shown as buttons
**So that** I can answer with one click or in my own words

```gherkin
Scenario: CLAUDE-010.1 One question, one click
  Given Claude asks one single-choice question "Which database?" with the options "SQLite" and "Postgres"
  Then a card "Claude has a question" shows both options as buttons and the first one is focused
  When I click "Postgres"
  Then the answer is sent at once and the card disappears
  And no "Send answer" button was needed

Scenario: CLAUDE-010.2 Choose several
  Given a question marked "Choose any" with the options "Lint", "Tests" and "Docs"
  When I click "Lint" and "Docs" and then "Send answer"
  Then Claude receives "Lint, Docs"
  And clicking a chosen option again removes it

Scenario: CLAUDE-010.3 Several questions
  When Claude asks 2 questions
  Then the card is titled "Claude has 2 questions" and has a "Send answers" button
  And the button is disabled until every question has an answer

Scenario: CLAUDE-010.4 My own answer
  Given a question with options
  When I type "MariaDB" in "Or type your own answer"
  Then any chosen option of that question is cleared
  And pressing Enter in the field (or "Send answer") sends "MariaDB"
  And choosing an option afterwards clears what I typed

Scenario: CLAUDE-010.5 Skip
  When I click "Skip"
  Then the card disappears and Claude continues without an answer
```

## CLAUDE-011: Follow Claude's task list

- Status: draft
- Commands: none
- Files:
  - `src/components/ClaudeView.tsx` — `TodoCard`, `Working` (current task and count), `lastTodoKey`
  - `src/lib/claudeProtocol.ts` — `latestTodos`, `Todo`, `toolSummary` (TodoWrite)
- Tests: `src/__tests__/claude.test.ts`
- Docs: `docs/claude-code.md`

**As a** developer running a long task
**I want** Claude's to-do list shown as a checklist
**So that** I can see what is done and what it is doing now

```gherkin
Scenario: CLAUDE-011.1 The latest list is shown in full
  When Claude wrote a to-do list of 3 items, 1 completed and 1 in progress
  Then a card "Tasks 1/3 done" lists the 3 items, each marked completed, in progress or pending
  And the item in progress shows its active wording when Claude gave one

Scenario: CLAUDE-011.2 Earlier versions shrink
  When Claude updates the list
  Then the earlier card becomes one line "Updated the task list · 1/3 done" and only the newest card is shown in full

Scenario: CLAUDE-011.3 The working line names the current task
  When Claude is working and the list has an item in progress "Running the tests"
  Then the working line reads "Running the tests…" with "1/3 tasks" before the elapsed time

Scenario: CLAUDE-011.4 No to-do tool, no card
  When the installed Claude Code never uses a to-do tool
  Then no task card appears and the working line reads "Working…"
```

## CLAUDE-012: Attach pictures to a message

- Status: draft
- Commands: none
- Files:
  - `src/lib/claudeImages.ts` — `prepareImage` (`MAX_SIDE` 2000, `MAX_BYTES` 3,750,000, PNG then JPEG 0.88), `fitSize`, `imageFromPath`, `isImagePath`
  - `src/components/ClaudeView.tsx` — `onPaste`, `browseImages`, `claude.drop` handler, thumbnails (`.claude-attach`), images on the user's message
  - `src/lib/claude.ts` — `addAttachments` (at most 20), `removeAttachment`, `clearAttachments`
  - `src/lib/claudeProtocol.ts` — `userMessage` (image blocks before the text), `addUser` (thumbnails)
  - `src-tauri/src/claude.rs` — `claude_read_image` (`IMAGE_MAX` 40 MB, `image_type`, `base64`)
  - `src/App.tsx` — drop routing to `claude.drop`
- Tests: `src/__tests__/claude.test.ts`, `src-tauri/src/claude.rs`
- Docs: `docs/claude-code.md`

**As a** developer describing a visual problem
**I want** to paste or drop screenshots into the message
**So that** Claude can see what I see

```gherkin
Scenario: CLAUDE-012.1 Paste a screenshot
  Given a screenshot is on the clipboard
  When I press Ctrl+V in the message box
  Then a thumbnail appears above the message box and no text is pasted
  And the Send button is enabled even with no text

Scenario: CLAUDE-012.2 Sent with the message
  Given 2 thumbnails and the text "Why is this misaligned?"
  When I send
  Then Claude receives both pictures and the text
  And my message in the conversation shows the 2 pictures above the text
  And the thumbnails are cleared from the message box

Scenario: CLAUDE-012.3 Remove one before sending
  When I click the × of a thumbnail
  Then that picture is removed and the others stay

Scenario: CLAUDE-012.4 Large pictures are scaled down
  Given a 4000 × 3000 px screenshot
  When I attach it
  Then it is sent as 2000 × 1500 px
  And a 1200 × 800 px PNG under the size limit is sent unchanged

Scenario: CLAUDE-012.5 The paperclip
  When I click the paperclip button
  Then a dialog "Attach images" offers png, jpg, jpeg, gif and webp files, several at once
  And each picked file becomes a thumbnail

Scenario: CLAUDE-012.6 Drop image files on the tab
  When I drop "shot.png" from File Explorer on a Claude tab
  Then it becomes a thumbnail and is not opened as a tab

Scenario: CLAUDE-012.7 Limits
  Given 20 pictures are attached
  When I add another
  Then it is not added
  And an image file over 40 MB shows the error "Could not attach <path>: the image is too large (<n> MB)" and the others are still attached
```

## CLAUDE-013: Point Claude at files and selections

- Status: draft
- Commands: `claude.addSelection`, `claude.addFile`
- Files:
  - `src/lib/commands.ts` — `toClaude`, `textForClaude`, `claude.addSelection` (Ctrl+Alt+L), `claude.addFile`
  - `src/lib/claude.ts` — `contextFor`, `claudeTabFor`, `lastTextDoc`, `appendToDraft`
  - `src/lib/claudeProtocol.ts` — `relPath`
  - `src/components/ClaudeView.tsx` — `claude.drop` handler (non-image files), `addContext`, the two buttons next to the paperclip
  - `src/App.tsx` — `onDragDropEvent`: a drop over `.claude-view` goes to `bus.emit("claude.drop")`, anything else opens the files
  - `src/components/MenuBar.tsx` — Tools menu entries
- Tests: `src/__tests__/claude.test.ts`
- Docs: `docs/claude-code.md`

**As a** developer
**I want** to hand Claude the code I selected or the files I mean
**So that** I do not have to retype paths and paste snippets

```gherkin
Scenario: CLAUDE-013.1 Add the selection
  Given a Claude tab for "C:\work\shop" and lines 3 to 5 selected in "C:\work\shop\src\app.ts"
  When I press Ctrl+Alt+L
  Then the Claude tab becomes active
  And its message box gains "In `src/app.ts` lines 3-5:" followed by the selected text in a typescript code block
  And nothing is sent

Scenario: CLAUDE-013.2 Text already in the box is kept
  Given the message box contains "Refactor this"
  When I add a selection
  Then the snippet is added on a new line after "Refactor this"

Scenario: CLAUDE-013.3 Which Claude tab gets it
  Given Claude tabs for "C:\work" and "C:\work\shop"
  When I add a selection from "C:\work\shop\src\app.ts"
  Then it goes to the "shop" tab, the deepest folder containing the file
  And a file outside every Claude folder goes to the Claude tab used last

Scenario: CLAUDE-013.4 No Claude tab yet
  Given no Claude tab is open and the open folder is "C:\work\shop"
  When I press Ctrl+Alt+L with text selected
  Then a Claude tab for "C:\work\shop" opens and receives the snippet

Scenario: CLAUDE-013.5 Nothing selected
  Given nothing is selected in the active file
  When I press Ctrl+Alt+L
  Then a message "Select some text first." is shown

Scenario: CLAUDE-013.6 Mention the file
  Given "C:\work\shop\src\app.ts" is the active tab
  When I run "Mention This File to Claude Code"
  Then "`src/app.ts`" is added to the message box of the Claude tab for that folder
  And the command is unavailable for a file that has never been saved

Scenario: CLAUDE-013.7 The buttons in the Claude tab
  When a Claude tab is in front and the text tab I used last is "app.ts"
  Then the buttons next to the paperclip read "Mention app.ts" and "Add the selection in app.ts"
  And with nothing selected there, the selection button reports "Nothing is selected in app.ts."
  And with no text tab, both buttons are disabled

Scenario: CLAUDE-013.8 Drop other files on the tab
  When I drop "C:\work\shop\data\a.csv" and "D:\x\b.log" on the Claude tab for "C:\work\shop"
  Then "`data/a.csv` `D:\x\b.log`" is added to the message box
  And neither file is opened as a tab

Scenario: CLAUDE-013.9 Drops elsewhere still open files
  When I drop a file on a text tab
  Then the file opens in a tab as usual
```

## CLAUDE-014: Read formatted replies

- Status: draft
- Commands: none
- Files:
  - `src/lib/markdown.ts` — `parseMarkdown`, `inline`, `list`, `cells`, `plain` (pure parser; produces a tree, never HTML)
  - `src/components/Markdown.tsx` — `Markdown`, `BlockView`, `Inlines`, `CodeBlock`, `useHighlight` (CodeMirror language data, off while a block is still streaming)
  - `src/components/ClaudeView.tsx` — `linkOpener` (web links → browser, paths → `openPath` with line)
  - `src/styles/app.css` — `.md*` rules
- Tests: `src/__tests__/claude.test.ts`
- Docs: `docs/claude-code.md`

**As a** developer reading Claude's replies
**I want** Markdown shown as headings, lists, tables and highlighted code
**So that** long answers are easy to read and to act on

```gherkin
Scenario: CLAUDE-014.1 Common Markdown
  When a reply with a heading, a nested list, a quote, a table with aligned columns, bold, italic, struck-through text and inline code
  Then each is shown formatted

Scenario: CLAUDE-014.2 Code blocks
  Given a reply with a fenced block marked "ts"
  Then the block has a header "ts", syntax colours and a "Copy code" button
  When I click the button
  Then the code is on the clipboard and the button shows "Copied" briefly
  And a block without a language is headed "text" and is not coloured

Scenario: CLAUDE-014.3 A block still being written
  When a reply is streaming and a code fence is not closed yet
  Then the text so far is shown as a code block without colours until the block is complete

Scenario: CLAUDE-014.4 Web links
  When I click a link to "https://example.com/docs"
  Then it opens in my browser, not inside Quarry
  And a bare "https://…" address in the text is a link too

Scenario: CLAUDE-014.5 File links
  Given a Claude tab for "C:\work\shop"
  When I click a link to "src/app.ts:12"
  Then "C:\work\shop\src\app.ts" opens in a tab at line 12
  And "src/app.ts#L12" and an absolute path work the same way

Scenario: CLAUDE-014.6 HTML is never rendered
  When a reply containing "<img src=x onerror=alert(1)>" or "<script>"
  Then it is shown as plain text and nothing is executed

Scenario: CLAUDE-014.7 Line breaks are kept
  When a paragraph written on two lines
  Then it is shown on two lines
```

## CLAUDE-015: Start a new conversation in the same folder

- Status: draft
- Commands: `claude.newSession`
- Files:
  - `src/lib/claude.ts` — `newClaudeSession`, `stopProc`
  - `src/lib/commands.ts` — `claude.newSession` (enabled on a Claude tab)
  - `src/components/ClaudeView.tsx` — "New conversation" header button; the other header buttons (terminal, "Show folder in the Explorer")
- Tests: none
- Docs: `docs/claude-code.md`

**As a** developer who finished one topic
**I want** to start over in the same folder
**So that** Claude begins with a clean context

```gherkin
Scenario: CLAUDE-015.1 New conversation
  Given a Claude tab with a conversation
  When I click "New conversation" in the header or run "Claude Code: New Conversation"
  Then the conversation is cleared and the empty page is shown
  And a fresh Claude Code process starts in the same folder
  And the old conversation is listed under past conversations

Scenario: CLAUDE-015.2 Only on a Claude tab
  When a text tab is active
  Then "New Conversation" is not offered in the palette

Scenario: CLAUDE-015.3 Stopping the old one is not an error
  Given Claude is working
  When I start a new conversation
  Then the running task ends and no "Claude Code stopped" note is shown

Scenario: CLAUDE-015.4 Other header buttons
  When I look at the header of a Claude tab
  Then the header also has a button that opens a Claude CLI tab in the same folder as a separate conversation
  And a button "Show folder in the Explorer"
```

## CLAUDE-016: Continue a conversation after restarting Quarry

- Status: draft
- Commands: none
- Files:
  - `src/lib/claude.ts` — `flush` (keeps `doc.claude.sessionId` up to date), `openClaudeTab` (`historyLater`), `loadHistory`, `spawn` (`resume`), the failed-resume branch of the `claude:exit` listener
  - `src/lib/actions.ts` — session entries `claude: { cwd, sessionId }`; restore with `activate: false, start: false, reuse: false`
  - `src/lib/store.ts` — `Doc.claude`
  - `src-tauri/src/claude.rs` — `build_args` (`--resume`), `is_session_id`, `claude_history`
  - `src/lib/claudeProtocol.ts` — `reduce` (`system/init`, `result` carry the session id), `historyTranscript`
- Tests: `src/__tests__/claude.test.ts`, `src-tauri/src/claude.rs`
- Docs: `docs/claude-code.md`

**As a** developer who closes Quarry in the middle of a job
**I want** my Claude tabs back with their conversations
**So that** I can carry on where I left off

```gherkin
Scenario: CLAUDE-016.1 Tabs come back idle
  Given a Claude tab for "C:\work\shop" with a conversation was open when Quarry closed
  When Quarry starts again with session restore on
  Then the tab "Claude · shop" is there, its state is "Idle" and no Claude Code process has been started

Scenario: CLAUDE-016.2 Earlier messages load when the tab is first shown
  Given a restored Claude tab in the background
  When I switch to it for the first time
  Then "Loading the earlier messages…" is shown briefly
  And then my earlier messages, Claude's replies and the step cards appear

Scenario: CLAUDE-016.3 The next message continues the conversation
  Given a restored Claude tab
  When I send a message
  Then Claude Code starts and resumes that conversation, so Claude remembers the earlier messages

Scenario: CLAUDE-016.4 The folder is gone
  Given the folder of a saved Claude tab no longer exists
  When Quarry starts
  Then that tab is not restored

Scenario: CLAUDE-016.5 The conversation can no longer be resumed
  Given Claude Code no longer has the saved conversation
  When I send a message in the restored tab
  Then an error note ends with "The earlier conversation could not be resumed (Claude Code may no longer have it). Your next message starts a new conversation."
  And my following message starts a new conversation instead of failing again

Scenario: CLAUDE-016.6 History that cannot be read
  When the earlier messages cannot be read
  Then a note "Earlier messages could not be shown (<reason>)." appears and the tab is still usable

Scenario: CLAUDE-016.7 Only a real conversation id is resumed
  When a tab is restored with a saved conversation id that is not made of hexadecimal digits and dashes
  Then it is not passed to Claude Code
```

## CLAUDE-017: Browse and reopen past conversations

- Status: draft
- Commands: none
- Files:
  - `src/components/ClaudeView.tsx` — `HistoryMenu`, `Empty` ("Continue a conversation", 4 most recent), `ago`
  - `src/lib/claude.ts` — `listConversations`, `resumeConversation`, `loadHistory` ("Older messages are not shown.")
  - `src/lib/claudeProtocol.ts` — `historyTranscript` (replays JSONL lines through `reduce`; skips sidechain / meta lines and `<…>` system text)
  - `src-tauri/src/claude.rs` — `claude_conversations` (newest 60 files, `TITLE_SCAN`, title ≤ 160 characters), `prompt_text`, `project_slug`, `config_dir` (`CLAUDE_CONFIG_DIR` or `~/.claude`), `claude_history` (`HISTORY_MAX` 24 MB, fallback search in other project folders)
- Tests: `src/__tests__/claude.test.ts`, `src-tauri/src/claude.rs`
- Docs: `docs/claude-code.md`

**As a** developer returning to earlier work
**I want** to see the folder's past Claude Code conversations and reopen one
**So that** I can continue it, wherever it was started

```gherkin
Scenario: CLAUDE-017.1 The history list
  Given the folder has 3 past conversations
  When I click the history button in the header
  Then a list "Conversations in this folder" shows them newest first
  And each shows the first thing I asked and when it was last used, such as "5 min ago" or "yesterday"
  And the conversation shown in the tab is marked "open"

Scenario: CLAUDE-017.2 Conversations from the command line are included
  When a conversation was held with the claude command line in the same folder
  Then it is in the list too

Scenario: CLAUDE-017.3 Reopen one
  When I pick a conversation
  Then the list closes, any running Claude Code process of the tab is stopped and the tab shows that conversation's messages, pictures and steps
  And my next message continues that conversation

Scenario: CLAUDE-017.4 Recent conversations on the empty page
  When the folder has 6 past conversations
  Then a new conversation's empty page lists the 4 most recent under "Continue a conversation"
  And clicking one reopens it

Scenario: CLAUDE-017.5 Nothing yet
  When the folder has no past conversations
  Then the list says "No earlier conversations here yet."
  And the empty page shows no "Continue a conversation" section

Scenario: CLAUDE-017.6 Closing the list
  Given the history list is open
  When I press Esc or click outside it
  Then it closes and nothing changes

Scenario: CLAUDE-017.7 Very long conversations
  Given a conversation whose messages exceed 24 MB
  When I reopen it
  Then only the most recent messages are shown, under a note "Older messages are not shown."

Scenario: CLAUDE-017.8 What is not listed
  When the history list is built for a folder
  Then conversations without any prompt of mine are left out
  And only the 60 most recently used conversations are considered
  And stopped requests appear in a replayed conversation as "Stopped."
```

## CLAUDE-018: Choose the model

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/SettingsPanel.tsx` — `CLAUDE_MODELS` (Default, Opus, Sonnet, Haiku; a stored custom value is added to the list), "Model" row
  - `src/lib/claude.ts` — `spawn` (passes `settings.claudeModel` on every process start)
  - `src-tauri/src/claude.rs` — `build_args` (`--model` only when not empty, trimmed)
  - `src/components/ClaudeView.tsx` — `modelLabel` chip
  - `src/lib/claudeProtocol.ts` — `reduce` (`system/init` model)
  - `src/lib/types.ts` — `claudeModel` (default empty)
- Tests: `src/__tests__/claude.test.ts`, `src-tauri/src/claude.rs`
- Docs: `docs/claude-code.md`

**As a** developer on a Claude Code plan
**I want** to pick which model Quarry's Claude tabs use
**So that** I can trade speed against capability

```gherkin
Scenario: CLAUDE-018.1 Default leaves the choice to Claude Code
  When Settings › Claude Code › Model is "Default"
  Then Claude Code is started without a model option
  And the tab's chip reads "Default model" until Claude Code reports the model it uses

Scenario: CLAUDE-018.2 A chosen model
  Given Model is "Sonnet"
  When a Claude Code process is started for a tab
  Then it is started with the model "sonnet"
  And the chip shows the model name Claude Code reports

Scenario: CLAUDE-018.3 A running conversation keeps its model
  Given a Claude tab whose process is running
  When I change Model
  Then that process is not restarted
  And the new model is used the next time a process is started for a tab

Scenario: CLAUDE-018.4 A model name from the settings file
  When the stored model is a name that is not in the list
  Then the Model list shows that name as an extra entry and it is used as given
```

## CLAUDE-019: Know what background Claude tabs are doing

- Status: draft
- Commands: none
- Files:
  - `src/lib/claude.ts` — `useClaudeBadge`, `flush` (`unseenDone`, toasts), `installClaudeEvents` (clears `unseenDone` when the tab is shown)
  - `src/components/TitleBar.tsx` — `ClaudeBadge`, `BADGE` titles
  - `src/styles/app.css` — `.tab-badge` states
- Tests: none
- Docs: `docs/claude-code.md`

**As a** developer who keeps editing while Claude works in another tab
**I want** the tab to tell me when Claude needs me or is finished
**So that** a waiting question does not stall the job unnoticed

```gherkin
Scenario: CLAUDE-019.1 Working in the background
  When Claude is working in a tab that is not in front
  Then that tab shows a badge with the tooltip "Claude is working"

Scenario: CLAUDE-019.2 A question in the background
  When Claude asks for permission in the background tab "Claude · shop"
  Then the badge changes to "Claude is waiting for your answer"
  And a warning "Claude is waiting for your answer in shop." is shown once for that request

Scenario: CLAUDE-019.3 Finished out of sight
  Given Claude finishes in the background tab
  Then a message "Claude finished in shop." is shown and the badge reads "Claude finished"
  When I switch to the tab
  Then the badge is gone and stays gone

Scenario: CLAUDE-019.4 The tab in front has no badge
  When the Claude tab is the active tab
  Then it shows no badge and no such messages appear
```

## CLAUDE-020: Closing tabs, quitting and a process that stops

- Status: draft
- Commands: none
- Files:
  - `src/lib/actions.ts` — `closeDocument` (asks while Claude is working, `disposeClaude`), window close (`stopAllClaude`)
  - `src/lib/claude.ts` — `disposeClaude`, `stopAllClaude`, `claude:exit` listener, `exitNote`, `stopping` (wanted exits are silent), `write` ("Could not reach Claude Code")
  - `src/lib/claudeProtocol.ts` — `ended`
  - `src-tauri/src/claude.rs` — `claude_stop`, `claude_stop_all`, `kill_tree` (`taskkill /T /F`), stderr tail (last 4 to 8 KB), `claude:exit`, `SESSION_ENV` stripped by `command`
  - `src-tauri/src/writer.rs` — `run_all`
  - `src/lib/updater.ts` — stops Claude processes before installing an update
- Tests: `src/__tests__/claude.test.ts`
- Docs: `docs/claude-code.md`

**As a** developer
**I want** Claude Code processes to end with their tabs and failures to be explained
**So that** nothing keeps running behind my back and I know how to recover

```gherkin
Scenario: CLAUDE-020.1 Closing a working tab asks
  Given Claude is working in "Claude · shop"
  When I close the tab
  Then a dialog "Stop Claude Code in shop?" explains that closing stops the current task
  When I click "Close tab"
  Then the tab closes and the Claude Code process and any command it started end
  And cancelling keeps the tab and the task

Scenario: CLAUDE-020.2 Closing an idle tab does not ask
  Given Claude is not working
  When I close the tab
  Then it closes at once and its process ends

Scenario: CLAUDE-020.3 Quitting ends everything
  Given 2 Claude tabs with running processes
  When I quit Quarry
  Then both Claude Code processes and the commands they started are ended before the window closes

Scenario: CLAUDE-020.4 Claude Code stops by itself
  When the Claude Code process of a tab exits with code 1 after printing an error
  Then an error note "Claude Code stopped (exit code 1)." with the last lines of its error output and "Send a message to start it again." is shown
  And the state shows "Idle", nothing is marked as working and open permission requests are removed

Scenario: CLAUDE-020.5 Recover by sending
  Given the process stopped by itself
  When I send a message
  Then Claude Code is started again and continues the same conversation

Scenario: CLAUDE-020.6 Quarry started from a Claude Code session
  When Quarry itself was started by a Claude Code session
  Then the Claude Code processes Quarry starts do not inherit that session's marker variables
  And user configuration variables such as CLAUDE_CODE_USE_BEDROCK are passed on
```
