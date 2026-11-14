---
area: Merge Conflicts and Stopped Operations
prefix: CONFLICT
---

# Merge Conflicts and Stopped Operations

Resolving git conflicts in the editor and in the Source Control panel, and carrying on with, skipping or aborting a merge, rebase, cherry-pick or revert that stopped part-way. User documentation: `docs/git.md` ("Resolving a conflict", "Rebase"). Ordinary staging and committing are in `specs/git.md`; the graph tab's own strip is in `specs/git-graph.md`.

## CONFLICT-001: See each conflict marked in the editor

- Status: draft
- Commands: none
- Files:
  - `src/lib/conflicts.ts` — `parseConflicts` (start / optional `|||||||` base / `=======` / end, CRLF tolerant, malformed blocks ignored), `sideLabel`
  - `src/editor/conflicts.ts` — `conflictField` (StateField), `scan` (`MAX_SCAN` = 4,000,000 characters), `mayAddConflict`, `build` (line decorations), `BarWidget`, `conflictExtensions`
  - `src/editor/manager.ts` — adds `conflictExtensions()` to every text document
  - `src/styles/app.css` — `.cm-conflict-*`
- Tests: `src/__tests__/conflicts.test.ts`, `src/__tests__/conflictsEditor.test.ts`
- Docs: `docs/git.md`

**As a** developer whose merge left conflicts in a file
**I want** each conflict's two sides tinted and numbered in the editor
**So that** I can see at a glance what my branch has and what is coming in

```gherkin
Scenario: CONFLICT-001.1 A conflict is marked
  Given a file containing a block "<<<<<<< HEAD", my lines, "=======", their lines, ">>>>>>> 18bc71d (Add tokenizer)"
  When I open it in a text tab
  Then my lines (current) are tinted green and the incoming lines blue
  And the three marker lines are shown muted and in italics
  And a bar above the block reads "Conflict 1 of 1" with the buttons Accept Current, Accept Incoming and Accept Both

Scenario: CONFLICT-001.2 Several conflicts are numbered
  Given a file with 2 conflicts
  When I open it in a text tab
  Then the bars read "Conflict 1 of 2" and "Conflict 2 of 2"

Scenario: CONFLICT-001.3 diff3 style
  Given a conflict that also has a "||||||| base" section before "======="
  When I open the file in a text tab
  Then the common-ancestor lines get their own tint
  And they belong to neither the current nor the incoming side

Scenario: CONFLICT-001.4 Lookalikes are left alone
  Given a file with a "=======" heading underline, a lone "<<<<<<<" line with no end, or markers with 6 or 8 characters
  When I open it in a text tab
  Then no bar and no tint is shown for them

Scenario: CONFLICT-001.5 The tooltips name the sides
  Given a conflict between "<<<<<<< HEAD" and ">>>>>>> 18bc71d (Add tokenizer)"
  When I hover the buttons of its bar
  Then the Accept Current button's tooltip says "Keep Current (HEAD): what your branch has"
  And the Accept Incoming button's tooltip says "Keep Incoming (18bc71d (Add tokenizer)): what is being brought in"

Scenario: CONFLICT-001.6 Conflicts appear when they are typed or pasted
  Given a document without conflicts
  When I paste a complete conflict block into it
  Then the bar and the tints appear
  And ordinary typing that inserts no "<<<<<<<" does not rescan the document

Scenario: CONFLICT-001.7 Very large documents are not scanned
  Given a document longer than 4,000,000 characters that contains conflict markers
  When I open it in a text tab
  Then no conflict bars are shown and the conflict commands are disabled
```

## CONFLICT-002: Accept one side of a conflict

- Status: draft
- Commands: `git.acceptCurrent`, `git.acceptIncoming`, `git.acceptBoth`
- Files:
  - `src/editor/conflicts.ts` — `resolveChange` (the edit for one block), `accept` (one transaction, `userEvent: "input.conflict"`), `conflictAtCursor`, bar buttons (mousedown keeps editor focus)
  - `src/lib/conflicts.ts` — `resolvedLines`
  - `src/lib/gitCommands.ts` — `acceptHere`, `withConflicts`, `hasConflicts`
  - `src/components/MenuBar.tsx` — Git › Conflicts submenu
- Tests: `src/__tests__/conflicts.test.ts`, `src/__tests__/conflictsEditor.test.ts`
- Docs: `docs/git.md`

**As a** developer resolving a conflict
**I want** to keep my side, the incoming side or both with one click or command
**So that** I don't have to delete marker lines by hand

```gherkin
Scenario: CONFLICT-002.1 Accept Current from the bar
  Given a conflict with "mine" as the current side and "theirs" as the incoming side
  When I click "Accept Current" on its bar
  Then the whole block, markers included, is replaced by "mine"
  And the cursor is at the start of the kept text

Scenario: CONFLICT-002.2 Accept Incoming
  When I click "Accept Incoming"
  Then the block is replaced by "theirs"

Scenario: CONFLICT-002.3 Accept Both keeps current first
  When I click "Accept Both"
  Then the block is replaced by "mine" followed by "theirs"
  And with a diff3 conflict the common-ancestor lines are dropped

Scenario: CONFLICT-002.4 One undo step
  Given I accepted a side
  When I press Ctrl+Z
  Then the conflict block is back exactly as it was, with its bar

Scenario: CONFLICT-002.5 From the menu, for the conflict at the cursor
  Given a file with 3 conflicts and the cursor inside the second
  When I choose Git › Conflicts › Accept Incoming (Conflict at Cursor)
  Then the second conflict is resolved to its incoming side
  And with the cursor between conflicts the next one below is resolved, and below the last one the first

Scenario: CONFLICT-002.6 An empty side
  Given a conflict whose current side has no lines
  When I accept Current
  Then the block is removed and no empty line is left in its place

Scenario: CONFLICT-002.7 No conflicts in the file
  Given the active document has no conflicts, or the active tab is not a text tab
  When I open the Git › Conflicts menu or the command palette
  Then the Accept commands are greyed out in the menu and the palette
```

## CONFLICT-003: Resolve every conflict in a file one way

- Status: draft
- Commands: `git.acceptAllCurrent`, `git.acceptAllIncoming`
- Files:
  - `src/editor/conflicts.ts` — `acceptAll` (all blocks in one transaction)
  - `src/lib/gitCommands.ts` — `acceptEvery`
  - `src/lib/conflicts.ts` — `resolveAll`, `resolvedLines`
- Tests: `src/__tests__/conflicts.test.ts`, `src/__tests__/conflictsEditor.test.ts`
- Docs: `docs/git.md`

**As a** developer who knows one side is right for a whole file
**I want** to accept that side for every conflict in it at once
**So that** I don't click through each block

```gherkin
Scenario: CONFLICT-003.1 Accept All Incoming
  Given a file with 4 conflicts
  When I choose Git › Conflicts › Accept All Incoming in This File
  Then all 4 blocks are replaced by their incoming sides
  And the text outside the blocks is unchanged

Scenario: CONFLICT-003.2 Accept All Current
  When I choose Accept All Current in This File
  Then every block is replaced by its current side

Scenario: CONFLICT-003.3 One undo step
  Given I accepted all conflicts one way
  When I press Ctrl+Z once
  Then all 4 conflicts are back

Scenario: CONFLICT-003.4 Disabled without conflicts
  Given the active document has no conflicts
  When I open the Git › Conflicts menu or the command palette
  Then both commands are greyed out
```

## CONFLICT-004: Jump between conflicts

- Status: draft
- Commands: `git.nextConflict`, `git.prevConflict`
- Files:
  - `src/editor/conflicts.ts` — `nextConflict` (which block, wrapping), `gotoConflict` (centres it)
  - `src/lib/gitCommands.ts` — registrations with `Alt+F6` / `Shift+Alt+F6`
- Tests: `src/__tests__/conflictsEditor.test.ts`
- Docs: `docs/git.md`

**As a** developer working through a conflicted file
**I want** shortcuts to the next and previous conflict
**So that** I can go through them without scrolling

```gherkin
Scenario: CONFLICT-004.1 Next conflict
  Given a file with conflicts starting at lines 10, 80 and 300 and the cursor on line 1
  When I press Alt+F6
  Then the cursor is on line 10 and the block is scrolled to the middle of the editor
  And the editor has the keyboard focus

Scenario: CONFLICT-004.2 Previous conflict
  Given the cursor is on line 200
  When I press Shift+Alt+F6
  Then the cursor is on line 80

Scenario: CONFLICT-004.3 Wrap around
  Given the cursor is below the last conflict
  When I press Alt+F6
  Then the cursor is on line 10
  And Shift+Alt+F6 above the first conflict goes to line 300

Scenario: CONFLICT-004.4 No conflicts
  Given the active document has no conflicts
  When I open the Git › Conflicts menu or the command palette
  Then Next Conflict and Previous Conflict are greyed out
```

## CONFLICT-005: Compare the two sides of a conflict

- Status: draft
- Commands: none
- Files:
  - `src/editor/conflicts.ts` — Compare button in `BarWidget`, `setConflictHooks` / `ConflictHooks.compare`
  - `src/lib/git.ts` — `compareSides` (wired in `installGit`), opens a preview Compare tab
  - `src/lib/diff.ts` — `openCompare` with two `text` sources
- Tests: none
- Docs: `docs/git.md`

**As a** developer facing a large conflict
**I want** to see its current and incoming text next to each other
**So that** I can tell exactly what differs before choosing

```gherkin
Scenario: CONFLICT-005.1 Compare from the bar
  Given "store.ts" has 2 conflicts
  When I click "Compare" on the bar of the second conflict
  Then a Compare tab opens with "store.ts · conflict 2 · current" on the left and "store.ts · conflict 2 · incoming" on the right
  And both sides are read-only
  And the conflicted document itself is unchanged

Scenario: CONFLICT-005.2 The tab is reused
  Given that Compare tab is open and untouched
  When I click "Compare" on another conflict
  Then its comparison replaces the previous one

Scenario: CONFLICT-005.3 diff3 conflicts
  Given a conflict with a common-ancestor section
  When I click "Compare"
  Then the left side holds only the current lines, without the ancestor lines
```

## CONFLICT-006: Finish a file when its last conflict is gone

- Status: draft
- Commands: none
- Files:
  - `src/editor/conflicts.ts` — update listener in `conflictExtensions` (`hooks.cleared` when the count goes from some to none)
  - `src/lib/git.ts` — `conflictsCleared` (only for a file git lists as conflicted; `stashLastFile` words the last file of a stash conflict), then `resolveConflicts`
  - `src/lib/dialogs.ts` — `choose`
- Tests: none
- Docs: `docs/git.md`

**As a** developer who just resolved the last conflict in a file
**I want** Quarry to offer to save it and mark it resolved
**So that** I don't forget the step that tells git the file is done

```gherkin
Scenario: CONFLICT-006.1 The offer
  Given "store.ts" is listed under Merge Changes and has 1 conflict left in its tab
  When I accept a side of that conflict
  Then a dialog "No conflicts left in store.ts" asks "Save store.ts and mark it resolved?"
  And its buttons are "Save and Mark Resolved" (default) and "Keep Editing"

Scenario: CONFLICT-006.2 Save and Mark Resolved
  When I click "Save and Mark Resolved"
  Then the tab is saved and the file moves from Merge Changes to Staged Changes

Scenario: CONFLICT-006.3 Keep Editing
  When I click "Keep Editing"
  Then the tab stays unsaved and the file stays under Merge Changes

Scenario: CONFLICT-006.4 The dialog says what is left
  Given 2 other files still have conflicts
  When the dialog appears after I resolve the last conflict of a file
  Then the dialog adds "2 other files still have conflicts."
  And when it is the last file of a merge, cherry-pick or revert it says "It is the last file: after this you can commit to finish."
  And when it is the last file of a rebase it says "It is the last file: after this, Continue Rebase carries on."
  And when the conflicts came from a stash (no operation in progress) it says what STASH-009.9 gives, never "commit to finish"

Scenario: CONFLICT-006.5 Deleting the markers by hand counts too
  Given I edit the text and delete the last marker lines myself
  When the last marker line is gone
  Then the same dialog appears

Scenario: CONFLICT-006.6 Not for files git does not list as conflicted
  Given an untitled document, or a file that is not under Merge Changes, containing a conflict block
  When I resolve its last block
  Then no dialog appears
```

## CONFLICT-007: Mark a conflicted file as resolved

- Status: draft
- Commands: `git.stageFile`
- Files:
  - `src/lib/git.ts` — `resolveConflicts` (saves a dirty tab of the file first, checks the file on disk for markers, then `stage`)
  - `src/lib/gitStatus.ts` — `hasConflictMarkers` (`<<<<<<<` or `>>>>>>>` lines; a lone `=======` does not count)
  - `src/components/panels/GitPanel.tsx` — `+` on a Merge Changes row ("Mark as resolved (stage)") and on the section heading ("Mark all as resolved (stage)")
  - `src/lib/gitCommands.ts` — `git.stageFile` routes a conflicted file through `resolveConflicts`
  - `src-tauri/src/git.rs` — `stage` / `git_stage` (`add -A`)
- Tests: `src/__tests__/gitRemote.test.ts`
- Docs: `docs/git.md`

**As a** developer who has fixed a conflicted file
**I want** to mark it resolved, with a check that no marker lines are left
**So that** I never commit `<<<<<<<` lines by accident

```gherkin
Scenario: CONFLICT-007.1 Mark one file resolved
  Given "store.ts" is under Merge Changes and its text has no marker lines
  When I click + on its row
  Then it moves to Staged Changes

Scenario: CONFLICT-007.2 An unsaved tab is saved first
  Given the tab of "store.ts" has unsaved edits
  When I click + on its row
  Then the tab is saved before the file is staged
  And if the save fails or is cancelled, nothing is staged

Scenario: CONFLICT-007.3 Leftover markers are asked about
  Given "store.ts" on disk still contains a ">>>>>>> 18bc71d" line
  When I click + on its row
  Then a dialog "Conflict markers are still in the file" names store.ts and warns that those lines would be committed as they are
  And its buttons are "Mark Resolved Anyway" and "Cancel" (default)
  And "Cancel" stages nothing

Scenario: CONFLICT-007.4 A heading underline is not a marker
  Given the file contains a line "=======" but no "<<<<<<<" or ">>>>>>>" line
  When I click +
  Then it is staged without a question

Scenario: CONFLICT-007.5 Mark all resolved
  Given 7 files under Merge Changes, 6 of which still contain markers
  When I click + on the Merge Changes heading
  Then one dialog names the first 5 of them followed by ", and 1 more"
  And "Mark Resolved Anyway" stages all 7

Scenario: CONFLICT-007.6 Stage Current File on a conflicted file
  Given the active tab is a conflicted file
  When I run Git › Stage Current File
  Then the same save and marker checks run before it is staged

Scenario: CONFLICT-007.7 A file deleted on one side
  Given a conflicted file that is not in the folder because one side deleted it
  When I click + on its row
  Then it is marked resolved as deleted, without a marker check
```

## CONFLICT-008: Take one side's version of a whole file

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/GitPanel.tsx` — "Current" / "Incoming" buttons on Merge Changes rows (`FileRow`), rebase-aware and stash-aware tooltips
  - `src/lib/gitStash.ts` — `stashSideTitle`
  - `src/lib/git.ts` — `takeSide` (asks before discarding unsaved edits, reloads or closes the open tab)
  - `src-tauri/src/git.rs` — `resolve_side` / `git_resolve_side` (`checkout --ours` / `--theirs` + `add`, or `rm -f` when that side has no stage 2 / 3 entry)
  - `src/lib/gitApi.ts` — `git.resolveSide`
  - `src/lib/actions.ts` — `revertDocument`, `closeDocument`
- Tests: `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer who wants one side's version of an entire file
**I want** Current and Incoming buttons on the file's row
**So that** I can settle a file, including one a side deleted, without opening it

```gherkin
Scenario: CONFLICT-008.1 Take the current version
  Given "store.ts" is under Merge Changes
  When I click "Current" on its row
  Then the file on disk becomes my branch's version and is staged
  And a notification says "store.ts: took the current version."

Scenario: CONFLICT-008.2 Take the incoming version
  When I click "Incoming" on its row
  Then the file becomes the incoming version and is staged
  And a notification says "store.ts: took the incoming version."

Scenario: CONFLICT-008.3 The side that deleted the file
  Given my branch deleted "old.ts" and the incoming side changed it
  When I click "Current" on its row
  Then the file is removed and the conflict is resolved as a deletion
  And a notification says "old.ts: deleted (the current side had deleted it)."
  And clicking "Incoming" instead keeps the incoming file

Scenario: CONFLICT-008.4 An open tab follows
  Given "store.ts" is open in a tab without unsaved edits
  When I take a side
  Then the tab shows the new text without asking
  And when taking the side deleted the file, its tab is closed

Scenario: CONFLICT-008.5 Unsaved edits are asked about
  Given the tab of "store.ts" has unsaved edits
  When I click "Incoming"
  Then a dialog "Replace your edits to store.ts?" offers "Replace" and "Cancel" (default)
  And "Cancel" leaves the file and the tab as they are

Scenario: CONFLICT-008.6 During a rebase the tooltips say which side is which
  Given a rebase is in progress
  When I hover the buttons on a Merge Changes row
  Then the "Current" tooltip says it takes the version on the branch I am rebasing onto
  And the "Incoming" tooltip says it takes my own commit's version
  And when the conflict came from a stash (no operation in progress) the tooltips say "Stash: Current is your files as they are now, Incoming is the stash."
```

## CONFLICT-009: Open a conflicted file from Merge Changes

- Status: draft
- Commands: none
- Files:
  - `src/lib/git.ts` — `openChange` (a conflict opens the file itself, not a Compare tab; toast when the file is not in the folder)
  - `src/components/panels/GitPanel.tsx` — `Section` "Merge Changes", `FileRow` click / Enter / double-click, letter `!`
  - `src/lib/gitStatus.ts` — `groupFiles` (conflicted files only in the conflict group), `rowKind`, `kindOf`
- Tests: `src/__tests__/splitGit.test.ts`
- Docs: `docs/git.md`

**As a** developer with conflicted files
**I want** them listed apart and opened straight in the editor
**So that** I get to the conflict markers in one click

```gherkin
Scenario: CONFLICT-009.1 Conflicted files have their own section
  Given a merge left 2 files in conflict and 3 files merged cleanly
  When I open the Source Control panel
  Then "Merge Changes" lists the 2 files with the letter "!"
  And they appear neither under Staged Changes nor under Changes

Scenario: CONFLICT-009.2 Click opens the file
  When I click a file under Merge Changes
  Then the file itself opens in a text tab with its conflicts marked
  And no Compare tab is opened

Scenario: CONFLICT-009.3 A file that is not in the folder
  Given a conflicted file that one side deleted and that does not exist on disk
  When I click it
  Then nothing opens and a notification says it "was deleted on one side and is not in the folder. Mark it resolved with + to keep it deleted, or abort."
```

## CONFLICT-010: Commit only when every conflict is resolved

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/GitPanel.tsx` — Commit button `disabled` / tooltip, message prefill effect (`offered`, `opKey`)
  - `src/lib/gitStatus.ts` — `commitLabel` ("Resolve N Conflict(s) First")
  - `src/lib/git.ts` — `commit()` refuses while conflicted files exist
  - `src-tauri/src/git.rs` — `operation_message` (MERGE_MSG without `#` lines) in `GitStatus.operationMessage`
- Tests: `src/__tests__/gitRemote.test.ts`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer finishing a merge, cherry-pick or revert
**I want** the commit held back until all conflicts are resolved, with git's message ready
**So that** I can't commit a half-resolved state and don't retype the message

```gherkin
Scenario: CONFLICT-010.1 The button says what is in the way
  Given 1 file is under Merge Changes
  When I look at the commit box
  Then the Commit button is disabled and reads "Resolve 1 Conflict First"
  And with 3 conflicted files it reads "Resolve 3 Conflicts First"

Scenario: CONFLICT-010.2 Ctrl+Enter does not commit either
  Given 2 files are under Merge Changes and the message box has text
  When I press Ctrl+Enter in the message box
  Then no commit is made
  And a warning says "2 files still have conflicts. Resolve them under Merge Changes (then mark each resolved with +), or abort."

Scenario: CONFLICT-010.3 The prepared message is filled in
  Given a cherry-pick of the commit "Add tokenizer" stopped on a conflict
  And the message box is empty
  When the Source Control panel shows the stopped operation
  Then the message box contains "Add tokenizer"
  And for a stopped merge it contains git's "Merge branch …" message, without the "# Conflicts:" comment lines

Scenario: CONFLICT-010.4 My own message is kept
  Given I had typed "WIP" in the message box before the operation stopped
  When the Source Control panel shows the stopped operation
  Then the box still contains "WIP"

Scenario: CONFLICT-010.5 Offered once
  Given the prepared message was filled in and I cleared the box
  When the status refreshes during the same stopped operation
  Then the box stays empty

Scenario: CONFLICT-010.6 The button comes back
  Given every file has been marked resolved
  When I look at the commit box
  Then the Commit button is enabled again with its normal wording, for example "Commit 2 Staged"
```

## CONFLICT-011: Abort a stopped operation

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/GitPanel.tsx` — operation badge (`OPERATION` labels), "Abort" beside the branch
  - `src/components/GraphView.tsx` — "Abort" in the stopped-operation strip
  - `src/lib/git.ts` — `abortOperation` (asks, then `checkExternalChanges`; forgets a pending rewrite of pushed commits, MERGE-009)
  - `src-tauri/src/git.rs` — `operation` (rebase-merge / rebase-apply / MERGE_HEAD / CHERRY_PICK_HEAD / REVERT_HEAD), `abort_operation` / `git_abort`
  - `src/lib/gitApi.ts` — `git.abort`, `GitOperation`
- Tests: `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer whose merge, rebase, cherry-pick or revert stopped
**I want** to see that it is in progress and be able to abort it
**So that** I can get back to where I was when resolving is not worth it

```gherkin
Scenario: CONFLICT-011.1 The panel shows the operation
  Given a cherry-pick stopped on a conflict
  When I open the Source Control panel
  Then a badge "Cherry-picking" shows after the branch button and the "Merge or Rebase" button, with an "Abort" button
  And a merge shows "Merging", a revert "Reverting" and a rebase "Rebasing"
  And it is the same for a merge or rebase started in Quarry (MERGE-007)
  And conflicts left by a stash (no operation in progress) show the badge "Stash conflicts" instead, with no "Abort" button (STASH-009.3)

Scenario: CONFLICT-011.2 Abort asks first
  When I click "Abort"
  Then a dialog "Abort the cherry-pick?" says everything goes back to how it was and resolutions made so far are discarded
  And its confirm button reads "Abort Cherry-pick"

Scenario: CONFLICT-011.3 Abort
  When I confirm
  Then the branch and files are as before the cherry-pick, and Merge Changes is empty
  And a notification says "Aborted the cherry-pick."
  And open tabs of files that changed on disk are re-checked
  And an aborted rebase of already-pushed commits leaves no "Force Push…" offer (MERGE-009.13)

Scenario: CONFLICT-011.4 Cancel
  When I cancel the dialog
  Then the operation is still in progress and nothing changed

Scenario: CONFLICT-011.5 Abort while conflicts remain
  Given files are still under Merge Changes
  When I look at the buttons beside the branch
  Then "Abort" is enabled

Scenario: CONFLICT-011.6 Disabled while git is busy
  Given another git action is running
  When I look at the buttons beside the branch
  Then "Abort" is disabled until it finishes
```

## CONFLICT-012: Skip the commit an operation stopped on

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/GitPanel.tsx` — "Skip" button (not for a merge; disabled while conflicts remain), "Nothing is left to commit…" note
  - `src/lib/git.ts` — `continueOperation(root, operation, "skip")`
  - `src-tauri/src/git.rs` — `continue_operation` / `git_continue` (`--skip`, refused for a merge, `GIT_EDITOR=true`)
  - `src/lib/gitApi.ts` — `git.continueOp`
- Tests: `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer whose cherry-pick, revert or rebase stopped on a commit I don't need
**I want** to leave that commit out and carry on
**So that** I am not stuck when resolving leaves nothing to commit

```gherkin
Scenario: CONFLICT-012.1 Skip is offered for everything but a merge
  Given a cherry-pick, revert or rebase is stopped
  When I look at the buttons beside the branch
  Then a "Skip" button shows beside the operation badge
  And a stopped merge has no "Skip" button

Scenario: CONFLICT-012.2 Not while conflicts remain
  Given files are still under Merge Changes
  When I look at the buttons beside the branch
  Then "Skip" is disabled and its tooltip says "Resolve the conflicts first (or Abort)"

Scenario: CONFLICT-012.3 Skip asks first
  Given a rebase is stopped and no file is in conflict
  When I click "Skip"
  Then a dialog "Skip this commit?" says the commit's changes will not be on the branch
  When I confirm with "Skip Commit"
  Then that commit is left out and the rebase carries on
  And a notification says "Skipped that commit: the rebase is on its next commit." or "The rebase is finished."

Scenario: CONFLICT-012.4 Nothing left to commit
  Given a cherry-pick is stopped and resolving left no changes at all
  When I look at the list of changes in the panel
  Then the panel says "Nothing is left to commit for this cherry-pick: its changes are already on the branch. Press Skip to move on, or Abort."
  And for a merge it says "Abort to end it." instead
```

## CONFLICT-013: Carry on with a rebase

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/GitPanel.tsx` — `rebasing`, disabled message box and its placeholder, `doCommit` → `continueOperation`, "Rebasing 2 of 5" from `operationStep`
  - `src/lib/gitStatus.ts` — `commitLabel(..., operation)` → "Continue Rebase"
  - `src/lib/git.ts` — `continueOperation(root, "rebase", "continue")` (then `rewriteContinued`, MERGE-009), `note` hook in `installGit` (rebase / am wording, or the stash note)
  - `src/editor/conflicts.ts` — `ConflictHooks.note`, note shown in each bar
  - `src-tauri/src/git.rs` — `operation_step` (msgnum / end, next / last), `continue_operation` (`rebase --continue`, `GIT_EDITOR=true`)
- Tests: `src/__tests__/gitRemote.test.ts`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer whose rebase (or Pull (Rebase)) stopped on a conflict
**I want** the panel to show where the rebase is and continue it with the main button
**So that** I can work through each stop without knowing the git commands

```gherkin
Scenario: CONFLICT-013.1 Progress
  Given a rebase of 5 commits stopped on the second
  When I open the Source Control panel
  Then the badge beside the branch reads "Rebasing 2 of 5"

Scenario: CONFLICT-013.2 The message box is off
  Given a rebase is in progress
  When I look at the commit box
  Then the message box is disabled
  And its placeholder says "A rebase keeps each commit's own message: resolve the conflicts, then Continue Rebase"
  And git's prepared message is not put into the box

Scenario: CONFLICT-013.3 The main button continues
  Given every conflicted file has been marked resolved
  Then the main button reads "Continue Rebase" and is enabled without a message
  When I click it
  Then the rebase carries on with the next commit, keeping each commit's own message without opening an editor
  And a notification says "Continued: the rebase is on its next commit." when it stops again, or "The rebase is finished." when it is done
  And when the rebase was started with "Rebase Anyway" over already-pushed commits (MERGE-006), finishing it makes the status line offer "Force Push…" (MERGE-009.1)

Scenario: CONFLICT-013.4 Conflicts first
  Given 1 file is still under Merge Changes during the rebase
  When I look at the commit box
  Then the main button is disabled and reads "Resolve 1 Conflict First"

Scenario: CONFLICT-013.5 It stops again
  Given the next commit conflicts too
  When I click "Continue Rebase"
  Then an error says "Stopped on a conflict." and the files are listed under Merge Changes again
  And the badge shows the new step, for example "Rebasing 3 of 5"

Scenario: CONFLICT-013.6 The sides are explained
  Given a rebase is in progress and I open a conflicted file
  When I look at its conflict bars
  Then each conflict bar also says "Rebasing: Current is the branch you are rebasing onto, Incoming is your own commit."
  And during a merge, cherry-pick or revert the bars carry no such note
  And when the conflicts came from a stash they say "Stash: Current is your files as they are now, Incoming is the stash." (STASH-009.4)
```

## CONFLICT-014: Carry on with a patch series (git am)

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/GitPanel.tsx` — badge, Skip / Abort tooltips, disabled message box and its placeholder, `doCommit` → `continueOperation`
  - `src/components/GraphView.tsx` — stopped-operation strip (`stoppedNoun`)
  - `src/lib/gitStatus.ts` — `operationWords("am")` (badge, button labels, placeholder, sides note), `operationDone` (notifications), `commitLabel(..., "am")`
  - `src/lib/git.ts` — `continueOperation`, `abortOperation`, `note` hook in `installGit`, `conflictsCleared`
  - `src-tauri/src/git.rs` — `operation` (rebase-apply with `applying`), `operation_step` (next / last), `continue_operation` (`am --continue` / `--skip`), `abort_operation` (`am --abort`)
- Tests: `src/__tests__/gitRemote.test.ts`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer applying a patch series with `git am` that stopped on a patch
**I want** the panel to name it as applying patches and carry it on with the main button
**So that** I am not told I am in a rebase I never started

```gherkin
Scenario: CONFLICT-014.1 Progress
  Given `git am` of 5 patches stopped on the second
  When I open the Source Control panel
  Then the badge beside the branch reads "Applying patches 2 of 5"
  And the graph tab's strip says "The patch series stopped part-way"

Scenario: CONFLICT-014.2 The main button continues
  Given every conflicted file has been marked resolved
  When I look at the commit box
  Then the message box is disabled and its placeholder says "Each patch keeps its own message: resolve the conflicts, then Continue Applying Patches"
  And the main button reads "Continue Applying Patches" and is enabled without a message
  When I click it
  Then the next patch is applied, each keeping its own message
  And a notification says "Continued: the patch series is on its next patch." when it stops again, or "The patch series is finished." when it is done

Scenario: CONFLICT-014.3 The sides are explained
  Given a patch series is stopped and I open a conflicted file
  When I look at its conflict bars
  Then each conflict bar also says "Applying patches: Current is your branch, Incoming is the patch."

Scenario: CONFLICT-014.4 Skip a patch
  Given no file is in conflict
  When I click "Skip"
  Then a dialog "Skip this patch?" says the patch's changes will not be on the branch
  When I confirm with "Skip Patch"
  Then that patch is left out and a notification says "Skipped that patch: the patch series is on its next patch." or "The patch series is finished."

Scenario: CONFLICT-014.5 Abort
  When I click "Abort"
  Then a dialog "Abort the patch series?" asks first and its confirm button reads "Abort Applying Patches"
  When I confirm
  Then the branch is back where it was before the patch series and a notification says "Aborted the patch series."

Scenario: CONFLICT-014.6 Never called a rebase
  Given a patch series is stopped
  When I look at the panel, the dialogs and the notifications
  Then none of them mentions a rebase or "the am"
```
