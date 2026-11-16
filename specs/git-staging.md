---
area: Hunk and Line Staging
prefix: STAGE
---

# Hunk and Line Staging

Staging, unstaging and discarding part of a file: one change (a "hunk") or a selected range of lines, from the Compare tab that Source Control opens for a changed file. Whole-file staging and discarding are in `git.md` (GIT-011, GIT-012), the Compare tab itself in `compare.md`. Roadmap item 1 in `GIT-ROADMAP.md`; user documentation is in `docs/git.md` (Stage part of a file) and `docs/compare.md`.

Decisions:

- **Owner decisions (2026-11-13).** The shared unsaved-tabs dialog (Save All / Continue Without Saving / Cancel, SAFE-001 to SAFE-003) is for operations that can rewrite any file of the repository. Partial staging is not one of them and keeps its own rule, below: the one file is saved first, without that dialog (SAFE says the same; the only thing it adds is that a failed save cancels the action, which STAGE-005.2 already requires and `applyGuarded` does).
- **A "change" is what the Compare tab already counts** ("Change 2 of 5"): one block of differing lines as @codemirror/merge shows it, not git's own hunk with 3 context lines. The user-facing word is "change"; "hunk" is only used in this file's title and in code. The editor compares characters, so its block sometimes takes in a neighbouring line that is the same on both sides (four lines removed above a line that starts alike); such a line is not counted as part of the change, so "4 removed lines" stay 4 removed lines when lines are picked from it.
- **Only Source Control comparisons get the controls**: the tabs opened by clicking a row under Changes (staged or HEAD ↔ working copy: Stage, Discard) or under Staged Changes (HEAD ↔ staged: Unstage). Compare with Last Commit, commit-file and file-to-file comparisons do not, because their left side is not the index.
- **Controls**: a small bar above each change in the right side (also in the Inline layout) with "Stage Change" / "Discard Change", or "Unstage Change" in the staged comparison; toolbar buttons "Stage Selected Lines" / "Discard Selected Lines" (or "Unstage Selected Lines") for a selection. The copy arrows of DIFF-011 stay as they are (an undoable edit of the side, not a git action).
- **Six commands**, so the palette, menu, shortcuts and macros say exactly what they will do: `git.stageChange`, `git.unstageChange`, `git.discardChange` (the change at the cursor), `git.stageLines`, `git.unstageLines`, `git.discardLines` (the selection). They are in the palette (which, as for every command, leaves out the ones that do not apply at the moment) and in a Git › Stage Part of a File submenu, which sits directly after Stage Current File / Unstage Current File (the planned layout of the whole Git menu is in `specs/git-merge-rebase.md`, Decisions). Shortcuts: `Ctrl+K S` (stage change), `Ctrl+K U` (unstage change), `Ctrl+K L` (stage lines), `Ctrl+K N` (unstage lines); Discard has no shortcut on purpose. Two-key chords are already supported and these four are free: the only chord today is `Ctrl+K M` (`code.setLanguage`), no command in `commands.ts` or `gitCommands.ts` uses `Ctrl+K` on its own, no other planned git spec takes a `Ctrl+K` chord, and a chord's second key never reaches the editor as typing.
- **Lines are selected in the right side** (the working copy, or the staged text in the staged comparison). A bare cursor counts as its one line. In a change that replaces N lines with N lines the lines are paired one to one; when the counts differ, the selected new lines replace the whole old block; added lines are taken one by one; removed lines can only be taken whole, by a selection that spans the place they were removed from. Staging part of a set of removed lines is not offered in this version.
- **Discard always asks**, names the file and the lines, and "Cancel" is the default button. Stage and Unstage do not ask: they lose nothing. There is no Discard in the staged comparison (as GIT-012.6).
- **Unsaved edits are saved first** for Stage and Discard, like marking a conflict resolved; the Discard dialog says so before it happens. Unstage never saves anything: it does not read the working file.
- **Nothing is applied on stale data.** If the file or the index is not what the comparison shows, nothing is staged, unstaged or discarded (and nothing is saved): the comparison reloads and says so.
- **The patch is built byte for byte in Rust** from the index blob and the file on disk (line endings, encoding, BOM, missing final newline untouched) and applied with `git apply --cached`, `git apply --cached -R` or `git apply -R`; the pure TS side only turns changes and the selection into line ranges. "The file on disk" is read the way git compares it with the index (`git diff-files` with the whole file as context), so a file that has CRLF on disk and LF in the repository gives a patch in the repository's line endings, and nothing is written into `.git` to find that out. Files git treats as binary, which includes UTF-16 text, and files whose line breaks the editor and git count differently (lone CR) are refused with a message: only the whole file can be staged.
- **The code is in its own files**: the actions in `src/lib/gitStaging.ts` (not `git.ts`), the Rust side in `src-tauri/src/git/staging.rs` (a submodule of `git.rs`).
- **Clicking a row whose comparison is already open** shows that tab, brought up to date, instead of opening a second one.
- **Source Control comparisons follow the index**: they refresh in place after any staging action in Quarry, and Reload re-reads their git side (today a git side keeps its text, DIFF-013.5).
- **Whole-file cases fall back to the file actions**: untracked and conflicted files have no partial staging (they open as files); for a deleted file, and for the single change of a newly added staged file, the change buttons do what the row's Stage / Unstage / Discard do.
- **A staged new file that was edited again** opens a comparison under Changes ("(staged)" ↔ working copy) instead of just opening the file, so the later edits can be staged in parts.
- **Swapped sides hide the controls**; swap back to get them. Swap itself stays available.
- **Not in this version**: partial staging from the editor's change gutter / Peek (GIT-003).

## STAGE-001: Stage one change of a file

- Status: draft
- Commands: `git.stageChange`
- Files:
  - `src/lib/gitHunks.ts` — pure: `hunksOf` (line ranges of each change from the two texts' chunks; lines that are the same on both sides are dropped from a chunk's ends), `hunkAt` (change at a line), `Pick` type (`oldStart`, `oldCount`, `newStart`, `newCount`), `textHash`, `barPlace` (where a change's bar and the left side's gap go so the two sides stay level; a change with no lines on a side hangs its widget below the line before it)
  - `src/lib/gitStaging.ts` — `openChangeCompare` / `changeSources` (the comparison's two sides and its `git` mark; an open comparison of the same file and section is shown again), `stageHunk` / `applyChange` (busy label, refresh of the comparison), `reloadChange`
  - `src/lib/git.ts` — `openChange` (untracked and conflicted files open as files; everything else goes to `openChangeCompare`)
  - `src/lib/diff.ts` — `DiffSession.git` (`DiffGit`: root, path, `staged`, `base`, `origPath`, `whole`), `openCompare` option carrying it, `loadSide`
  - `src/components/DiffView.tsx` — `hunkBars` / `HunkBar` (the bar "Stage Change" above each change in the right / inline editor), `HunkGap` (same height in the left editor), `placeOf` / `restorePlace` (cursor, scroll line and focus kept across the rebuild)
  - `src/lib/gitApi.ts` — `applyLines` wrapper
  - `src-tauri/src/git/staging.rs` — `git_apply_lines` / `apply_lines` (mode `stage`): `splice` + `build_patch` from the index blob and the working file as git sees it (`worktree_as_git`), `git apply --cached`
  - `src-tauri/src/git.rs` — `pub mod staging`
  - `src-tauri/src/lib.rs` — registers `git::staging::git_apply_lines`
  - `src/components/panels/GitPanel.tsx` — no new logic; the file appears in both sections and the Commit button counts it
  - `src/styles/app.css` — `.diff-hunk-bar`, `.diff-hunk-gap`, `.diff-hunk-btn`
- Tests: `src/__tests__/gitHunks.test.ts`, `src/__tests__/gitStaging.test.tsx`, `src-tauri/src/git/staging.rs`
- Docs: `docs/git.md`, `docs/compare.md`

**As a** developer whose file holds two unrelated edits
**I want** to stage one of them and leave the other
**So that** each commit holds one piece of work

```gherkin
Scenario: STAGE-001.1 Every change has a Stage button
  Given "app.ts" has 3 unstaged changes and nothing staged
  When I click "app.ts" under Changes
  Then the Compare tab "app.ts (HEAD)" ↔ "app.ts" opens and the toolbar reads "3 changes"
  And each of the 3 changes has a bar above it in the right side with "Stage Change" and "Discard Change"

Scenario: STAGE-001.2 Stage one change
  Given the comparison of "app.ts" with changes at lines 3, 20 and 40
  When I click "Stage Change" on the change at line 3
  Then "git diff --cached" shows only the change at line 3
  And "git diff" shows only the changes at lines 20 and 40
  And "app.ts" on disk is not modified

Scenario: STAGE-001.3 The file is in both lists and the Commit button counts it
  Given nothing else is staged
  When I have staged one of the 3 changes of "app.ts"
  Then "app.ts" is listed under Staged Changes and under Changes
  And the Commit button reads "Commit 1 Staged"

Scenario: STAGE-001.4 The comparison follows
  Given I staged the change at line 3
  When the action finishes
  Then the same tab now shows "app.ts (staged)" on the left and reads "2 changes"
  And the staged change is no longer marked as a difference
  And the view has not jumped away from where I was reading

Scenario: STAGE-001.5 Stage the last change
  Given "app.ts" has one unstaged change left
  When I click its "Stage Change"
  Then "app.ts" leaves the Changes list and stays under Staged Changes
  And the tab stays open and reads "No differences"

Scenario: STAGE-001.6 One staged, one discarded, one left
  Given "app.ts" with changes at lines 3, 20 and 40
  When I stage the change at line 3 and discard the change at line 20, confirming the question
  Then "git diff --cached" shows only the change at line 3
  And "git diff" shows only the change at line 40
  And line 20 of "app.ts" on disk has its committed text

Scenario: STAGE-001.7 Inline layout
  Given the comparison is switched to "Inline"
  When I click "Stage Change" on a change's bar in the single editor
  Then that change is staged exactly as in the side by side layout

Scenario: STAGE-001.8 A file that already has something staged
  Given "app.ts" was staged whole and then edited again in two places
  When I open it from Changes and stage one of the two changes
  Then what was staged before is still staged and the one change is added to it
  And the other change stays under Changes

Scenario: STAGE-001.9 No question is asked
  When I click "Stage Change"
  Then the change is staged without a confirmation dialog, since nothing is lost

Scenario: STAGE-001.10 The two sides stay level
  Given the side by side comparison of a file where lines were only removed in one place and only added in another, also at the very start and the very end
  When I look at the lines after each change, before and after scrolling
  Then every unchanged line is at the same height in the left and the right side
  And the bar of a change that only removes lines sits above the empty space those lines leave in the right side (at the very start of the file: below it, directly above the first line)
```

## STAGE-002: Unstage one change

- Status: draft
- Commands: `git.unstageChange`
- Files:
  - `src/lib/gitStaging.ts` — `unstageHunk` / `applyChange`; `changeSources` staged branch (HEAD ↔ staged session marked `staged: true`, `origPath` of a rename, `whole` for a staged deletion)
  - `src/lib/gitHunks.ts` — `hunksOf`, `hunkAt` (same ranges, applied in reverse)
  - `src/components/DiffView.tsx` — change bar with "Unstage Change" only, in a staged comparison
  - `src-tauri/src/git/staging.rs` — `apply_lines` (mode `unstage`): patch from the HEAD blob and the index blob, `git apply --cached -R`; a newly added file with nothing left staged → `unstage`
- Tests: `src/__tests__/gitHunks.test.ts`, `src/__tests__/gitStaging.test.tsx`, `src-tauri/src/git/staging.rs`
- Docs: `docs/git.md`, `docs/compare.md`

**As a** developer who staged more than the commit should hold
**I want** to take one change back out of the staged set
**So that** I can fix the commit's contents without unstaging the whole file

```gherkin
Scenario: STAGE-002.1 The staged comparison offers Unstage only
  Given "app.ts" has 2 staged changes
  When I click "app.ts" under Staged Changes
  Then the Compare tab "app.ts (HEAD)" ↔ "app.ts (staged)" opens
  And each change has a bar with "Unstage Change" and no Stage or Discard button

Scenario: STAGE-002.2 Unstage one change
  Given the staged comparison of "app.ts" with changes at lines 3 and 20
  When I click "Unstage Change" on the change at line 20
  Then "git diff --cached" shows only the change at line 3
  And "git diff" shows the change at line 20
  And "app.ts" on disk is not modified
  And "app.ts" is listed under both Staged Changes and Changes

Scenario: STAGE-002.3 Unstage the last staged change
  Given "app.ts" has one staged change
  When I click its "Unstage Change"
  Then "app.ts" leaves Staged Changes and is under Changes with its edits intact
  And the tab stays open and reads "No differences"

Scenario: STAGE-002.4 No question, no save
  Given "app.ts" is open in a tab with unsaved edits
  When I click "Unstage Change" in its staged comparison
  Then the change is unstaged without a dialog
  And the tab of "app.ts" is not saved and keeps its unsaved edits

Scenario: STAGE-002.5 A newly added file
  Given "new.ts" was added with "git add" and never committed, so its whole text is one staged change
  When I click "Unstage Change" on it
  Then "new.ts" is untracked again, shows U under Changes, and stays on disk

Scenario: STAGE-002.6 A staged rename with edits
  Given "old.ts" was renamed to "new.ts", edited in 2 places and staged
  When I unstage one of the 2 changes in the staged comparison
  Then the rename stays staged with the other change
  And the unstaged change shows under Changes for "new.ts"
  And the staged comparison's left side is labelled "old.ts (HEAD)", the file's name before the rename
```

## STAGE-003: Discard one change, after asking

- Status: draft
- Commands: `git.discardChange`
- Files:
  - `src/lib/gitStaging.ts` — `discardHunk` / `applyGuarded` (confirmation wording, save first, the file's tab reloaded with `revertDocument` afterwards)
  - `src/lib/gitHunks.ts` — `describeLines` ("Lines 20–22", "Line 20", "The 4 lines removed after line 19"), `discardText` (the question's sentences)
  - `src/lib/dialogs.ts` — `choose` (unchanged: danger button, `default: true` on Cancel)
  - `src/components/DiffView.tsx` — "Discard Change" on the change bar (comparisons from Changes only)
  - `src-tauri/src/git/staging.rs` — `apply_lines` (mode `discard`): patch from the index blob and the working file, `git apply -R` on the working file only
- Tests: `src/__tests__/gitHunks.test.ts`, `src/__tests__/gitStaging.test.tsx`, `src-tauri/src/git/staging.rs`
- Docs: `docs/git.md`, `docs/compare.md`

**As a** developer who tried something in one place that did not work out
**I want** to throw away that one change, after being asked
**So that** the rest of my work in the file stays and nothing is lost by accident

```gherkin
Scenario: STAGE-003.1 Discard asks first
  Given the comparison of "app.ts" with nothing staged and a change covering lines 20 to 22
  When I click "Discard Change" on that change
  Then a dialog "Discard this change?" says "Lines 20–22 of app.ts go back to the last commit. Your edits to those lines will be lost."
  And its buttons are "Discard Change" and "Cancel", with "Cancel" the default

Scenario: STAGE-003.2 Cancel, Escape and Enter leave the file alone
  Given the "Discard this change?" dialog is open
  When I click "Cancel", press Escape, or press Enter
  Then "app.ts" on disk and the index are unchanged and the change is still in the comparison

Scenario: STAGE-003.3 Discard restores those lines only
  Given "app.ts" with changes at lines 3, 20 and 40
  When I click "Discard Change" on the change at line 20 and confirm with "Discard Change"
  Then lines 20 to 22 of "app.ts" on disk have their committed text
  And the changes at lines 3 and 40 are still in the file and under Changes
  And the comparison reads "2 changes"

Scenario: STAGE-003.4 An open tab shows the restored text
  Given "app.ts" is also open in a text tab with no unsaved edits
  When I discard a change in the comparison
  Then the tab shows the restored lines without asking whether to reload

Scenario: STAGE-003.5 With something staged, the lines go back to the staged version
  Given "app.ts" was staged and then edited again at line 20
  When I click "Discard Change" on the change at line 20
  Then the dialog says "Line 20 of app.ts goes back to the staged version. Your edits to that line will be lost."
  And after confirming, only the later edit is gone and everything staged is still staged

Scenario: STAGE-003.6 Removed lines are put back
  Given a change where 4 lines were deleted after line 19 and nothing was added
  When I click its "Discard Change"
  Then the dialog says "The 4 lines removed after line 19 of app.ts are put back."
  And after confirming, the 4 lines are in the file again

Scenario: STAGE-003.7 Discarding the last change
  Given "app.ts" has one unstaged change and nothing staged
  When I discard it and confirm
  Then "app.ts" leaves the Changes list and the comparison reads "No differences"

Scenario: STAGE-003.8 No Discard in the staged comparison
  Given the comparison opened from Staged Changes
  When I look at the change bars and the toolbar
  Then there is no Discard button of any kind
```

## STAGE-004: Stage, unstage or discard selected lines

- Status: draft
- Commands: `git.stageLines`, `git.unstageLines`, `git.discardLines`
- Files:
  - `src/lib/gitHunks.ts` — `picksForSelection` (pure: selection line range × changes → `Pick[]`; equal counts pair line by line, unequal counts take the whole old block, added lines one by one, a removal only when the selection spans it), `selectionApplies`
  - `src/lib/gitStaging.ts` — `stageLines`, `unstageLines`, `discardLines` / `applySelection`, `selectedLines` (the same guards and dialogs as the change actions)
  - `src/components/DiffView.tsx` — toolbar buttons "Stage Selected Lines" / "Discard Selected Lines" / "Unstage Selected Lines", enabled from the right editor's selection
  - `src-tauri/src/git/staging.rs` — `apply_lines` with several picks; `splice` / `build_patch` context and line counts for partial changes
- Tests: `src/__tests__/gitHunks.test.ts`, `src/__tests__/gitStaging.test.tsx`, `src-tauri/src/git/staging.rs`
- Docs: `docs/git.md`, `docs/compare.md`

**As a** developer whose single change mixes a fix with debug output
**I want** to stage, unstage or discard only the lines I select
**So that** a commit can hold part of a change

```gherkin
Scenario: STAGE-004.1 Stage some of the added lines
  Given one change of "app.ts" adds lines 10 to 15
  And I select lines 11 to 12 in the right side
  When I click "Stage Selected Lines"
  Then "git diff --cached" shows exactly lines 11 and 12 as added
  And "git diff" shows lines 10, 13, 14 and 15 as added
  And the comparison now shows two smaller changes around the staged lines

Scenario: STAGE-004.2 One line of a block changed line for line
  Given a change that replaces 3 lines with 3 lines at lines 20 to 22
  And the cursor is on line 21 with nothing selected
  When I click "Stage Selected Lines"
  Then the staged version has the new line 21 and the old lines 20 and 22
  And lines 20 and 22 are still shown as changes

Scenario: STAGE-004.3 A block replaced by a different number of lines
  Given a change that replaces 2 old lines with 5 new lines at lines 30 to 34
  And I select lines 30 to 31
  When I click "Stage Selected Lines"
  Then the staged version has the 2 old lines replaced by the new lines 30 and 31
  And lines 32 to 34 remain as an unstaged addition

Scenario: STAGE-004.4 A selection across several changes
  Given changes at lines 3, 20 and 40 and a selection from line 1 to line 25
  When I click "Stage Selected Lines"
  Then the changes at lines 3 and 20 are staged whole and the change at line 40 is not

Scenario: STAGE-004.5 Removed lines come along only when the selection spans them
  Given 4 lines were deleted between lines 19 and 20
  When I select lines 19 to 20 and click "Stage Selected Lines"
  Then the removal of the 4 lines is staged
  And with only line 19 selected the button is disabled, since the selection touches no change

Scenario: STAGE-004.6 Unstage selected lines
  Given the staged comparison of "app.ts" where one change adds lines 10 to 15
  When I select lines 14 to 15 in the right side and click "Unstage Selected Lines"
  Then "git diff --cached" shows lines 10 to 13 as added
  And "git diff" shows lines 14 and 15 as added
  And the file on disk is unchanged

Scenario: STAGE-004.7 Discard selected lines asks first
  Given one change adds lines 10 to 15 and I select lines 11 to 12
  When I click "Discard Selected Lines"
  Then a dialog "Discard the selected lines?" says "Lines 11–12 of app.ts go back to the last commit. Your edits to those lines will be lost."
  And "Cancel" is the default button and leaves everything as it was
  And "Discard Lines" removes just those 2 lines from the file, leaving the other 4 added lines

Scenario: STAGE-004.8 A selection that touches no change
  Given the selection covers only unchanged lines, or the cursor is on an unchanged line
  When I look at the toolbar
  Then "Stage Selected Lines" and "Discard Selected Lines" are disabled

Scenario: STAGE-004.9 The selection is read from the right side
  Given the side by side layout with a selection in the left side only
  When I look at the toolbar
  Then the selected-lines buttons follow the right side's cursor or selection, not the left side's

Scenario: STAGE-004.10 The change bar always takes the whole change
  Given I selected 2 lines inside a 6-line change
  When I click "Stage Change" on that change's bar
  Then all 6 lines are staged

Scenario: STAGE-004.11 A neighbouring line that did not change is left alone
  Given 4 lines were added above a line that begins like them, so the editor marks that line as part of the change too
  When I select the first added line and click "Stage Selected Lines"
  Then only that line is added to the staged version
  And the unchanged neighbouring line is still in the staged version
```

## STAGE-005: Unsaved edits are saved first

- Status: draft
- Commands: `git.stageChange`, `git.stageLines`, `git.discardChange`, `git.discardLines`
- Files:
  - `src/lib/gitStaging.ts` — `applyGuarded` (shared by every Stage / Discard action: the open text tab via `saveDocument`, an edited Compare side via `saveDiff`; a failed or cancelled save stops the action; the tab's text must be what the comparison shows, before and after the save)
  - `src/lib/diff.ts` — `saveDiff`, `sideText` (the text the comparison shows)
  - `src/lib/actions.ts` — `saveDocument`, `revertDocument` after a discard
- Tests: `src/__tests__/gitStaging.test.tsx`
- Docs: `docs/git.md`

**As a** developer who stages while still typing
**I want** Quarry to save the file before it stages or discards part of it
**So that** what is staged is what I see in the comparison, not an older file on disk

```gherkin
Scenario: STAGE-005.1 Stage with an unsaved tab saves it first
  Given "app.ts" is open in a tab with unsaved edits
  And its comparison shows "app.ts (unsaved)" on the right with 2 changes
  When I click "Stage Change" on the first change
  Then the tab of "app.ts" is saved without a question
  And the first change, as shown in the comparison, is staged
  And the tab no longer shows the unsaved-changes dot
  And the comparison's right side reads "app.ts" again at once (it follows every save of the tab, without a click)

Scenario: STAGE-005.2 The save fails or is cancelled
  Given "app.ts" has unsaved edits and was also changed on disk by another program
  When I click "Stage Change" and answer the save's overwrite question with "Cancel"
  Then nothing is staged and the tab keeps its unsaved edits

Scenario: STAGE-005.3 Edits made in the comparison itself
  Given "app.ts" is not open in a tab and I typed in the right side of its comparison, which is tagged "edited"
  When I click "Stage Change" on a change
  Then the right side is saved to "app.ts" first and the tag "edited" goes away
  And the change is staged as shown

Scenario: STAGE-005.4 Discard says that it will save
  Given "app.ts" is open in a tab with unsaved edits
  When I click "Discard Change" on a change covering lines 20 to 22
  Then the dialog adds "app.ts has unsaved changes; they are saved first."
  And "Cancel" leaves the tab unsaved and the file untouched
  And "Discard Change" saves the tab, restores lines 20 to 22, and the tab shows the result with no unsaved edits

Scenario: STAGE-005.5 Typed more since the comparison was opened
  Given the comparison was opened from the tab of "app.ts" and I then typed 3 more lines in that tab
  When I click "Stage Change" in the comparison
  Then nothing is staged and the tab is not saved
  And the comparison reloads with the tab's current text
  And a message says "app.ts changed since this comparison was loaded. It was reloaded: check the change and try again."

Scenario: STAGE-005.6 Unsaved edits in other files are left alone
  Given "other.ts" has unsaved edits in its tab
  When I stage or discard a change of "app.ts"
  Then "other.ts" is not saved
```

## STAGE-006: Line endings, encoding and the end of the file are preserved

- Status: draft
- Commands: none
- Files:
  - `src-tauri/src/git/staging.rs` — `build_patch` (pure: works on bytes, lines split on `\n` keeping any `\r`, `\ No newline at end of file` markers, hunk header counts), `worktree_as_git` (the working file after git's own line-ending conversion, read from `git diff-files` with the whole file as context, so nothing is written to the repository), `apply` (`git apply --whitespace=nowarn`), the binary / UTF-16 and mixed-line-ending refusals
  - `src/lib/gitHunks.ts` — line ranges only; never sends text to be written
- Tests: `src-tauri/src/git/staging.rs`
- Docs: none

**As a** developer on Windows whose files use CRLF or a legacy encoding
**I want** partial staging to change only the lines I chose
**So that** a staged change never turns into a whole-file line-ending or encoding change

```gherkin
Scenario: STAGE-006.1 A CRLF file committed with CRLF
  Given "win.txt" is committed with CRLF line endings and has changes at lines 3 and 20
  When I stage the change at line 3
  Then "git diff --cached" shows only the lines of that change, not every line of the file
  And the staged version still has CRLF on every line
  And "win.txt" on disk is byte for byte what it was

Scenario: STAGE-006.2 CRLF on disk, LF in the repository
  Given a repository with "core.autocrlf" set to "true" where "win.txt" has CRLF on disk and LF in the last commit
  When I stage one of its 3 changes and discard another
  Then "git diff --cached" shows only the staged change, with LF line endings in the index
  And "git diff" shows only the remaining change
  And every line of "win.txt" on disk still ends with CRLF

Scenario: STAGE-006.3 Selected lines in a CRLF file
  Given a change adding lines 10 to 15 to the CRLF file "win.txt"
  When I stage lines 11 to 12
  Then exactly those 2 lines are staged and no other line is reported as changed

Scenario: STAGE-006.4 No newline at the end of the file
  Given "app.ts" has no final newline and its last line is changed
  When I stage that change
  Then the staged version also has no final newline
  And "git diff" reports no remaining difference for that line

Scenario: STAGE-006.5 A final newline was added or removed
  Given the only change at the end of "app.ts" is that a final newline was added
  When I stage that change
  Then the staged version ends with the newline and "git diff" shows nothing left for it

Scenario: STAGE-006.6 A file that is not UTF-8
  Given "latin.txt" is saved as Windows-1252 and a changed line contains "café"
  When I stage that change
  Then the staged bytes of that line are the file's own bytes, not a UTF-8 re-encoding
  And a UTF-8 file with a byte order mark keeps the mark when its first line is staged or discarded

Scenario: STAGE-006.7 Change on the first or the last line
  Given changes on line 1 and on the last line of a 200-line file
  When I stage one and discard the other
  Then both actions succeed, with no "patch does not apply" error

Scenario: STAGE-006.8 A file git treats as binary
  Given "wide.txt" is saved as UTF-16, which git treats as a binary file
  When I click "Stage Change" or "Unstage Change" in its comparison
  Then nothing is staged or unstaged and a message says only the whole file can be staged, unstaged or discarded
  And its comparison shows no change bars and no selected-lines buttons in the first place (they could only refuse); the whole file is staged from the Source Control list
```

## STAGE-007: Where partial staging is offered

- Status: draft
- Commands: `git.stageChange`, `git.unstageChange`, `git.discardChange`, `git.stageLines`, `git.unstageLines`, `git.discardLines`
- Files:
  - `src/lib/git.ts` — `openChange` (conflict and untracked open the file; index `A` + worktree `M` now compares)
  - `src/lib/gitStaging.ts` — `changeSources` ("(staged)" ↔ working copy, deleted file → `whole`), `canApply` / `fits` (the rule shared by the bars, toolbar and commands), `wholeFile` (a deleted file's change buttons = the row's actions), `applying` (one action at a time)
  - `src/lib/gitStatus.ts` — `kindOf` (which rows compare, which just open)
  - `src/lib/diff.ts` — `DiffSession.git`, `DiffSession.swapped` (set by `swapDiff`)
  - `src/components/DiffView.tsx` — bars and toolbar buttons shown only for a Source Control comparison that is not swapped; disabled while `useGit().busy`
  - `src/lib/gitCommands.ts` — `enabled` rules of the six commands
- Tests: `src/__tests__/gitStaging.test.tsx`
- Docs: `docs/git.md`, `docs/compare.md`

**As a** developer
**I want** the partial-staging controls to appear only where they can work
**So that** I am never offered an action that would do something other than it says

```gherkin
Scenario: STAGE-007.1 Other comparisons have no staging controls
  Given a Compare tab opened with Compare with Last Commit (HEAD), from a commit's file list, from file history, from a stash, from a comparison of two commits, or of two files
  When I look at its changes and toolbar
  Then there are no Stage, Unstage or Discard controls
  And the six partial-staging commands are greyed out in the menu and left out of the palette

Scenario: STAGE-007.2 Conflicted files
  Given "app.ts" is under Merge Changes with conflicts
  When I click its row
  Then the file itself opens with the conflict bars, not a comparison
  And no partial-staging control or command can stage any part of it; marking it resolved stays the only way to stage it

Scenario: STAGE-007.3 Untracked files
  Given an untracked file "notes.txt" under Changes
  When I click its row
  Then the file itself opens and there are no partial-staging controls; "Stage" (+) on the row stages it whole

Scenario: STAGE-007.4 A staged new file that was edited again
  Given "new.ts" was added with "git add", never committed, and then edited in 2 places
  When I click its row under Changes
  Then a Compare tab "new.ts (staged)" ↔ "new.ts" opens with 2 changes, each with "Stage Change" and "Discard Change"

Scenario: STAGE-007.5 A deleted file
  Given "old.ts" was deleted from the folder and its comparison shows "old.ts (HEAD)" ↔ "old.ts (deleted)" with one change
  When I click "Stage Change"
  Then the deletion is staged, as with "Stage" (+) on the row
  And "Discard Change" asks the file-level question of GIT-012 and, once confirmed, puts the file back
  And the selected-lines buttons are disabled

Scenario: STAGE-007.6 Swapped sides
  Given a Source Control comparison where I clicked "Swap sides"
  When I look at the changes and the toolbar
  Then the change bars and the selected-lines buttons are hidden and the commands are greyed out
  And swapping back brings them back

Scenario: STAGE-007.7 While git is busy
  Given a commit, pull or other git action is in progress
  When I look at a Source Control comparison
  Then the bar buttons and selected-lines buttons are disabled
  And clicking twice quickly on "Stage Change" stages that change once

Scenario: STAGE-007.8 Nothing left to act on
  Given a Source Control comparison that reads "No differences"
  When I open the Git menu
  Then all six partial-staging commands are greyed out

Scenario: STAGE-007.9 The copy arrows are unchanged
  Given a comparison from Changes whose right side is the file on disk
  When I press the mouse button on a change's arrow between the sides
  Then the left side's lines are copied into the right side as an unsaved, undoable edit, as in DIFF-011
  And nothing is staged or discarded in git

Scenario: STAGE-007.10 During a merge or rebase, for files without conflicts
  Given a rebase stopped on a conflict in "a.ts" and "b.ts" has ordinary unstaged changes
  When I open the comparison of "b.ts" from Changes
  Then its changes can be staged and discarded as usual
```

## STAGE-008: Partial staging from the menu, the palette and the keyboard

- Status: draft
- Commands: `git.stageChange`, `git.unstageChange`, `git.discardChange`, `git.stageLines`, `git.unstageLines`, `git.discardLines`
- Files:
  - `src/lib/gitCommands.ts` — registers the six commands (titles, `Ctrl+K S` / `Ctrl+K U` / `Ctrl+K L` / `Ctrl+K N`, `enabled` from the active Compare tab); each calls the same `gitStaging.ts` action as its button
  - `src/components/MenuBar.tsx` — Git › Stage Part of a File submenu, directly after Stage Current File / Unstage Current File (group 5 of the planned Git menu, `specs/git-merge-rebase.md` Decisions)
  - `src/components/DiffView.tsx` — `changeAtCursor`, `selectedLines` for a tab (what the commands act on); button tooltips show the shortcuts
  - `src/lib/gitStaging.ts` — `stageHunk`, `unstageHunk`, `discardHunk`, `stageLines`, `unstageLines`, `discardLines` (the only entry points; all guards live here), `changeAtCursor`
- Tests: `src/__tests__/gitStaging.test.tsx`
- Docs: `docs/git.md`, `docs/keyboard-shortcuts.md`

**As a** developer who works from the keyboard
**I want** every partial-staging action as a command with the same guards as its button
**So that** I can stage while reviewing with F7 and no route skips a confirmation

```gherkin
Scenario: STAGE-008.1 The commands are in the Git menu and the palette
  When I open Git › Stage Part of a File
  Then I find "Stage Change at Cursor", "Unstage Change at Cursor", "Discard Change at Cursor…", "Stage Selected Lines", "Unstage Selected Lines" and "Discard Selected Lines…"
  And the command palette lists the ones that apply to the active comparison at the moment

Scenario: STAGE-008.2 Review and stage with the keyboard
  Given a comparison from Changes with 3 changes
  When I press F7 to move to the second change and then Ctrl+K S
  Then the second change is staged and the toolbar reads "2 changes"
  And the keyboard focus is still in the comparison, so F7 moves on to the next change

Scenario: STAGE-008.3 Selected lines with the keyboard
  Given I selected lines 11 to 12 of an added block with Shift+Down
  When I press Ctrl+K L
  Then those 2 lines are staged
  And in a staged comparison Ctrl+K U unstages the change at the cursor and Ctrl+K N the selected lines

Scenario: STAGE-008.4 Discard from the palette asks the same question
  Given the cursor is in a change covering lines 20 to 22
  When I run "Discard Change at Cursor…" from the palette or the Git menu
  Then the "Discard this change?" dialog of STAGE-003.1 appears with "Cancel" as the default
  And nothing is discarded unless I click "Discard Change"

Scenario: STAGE-008.5 Discard has no keyboard shortcut
  When I look at the Discard commands in the menu and the palette
  Then neither shows a shortcut

Scenario: STAGE-008.6 Commands that do not fit the comparison are greyed out
  Given a comparison opened from Changes
  When I open the Git › Stage Part of a File submenu
  Then the two Unstage commands are greyed out
  And in a comparison opened from Staged Changes only the two Unstage commands are available

Scenario: STAGE-008.7 The cursor is not in a change
  Given the cursor is on an unchanged line with nothing selected
  When I press Ctrl+K S
  Then nothing is staged and a notification says "Stage Change at Cursor is not available here"
  And "Stage Change at Cursor" and "Stage Selected Lines" are greyed out in the menu

Scenario: STAGE-008.8 Not on a Compare tab
  Given the active tab is a text tab, a terminal or the commit graph
  When I press Ctrl+K S or Ctrl+K U
  Then nothing is staged or unstaged (a notification says the command is not available here)
  And the six commands are greyed out in the menu and left out of the palette

Scenario: STAGE-008.9 Commands save first too
  Given the file's tab has unsaved edits
  When I run "Stage Change at Cursor" from the palette
  Then the tab is saved first, exactly as with the button (STAGE-005.1)

Scenario: STAGE-008.10 Shortcuts do not collide
  When I look at the shortcut list
  Then Ctrl+K S, Ctrl+K U, Ctrl+K L and Ctrl+K N belong to these commands only
  And Ctrl+K M still switches the language mode
```

## STAGE-009: The comparison stays true to the index

- Status: draft
- Commands: none
- Files:
  - `src/lib/gitStaging.ts` — `refreshChangeTabs` (after every git action: re-reads the sides of every clean Source Control comparison), `reloadChange` (sides and labels from git and the disk; the view is rebuilt only when something changed), the stale route (`STALE`, `staleMessage`)
  - `src/lib/git.ts` — `onGitAction` (called at the end of `run`, so `stage` / `unstage` / `discard` / `commit` and the rest refresh the comparisons)
  - `src/lib/diff.ts` — `reloadDiff` (a session with `git` goes to `reloadChange`), `patchDiff`
  - `src/components/DiffView.tsx` — keeps the cursor line, the first visible line and the focus across a refresh
  - `src-tauri/src/git/staging.rs` — `apply_lines` takes the hashes of the two texts shown (`Expected`, `text_hash`) and refuses with a `quarry-stale` error before touching anything; `git apply --check` first so a patch is applied whole or not at all
  - `src/lib/gitStatus.ts` — `gitErrorText` for any other failure
- Tests: `src/__tests__/gitStaging.test.tsx`, `src-tauri/src/git/staging.rs`
- Docs: `docs/compare.md`

**As a** developer who also uses the panel, the terminal and other tools on the same repository
**I want** the comparison to show the current index and to refuse to act on an outdated picture
**So that** the lines that get staged or discarded are always the ones I was looking at

```gherkin
Scenario: STAGE-009.1 The index changed outside Quarry
  Given the comparison of "app.ts" is open and I then ran "git add app.ts" in a terminal
  When I click "Stage Change" in the comparison
  Then nothing is staged or unstaged by Quarry
  And the comparison reloads and a message says "app.ts changed since this comparison was loaded. It was reloaded: check the change and try again."

Scenario: STAGE-009.2 The file changed on disk
  Given the comparison's right side is the file "app.ts" and another program rewrote the file since
  When I click "Discard Change" and confirm
  Then the file is not modified by Quarry, the comparison reloads, and the same message is shown

Scenario: STAGE-009.3 Staging from the panel refreshes the comparison
  Given the comparison "app.ts (HEAD)" ↔ "app.ts" is open with 3 changes
  When I click "Stage" (+) on the row of "app.ts" in the panel
  Then the comparison shows "app.ts (staged)" on the left and reads "No differences" without my reloading

Scenario: STAGE-009.4 Both comparisons of one file stay in step
  Given the comparisons of "app.ts" from Changes and from Staged Changes are both open
  When I stage a change in the first
  Then the second, "app.ts (HEAD)" ↔ "app.ts (staged)", shows that change when I switch to it

Scenario: STAGE-009.5 After a commit
  Given a comparison from Staged Changes of "app.ts"
  When I commit the staged changes
  Then that comparison reads "No differences"
  And a comparison from Changes of the same file has "app.ts (HEAD)" on the left again

Scenario: STAGE-009.6 Reload reads git again
  Given a Source Control comparison and a change to the index made outside Quarry
  When I click "Reload the files from disk"
  Then the left side shows what is staged now and the changes are recalculated

Scenario: STAGE-009.7 A comparison with unsaved edits is not refreshed under me
  Given I typed in the right side of a comparison from Changes and have not saved
  When the file is staged from the panel
  Then my unsaved text in the comparison is kept and the side is still tagged "edited"

Scenario: STAGE-009.8 All or nothing
  Given a selection across 3 changes
  When staging them fails for any reason
  Then none of the 3 is staged, an error is shown without git's "hint:" lines, and the comparison is reloaded

Scenario: STAGE-009.9 The file was closed, renamed or deleted meanwhile
  Given a comparison from Changes whose file was deleted from disk after it was opened
  When I click "Stage Change"
  Then nothing is staged and the message says the file changed since the comparison was loaded
  And the reloaded comparison shows "app.ts (deleted)" on the right

Scenario: STAGE-009.10 Clicking the row again shows the open comparison
  Given the comparison of "app.ts" from Changes is open in a tab
  When I click "app.ts" under Changes again
  Then that tab is shown, brought up to date, and no second comparison opens
```
