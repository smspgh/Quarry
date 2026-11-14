---
area: Stash
prefix: STASH
---

# Stash

Putting uncommitted work aside and bringing it back: Stash Changes, the Stashes section of the Source Control panel (see, apply, pop, drop), a stash that conflicts when it comes back, and stashes as nodes in the commit graph. Roadmap item 2 in `GIT-ROADMAP.md`; user documentation is in `docs/git.md`.

Decisions (taken where the roadmap left the choice open):

- **Owner decisions (2026-11-13).** The unsaved-tabs question (Save All / Continue Without Saving / Cancel) is specified once, in SAFE-001 to SAFE-003 (stashing: SAFE-003.6; applying or popping: SAFE-003.7), and arrives with that area; nothing in this area asks about unsaved tabs. Until then a stash simply takes the files as they are on disk and unsaved text stays in its tab.
- **Where.** A **Stashes** section sits in the Source Control panel between the change sections and Commits. It is always there once the repository has a commit (so the feature can be found), with a one-line note when there are no stashes. All stashes are listed, newest first, with no paging.
- **Asking for the message.** Stash Changes opens a small form at the top of the Stashes section (message box, untracked option, Stash / Cancel), like the Add Remote form; there is no text-input dialog in Quarry and none is added. The message is optional; without one git's own "WIP on main: …" subject is kept and shown as "WIP at 1a2b3c4 Fix tab order".
- **What a stash takes.** Staged and unstaged changes to tracked files, always. **Include untracked files** is a checkbox that starts ticked every time the form opens, because Quarry lists untracked files under Changes and leaving them behind would surprise; it is hidden when there are no untracked files. Ignored files are never stashed. Stashing only some files, only staged changes, or "keep staged" are not part of this area.
- **Coming back.** Apply and Pop do not restore what was staged: a stashed modification comes back under Changes, unstaged. Pop does not ask (the work goes into the files, nothing is lost); **Drop asks**, with Cancel as the default.
- **Which stash.** Every action names its stash by commit id, not by `stash@{n}`, so a list that went stale (a stash made in a terminal) can never make Quarry apply or drop the wrong one.
- **A pop that conflicts.** git keeps the stash and records no operation, so Quarry remembers it itself (in memory, never in `.git`): the files go to Merge Changes and through the existing conflict bars, a badge **Stash conflicts** shows beside the branch (where the stopped-operation badge shows, after the "Merge or Rebase" button of MERGE-003), the stash's row says "applied with conflicts", and when the last file is resolved Quarry offers to drop the stash (**Keep Stash** is the default). An Apply that conflicts looks the same but ends without the offer. Nothing is committed for the user. The badge, the graph strip and the bars' note show whenever files are in conflict with no operation in progress (nothing else leaves that state), so they are still there after a restart; only the row's mark and the drop offer are forgotten.
- **No Abort for a stash conflict.** git has no `stash pop --abort`, and the only general undo (`reset --merge`) could discard other work. The ways out are per file ("Current" on the row keeps the file as it was) and the stash is never lost. Messages for a stash conflict must not mention Abort.
- **When it is off.** Stash Changes, Apply and Pop are disabled while a merge, rebase, cherry-pick, revert or patch series is stopped, or while any file is in conflict. Looking at a stash and dropping one still work. The sentence "Finish or abort the rebase first" is the shared `finishFirst(operation)` of `src/lib/gitStatus.ts` (see MERGE-003): no full stop as a tooltip, a full stop as a notification.
- **Graph.** Stashes show only in *All branches*: one node per stash on its base commit with a "stash" label; git's helper commits (the staged snapshot, the untracked-files snapshot) are hidden. A stash row always sits directly above the commit it was made on (it is put there, not found by walking the history, so paging counts commits only); that commit is shown even when no branch reaches it any more. A stash node's right-click menu has only Apply / Pop / Drop / Copy, never the commit actions: none of the entries other specs add to the commit menu (merge, rebase, compare, edit history, Summarise with Claude) appears on a stash row, and a right-click on its "stash" label opens this same menu, not the ref-label menu of MERGE-002. A stash row cannot be picked for Compare Commits (COMMITCMP-001). Search All History does not cover stashes.
- **All or nothing (built 2026-11-13).** git itself does not apply a stash that holds untracked files all-or-nothing: it restores the untracked files it can and then gives up on a tracked file with changes of its own, or applies the tracked changes and then gives up on an untracked file that is in the way, leaving half the stash in the folder. Quarry checks both before git runs, for such a stash, and refuses in the same words, so "nothing in my files changes" (STASH-006.6, STASH-006.7, STASH-007.4) is true. Stashing with untracked files runs git without `--literal-pathspecs` (with it, git stashes the untracked files but leaves them in the folder).
- **Commands.** `git.stash`, `git.stashApply`, `git.stashPop`, `git.stashDrop`, `git.showStashes`, in the palette and in a Git › Stash submenu, which sits after Stage Part of a File in the Git menu (the planned layout of the whole menu is in `specs/git-merge-rebase.md`, Decisions); the three "latest stash" commands go through exactly the same guards as the row buttons. Stash Changes… and Show Stashes are greyed out only without a repository, the three "latest stash" commands also without a stash; none is greyed out while a stash cannot run (a stopped operation, conflicts, nothing to stash): running it then says why. No keyboard shortcuts. There is no Drop All.

## STASH-001: Stash uncommitted changes

- Status: draft
- Commands: `git.stash`
- Files:
  - `src/components/panels/StashSection.tsx` — `StashesSection` (section head with the Stash Changes… button), `StashForm` (message box, Stash / Cancel, Enter / Escape)
  - `src/components/panels/GitPanel.tsx` — renders `StashesSection` between the change sections and `CommitsSection`
  - `src/lib/git.ts` — `stashChanges(root, message, untracked)` (busy label "Stashing…", notification, `checkExternalChanges`), `showStashForm()`, `useGit.stashForm`
  - `src/lib/gitStash.ts` — pure: `stashTitle` (git's subject → what is shown), `stashDone` (notifications)
  - `src/lib/gitCommands.ts` — `git.stash`
  - `src-tauri/src/git.rs` — `stash_push` / `git_stash_push` (`stash push [--include-untracked] [--message=<message>]`; "nothing to stash" is an error), `git_stash` (the command without `--literal-pathspecs`)
  - `src-tauri/src/lib.rs` — the four `git_stash_*` commands in the invoke handler
  - `src/lib/gitApi.ts` — `git.stashPush`
- Tests: `src/__tests__/gitStash.test.ts`, `src/__tests__/stashSection.test.tsx`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer who has to switch to something else in the middle of a change
**I want** to put my uncommitted changes aside under a name
**So that** my files are clean again and I can bring the work back later

```gherkin
Scenario: STASH-001.1 Open the form
  Given a repository on "main" with 3 changed files
  When I click "Stash Changes…" on the Stashes section heading
  Then a form opens at the top of the Stashes section with an empty message box that has the focus, a "Stash" button and a "Cancel" button
  And the placeholder of the message box reads "Stash message (optional)"

Scenario: STASH-001.2 Stash with a message
  Given 2 files under Changes and 1 file under Staged Changes
  And the form's message box contains "WIP parser"
  When I click "Stash"
  Then Staged Changes and Changes are empty and the panel says "No uncommitted changes."
  And the Stashes section lists "WIP parser" first
  And a notification says "Stashed 3 files: WIP parser"
  And the form is closed

Scenario: STASH-001.3 Enter stashes, Escape cancels
  Given the form is open with "WIP parser" in the message box
  When I press Enter in the message box
  Then the changes are stashed as "WIP parser"
  And pressing Escape instead closes the form and stashes nothing

Scenario: STASH-001.4 No message
  Given the form's message box is empty and the last commit on "main" is 1a2b3c4 "Fix tab order"
  When I click "Stash"
  Then the changes are stashed
  And the new stash is listed as "WIP at 1a2b3c4 Fix tab order"

Scenario: STASH-001.5 Open tabs follow the files
  Given "app.ts" is changed, saved and open in a tab
  When I stash my changes
  Then the tab of "app.ts" shows the committed text without asking
  And its change markers in the gutter are gone

Scenario: STASH-001.6 Cancel
  Given the form is open
  When I click "Cancel"
  Then the form closes, no stash is made and my changes are still listed

Scenario: STASH-001.7 git refuses
  Given git fails to create the stash
  When I click "Stash"
  Then an error shows git's message without its "hint:" lines
  And my changes are still listed and the form stays open with my message
```

## STASH-002: Choose whether untracked files go into the stash

- Status: draft
- Commands: `git.stash`
- Files:
  - `src/components/panels/StashSection.tsx` — "Include untracked files (N)" checkbox of the form (starts ticked, hidden with no untracked files), Stash button disabled state
  - `src/lib/gitStash.ts` — `stashCounts` (tracked / untracked files a stash would take, from the status)
  - `src/lib/git.ts` — `stashChanges` passes the choice
  - `src-tauri/src/git.rs` — `stash_push` (`--include-untracked` only when asked; never `--all`)
- Tests: `src/__tests__/gitStash.test.ts`, `src/__tests__/stashSection.test.tsx`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer whose change includes new files git does not track yet
**I want** to choose whether those files are stashed too
**So that** the stash holds the whole change, or leaves my scratch files where they are

```gherkin
Scenario: STASH-002.1 The option is on by default
  Given 2 modified files and 2 untracked files "notes.txt" and "draft.ts"
  When I open the stash form
  Then it has a ticked checkbox "Include untracked files (2)"

Scenario: STASH-002.2 Untracked files are stashed
  Given the checkbox is ticked
  When I click "Stash"
  Then "notes.txt" and "draft.ts" are no longer in the folder and no file is listed under Changes
  And a notification says "Stashed 4 files"

Scenario: STASH-002.3 Untracked files are left alone
  Given I untick "Include untracked files (2)"
  When I click "Stash"
  Then the 2 modified files are stashed
  And "notes.txt" and "draft.ts" are still in the folder and still listed under Changes with the letter "U"
  And a notification says "Stashed 2 files"

Scenario: STASH-002.4 No untracked files, no option
  Given 3 modified files and no untracked files
  When I open the stash form
  Then there is no "Include untracked files" checkbox

Scenario: STASH-002.5 Only untracked files, option off
  Given the only changes are 2 untracked files
  When I untick "Include untracked files (2)"
  Then the "Stash" button is disabled
  And a note says "Only untracked files have changed: tick the box to stash them."

Scenario: STASH-002.6 The option starts ticked again next time
  Given I unticked the checkbox and stashed
  When I open the stash form again with untracked files present
  Then the checkbox is ticked

Scenario: STASH-002.7 Ignored files are never stashed
  Given "build\out.log" is ignored by .gitignore and exists
  When I stash with the checkbox ticked
  Then "build\out.log" is still in the folder
```

## STASH-003: Guards before stashing

- Status: draft
- Commands: `git.stash`
- Files:
  - `src/lib/gitStash.ts` — `stashBlocked` (why Stash Changes / Apply / Pop cannot run now: no commit yet, a stopped operation, conflicted files, nothing to stash; the sentence shown)
  - `src/lib/git.ts` — `stashChanges` (checks `stashBlocked` on a fresh status before anything runs; the unsaved-tabs question is not part of this story: SAFE-003.6 adds it to this function later)
  - `src/components/panels/StashSection.tsx` — disabled Stash Changes button with the reason as tooltip, disabled while `busy`
  - `src/lib/gitCommands.ts` — `git.stash` gives the same reason as a notification
  - `src/lib/gitStatus.ts` — `finishFirst(operation)` (the shared sentence naming the stopped operation, on `operationWords`; shared with MERGE-003)
  - `src-tauri/src/git.rs` — `stash_push` (refuses before the first commit)
- Tests: `src/__tests__/gitStash.test.ts`, `src/__tests__/stashSection.test.tsx`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer
**I want** Quarry to stop a stash that cannot work and to say why
**So that** I never believe work was stashed when it was not

```gherkin
Scenario: STASH-003.1 Nothing to stash
  Given a repository with no uncommitted changes
  When I look at the Stashes section
  Then the "Stash Changes…" button is disabled and its tooltip says "There are no uncommitted changes to stash"

Scenario: STASH-003.2 Not during a stopped operation
  Given a rebase stopped on a conflict
  When I look at the Stashes section
  Then "Stash Changes…" is disabled and its tooltip says "Finish or abort the rebase first"

Scenario: STASH-003.3 Not while files are in conflict
  Given 1 file is under Merge Changes and no operation is in progress
  When I look at the Stashes section
  Then "Stash Changes…" is disabled and its tooltip says "Resolve the conflicts first"

Scenario: STASH-003.4 Disabled while git is busy
  Given another git action is running
  When I look at the Stashes section
  Then "Stash Changes…" and the form's "Stash" button are disabled until it finishes

Scenario: STASH-003.5 A repository with no commits
  Given a repository with changed files and no commits yet
  When I open the Source Control panel
  Then there is no Stashes section
  And running "Stash Changes…" from the command palette says "Make a first commit before stashing." and stashes nothing
```

## STASH-004: See the stashes of the repository

- Status: draft
- Commands: `git.showStashes`
- Files:
  - `src/components/panels/StashSection.tsx` — `StashesSection` (count in the heading, rows with title, branch and age, row buttons Apply / Pop / Drop, empty note)
  - `src/lib/git.ts` — `stashes` per repository in `useGit`, `loadStashes`, `stashAfterRefresh` (reloads a list when the status's stash id or count changes), `showStashes` (`useGit.stashReveal`)
  - `src/lib/gitStash.ts` — `stashTitle` ("On main: WIP parser" → "WIP parser" + branch "main"; "WIP on main: 1a2b3c4 Fix tab order" → "WIP at 1a2b3c4 Fix tab order" + branch "main"), `stashWhere`
  - `src-tauri/src/git.rs` — `stash_list` / `git_stash_list` (`stash list -z --format=…`: commit id, parents, author, time, subject), `GitStash`, `stash_ids`; `status` gains the newest stash's id and the number of stashes (`GitStatus.stash`, `stash_count`)
  - `src/lib/gitApi.ts` — `GitStash`, `git.stashList`, `GitStatus.stash` / `stashCount`
  - `src/editor/git.ts` — `relativeTime`
  - `src/lib/gitCommands.ts` — `git.showStashes`
  - `src/styles/app.css` — `.scm-stash*`
- Tests: `src/__tests__/gitStash.test.ts`, `src/__tests__/stashSection.test.tsx`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer who stashed work earlier
**I want** to see my stashes in the Source Control panel
**So that** I remember they exist and can pick the right one

```gherkin
Scenario: STASH-004.1 Where the section is
  Given a repository with at least one commit
  When I open the Source Control panel
  Then a "Stashes" section shows below Changes and above Commits

Scenario: STASH-004.2 The list
  Given 3 stashes: "WIP parser" made on "main" 2 hours ago, "try new layout" made on "feature" yesterday, and one without a message
  When I look at the Stashes section
  Then its heading shows the count 3
  And the stashes are listed newest first
  And the first row shows "WIP parser" with "main · 2 hours ago" under it

Scenario: STASH-004.3 A stash without a message
  Given a stash made without a message when the last commit was 1a2b3c4 "Fix tab order"
  When I look at its row
  Then it reads "WIP at 1a2b3c4 Fix tab order"

Scenario: STASH-004.4 No stashes
  Given a repository with commits and no stashes
  When I look at the Stashes section
  Then it says "No stashes. Stash Changes puts your uncommitted work aside to bring back later."
  And the heading shows no count

Scenario: STASH-004.5 Row buttons
  When I hover a stash row
  Then it shows the buttons "Apply", "Pop" and "Drop"
  And the row's tooltip gives the full message, the branch it was made on, its date and the commit it was made on

Scenario: STASH-004.6 A stash made outside Quarry appears
  Given I run "git stash" in a terminal
  When the Quarry window gets focus again
  Then the new stash is in the list

Scenario: STASH-004.7 Collapse
  When I click the "Stashes" heading
  Then the list closes, and clicking it again opens it

Scenario: STASH-004.8 Show Stashes command
  Given the Source Control panel is closed
  When I run "Show Stashes" from the command palette
  Then the panel opens with the Stashes section open and the focus on its first row

Scenario: STASH-004.9 The section follows the repository
  Given the panel shows repository "app" with 2 stashes
  When I switch the panel to repository "tools", which has none
  Then the Stashes section shows the empty note, not the stashes of "app"
```

## STASH-005: See what a stash holds

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/StashSection.tsx` — expanding a row to its files (same row markup as `CommitsSection`'s files), click / Enter / double-click
  - `src/lib/git.ts` — `openStashFile` (base commit vs stash, `preview` Compare tab like `openCommitFile`; an untracked file is read from `<stash>^3`)
  - `src/lib/gitStatus.ts` — `commitFileKind` (status "?" = an untracked file of a stash), `KIND_LETTER` (it shows "U")
  - `src-tauri/src/git.rs` — `stash_files` / `git_stash_files` (`diff --name-status -z -M <id>^1 <id>` through `parse_commit_files`, then the untracked files from `stash_untracked` = the tree of `<id>^3`, with status "?"), `show` (a stashed untracked file is read with the revision `<id>^3`)
  - `src/lib/gitApi.ts` — `git.stashFiles`
  - `src/lib/diff.ts` — `openCompare`
  - `src/lib/ipc.ts` — `fs.exists` (double-click opens only a file that is in the folder)
- Tests: `src/__tests__/stashSection.test.tsx`, `src/__tests__/gitStash.test.ts`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer deciding which stash to bring back
**I want** to see the files a stash holds and what it changed in each
**So that** I do not have to apply it to find out

```gherkin
Scenario: STASH-005.1 Expand a stash to its files
  Given a stash "WIP parser" that modified "app.ts", added "lexer.ts" and deleted "old.ts"
  When I click its row
  Then its files are listed under it with the letters M, A and D
  And clicking the row again closes the list

Scenario: STASH-005.2 Untracked files are listed too
  Given a stash made with "Include untracked files" that holds the untracked file "notes.txt"
  When I expand it
  Then "notes.txt" is listed with the letter "U"

Scenario: STASH-005.3 See what the stash changed in a file
  Given the expanded stash 4f5e6d7 was made on commit 1a2b3c4 and holds "app.ts"
  When I click "app.ts"
  Then a Compare tab opens with "app.ts @ 1a2b3c4" on the left and "app.ts @ stash 4f5e6d7" on the right
  And both sides are read-only
  And it is a preview tab that the next such click replaces

Scenario: STASH-005.4 A new or untracked file
  When I click "lexer.ts" or "notes.txt" in the expanded stash
  Then the Compare tab's left side is empty and the right side is the stashed file

Scenario: STASH-005.5 Looking changes nothing
  Given I have uncommitted changes
  When I expand a stash and open its files
  Then my files, the staged changes and the stash list are unchanged

Scenario: STASH-005.6 Open the file as it is now
  When I double-click a file of the stash that exists in the folder
  Then the file itself opens in a tab
  And double-clicking a file that is not in the folder opens nothing

Scenario: STASH-005.7 A binary file
  Given the stash holds "logo.png"
  When I click it
  Then no tab opens and a notification says "This file is binary."

Scenario: STASH-005.8 Available while actions are off
  Given a rebase stopped on a conflict
  When I click a stash row and then a file in it
  Then the files are listed and the Compare tab opens as usual
```

## STASH-006: Apply a stash and keep it

- Status: draft
- Commands: `git.stashApply`
- Files:
  - `src/lib/git.ts` — `stashAction(root, stash, "apply" | "pop" | "drop")` (guards on a fresh status, notification, `checkExternalChanges`; the unsaved-tabs question is added to apply / pop by SAFE-003.7, not here), `stashRun` (busy label, refusal as a notification, reloads the list)
  - `src/lib/gitStash.ts` — `stashBlocked`, `stashDone`, `stashErrorText` (git's "would be overwritten" / "already exists" output → a sentence naming the files and what to do)
  - `src/components/panels/StashSection.tsx` — "Apply" row button, disabled state and tooltip
  - `src/lib/gitCommands.ts` — `git.stashApply` (the newest stash)
  - `src-tauri/src/git.rs` — `stash_op` / `git_stash_op` (finds the stash's current `stash@{n}` from its commit id, then `stash apply`; an id that is no longer a stash is an error; for a stash with untracked files it first refuses, in git's words, an untracked file that already exists or a tracked file with changes of its own, because git would otherwise apply half the stash)
  - `src/lib/gitApi.ts` — `git.stashOp`
- Tests: `src/__tests__/gitStash.test.ts`, `src/__tests__/stashSection.test.tsx`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer
**I want** to bring a stash's changes back into my files while keeping the stash
**So that** I can use the same changes again, for example on another branch

```gherkin
Scenario: STASH-006.1 Apply
  Given no uncommitted changes and a stash "WIP parser" that modified "app.ts" and "store.ts"
  When I click "Apply" on its row
  Then "app.ts" and "store.ts" are listed under Changes with the letter "M"
  And "WIP parser" is still in the Stashes list
  And a notification says "Applied stash: WIP parser. It is still in the list."

Scenario: STASH-006.2 What was staged comes back unstaged
  Given the stash was made while the change to "app.ts" was staged
  When I apply it
  Then "app.ts" is listed under Changes, not under Staged Changes

Scenario: STASH-006.3 Untracked files come back
  Given the stash holds the untracked file "notes.txt"
  When I apply it
  Then "notes.txt" is in the folder again and listed under Changes with the letter "U"

Scenario: STASH-006.4 Open tabs follow the files
  Given "app.ts" is open in a tab without unsaved edits
  When I apply a stash that changes "app.ts"
  Then the tab shows the new text without asking

Scenario: STASH-006.5 Apply on top of other changes
  Given I have an uncommitted change to "readme.md", which the stash does not touch
  When I apply the stash
  Then the stash's changes are added and my change to "readme.md" is untouched

Scenario: STASH-006.6 My changes to the same file are in the way
  Given I have an uncommitted change to "app.ts" and the stash also changes "app.ts"
  When I click "Apply"
  Then nothing in my files changes and the stash is kept
  And an error says "app.ts has uncommitted changes that this stash would overwrite. Commit or stash them first, then apply again."

Scenario: STASH-006.7 An untracked file already exists
  Given the stash holds the untracked file "notes.txt" and a file "notes.txt" is in the folder
  When I click "Apply"
  Then my "notes.txt" is not overwritten and the stash is kept
  And an error names "notes.txt" as already in the folder and says to move or delete it, then apply again

Scenario: STASH-006.8 Not during a stopped operation or with conflicts
  Given a cherry-pick stopped on a conflict
  When I hover a stash row
  Then "Apply" and "Pop" are disabled with the tooltip "Finish or abort the cherry-pick first"
  And "Drop" is enabled

Scenario: STASH-006.9 Disabled while git is busy
  Given another git action is running
  When I hover a stash row
  Then "Apply", "Pop" and "Drop" are disabled until it finishes

Scenario: STASH-006.10 A stale list still acts on the right stash
  Given the list shows "WIP parser" first
  And a newer stash was made in a terminal that the list does not show yet
  When I click "Apply" on "WIP parser"
  Then the changes of "WIP parser" are applied, not those of the newer stash
  And the list reloads and shows both stashes

Scenario: STASH-006.11 The stash is gone
  Given "WIP parser" was dropped in a terminal and the list still shows it
  When I click "Apply" on it
  Then nothing is applied, an error says "That stash no longer exists." and the list reloads without it
```

## STASH-007: Pop a stash

- Status: draft
- Commands: `git.stashPop`
- Files:
  - `src/lib/git.ts` — `stashAction(…, "pop")` (same guards as apply; no confirmation)
  - `src/lib/gitStash.ts` — `stashDone`
  - `src/components/panels/StashSection.tsx` — "Pop" row button
  - `src/lib/gitCommands.ts` — `git.stashPop` (the newest stash)
  - `src-tauri/src/git.rs` — `stash_op` (`stash pop stash@{n}`)
- Tests: `src/__tests__/gitStash.test.ts`, `src/__tests__/stashSection.test.tsx`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer returning to work I put aside
**I want** to bring a stash back and remove it from the list in one step
**So that** finished stashes do not pile up

```gherkin
Scenario: STASH-007.1 Pop
  Given no uncommitted changes and 2 stashes, the first being "WIP parser" with changes to "app.ts" and "store.ts"
  When I click "Pop" on "WIP parser"
  Then "app.ts" and "store.ts" are listed under Changes
  And "WIP parser" is no longer in the Stashes list, whose heading now shows the count 1
  And a notification says "Popped stash: WIP parser"

Scenario: STASH-007.2 Pop does not ask
  When I click "Pop" on a stash that applies cleanly
  Then no confirmation dialog appears

Scenario: STASH-007.3 Pop a stash that is not the newest
  Given 3 stashes
  When I click "Pop" on the third row
  Then that stash's changes are in my files and that stash is the one removed
  And the other 2 stashes are still listed in the same order

Scenario: STASH-007.4 A pop that cannot start keeps the stash
  Given I have an uncommitted change to "app.ts" and the stash also changes "app.ts"
  When I click "Pop"
  Then nothing in my files changes and the stash is still in the list
  And an error says "app.ts has uncommitted changes that this stash would overwrite. Commit or stash them first, then pop again."

Scenario: STASH-007.5 Popping the last stash
  Given exactly 1 stash
  When I pop it
  Then the Stashes section shows its empty note
```

## STASH-008: Drop a stash

- Status: draft
- Commands: `git.stashDrop`
- Files:
  - `src/lib/gitStash.ts` — `dropConfirm` (title, text and button labels of the dialog: stash title, branch, age, file count)
  - `src/lib/git.ts` — `stashAction(…, "drop")` (asks through `choose`, then runs)
  - `src/lib/dialogs.ts` — `choose`
  - `src/components/panels/StashSection.tsx` — "Drop" row button (styled as dangerous), Delete key on a focused row
  - `src/lib/gitCommands.ts` — `git.stashDrop` (the newest stash, same dialog)
  - `src-tauri/src/git.rs` — `stash_op` (`stash drop stash@{n}`, addressed by commit id), `stash_files` (the file count for the dialog)
- Tests: `src/__tests__/gitStash.test.ts`, `src/__tests__/stashSection.test.tsx`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer with stashes I no longer need
**I want** to delete one, after being told exactly what is lost
**So that** the list stays short and I never throw away work by a slip

```gherkin
Scenario: STASH-008.1 Drop asks first
  Given a stash "WIP parser" with 3 files, made on "main" 2 hours ago
  When I click "Drop" on its row
  Then a dialog "Drop this stash?" says that "WIP parser" (3 files, made on main 2 hours ago) will be deleted, that its changes are not in my files or in any commit, and that Quarry cannot bring it back
  And its buttons are "Drop Stash" and "Cancel" (default)

Scenario: STASH-008.2 Drop
  When I click "Drop Stash"
  Then "WIP parser" is no longer in the Stashes list
  And my files and uncommitted changes are untouched
  And a notification says "Dropped stash: WIP parser"

Scenario: STASH-008.3 Cancel
  When I click "Cancel" or press Escape in the dialog
  Then the stash is still in the list and nothing changed

Scenario: STASH-008.4 Enter does not drop
  Given the "Drop this stash?" dialog is open
  When I press Enter
  Then the dialog closes as cancelled and the stash is still in the list

Scenario: STASH-008.5 Delete key
  Given the focus is on a stash row
  When I press Delete
  Then the same "Drop this stash?" dialog appears

Scenario: STASH-008.6 Drop works during a stopped operation
  Given a rebase stopped on a conflict
  When I click "Drop" on a stash and confirm
  Then the stash is dropped and the rebase is still stopped where it was

Scenario: STASH-008.7 The right stash is dropped from a stale list
  Given the list shows "WIP parser" first
  And a newer stash was made in a terminal that the list does not show yet
  When I click "Drop" on "WIP parser" and confirm
  Then "WIP parser" is dropped and the newer stash is still there

Scenario: STASH-008.8 No way to drop every stash at once
  Given 4 stashes
  When I look at the Stashes section heading, the Git menu and the command palette
  Then there is no "Drop All" or "Clear" action
```

## STASH-009: A stash that conflicts when it comes back

- Status: draft
- Commands: `git.stashApply`, `git.stashPop`
- Files:
  - `src/lib/git.ts` — `stashAction` (a conflicted apply / pop is not an error: records `stashPending` { root, stash id, title, pop } in `useGit`, in memory only, and shows Source Control); `stashAfterRefresh` / `settleStash` (offer the drop when a fresh status of that repository has no conflicted file left and the stash still exists); `conflictsCleared` wording (`stashLastFile`); the `note` hook in `installGit` passes the stash sides note to the editor bars; `commit` and `openChange` leave "or abort" out of their messages when no operation is in progress
  - `src/lib/gitStash.ts` — `STASH_CONFLICT` (badge "Stash conflicts", row mark, sides note, last-file sentences, Commit button tooltip), `stashConflictWarning` (notification), `stashConflictStrip` (graph strip), `stashSideTitle` (row button tooltips), `dropOffer` (the offer's title / text / buttons), `isStashConflict` (conflicted files with no operation in progress)
  - `src/lib/gitStatus.ts` — `gitErrorText` must not be used for this case (its text says "press Abort")
  - `src/components/panels/GitPanel.tsx` — "Stash conflicts" badge beside the branch, in the place of the stopped-operation badge (the two never show together; no Abort / Skip buttons), Merge Changes rows' "Current" / "Incoming" tooltips, the Commit button's tooltip
  - `src/components/panels/StashSection.tsx` — "applied with conflicts" mark on the pending stash's row
  - `src/components/GraphView.tsx` — warning strip for conflicted files with no operation in progress (no Abort button), in the place of the stopped-operation strip of GRAPH-014; it stays a strip when GRAPH-015 turns the uncommitted-changes strip into a row
  - `src/editor/conflicts.ts` — conflict bars show the sides note it is given (as for a rebase)
  - `src-tauri/src/git.rs` — `stash_op` reports "conflicts" as a result instead of an error (git failed and unmerged files appeared: `has_unmerged`); test that a conflicted pop keeps the stash
- Tests: `src/__tests__/gitStash.test.ts`, `src/__tests__/stashSection.test.tsx`, `src/__tests__/graphView.test.tsx`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer whose stash no longer fits the files as they are now
**I want** the conflicts shown like any other conflict, and to be told what happens to the stash
**So that** I can finish bringing the work back without losing the stash or leaving it behind by mistake

```gherkin
Scenario: STASH-009.1 A pop that conflicts
  Given "app.ts" was changed and committed after the stash "WIP parser" was made, in the same lines the stash changes
  And the stash also changes "store.ts", which does not conflict
  When I click "Pop" on "WIP parser"
  Then "app.ts" is listed under Merge Changes with the letter "!"
  And the stash's change to "store.ts" is in my files, listed under Staged Changes (git stages what applied cleanly)
  And Source Control is shown
  And a warning says "Stash WIP parser conflicts with your files in 1 file. Resolve it under Merge Changes. The stash is kept until you drop it."
  And the message does not mention Abort

Scenario: STASH-009.2 The stash is kept
  Given a pop stopped on conflicts
  When I look at the Stashes section
  Then "WIP parser" is still listed, marked "applied with conflicts"

Scenario: STASH-009.3 The panel says what is going on
  Given a pop stopped on conflicts
  When I look beside the branch button
  Then a badge "Stash conflicts" shows, whose tooltip says to resolve the files under Merge Changes and that the stash is kept
  And there is no "Abort" and no "Skip" button
  And the Commit button is disabled and reads "Resolve 1 Conflict First"
  And the message box is not filled in

Scenario: STASH-009.4 The conflict bars say which side is which
  When I click "app.ts" under Merge Changes
  Then it opens with its conflict marked and the bar offering Accept Current, Accept Incoming, Accept Both and Compare
  And the bar notes "Stash: Current is your files as they are now, Incoming is the stash."
  And the "Current" and "Incoming" buttons on the Merge Changes row say the same in their tooltips

Scenario: STASH-009.5 Resolving the last file of a pop offers the drop
  Given "app.ts" is the only conflicted file of the pop of "WIP parser"
  When I mark it resolved
  Then a dialog "Conflicts resolved: drop the stash?" says the changes of "WIP parser" are now in my files and the stash itself is still in the list
  And its buttons are "Drop Stash" and "Keep Stash" (default)

Scenario: STASH-009.6 Drop Stash
  When I click "Drop Stash"
  Then "WIP parser" is removed from the Stashes list without a second question
  And the "Stash conflicts" badge is gone

Scenario: STASH-009.7 Keep Stash
  When I click "Keep Stash"
  Then "WIP parser" stays in the list without the "applied with conflicts" mark
  And the badge is gone and I am not asked again

Scenario: STASH-009.8 Nothing is committed for me
  Given I resolved every conflicted file of the pop
  When I look at the panel
  Then the resolved files are under Staged Changes and no commit was made
  And the Commit button has its normal wording again, for example "Commit 1 Staged"

Scenario: STASH-009.9 Save and Mark Resolved does not talk about committing
  Given "app.ts" is the last conflicted file of a pop and I accept a side of its last conflict in the editor
  When the "No conflicts left in app.ts" dialog appears
  Then it says "It is the last file: after this, Quarry offers to drop the stash."
  And it does not say "you can commit to finish"
  And for an Apply, or after a restart, it says "It is the last file: after this the stash's changes are in your files (nothing is committed for you)."

Scenario: STASH-009.10 Keep my version of a file
  Given "app.ts" is under Merge Changes after a pop
  When I click "Current" on its row
  Then "app.ts" is as it was before the pop and is no longer in conflict

Scenario: STASH-009.11 An Apply that conflicts
  When I click "Apply" on a stash that conflicts
  Then the files, the badge and the bars are the same as for a pop
  And the warning ends "The stash stays in the list."
  And resolving the last file does not offer to drop the stash

Scenario: STASH-009.12 The graph tab
  Given a pop stopped with 2 conflicted files
  When I look at the graph tab
  Then a warning strip says "A stash was applied with conflicts: 2 files have conflicts. Resolve them in Source Control."
  And the strip has no "Abort" button

Scenario: STASH-009.13 No new stash, apply or pop until the conflicts are resolved
  Given a pop stopped on conflicts
  When I look at the Stashes section
  Then "Stash Changes…" and every row's "Apply" and "Pop" are disabled with the tooltip "Resolve the conflicts first"

Scenario: STASH-009.14 After restarting Quarry
  Given a pop stopped on conflicts and I close and reopen Quarry
  When I open the Source Control panel
  Then "app.ts" is still under Merge Changes and "WIP parser" is still in the Stashes list, without the "applied with conflicts" mark
  And the "Stash conflicts" badge and the bars' note still show
  And resolving the file does not offer the drop: I drop the stash myself with "Drop"

Scenario: STASH-009.15 Nothing is written into the repository to remember this
  Given a pop stopped on conflicts
  When I look inside the repository's ".git" folder
  Then Quarry has added no file of its own there

Scenario: STASH-009.16 The stash was dropped in the meantime
  Given a pop stopped on conflicts and I dropped "WIP parser" myself with "Drop"
  When I resolve the last conflicted file
  Then no drop dialog appears
```

## STASH-010: Stashes in the commit graph

- Status: draft
- Commands: `git.graph`
- Files:
  - `src-tauri/src/git.rs` — `graph` (with `all`, the commit each stash was made on is added to the revisions; `graph_scope` still excludes `refs/stash`, so a stash's helper commits are never walked and `--skip` / `--max-count` count commits only), `fold_stashes` (puts one row per stash right above its base commit: only parent = the base, `refs` = `refs/stash`, `stash` = true), `GitGraphCommit.stash`
  - `src/lib/gitGraph.ts` — `RefKind` "stash", `refLabels`, `commitMatches` (given the stash's title as its summary), `stashMenu` (the entries a stash node gets), `layoutGraph` unchanged (a stash is a commit with one parent and no children)
  - `src/components/GraphView.tsx` — `RowGraph` (stash dot drawn hollow), `RefBadge` ("stash" label), `GraphMenu` (stash entries instead of commit actions), details pane (files from `git.stashFiles`, `openStashFile` in `DetailFile`), reload when the status's stash id or count changes, paging by commits (`stashRows`)
  - `src/lib/git.ts` — `stashAction`, `openStashFile`
  - `src/lib/gitApi.ts` — `GitGraphCommit.stash`
  - `src/lib/gitStash.ts` — `stashTitle`, `stashBlocked`
  - `src/styles/app.css` — `.graph-ref.stash`, stash dot
  - `src/styles/tokens.css` — colour variable for the stash label, light and dark
- Tests: `src/__tests__/gitGraph.test.ts`, `src/__tests__/graphView.test.tsx`, `src/__tests__/gitStash.test.ts`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer looking at the whole repository in the graph
**I want** each stash drawn on the commit it was made from
**So that** I can see where put-aside work belongs and act on it there

```gherkin
Scenario: STASH-010.1 A stash is a node on its base commit
  Given a stash "WIP parser" made when "main" was on commit 1a2b3c4
  When I open the graph and click "All branches"
  Then a row "WIP parser" with a "stash" label and a hollow dot sits above commit 1a2b3c4, joined to it by a line
  And its author and date columns show who made the stash and when

Scenario: STASH-010.2 One row per stash
  Given the stash holds staged changes and untracked files
  When I look at the graph in "All branches"
  Then the stash is exactly 1 row
  And no row reads "index on main: …" or "untracked files on main: …"

Scenario: STASH-010.3 Not in the current-branch view
  Given the repository has 2 stashes
  When "Current branch" is selected
  Then no stash rows are shown

Scenario: STASH-010.4 A stash on an older commit
  Given a stash made on a commit that now has 5 newer commits on "main" above it
  When I look at the graph in "All branches"
  Then the stash sits in its own lane beside "main", in the row directly above its base commit, and joins it there
  And the commits of "main" stay in the first lane

Scenario: STASH-010.5 Several stashes on one commit
  Given 2 stashes made on the same commit
  When I look at the graph in "All branches"
  Then both are shown as separate rows directly above that commit, newest first, each joined to it

Scenario: STASH-010.6 Details of a stash
  When I click a stash row
  Then the details pane shows its message, date, the commit it was made on as a Parent link, and the files it holds, untracked ones included
  And clicking a file opens the same Compare tab as from the Stashes section

Scenario: STASH-010.7 The right-click menu of a stash
  When I right-click a stash row
  Then the menu offers "Apply Stash", "Pop Stash", "Drop Stash…" and "Copy Message"
  And it does not offer Check Out, Create Branch, Create Tag, Cherry-pick, Revert or any Reset entry

Scenario: STASH-010.8 Actions from the graph use the same guards
  When I choose "Drop Stash…" from a stash row's menu
  Then the "Drop this stash?" dialog appears with "Cancel" as the default
  And "Apply Stash" and "Pop Stash" are disabled while an operation is stopped or files are in conflict

Scenario: STASH-010.9 The graph follows the stash list
  Given the graph shows "All branches"
  When I stash my changes, or pop or drop a stash, from the Source Control panel
  Then the graph reloads and the stash row appears or disappears

Scenario: STASH-010.10 Find
  Given a stash "WIP parser" is among the loaded rows
  When I type "parser" in the graph's find box
  Then the stash row counts as a match and stays bright

Scenario: STASH-010.11 Search All History leaves stashes out
  When I run Search All History for "parser"
  Then the results list only commits, not the stash

Scenario: STASH-010.12 No stashes
  Given a repository with no stashes
  When I look at the graph in "All branches"
  Then the graph is the same as before this feature: every branch and tag, and no stash rows

Scenario: STASH-010.13 A stash on a commit no branch reaches any more
  Given a stash made on a commit that was since reset away from every branch
  When I look at the graph in "All branches"
  Then the stash row is shown above that commit, which is shown too

Scenario: STASH-010.14 Loading more commits
  Given a history of more than 300 commits with 2 stashes among the first 300
  When I scroll to the end of the loaded rows
  Then the next 300 commits are loaded with none left out and none repeated
```

## STASH-011: Stash from the menu and the command palette

- Status: draft
- Commands: `git.stash`, `git.stashApply`, `git.stashPop`, `git.stashDrop`, `git.showStashes`
- Files:
  - `src/lib/gitCommands.ts` — registers the five commands (`enabled()` from the repository and, for the three latest-stash commands, the status's stash count; each `run` goes through `showStashForm` / `stashLatest`, which check `stashBlocked` and then call the same `stashChanges` / `stashAction` the panel uses)
  - `src/components/MenuBar.tsx` — Git › Stash submenu, after Stage Part of a File (group 5 of the planned Git menu, `specs/git-merge-rebase.md` Decisions)
  - `src/lib/git.ts` — `showStashForm` (opens the panel and the form), `showStashes`, `stashLatest` (the newest stash from a fresh list), `stashAction`
  - `src/lib/gitStash.ts` — `stashBlocked`
  - `src/lib/panels.ts` — `showPanel`
- Tests: `src/__tests__/gitStash.test.ts`, `src/__tests__/ui.test.ts`
- Docs: `docs/git.md`

**As a** developer who works from the keyboard
**I want** the stash actions in the Git menu and the command palette
**So that** I can stash and restore without the mouse, with the same protection as in the panel

```gherkin
Scenario: STASH-011.1 The Git menu
  When I open Git › Stash
  Then it lists "Stash Changes…", "Apply Latest Stash", "Pop Latest Stash", "Drop Latest Stash…" and "Show Stashes"

Scenario: STASH-011.2 Stash Changes from the palette
  Given the Source Control panel is closed and I have 3 changed files
  When I run "Stash Changes…" from the command palette
  Then the panel opens with the stash form open and the focus in its message box
  And nothing is stashed until I press "Stash"

Scenario: STASH-011.3 Apply and pop the latest stash
  Given 2 stashes, the newest being "WIP parser"
  When I run "Pop Latest Stash"
  Then the changes of "WIP parser" are in my files and it is removed from the list
  And "Apply Latest Stash" brings the newest stash's changes back and keeps it

Scenario: STASH-011.4 Drop Latest Stash asks too
  Given the newest stash is "WIP parser"
  When I run "Drop Latest Stash…"
  Then the "Drop this stash?" dialog names "WIP parser", with "Cancel" as the default
  And nothing is dropped unless I click "Drop Stash"

Scenario: STASH-011.5 Greyed out with no stashes
  Given a repository with no stashes
  When I open Git › Stash or search the palette for "stash"
  Then "Apply Latest Stash", "Pop Latest Stash" and "Drop Latest Stash…" are listed but greyed out
  And "Stash Changes…" and "Show Stashes" are enabled

Scenario: STASH-011.6 Greyed out with no repository
  Given the open folder is not in a git repository
  When I search the palette for "stash"
  Then all five commands are listed but greyed out

Scenario: STASH-011.7 The commands cannot go round the guards
  Given a merge stopped on a conflict
  When I run "Stash Changes…", "Apply Latest Stash" or "Pop Latest Stash" from the palette
  Then nothing is stashed or applied
  And a notification says "Finish or abort the merge first."

Scenario: STASH-011.8 Nothing to stash, from the palette
  Given a repository with no uncommitted changes
  When I run "Stash Changes…" from the palette
  Then the form does not open and a notification says "There are no uncommitted changes to stash."

Scenario: STASH-011.9 No shortcuts are taken
  When I look at the five commands in the palette
  Then none of them shows a keyboard shortcut
```
