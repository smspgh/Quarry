---
area: Macros
prefix: MACRO
---

# Macros

Keyboard macros: recording typing, editing keys and commands in a text tab, playing them back once, N times or down to the end of the file as one undo step, editing the recorded steps, and keeping macros as `<name>.macro.json` files in the macros folder. User documentation: `docs/macros.md`.

## MACRO-001: Record a macro

- Status: draft
- Commands: `macro.toggleRecord`
- Files:
  - `src/lib/commands.ts` — `toggleRecording` (new unsaved `Macro N`, opens the Macros panel), `macro.toggleRecord` (`enabled`, `dynamicTitle`), `setLastMacro` / `getLastMacro`
  - `src/lib/macros.ts` — `startRecording`, `stopRecording`, `stageMacros`, `installRecorderHooks`
  - `src/components/StatusBar.tsx` — "REC n" item
  - `src/components/panels/MacrosPanel.tsx` — record button in the header, "Recording… n steps captured" note
  - `src/lib/store.ts` — `recording`, `recordingSteps`, `recordTargetId`, `macros`, `activeMacroId`
  - `src/App.tsx` — calls `installRecorderHooks` at startup
- Tests: none
- Docs: `docs/macros.md`

**As a** developer facing the same edit on many lines
**I want** to record what I do once
**So that** I can replay it instead of repeating it by hand

```gherkin
Scenario: MACRO-001.1 Start recording
  Given a text tab is in front
  When I press Ctrl+Shift+R
  Then a message reads "Recording macro… press Ctrl+Shift+R to stop."
  And the status bar shows "REC 0"
  And the editor has focus

Scenario: MACRO-001.2 The step count is shown while recording
  Given recording is on
  When I press Home, type "// " and press Down
  Then the status bar shows "REC 3"
  And Macros › Start/Stop Recording reads "Stop Macro Recording (3 steps)"

Scenario: MACRO-001.3 Stop recording creates an unsaved macro
  Given recording is on with 3 steps and there are 2 macros
  When I press Ctrl+Shift+R
  Then a macro "Macro 3" with 3 steps is added at the top of the Macros panel, marked unsaved with "•"
  And the Macros panel opens with it selected
  And a message reads 'Recorded 3 steps as "Macro 3". Save it in the Macros panel to keep it.'
  And no file is written yet

Scenario: MACRO-001.4 Nothing recorded
  Given recording is on and I have done nothing
  When I press Ctrl+Shift+R
  Then a message reads "Nothing was recorded." and no macro is added

Scenario: MACRO-001.5 Recording needs a text tab
  Given the tab in front is a file open in large-file mode
  When I open the Macros menu
  Then "Start Macro Recording" is greyed out
  And the panel's record button has the tooltip "Open a text document to record a macro"

Scenario: MACRO-001.6 No recording during playback
  Given a macro is playing
  When I look at the Macros panel
  Then the record button is disabled
```

## MACRO-002: What a recording captures

- Status: draft
- Commands: none
- Files:
  - `src/lib/macros.ts` — `installRecorderHooks` (`onKeydown`, `onInput`, `IGNORED_KEYS`), `recordCommand` (skips `macro.*`; `recordableArgs` drops a tab's `docId`, see TAB-007.10), `push`
  - `src/editor/manager.ts` — `hooks.onKeydown` (highest-precedence keydown handler), `hooks.onInput` (input handler)
  - `src/lib/commands.ts` — `runCommand` and `handleKeyEvent` call `recordCommand`
  - `src/lib/types.ts` — `MacroStep`
- Tests: none
- Docs: `docs/macros.md`

**As a** developer recording a macro
**I want** typing, editing keys and commands captured in a form that replays reliably
**So that** playback does what I did, even if I later change a shortcut

```gherkin
Scenario: MACRO-002.1 Typing is merged into one step
  Given recording is on
  When I type "hello" in the editor
  Then one step 'Type "hello"' is recorded, not five

Scenario: MACRO-002.2 Editing and navigation keys
  Given recording is on
  When I press End and then Ctrl+Shift+Left in the editor
  Then two key steps "End" and "Ctrl+Shift+Left" are recorded
  And pressing only Shift, Ctrl or Alt records nothing

Scenario: MACRO-002.3 A registered shortcut is recorded as its command
  Given recording is on
  When I press Ctrl+D
  Then the step reads "Command: Add Selection to Next Find Match", not a key

Scenario: MACRO-002.4 Commands from menus, the palette and panel buttons
  Given recording is on
  When I run Sort Lines Ascending from the command palette
  Then a command step for it is recorded

Scenario: MACRO-002.5 Macro commands are never recorded
  Given recording is on
  When I press Ctrl+Shift+R to stop
  Then no step is recorded for the Start/Stop Recording command

Scenario: MACRO-002.6 Mouse and other input boxes are not recorded
  Given recording is on
  When I click in the editor, select text with the mouse, or type into the find bar
  Then no step is recorded for any of those
```

## MACRO-003: Record more steps into an existing macro

- Status: draft
- Commands: `macro.recordInto`
- Files:
  - `src/lib/commands.ts` — `macro.recordInto` (hidden; takes the macro id), append branch of `toggleRecording`
  - `src/lib/macros.ts` — `startRecording(targetId)`
  - `src/components/panels/MacrosPanel.tsx` — "Record more" / "Stop (n)" button above the steps
- Tests: none
- Docs: `docs/macros.md`

**As a** developer whose macro is almost right
**I want** to record extra steps onto the end of it
**So that** I do not have to record the whole thing again

```gherkin
Scenario: MACRO-003.1 Append steps
  Given the macro "Comment line" with 3 steps is selected in the Macros panel
  When I click "Record more", press End and type ";" in the editor, then press Ctrl+Shift+R
  Then "Comment line" has 5 steps and is marked unsaved
  And a message reads 'Added 2 steps to "Comment line". Save it to keep the change.'
  And no new macro is created

Scenario: MACRO-003.2 The button turns into Stop
  Given I clicked "Record more" on a macro
  When I have recorded 2 steps
  Then the button above its steps reads "Stop (2)"
  When I click it
  Then recording stops and the steps are appended

Scenario: MACRO-003.3 Unavailable without a text tab
  Given no text tab is in front
  When I look at a selected macro
  Then "Record more" is disabled with the tooltip "Open a text document to record"
```

## MACRO-004: Play a macro once

- Status: draft
- Commands: `macro.playLast`, `macro.play`
- Files:
  - `src/lib/commands.ts` — `macro.playLast` (`getLastMacro() ?? macros[0]`: looked up by id, then path, in the current list; `macroReady`, `dynamicTitle`), `macro.play` (hidden; id or `{ id, toEnd }`), `bindCommandRunner`, `bindAppKeyFallback`
  - `src/lib/macros.ts` — `playSteps` (text via `replaceSelection`, keys via `runScopeHandlers` then the app shortcut fallback, commands via the registry), `syntheticKey`, `guarded`
  - `src/components/panels/MacrosPanel.tsx` — `play`, Play button, `canPlay`, `playTitle`
  - `src/components/StatusBar.tsx` — "PLAYING" item
- Tests: none
- Docs: `docs/macros.md`

**As a** developer with a recorded macro
**I want** to replay it at the cursor with one shortcut or click
**So that** the recorded edit is repeated exactly

```gherkin
Scenario: MACRO-004.1 Play the last macro
  Given I recorded a macro that presses Home, types "// " and presses Down
  And the cursor is on the line "let a = 1;" and "Confirm script & macro runs" is off
  When I press Ctrl+Shift+M
  Then the line reads "// let a = 1;" and the cursor is on the next line

Scenario: MACRO-004.2 "Last" means last recorded or last played
  Given macros "A" and "B", and I played "B" from the panel
  When I open the Macros menu
  Then the play item reads 'Play Macro "B"'
  When I press Ctrl+Shift+M
  Then "B" is played

Scenario: MACRO-004.3 Play from the panel
  Given the macro "A" is selected in the Macros panel
  When I click "Play"
  Then "A" is played once on the document in front

Scenario: MACRO-004.4 Text goes to every cursor
  Given three cursors in the editor and a macro with the step Type "x"
  When I play it
  Then "x" is inserted at all three cursors

Scenario: MACRO-004.5 Commands that do not apply are skipped
  Given a macro containing a JSON command step and a Markdown tab in front
  When I play it
  Then that step does nothing and the remaining steps still run

Scenario: MACRO-004.6 Nothing to play
  Given no macro exists
  When I open the Macros menu
  Then "Play Last Recorded Macro" and "Play Last Macro Until End of File" are greyed out
  And the list part of the menu reads "No macros yet — record one"

Scenario: MACRO-004.7 Not while recording, playing or without a text tab
  Given recording is on
  When I look at the Macros panel
  Then "Play", "Play ×N" and "To end" are disabled, with the tooltip "Stop recording first" on Play
  Given the tab in front is not a text tab
  When I look at the Macros panel
  Then Play has the tooltip "Open a text document to play macros"

Scenario: MACRO-004.8 Play Last plays the macro as it is now
  Given I played "B" from the panel
  When I delete one of its steps in the editor, or rename it to "C" and save
  And I press Ctrl+Shift+M
  Then the edited macro is played, under its current name in the menu item
  And the steps it had before the edit are not played

Scenario: MACRO-004.9 A deleted macro is not played
  Given macros "A" and "B", and I played "B" from the panel
  When I delete "B" in the Macros panel
  Then the play item reads 'Play Macro "A"'
  When I press Ctrl+Shift+M
  Then "A" is played, not "B"
```

## MACRO-005: Play a macro N times

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/MacrosPanel.tsx` — times input (clamped to 1–100,000), "Play ×N" button, `play(id, n)`
  - `src/lib/macros.ts` — `playSteps(list, times)`
- Tests: none
- Docs: `docs/macros.md`

**As a** developer who knows how many lines need the edit
**I want** to play a macro a set number of times in a row
**So that** one click handles all of them

```gherkin
Scenario: MACRO-005.1 Play 5 times
  Given a macro that comments out a line and moves down, the cursor on the first of 5 lines, and the times box set to 5
  When I click "Play ×5"
  Then all 5 lines are commented out

Scenario: MACRO-005.2 The confirmation names the count
  Given "Confirm script & macro runs" is on and the macro has 3 steps
  When I click "Play ×5"
  Then the dialog says "3 recorded steps, played 5 times in a row."

Scenario: MACRO-005.3 Lowest value is 1
  When I type 0 or clear the times box
  Then it shows 1

Scenario: MACRO-005.4 Highest value is 100,000
  When I type 250000 in the times box
  Then it shows 100000
```

## MACRO-006: Play a macro until the end of the file

- Status: draft
- Commands: `macro.playToEnd`, `macro.play`
- Files:
  - `src/lib/macros.ts` — `playToEnd`, `shouldStopToEnd`, `PLAY_TO_END_MAX` (10,000)
  - `src/lib/commands.ts` — `macro.playToEnd`, `macro.play` with `toEnd`, "Played N times" message
  - `src/components/panels/MacrosPanel.tsx` — `playUntilEnd`, "To end" button
- Tests: `src/__tests__/scripts.test.ts`
- Docs: `docs/macros.md`

**As a** developer applying a line-by-line edit to the rest of a file
**I want** the macro repeated until it reaches the last line
**So that** I do not have to count lines first

```gherkin
Scenario: MACRO-006.1 Down to the last line
  Given a macro that presses Home, types "// " and presses Down
  And a 10-line document with the cursor on line 4
  When I click "To end" in the Macros panel
  Then lines 4 to 10 start with "// " and lines 1 to 3 are unchanged
  And a message reads "Played 7 times"

Scenario: MACRO-006.2 A macro that does not move down runs once
  Given a macro that only types "x"
  When I play it until the end of the file
  Then it is played once and a message reads "Played 1 time"

Scenario: MACRO-006.3 Starting on the last line
  Given the cursor is on the last line
  When I play a macro until the end of the file
  Then it is played exactly once

Scenario: MACRO-006.4 Safety limit
  Given a macro that adds a new line below and moves onto it
  When I play it until the end of the file
  Then it stops after 10,000 passes with the warning "Stopped after 10,000 repetitions (safety limit)."

Scenario: MACRO-006.5 From the menu
  Given the last macro is "A"
  When I choose Macros › Play "A" Until End of File
  Then "A" is repeated to the end of the file
```

## MACRO-007: Pause and stop playback

- Status: draft
- Commands: `macro.stop`, `macro.pause`
- Files:
  - `src/lib/macros.ts` — `stopPlayback`, `pausePlayback`, `checkpoint` (every 20 steps, and every 5 passes of To end), `PlaybackCancelled`, `guarded`
  - `src/lib/commands.ts` — `macro.stop` (Shift+Escape, no `dynamicTitle`: the menu shows its title without the "Macro: " prefix), `macro.pause` (`dynamicTitle`)
  - `src/components/StatusBar.tsx` — PLAYING / PAUSED item with pause and stop buttons
  - `src/components/panels/MacrosPanel.tsx` — Pause / Resume and Stop buttons shown while playing
- Tests: none
- Docs: `docs/macros.md`

**As a** developer who started a long playback
**I want** to pause or stop it
**So that** a macro going wrong does not run to the end

```gherkin
Scenario: MACRO-007.1 Playback indicator
  Given a macro set to play 50,000 times
  When it is playing
  Then the status bar shows "PLAYING" with pause and stop buttons
  And the Macros panel shows "Pause" and "Stop" in place of "Play"

Scenario: MACRO-007.2 Stop
  Given a macro is playing
  When I press Shift+Esc
  Then playback ends at the next checkpoint, at most 20 steps later
  And a message reads "Macro stopped"
  And the edits made so far stay in the document

Scenario: MACRO-007.3 Pause and resume
  Given a macro is playing
  When I click "Pause"
  Then playback holds, the status bar shows "PAUSED" and the button reads "Resume"
  When I click "Resume"
  Then playback continues from where it held

Scenario: MACRO-007.4 Stop while paused
  Given playback is paused
  When I click "Stop"
  Then playback ends and the status bar item disappears

Scenario: MACRO-007.5 Only available while playing
  Given no macro is playing
  When I open the Macros menu
  Then "Pause Macro Playback" and "Stop Playback" (shortcut Shift+Esc) are greyed out
  When a macro is playing
  Then they read "Pause Macro Playback" (or "Resume Macro Playback" while paused) and "Stop Playback", and are enabled
```

## MACRO-008: A whole playback is one undo step

- Status: draft
- Commands: none
- Files:
  - `src/lib/macros.ts` — `beginSession` / `endSession` (snapshot, history suppression, net change re-applied with `userEvent: "input.macro"`), `macroHistoryExtension`, `ensureHistoryExtension`, `canGroupUndo`, `isUndoRedoStep`, `depth`
- Tests: `src/__tests__/scripts.test.ts`
- Docs: `docs/macros.md`

**As a** developer who just ran a macro over hundreds of lines
**I want** one Ctrl+Z to take all of it back
**So that** a wrong macro costs me nothing

```gherkin
Scenario: MACRO-008.1 One undo for one play
  Given a macro with 12 steps
  When I play it once and press Ctrl+Z once
  Then the document is exactly as it was before the playback

Scenario: MACRO-008.2 One undo for all repetitions
  Given I played a macro with "Play ×200" or "To end"
  When I press Ctrl+Z once
  Then every repetition is undone
  And Ctrl+Y brings them all back

Scenario: MACRO-008.3 Earlier history is intact
  Given I typed "abc" and then played a macro
  When I press Ctrl+Z twice
  Then the playback and then the typing are undone

Scenario: MACRO-008.4 Macros that undo or redo keep normal history
  Given a macro that contains an Undo or Redo step, or a Ctrl+Z / Ctrl+Y key step
  When I play it
  Then its edits go into the undo history one by one
  And its Undo step undoes the macro's own previous edit, not my edit from before the playback

Scenario: MACRO-008.5 A stopped playback is still one step
  Given I stopped a playback part-way with Shift+Esc
  When I press Ctrl+Z once
  Then everything the playback did is undone
```

## MACRO-009: Confirm before a macro plays

- Status: draft
- Commands: none
- Files:
  - `src/lib/commands.ts` — `confirmRun("macro", …)` (shared with scripts)
  - `src/lib/macros.ts` — `playDetail`, `TO_END_DETAIL`: the detail text, shared by the panel and the commands
  - `src/components/panels/MacrosPanel.tsx` — `play`, `playUntilEnd` call `confirmRun`
  - `src/lib/dialogs.ts` — `choose`
  - `src/lib/types.ts` — `confirmRuns` setting, default `true`
- Tests: none
- Docs: `docs/macros.md`

**As a** developer with several macros
**I want** to be asked before one edits my document, and be able to look at its steps instead
**So that** I do not play the wrong macro by reflex

```gherkin
Scenario: MACRO-009.1 Prompt
  Given "Confirm script & macro runs" is on, the tab notes.txt is in front and "Tidy" has 4 steps
  When I play "Tidy"
  Then a dialog asks 'Run macro "Tidy"?', mentions its 4 recorded steps, and says it will edit notes.txt and can be undone with Ctrl+Z
  And it offers "Run", "Review first" and "Cancel"

Scenario: MACRO-009.2 Review first
  When I choose "Review first"
  Then the Macros panel opens with "Tidy" selected and nothing is played

Scenario: MACRO-009.3 Cancel
  When I choose "Cancel" or dismiss the dialog
  Then nothing is played

Scenario: MACRO-009.4 Asked once for repeated playback
  When I start "Play ×100" or "To end" and choose "Run"
  Then no further dialog appears during the repetitions

Scenario: MACRO-009.5 Setting off
  Given "Confirm script & macro runs" is off
  When I press Ctrl+Shift+M
  Then the macro plays without a dialog

Scenario: MACRO-009.6 Same wording wherever playback starts
  Given "Confirm script & macro runs" is on and "Tidy" has 1 step
  When I press Ctrl+Shift+M, or click "Play" in the Macros panel
  Then the dialog mentions "1 recorded step."
  When I click "Play ×5"
  Then it mentions "1 recorded step, played 5 times in a row."
  When I click "To end", or choose Play Until End of File from the Macros menu
  Then it says "Repeats until the cursor reaches the last line or stops moving down."
```

## MACRO-010: Manage macros in the Macros panel and menu

- Status: draft
- Commands: `macro.panel`, `macro.edit`, `view.macros`
- Files:
  - `src/components/panels/MacrosPanel.tsx` — list, `rename`, `duplicate`, `remove`, selection (`activeMacroId`)
  - `src/components/panels/ItemList.tsx` — `ItemList` (cards with an editable name, "•", meta, `sub` file name)
  - `src/lib/macros.ts` — `deleteMacro` (Recycle Bin), `stageMacros`, `macroFileName`
  - `src/components/MenuBar.tsx` — `macrosMenu` (one submenu per macro: Play / Play Until End of File / Edit)
  - `src/lib/commands.ts` — `macro.panel`, `macro.edit`
  - `src/lib/actions.ts` — `confirmDelete`
  - `src/styles/app.css` — `.item-list`, `.list-card`
- Tests: none
- Docs: `docs/macros.md`

**As a** developer who has built up several macros
**I want** to see, rename, copy and delete them in one place
**So that** the list stays useful

```gherkin
Scenario: MACRO-010.1 The list
  Given the macros "Comment line" (3 steps) and "Tidy" (1 step)
  When I choose Macros › Open Macros
  Then the Macros panel lists both by name with "3 steps" and "1 step"
  When I click "Tidy"
  Then its Play controls and its steps are shown below the list

Scenario: MACRO-010.2 Empty list
  Given there are no macros
  When I open the Macros panel
  Then it reads "No macros yet." and tells me to record one with the ● button, then save it

Scenario: MACRO-010.3 Rename
  Given a saved macro "Macro 1"
  When I click its name and change it to "Quote lines"
  Then the macro is marked unsaved with "•" and its file is not renamed until I click Save

Scenario: MACRO-010.4 Names that are not valid file names
  When I rename a macro to "a/b: test"
  Then a second line under the name shows the file it will be saved as, "a_b_ test.macro.json"

Scenario: MACRO-010.5 Duplicate
  Given the macro "Tidy" is selected
  When I click "Duplicate"
  Then an unsaved macro "Tidy (copy)" with the same steps appears right below it and is selected
  And editing the copy's steps does not change "Tidy"

Scenario: MACRO-010.6 Delete a saved macro
  Given the saved macro "Tidy" is selected
  When I click "Delete macro file"
  Then a dialog says its file will be moved to the Recycle Bin
  When I confirm
  Then the file is moved to the Recycle Bin, "Tidy" leaves the list and a message reads 'Deleted "Tidy"'

Scenario: MACRO-010.7 Delete an unsaved macro
  Given an unsaved macro that has never been saved is selected
  When I click "Delete macro file"
  Then the dialog says it has not been saved yet and will be discarded
  When I cancel
  Then the macro stays in the list

Scenario: MACRO-010.8 Each macro has a submenu in the Macros menu
  Given the macro "Tidy" with 4 steps and a text tab in front
  When I open Macros › Tidy
  Then it offers "Play", "Play Until End of File" and "Edit"
  When I choose "Edit"
  Then the Macros panel opens with "Tidy" selected

Scenario: MACRO-010.9 Menu play items explain why they are disabled
  Given recording is on
  When I open Macros › Tidy
  Then "Play" and "Play Until End of File" are greyed out and Play shows "recording"
```

## MACRO-011: Edit a macro's steps

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/MacroSteps.tsx` — `MacroSteps` (`startEdit`, `commitText`, `captureKey`, `move`, `remove`, `insert`, `label`)
  - `src/lib/macros.ts` — `describeStep`
  - `src/lib/commands.ts` — `getCommand` (titles for command steps), `prettyKeys`
  - `src/components/panels/MacrosPanel.tsx` — `onChange` marks the macro unsaved
  - `src/styles/app.css` — `.macro-steps`, `.macro-step`
- Tests: none
- Docs: `docs/macros.md`

**As a** developer whose recording has a typo or a wrong key
**I want** to fix the individual steps
**So that** I do not have to record the macro again

```gherkin
Scenario: MACRO-011.1 Steps are listed and numbered
  Given a macro that presses Home, types "// ", presses Ctrl+Shift+Left and runs Trim Trailing Whitespace
  When I select it
  Then its steps read 1. Home, 2. Type "// ", 3. Ctrl+Shift+Left and 4. "Command:" followed by that command's title

Scenario: MACRO-011.2 Edit a text step
  Given the step Type "// "
  When I click its pencil, change the text to "# " and press Enter
  Then the step reads Type "# " and the macro is marked unsaved

Scenario: MACRO-011.3 Cancel a text edit
  Given a text step is being edited
  When I press Esc
  Then the step keeps its previous text

Scenario: MACRO-011.4 Re-capture a key step
  Given the step "Home"
  When I click its pencil and press Ctrl+End
  Then the step reads "Ctrl+End"
  And pressing only a modifier key keeps waiting, and Esc cancels without changing the step

Scenario: MACRO-011.5 Command steps cannot be changed
  Given a command step
  When I look at its buttons
  Then it has Move up, Move down and Delete but no pencil

Scenario: MACRO-011.6 Reorder and delete
  Given a macro with 3 steps
  When I click "Move down" on step 1
  Then steps 1 and 2 swap places
  And "Move up" is disabled on the first step and "Move down" on the last
  When I click "Delete step" on a step
  Then it is removed and the rest are renumbered

Scenario: MACRO-011.7 Add steps
  When I click "+ Text"
  Then an empty text step is added at the end, open for typing
  When I click "+ Key"
  Then a key step is added at the end, waiting for me to press the key combination

Scenario: MACRO-011.8 A macro with no steps
  Given I deleted every step of a macro
  When I look at its step list
  Then it reads "No steps. Add a text or key step below."
```

## MACRO-012: Save a macro to a file

- Status: draft
- Commands: none
- Files:
  - `src/lib/macros.ts` — `saveMacro` (target `<folder>\<safe name>.macro.json`, overwrite question, removes the old file after a rename), `safeFileName`, `macroFileName`, `displayPath`
  - `src/components/panels/MacrosPanel.tsx` — `save`, Save button (enabled only while unsaved)
  - `src/lib/types.ts` — `Macro` (`path`, `unsaved`), `MacroStep`
  - `src/lib/ipc.ts` — `fs.writeText`, `fs.exists`, `fs.remove`
- Tests: `src/__tests__/paths.test.ts`
- Docs: `docs/macros.md`

**As a** developer who recorded a macro worth keeping
**I want** to save it as a file named after it
**So that** it is there next time and I can back it up or share it

```gherkin
Scenario: MACRO-012.1 Nothing is written until Save
  Given I just recorded "Macro 1"
  When I look in the macros folder
  Then there is no file for it
  And closing Quarry now loses the macro

Scenario: MACRO-012.2 Save
  Given the unsaved macro "Quote lines" is selected
  When I click Save
  Then the file "Quote lines.macro.json" is written in the macros folder
  And it holds a "steps" array and a "createdAt" time in milliseconds, indented by 2 spaces
  And the "•" disappears, Save becomes disabled and a message starts "Saved " followed by the file's path

Scenario: MACRO-012.3 Step format in the file
  When I save a macro with a key step, a text step and a command step
  Then the key step is stored with type "key", key, code and the ctrl / shift / alt / meta flags
  And the text step with type "input" and text
  And the command step with type "command", the command id and any arguments

Scenario: MACRO-012.4 Saving a renamed macro replaces its file
  Given the saved macro "Macro 1" renamed to "Quote lines"
  When I click Save
  Then "Quote lines.macro.json" exists and "Macro 1.macro.json" no longer does
  And "Macro 1.macro.json" is deleted outright, not moved to the Recycle Bin

Scenario: MACRO-012.5 Name already used by another macro
  Given "Tidy.macro.json" exists and I rename a different macro to "Tidy"
  When I click Save
  Then a dialog asks "Overwrite existing macro?"
  When I cancel
  Then no file is changed and the macro stays unsaved
  When I save again and choose "Overwrite"
  Then the file is replaced and the list shows one "Tidy", not two

Scenario: MACRO-012.6 Characters not allowed in file names
  When I save a macro named "a/b: test"
  Then the file is "a_b_ test.macro.json"
  And a macro with an empty name is saved as "untitled.macro.json"

Scenario: MACRO-012.7 Save fails
  Given the macros folder cannot be written to
  When I click Save
  Then an error starts "Could not save macro:" and the macro stays unsaved
```

## MACRO-013: Macros folder: loading, reloading and changing it

- Status: draft
- Commands: none
- Files:
  - `src/lib/macros.ts` — `loadMacros` (unsaved guard, `LoadReason`, skips unreadable files, sorted by name), `macrosDir`, `resolveFolder`, `cleanDirSetting`, `migrateLegacy`
  - `src/components/panels/MacrosPanel.tsx` — `chooseFolder`, `reload`, window-focus reload (the panel stays mounted while hidden, `Sidebar.tsx` `PanelFrame`, so this runs with the panel closed too)
  - `src/components/panels/SettingsPanel.tsx` — "Macros folder" row (`changeFolder`)
  - `src/App.tsx` — `loadMacros` at startup
- Tests: `src/__tests__/paths.test.ts`
- Docs: `docs/macros.md`

**As a** developer who keeps macros in a shared or backed-up folder
**I want** Quarry to load macros from the folder I choose and pick up changes made there
**So that** my macros follow me and edits made outside the editor show up

```gherkin
Scenario: MACRO-013.1 Macros are loaded at startup
  Given the macros folder holds "Tidy.macro.json" and "Comment line.macro.json"
  When Quarry starts
  Then the Macros panel lists "Comment line" and "Tidy", in name order
  And the default folder "macros" under Quarry's app data folder is created if it does not exist

Scenario: MACRO-013.2 Bad files are skipped silently
  Given the folder also holds "broken.macro.json" with invalid JSON and "empty.macro.json" without a "steps" array
  When macros are loaded
  Then neither appears in the list and no error is shown

Scenario: MACRO-013.3 Reload button
  Given nothing is unsaved
  When I click "Reload macros from the folder"
  Then the list is read again and a message reads "Loaded 2 macros from " followed by the folder
  And the button is disabled while recording or playing

Scenario: MACRO-013.4 Reloading would discard unsaved macros
  Given 1 unsaved macro
  When I click Reload
  Then a dialog asks "Reload macros from folder?" and says "1 unsaved macro will be discarded."
  When I cancel
  Then the list is unchanged

Scenario: MACRO-013.5 Changes made outside Quarry
  Given I copy "New.macro.json" into the macros folder with File Explorer, with the Macros panel open or closed
  When I switch back to Quarry
  Then "New" appears in the list, and in the Macros menu
  And this automatic reload is skipped while anything is unsaved, recording or playing

Scenario: MACRO-013.6 Choose another folder from the panel
  When I click the folder button in the panel header and pick D:\macros
  Then the setting Macros folder becomes D:\macros and the list shows the macros in it

Scenario: MACRO-013.7 Cancelling a folder switch keeps the old folder
  Given 2 unsaved macros
  When I pick another macros folder
  Then a dialog asks "Switch macros folder?" and says "2 unsaved macros will be discarded."
  When I cancel
  Then the setting goes back to the previous folder, the list is unchanged and a message reads "Macros folder change cancelled."

Scenario: MACRO-013.8 Unusable folder falls back
  Given the Macros folder is set to a path that cannot be created
  When macros are loaded
  Then the setting is reset to the default folder and one warning says so

Scenario: MACRO-013.9 Macros from an old version are imported once
  Given app data holds a macros.json from a version that stored all macros in one file
  When Quarry starts
  Then each of them is written as NAME.macro.json unless that file exists, and the import is not repeated
```
