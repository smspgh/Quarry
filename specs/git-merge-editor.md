---
area: Three-Way Merge View (deferred)
prefix: THREEWAY
---

# Three-Way Merge View (deferred)

**This feature is deferred and not built.** It is item 10 of `GIT-ROADMAP.md`: build it only if real use shows the inline accept bars (`specs/git-conflicts.md`, CONFLICT-001 to CONFLICT-007) are not enough. It is the largest item on the roadmap, and many people turn VS Code's version off. The stories below say what it must do if the owner later asks for it: a tab that shows a conflicted file as Current, Incoming and an editable Result, as a second way to do what the inline bars already do. Nothing here replaces the inline flow.

Decisions:

- **The inline bars stay the default.** Clicking a file under Merge Changes still opens the file itself (CONFLICT-009). The merge view opens only when asked for, and there is no setting that makes it the default.
- **Owner answers (2026-11-16), for when this is built.** Each conflicted file's row under Merge Changes gets its own "Open in Merge View" button (THREEWAY-001.2), and Ctrl+S in the merge tab means Complete Merge (THREEWAY-004.6): both confirmed. Still open: the Base pane when the markers carry no base (THREEWAY-001.6).
- **One source of truth: the file's marker blocks.** The view is built from the text of the conflicted file (the open tab's text when there is one, else the file on disk) with the existing `parseConflicts`; it does not read the index stages. So it works on a half-resolved file, and the base is shown only when the markers carry it (diff3 / zdiff3 style). Quarry never changes `merge.conflictStyle` itself.
- **The Result is a private copy until Complete.** An unresolved conflict stays in the Result as its marker block. Nothing reaches the file or its text tab before Complete, so Cancel is always free.
- **Complete goes through `resolveConflicts`.** It puts the Result into the file's tab, then runs today's path: save, leftover-marker check on disk, Mark Resolved (CONFLICT-007). There is no second staging route.
- **Same words as the bars.** Pane titles, tooltips and the rebase / patch-series note come from `sideLabel` and `operationWords`, so Current / Incoming mean the same everywhere (during a rebase, Current is the branch being rebased onto and Incoming is the user's own commit).
- **A new tab kind (`merge`)** with its own CodeMirror views, like Compare tabs; it is not kept in the session. One merge tab per file.
- **Next to the other planned git specs.** Open in Merge View is added to the existing Git › Conflicts submenu (the planned layout of the whole Git menu is in `specs/git-merge-rebase.md`, Decisions). Every dialog here that could lose the Result defaults to the choice that keeps it (Cancel / Keep Editing); `choose()` already takes a per-choice `default`. None of the four owner decisions of 2026-11-13 changes this area: Complete saves one file through `resolveConflicts`, so the shared unsaved-tabs dialog of SAFE does not apply to it.

User documentation would go in `docs/git.md` ("Resolving a conflict").

## THREEWAY-001: Open a conflicted file in the merge view

- Status: planned
- Commands: `git.openMergeView`
- Files:
  - `src/components/MergeView.tsx` — new: the tab's three panes (Current, Incoming, Result), optional Base pane, toolbar; own CodeMirror views (as DiffView has); registers its focus target with `editor.registerFocus`
  - `src/lib/mergeModel.ts` — new, pure: `buildMerge(text)` → the two side texts, base text and Result text with each conflict's ranges, from `parseConflicts`
  - `src/lib/mergeView.ts` — new: `openMergeView(path)`, per-tab session store, reuse of an open merge tab for the same file
  - `src/lib/conflicts.ts` — `parseConflicts` (base section of diff3 blocks), `sideLabel` for the pane titles
  - `src/lib/gitCommands.ts` — registers `git.openMergeView` (`{ docId }` aware, enabled only for a text document with conflicts)
  - `src/components/MenuBar.tsx` — Git › Conflicts › Open in Merge View
  - `src/components/panels/GitPanel.tsx` — "Open in Merge View" button on a Merge Changes row
  - `src/lib/types.ts` — `Doc.kind` gains `"merge"`, `Doc.merge`
  - `src/lib/actions.ts` — `closeDocument` disposes a merge tab; merge tabs left out of the session
  - `src/App.tsx` — renders `MergeView` for merge tabs
  - `src/components/TitleBar.tsx` — tab icon and title for a merge tab
  - `src/lib/git.ts` — `openChange` stays as it is (a conflict opens the file itself)
  - `src/styles/app.css` — `.merge-view`, pane tints reusing the `--conflict-*` variables
- Tests: `src/__tests__/mergeModel.test.ts`, `src/__tests__/mergeView.test.tsx`
- Docs: `docs/git.md`

**As a** developer facing a file with many or large conflicts
**I want** to open it in a view with the current side, the incoming side and the result in separate panes
**So that** I can read each side whole instead of interleaved between marker lines

```gherkin
Scenario: THREEWAY-001.1 Open from the menu
  Given "store.ts" is under Merge Changes and open in a text tab with 3 conflicts
  When I choose Git › Conflicts › Open in Merge View
  Then a tab "store.ts · merge" opens with the panes "Current (HEAD)" and "Incoming (18bc71d (Add tokenizer))" side by side and "Result" below them
  And Current shows the file with my side of all 3 conflicts, Incoming shows it with the incoming side of all 3
  And the Result shows the file with the 3 conflicts still unresolved
  And the toolbar reads "3 conflicts left"

Scenario: THREEWAY-001.2 Open from the Source Control panel
  Given "store.ts" is under Merge Changes and not open in any tab
  When I click "Open in Merge View" on its row
  Then the merge tab opens from the file on disk
  And no text tab of "store.ts" is opened

Scenario: THREEWAY-001.3 The inline bars stay the default
  Given "store.ts" is under Merge Changes
  When I click its row
  Then the file itself opens in a text tab with its conflict bars, as before
  And no merge tab is opened

Scenario: THREEWAY-001.4 The sides are read-only and line up
  Given the merge tab of "store.ts" is open
  When I type in the Current or the Incoming pane
  Then nothing changes there
  And scrolling any pane keeps the same conflict level in all three

Scenario: THREEWAY-001.5 Base is shown when the file carries it
  Given the conflicts of "store.ts" have a "||||||| base" section (diff3 style)
  When I open the merge view
  Then the toolbar has a "Base" toggle
  And turning it on shows a read-only "Base" pane between Current and Incoming with the common-ancestor lines of each conflict

Scenario: THREEWAY-001.6 No base without diff3 markers
  Given the conflicts of "store.ts" have no "|||||||" section
  When I open the merge view
  Then there is no "Base" toggle and no Base pane
  And git's configuration is not changed

Scenario: THREEWAY-001.7 Unsaved edits of the text tab are used
  Given the text tab of "store.ts" has unsaved edits that already resolved 1 of its 3 conflicts
  When I open the merge view
  Then the view shows 2 conflicts and the toolbar reads "2 conflicts left"

Scenario: THREEWAY-001.8 One merge tab per file
  Given the merge tab of "store.ts" is already open
  When I run Open in Merge View for "store.ts" again
  Then that tab is brought to the front with its Result as I left it
  And no second merge tab opens

Scenario: THREEWAY-001.9 Disabled without conflicts
  Given the active document has no conflicts, is longer than 4,000,000 characters, or is not a text tab
  When I open the Git › Conflicts menu or the command palette
  Then Open in Merge View is greyed out

Scenario: THREEWAY-001.10 Not restored after a restart
  Given a merge tab is open
  When I quit and start Quarry again
  Then the merge tab is not reopened
  And the conflicted file is still under Merge Changes, unchanged
```

## THREEWAY-002: Accept a side or both for each conflict

- Status: planned
- Commands: `git.acceptCurrent`, `git.acceptIncoming`, `git.acceptBoth`, `git.nextConflict`, `git.prevConflict`
- Files:
  - `src/components/MergeView.tsx` — per-conflict Accept Current / Accept Incoming / Accept Both controls beside each side, "Conflict 2 of 3" marker, "N conflicts left" counter
  - `src/lib/mergeModel.ts` — `applyChoice(model, index, choice)` → the Result edit for one conflict, `conflictsLeft`
  - `src/lib/conflicts.ts` — `resolvedLines` (same result as the inline bars; Both = current then incoming, base dropped)
  - `src/lib/mergeView.ts` — applies the edit to the Result as one transaction; `conflictAt` for the commands
  - `src/lib/gitCommands.ts` — the existing accept / next / previous commands act on the Result when a merge tab is active
- Tests: `src/__tests__/mergeModel.test.ts`, `src/__tests__/mergeView.test.tsx`
- Docs: `docs/git.md`

**As a** developer resolving conflicts in the merge view
**I want** to take the current side, the incoming side or both for each conflict with one click
**So that** the result fills in without my touching marker lines

```gherkin
Scenario: THREEWAY-002.1 Accept Current
  Given the merge tab of "store.ts" has 3 conflicts and the first has "mine" as its current side and "theirs" as its incoming side
  When I click "Accept Current" beside the first conflict in the Current pane
  Then in the Result the first conflict's block, markers included, is replaced by "mine"
  And the toolbar reads "2 conflicts left"
  And the file on disk and its text tab are unchanged

Scenario: THREEWAY-002.2 Accept Incoming
  Given the same conflict, unresolved
  When I click "Accept Incoming" beside it in the Incoming pane
  Then its block in the Result is replaced by "theirs"

Scenario: THREEWAY-002.3 Accept Both keeps current first
  Given the same conflict, unresolved
  When I click "Accept Both"
  Then its block in the Result is replaced by "mine" followed by "theirs"
  And with a diff3 conflict the common-ancestor lines are not put into the Result

Scenario: THREEWAY-002.4 Change my mind
  Given I accepted Current for the first conflict
  When I click "Accept Incoming" for the same conflict
  Then the Result holds "theirs" there instead of "mine"
  And the toolbar still reads "2 conflicts left"

Scenario: THREEWAY-002.5 One undo step
  Given I accepted a side for a conflict
  When I press Ctrl+Z in the Result pane
  Then that conflict is unresolved in the Result again and the counter goes back up by 1

Scenario: THREEWAY-002.6 An empty side
  Given a conflict whose current side has no lines
  When I accept Current for it
  Then its block is removed from the Result and no empty line is left in its place

Scenario: THREEWAY-002.7 Commands and shortcuts work on the Result
  Given a merge tab with conflicts starting at Result lines 10, 80 and 300 and the cursor on line 1 of the Result
  When I press Alt+F6
  Then all panes scroll to the conflict at line 10
  And Git › Conflicts › Accept Incoming (Conflict at Cursor) then resolves that conflict in the Result

Scenario: THREEWAY-002.8 Which side was taken is visible
  Given I accepted Incoming for the second conflict
  When I look at the Current and Incoming panes
  Then the second conflict's lines are marked as taken in Incoming and as not taken in Current
```

## THREEWAY-003: Edit the result by hand

- Status: planned
- Commands: none
- Files:
  - `src/components/MergeView.tsx` — editable Result pane (language, theme and settings of the file's own tab), "Edited" state of a conflict, Reset Conflict control
  - `src/lib/mergeModel.ts` — `mapConflicts` (conflict ranges mapped through Result edits), `resetConflict`, a conflict counts as left while its marker lines are in the Result
  - `src/lib/mergeView.ts` — dirty flag of the merge tab
  - `src/editor/cmSetup.ts` — language and base extensions for the Result view
- Tests: `src/__tests__/mergeModel.test.ts`, `src/__tests__/mergeView.test.tsx`
- Docs: `docs/git.md`

**As a** developer whose conflict needs a mix of both sides
**I want** to type in the result pane like in any editor
**So that** I can write the merged text neither side has

```gherkin
Scenario: THREEWAY-003.1 Type in the Result
  Given I accepted Both for a conflict in the merge tab of "store.ts"
  When I delete one of the kept lines in the Result and type "const limit = 20;"
  Then the Result shows my text with the file's syntax colours
  And the merge tab is marked as modified
  And the Current and Incoming panes are unchanged

Scenario: THREEWAY-003.2 Resolve a conflict by hand
  Given the toolbar reads "2 conflicts left"
  When I delete the three marker lines of one conflict in the Result and keep the lines I want
  Then the toolbar reads "1 conflict left"

Scenario: THREEWAY-003.3 Edits outside conflicts
  Given a conflict below line 50 is still unresolved
  When I add 4 lines at the top of the Result
  Then the conflict is still shown level with its sides
  And accepting a side for it replaces the right block

Scenario: THREEWAY-003.4 Reset one conflict
  Given I accepted Current for the second conflict and then edited its lines
  When I click "Reset Conflict" for it
  Then the second conflict is unresolved in the Result again, with its original marker block
  And my edits elsewhere in the Result are kept

Scenario: THREEWAY-003.5 Undo and redo
  Given I made 3 edits in the Result
  When I press Ctrl+Z three times and then Ctrl+Y once
  Then the first edit is back and the other two are not
  And the undo history of the file's own text tab is untouched
```

## THREEWAY-004: Complete the merge of a file, or cancel

- Status: planned
- Commands: `git.completeMergeView`, `git.cancelMergeView`, `file.save`, `file.close`
- Files:
  - `src/lib/mergeView.ts` — new: `completeMerge(docId)` (puts the Result into the file's tab as one undoable transaction, opening the file when needed, then `resolveConflicts`; closes the merge tab only when the file ended up staged), `cancelMerge(docId)`, changed-underneath check
  - `src/lib/git.ts` — `resolveConflicts` (unchanged: saves the tab, checks the file on disk for markers, stages); `conflictsCleared` must not also ask while Complete is running
  - `src/lib/gitStatus.ts` — `hasConflictMarkers`
  - `src/components/MergeView.tsx` — "Complete Merge" (primary) and "Cancel" buttons, counter wording
  - `src/lib/gitCommands.ts` — registers `git.completeMergeView` / `git.cancelMergeView` (enabled only on a merge tab)
  - `src/lib/commands.ts` — `file.save` on a merge tab runs Complete
  - `src/lib/actions.ts` — `closeDocument` / `closeMany` ask about a modified merge tab
  - `src/lib/dialogs.ts` — `choose`, `askDialog`
- Tests: `src/__tests__/mergeView.test.tsx`, `src/__tests__/gitRemote.test.ts`
- Docs: `docs/git.md`

**As a** developer who has finished (or given up on) a file in the merge view
**I want** Complete to save the result and mark the file resolved with the usual checks, and Cancel to leave everything alone
**So that** the merge view can never stage something the inline flow would have questioned

```gherkin
Scenario: THREEWAY-004.1 Complete with every conflict resolved
  Given the merge tab of "store.ts" reads "0 conflicts left"
  When I click "Complete Merge"
  Then "store.ts" is saved with the text of the Result
  And it moves from Merge Changes to Staged Changes
  And the merge tab closes
  And no "No conflicts left in store.ts" dialog appears on top of that

Scenario: THREEWAY-004.2 Complete with conflicts left asks
  Given the merge tab reads "2 conflicts left"
  When I click "Complete Merge"
  Then "store.ts" is saved with the Result, marker lines included
  And the dialog "Conflict markers are still in the file" names store.ts, with the buttons "Mark Resolved Anyway" and "Cancel" (default)
  And "Cancel" stages nothing and leaves the merge tab open

Scenario: THREEWAY-004.3 Markers typed by hand are caught too
  Given the toolbar reads "0 conflicts left" but I typed a line ">>>>>>> note" into the Result
  When I click "Complete Merge"
  Then the same "Conflict markers are still in the file" dialog appears

Scenario: THREEWAY-004.4 The save fails
  Given "store.ts" is read-only on disk
  When I click "Complete Merge"
  Then the save error is shown, nothing is staged and the file stays under Merge Changes
  And the merge tab stays open with my Result

Scenario: THREEWAY-004.5 The file's tab follows
  Given "store.ts" is also open in a text tab
  When I complete the merge
  Then that tab shows the Result's text, saved
  And one Ctrl+Z in that tab brings back the text it had before Complete

Scenario: THREEWAY-004.6 Ctrl+S completes
  Given a merge tab is active
  When I press Ctrl+S
  Then the same happens as with "Complete Merge"

Scenario: THREEWAY-004.7 Cancel without changes
  Given I just opened the merge view and changed nothing
  When I click "Cancel"
  Then the merge tab closes without a question
  And "store.ts" on disk, its text tab and its place under Merge Changes are unchanged

Scenario: THREEWAY-004.8 Cancel with a changed Result asks
  Given I accepted sides for 2 conflicts in the Result
  When I click "Cancel"
  Then a dialog "Discard the merge result for store.ts?" says the file itself is not changed, with the buttons "Discard" and "Keep Editing" (default)
  And "Discard" closes the tab and leaves "store.ts" as it was
  And "Keep Editing" leaves the tab open with the Result as it was

Scenario: THREEWAY-004.9 Closing the tab with an unsaved Result asks
  Given the merge tab is marked as modified
  When I press Ctrl+W, or click the tab's close button
  Then a dialog "Complete the merge of store.ts?" offers "Complete Merge", "Discard" and "Cancel" (default)
  And "Cancel" keeps the tab open
  And Close All and quitting Quarry ask the same way before the Result is lost

Scenario: THREEWAY-004.10 The file changed underneath
  Given the merge tab of "store.ts" is open
  And I then edited "store.ts" in its text tab
  When I click "Complete Merge"
  Then a dialog says "store.ts changed since the merge view was opened" and offers "Replace with Result" and "Cancel" (default)
  And "Cancel" changes nothing

Scenario: THREEWAY-004.11 The operation ended meanwhile
  Given the merge was aborted while the merge tab was open
  When I click "Complete Merge"
  Then nothing is written or staged
  And a notification says "store.ts is no longer in conflict. The merge view was not applied."

Scenario: THREEWAY-004.12 What is left to do
  Given 2 other files are still under Merge Changes
  When "store.ts" has been completed
  Then a notification says "store.ts resolved. 2 other files still have conflicts."
  And when it was the last file it says "store.ts resolved. It was the last file: you can commit to finish."
```

## THREEWAY-005: Know which side is which during a rebase

- Status: planned
- Commands: none
- Files:
  - `src/components/MergeView.tsx` — pane titles, sides note under the toolbar, button tooltips
  - `src/lib/gitStatus.ts` — `operationWords` (sides note for `rebase` and `am`; the one source of this wording)
  - `src/lib/conflicts.ts` — `sideLabel`
  - `src/lib/mergeView.ts` — reads the repository's `operation` from `useGit`, updates when it changes
  - `src/lib/git.ts` — `repoOf`, the same `note` text the inline bars get through `setConflictHooks`
- Tests: `src/__tests__/gitRemote.test.ts`, `src/__tests__/mergeView.test.tsx`
- Docs: `docs/git.md`

**As a** developer resolving a conflict in the middle of a rebase
**I want** the merge view to say that Current is the branch I am rebasing onto and Incoming is my own commit
**So that** I don't throw away my own change by picking the side I assumed was mine

```gherkin
Scenario: THREEWAY-005.1 The note during a rebase
  Given a rebase of "feature" onto "main" stopped on a conflict in "store.ts"
  When I open "store.ts" in the merge view
  Then a note under the toolbar says "Rebasing: Current is the branch you are rebasing onto, Incoming is your own commit."
  And the pane titles use the marker labels, for example "Current (HEAD)" and "Incoming (4f2a9c1 (Add limit))", never "Yours" / "Theirs"

Scenario: THREEWAY-005.2 The tooltips say it too
  Given a rebase is in progress
  When I hover "Accept Current" and "Accept Incoming" in the merge view
  Then the Accept Current tooltip says it keeps the version on the branch I am rebasing onto
  And the Accept Incoming tooltip says it keeps my own commit's version

Scenario: THREEWAY-005.3 A patch series is not called a rebase
  Given `git am` stopped on a conflict
  When I open the conflicted file in the merge view
  Then the note says "Applying patches: Current is your branch, Incoming is the patch."

Scenario: THREEWAY-005.4 No note for a merge or cherry-pick
  Given a merge or a cherry-pick stopped on a conflict
  When I open the conflicted file in the merge view
  Then there is no sides note
  And the Accept Current tooltip says "Keep Current (HEAD): what your branch has"

Scenario: THREEWAY-005.5 Same words as the inline bars
  Given a rebase is in progress and "store.ts" is open both in a text tab and in the merge view
  When I compare the note on the conflict bars with the note in the merge view
  Then they are word for word the same
```
