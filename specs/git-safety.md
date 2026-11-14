---
area: Unsaved Tabs and Git Operations
prefix: SAFE
---

# Unsaved Tabs and Git Operations

What Quarry does about open tabs when a git operation rewrites the files under them: before the operation it says which tabs have unsaved changes and offers to save them, and afterwards every open tab shows what is now on disk. Roadmap item 8, "Buffer-aware safety" (`GIT-ROADMAP.md`); user documentation is the section "Unsaved tabs and git" of `docs/git.md`. The stories cover every git action of Quarry: the Source Control panel and the graph, Stash (`git-stash.md`), starting a merge or rebase and Force Push (`git-merge-rebase.md`), partial staging (`git-staging.md`), Edit History (`git-history-edit.md`) and branch housekeeping (`git-branches.md`). None of those areas asks about unsaved tabs on its own: this area adds the one shared question to their action functions. Their command ids are defined in their own specs and listed in the Commands of the stories here that cover them.

Operations run outside Quarry's own git actions (a terminal tab, a Claude tab, another program) are not covered: for those the existing check on window focus and tab activation (FILE-015) stays the only safety net.

**Decisions**

- **Owner decisions (2026-11-13).** There is one unsaved-tabs dialog for every git operation, the one specified here: buttons "Save All" (default), "Continue Without Saving" and "Cancel"; and Pull always asks when the repository has unsaved tabs. The other git specs (Stash, merge / rebase, Edit History, branch housekeeping) define no unsaved-tabs dialog of their own and refer here. The one exception is partial staging, which keeps its own save-first rule (STAGE-005).
- **Which tabs count is not computed per operation.** For an operation that can rewrite any file (the "whole-repository" family below) the question is simply "does this repository have open tabs with unsaved changes?". Predicting which files a pull or a rebase will touch is unreliable, and a stash needs the saved text anyway. What actually happened is read from the disk afterwards: only tabs whose file really changed or vanished are affected.
- **A tab counts when** it is a text tab, a large-file tab or a Compare tab with an editable file side, it has edits the user made that are not saved, and its file is inside the repository the operation runs in (the deepest known repository containing the file, so a file in a nested repository belongs to the nested one). Untitled tabs never count. Tabs of other repositories or of files outside any repository never count. A tab that is marked unsaved only because its file went missing (FILE-015.4) and was not edited since does not count, otherwise switching back to the branch that has the file would ask about it.
- **Whole-repository family** (three-button dialog): switch branch, check out a commit, create a branch at a commit and switch to it, pull (all three kinds), merge and rebase (MERGE-004, MERGE-005, fast-forward included), an Edit History run (HISTORY-009), Reword Message of a commit that is not the last, Drop Commit and Squash into Parent (HISTORY-003 to HISTORY-005), cherry-pick, revert, Stash Changes (STASH-001), Apply and Pop of a stash (STASH-006, STASH-007), Continue and Skip of a stopped operation.
- **Discarding family** (no Save All, because saving and then discarding is pointless): discard file(s), hard reset, abort, take a side of a whole file (also the "Current" / "Incoming" buttons after a stash came back with conflicts, STASH-009). Their existing confirmation gains a sentence naming the tabs whose unsaved edits go too; "Cancel" stays the default. Confirming is the answer: the affected tabs then reload without a second question.
- **Never asks:** fetch, push, Force Push (MERGE-009), commit and amend (the GIT-008.6 warning stays), stage, unstage, mark resolved (it saves the tab itself, CONFLICT-007), soft and mixed reset, "Undo Last Commit" (a soft reset) and Reword Message of the last commit (neither touches the files, HISTORY-002, HISTORY-003.6), creating a branch from the current commit (the files do not change), creating or deleting a branch or tag without switching, renaming a branch, setting an upstream, pushing a branch or a tag, deleting a branch on the remote (BRANCH-003 to BRANCH-009), dropping a stash (STASH-008), comparing commits (COMMITCMP) and the Claude git helpers (GITAI).
- **Hunk and line staging / discard** (STAGE) keep the rule of their own spec (save the one file's tab first, STAGE-005); the only contract added here is that a failed save cancels the action, as in SAFE-002.4.
- **Order of dialogs:** an operation's own confirmation comes first, the unsaved-tabs dialog second, immediately before git runs. Cancel in either one means git is not run.
- **Operations that only start from a clean state are the exception to that order.** A merge, a rebase and every history edit that replays commits refuse to start while tracked files have uncommitted changes (MERGE-008, HISTORY-006.6), and "Save All" turns unsaved edits into exactly such changes. For these the order is: their own clean-state check; then the unsaved-tabs dialog; then, when Save All wrote anything, the clean-state check again, which now refuses with "Commit or discard your changes first"; only then the operation's confirmation and git. So the confirmation never describes a merge or rewrite that the save has just made impossible, and "Continue Without Saving" is the way to run it with the unsaved text kept in the tabs.
- **Buttons:** "Save All" (reads "Save" for one file) is the default and answers Enter: it never loses anything. "Continue Without Saving" runs the operation and keeps the unsaved text in the tabs. "Cancel" answers Escape. Pull always asks when the repository has unsaved tabs, even when it later turns out there was nothing to pull.
- **Save All saves only the listed files**, not every unsaved tab in the application. If any of them cannot be saved, the operation does not run.
- **Continue Without Saving is "Keep my version" answered up front** (FILE-015.3): afterwards there is no "changed on disk" question per tab; one warning names the tabs whose file changed underneath them, they stay marked unsaved, and saving one writes the tab's text.
- **The list** shows paths relative to the repository root with backslashes, in tab order, at most 10, then "and N more".
- **Tabs whose file is gone after the operation stay open**, as today (FILE-015.4 / .5), so that switching back brings them back clean. The per-file warnings are folded into one. A file removed because the user asked for exactly that (take-side deletion, an untracked file discarded to the Recycle Bin) closes its unedited tab instead.
- **Reload notices are folded:** one file keeps today's wording, several files give one notice with the count.
- **The guard lives in the action functions of `src/lib/git.ts`**, not in the buttons, so that every route (panel, graph menu, palette, shortcut, macro, hidden command) passes through it. One exception in form, not in effect: the hard reset's confirmation is the graph's (`act()` in `GraphView.tsx`, the only caller of `commitAction`), which asks `unsavedTabs()` for the tabs to name; `commitAction` then gives those tabs up without a second question.
- **As built (2026-11-14).** Pure rules and wording: `src/lib/gitSafety.ts`. The question and the after-operation step: `guardUnsaved` and `withTabs` in `src/lib/gitTabs.ts`, used in `git.ts` as `guard(root, op)` and `rewrite(g, label, fn)`. The answer is carried into the check that follows the operation by `answerAhead` in `actions.ts` ("keep" for Continue Without Saving, "lose" for a discarding confirmation), so a window-focus check that happens to run first does not ask either. A discarding operation reloads an unsaved tab only where git really rewrote its file (the file's modification time changed), the same rule for discard, hard reset, abort and take-a-side; a tab whose file was left alone keeps its edits. The after-operation check is not awaited by the action: when a "changed on disk" question from before is still open it queues behind it. A merge or rebase with nothing to do says so in its notification before any dialog. Reword Message and Squash into Parent ask when the message strip is submitted, not when it opens.

**Audit: every action that can rewrite files, and how it is covered**

Redone against the code on 2026-11-14, after every other git area was built. "guard" = the unsaved-tabs dialog through `guard()` (`guardUnsaved`); "sentence" = the action's own confirmation names the unsaved tabs, which then reload without a second question; "reload" = `rewrite()` / `withTabs()`: `checkExternalChanges({ quiet: true })` after the git call whether it worked, stopped on a conflict or failed, with one folded notice per kind. `src/__tests__/gitSafetyGuard.test.ts` runs every row with an unsaved tab, and checks that no other source file calls the file-rewriting git commands.

| Action (function in `src/lib/git.ts`) | Routes | About unsaved tabs | Tabs afterwards |
| --- | --- | --- | --- |
| `checkout(name)` | branch list (branch button, status bar, `git.switchBranch`), hidden `git.checkoutTo` (also what a macro records) | guard | reload |
| `checkout(name, true)` | "Create branch … from here" row, hidden `git.createBranch` | none: the files do not change | nothing to reload |
| `checkoutRef` | "Switch to …" of the graph's commit menu and ref-label menu; the "Switch to" offer after a rejected push (`refAction`) | guard | reload |
| `commitAction` checkout / branch-switch / cherry-pick / revert | graph commit menu (`act()` in `GraphView.tsx`, after its own confirmation) | guard | reload, also when the pick or revert stops on a conflict |
| `commitAction` reset-hard | graph commit menu | sentence, in the graph's confirmation (`unsavedTabs` → `actionConfirm`) | reload; the named tabs where the reset rewrote the file |
| `commitAction` reset-soft / reset-mixed / branch / tag | graph commit menu | none | soft / mixed: the check runs; branch / tag: nothing to reload |
| `remote` pull / pull-merge / pull-rebase | panel ↓ button, `SyncStatus` buttons, `git.pull`, the "Pull" offer after a rejected push | guard, always | reload, also when the pull stops on a conflict or fails |
| `remote` fetch / push, `forcePush` | panel, graph toolbar, `git.fetch`, `git.push`, `git.forcePush` | none | nothing to reload |
| `discard` | row button, "Discard all changes", the whole-file Discard of a Source Control comparison (`wholeFile` in gitStaging.ts) | sentence (`discardText`) | reload; the named tabs without a question; the tab of an untracked file that went to the Recycle Bin closes |
| `takeSide` | Merge Changes row Current / Incoming (also after a stash came back with conflicts) | "Replace your edits to …?" for a text tab, a large-file tab or a Compare tab's edited side | reload; tabs of a file that side deleted close |
| `abortOperation` | panel Abort, graph strip Abort | sentence (`lostEditsSentence`) | reload, also when the abort fails |
| `continueOperation` (continue / skip) | panel Continue button, Skip | Skip's confirmation, then guard | reload, also when it stops again |
| `startMerge` / `startRebase` (through `runStart`) | graph commit menu, ref-label menu, panel "Merge or Rebase" button and `git.mergeBranch` / `git.rebaseBranch` (branch list), hidden `git.mergeRef` / `git.rebaseOnto` | clean-state check, guard (`cleanGuard`: after Save All the clean-state check again), then their confirmation | reload, whether it finished, stopped or failed |
| `stashChanges` | the Stashes form's Stash button (`git.stash` opens the form) | guard, worded for a stash | reload |
| `stashAction` apply / pop, `stashLatest` | Stashes rows, graph stash-row menu, `git.stashApply`, `git.stashPop` | guard | reload, also after conflicts or a refusal |
| `stashAction` drop, `settleStash` | Stashes rows, graph stash-row menu, `git.stashDrop`, the Drop Stash offer | none | nothing to reload |
| `dropCommit`, `squashCommit`, `rewordCommit` of a commit that is not the last, `runHistoryEdit` (all through `planRun`) | graph commit menu and message strip, the Edit History list's Run | clean-state check (`historyGuard`), guard (`cleanGuard`), then their confirmation | reload, whether it finished, stopped or failed |
| `undoLastCommit`, `rewordCommit` of the last commit | graph commit menu, `git.undoLastCommit` | none: the files are not touched | the check runs |
| `resolveConflicts` | row +, "mark all", `git.stageFile`, last-conflict dialog | saves the file's unsaved tab first; a failed save cancels | nothing to reload |
| `commit` | panel button, Ctrl+Enter | warning "N open files have unsaved changes that are not in this commit." | nothing to reload |
| `stage` / `unstage` | rows, `git.stageFile`, `git.unstageFile` | none (the file on disk is staged) | nothing to reload |
| `applyGuarded` in `src/lib/gitStaging.ts` (one change / selected lines) | change bars, Compare toolbar, `git.stageChange` … `git.discardLines` | its own rule (STAGE-005): the file's tab or edited side is saved first, a failed save cancels | Discard: the file's tab is reloaded; comparisons follow the index |
| `refAction` in `src/lib/gitRefActions.ts` (delete, rename, set upstream, push, delete remote branch, tags) | graph label menu, branch-list row menu, Git › Branches and Tags | none: no file is rewritten | nothing to reload |

No route was left outside the guard. Not covered, by decision: git run in a terminal tab, a Claude tab or another program (FILE-015 notices those when the window gets focus).

Findings of the first audit (0.1.9) and what became of them: a cherry-pick, revert or pull that stopped on a conflict returned before the check (now `rewrite` checks in a `finally`); `checkExternalChanges` dropped a call made while another check was running (now queued); Compare tabs with a file side were never refreshed (`checkCompareTabs`); `takeSide` updated text tabs only (now every kind, through the same check); discard asked a second "changed on disk" question (answered ahead); one notice per reloaded file (folded).

## SAFE-001: Be told which tabs have unsaved changes before git rewrites files

- Status: draft
- Commands: `git.switchBranch`, `git.checkoutTo`, `git.pull`
- Files:
  - `src/lib/gitSafety.ts` — pure: `tabsAtRisk(tabs, root, repoRoots)` and `ownerRoot` (which tabs count), `unsavedPrompt(op, tabs)` (title, text, buttons), `listPaths` (10, then "and N more")
  - `src/lib/gitTabs.ts` — `openTabs` (the store's tabs as the rules see them: Compare sides, `missingOnly`), `riskTabs`, `guardUnsaved` (shows the dialog through `choose`)
  - `src/lib/git.ts` — `guard(root, op)`, called by every whole-repository action before git runs
  - `src/lib/dialogs.ts` — `choose` (three buttons, default and cancel)
  - `src/lib/actions.ts` — `missingOnly` (a tab marked unsaved only because its file is missing: `missingWarned` and the saved `snapshots`)
  - `src/lib/diff.ts` — unsaved editable file side of a Compare tab (`side.dirty`, `side.path`, `side.source`)
  - `src/lib/store.ts` — `Doc.dirty`, `Doc.bigInfo`
- Tests: `src/__tests__/gitSafety.test.ts`, `src/__tests__/gitSafetyGuard.test.ts`
- Docs: `docs/git.md`

**As a** developer with edits I have not saved yet
**I want** Quarry to tell me which open files have unsaved changes before a git operation rewrites files
**So that** I never find out afterwards that my tab and the file no longer belong together

```gherkin
Scenario: SAFE-001.1 The dialog names the files
  Given the repository "C:\work\app" is on "main"
  And the tabs "src\store.ts" and "README.md" of that repository have unsaved changes
  When I pick "feature" in the branch list
  Then before git runs a dialog "Unsaved changes in 2 open files" appears
  And it says "Switching to feature can rewrite files in this repository, and these open files have unsaved changes:" followed by "src\store.ts" and "README.md" on their own lines
  And it ends "Save them first, or continue and keep the unsaved text in their tabs."
  And its buttons are "Save All", "Continue Without Saving" and "Cancel"

Scenario: SAFE-001.2 Save All is the default, Escape cancels
  Given the unsaved-changes dialog is open
  When I press Enter
  Then it acts as "Save All"
  And pressing Escape instead acts as "Cancel"

Scenario: SAFE-001.3 One file
  Given only "src\store.ts" has unsaved changes
  When I pick "feature" in the branch list
  Then the dialog is titled "Unsaved changes in store.ts"
  And it says "… and this open file has unsaved changes:", then "src\store.ts", then "Save it first, or continue and keep the unsaved text in its tab."
  And its first button reads "Save"

Scenario: SAFE-001.4 A long list is cut
  Given 14 tabs of the repository have unsaved changes
  When I pick "feature" in the branch list
  Then the dialog is titled "Unsaved changes in 14 open files"
  And it lists the first 10 in tab order, by path relative to the repository folder, then "and 4 more"

Scenario: SAFE-001.5 Nothing unsaved, no dialog
  Given no tab of the repository has unsaved changes
  When I pick "feature" in the branch list
  Then no unsaved-changes dialog appears and the branch is switched as before

Scenario: SAFE-001.6 Untitled tabs never count
  Given "Untitled-1" has text and no tab of the repository has unsaved changes
  When I pick "feature" in the branch list
  Then no unsaved-changes dialog appears

Scenario: SAFE-001.7 Only tabs inside this repository count
  Given "C:\notes\todo.txt", which is in no repository, has unsaved changes
  And "C:\work\other\main.rs", in the repository "C:\work\other", has unsaved changes
  When I pull in the repository "C:\work\app"
  Then no unsaved-changes dialog appears
  And both tabs keep their unsaved changes

Scenario: SAFE-001.8 A file in a nested repository belongs to the nested one
  Given "C:\work\app\vendor\lib" is its own repository and its tab "vendor\lib\util.c" has unsaved changes
  When I switch branch in "C:\work\app"
  Then no unsaved-changes dialog appears
  And switching branch in "C:\work\app\vendor\lib" lists "util.c"

Scenario: SAFE-001.9 Large-file tabs count
  Given the large-file tab "data\big.csv" of the repository has an edited line that is not saved
  When I pick "feature" in the branch list
  Then the dialog lists "data\big.csv"

Scenario: SAFE-001.10 A Compare tab with unsaved edits to a file counts
  Given a Compare tab whose right side is the file "src\api.ts" of the repository, edited there and not saved
  When I pick "feature" in the branch list
  Then the dialog lists "src\api.ts"
  And a Compare tab that only shows git versions or another tab's text is never listed

Scenario: SAFE-001.11 The same file open twice is listed once
  Given "src\store.ts" has unsaved changes and is shown in both panes of the split editor
  When I pick "feature" in the branch list
  Then the dialog lists "src\store.ts" once

Scenario: SAFE-001.12 A tab whose file is merely missing does not count
  Given "old.ts" does not exist on "feature", so its unedited tab is marked unsaved since I switched there
  When I pick "main" in the branch list
  Then no unsaved-changes dialog appears
  And had I typed in the "old.ts" tab since, the dialog would list "old.ts"

Scenario: SAFE-001.13 Other kinds of tabs never count
  Given a Claude tab with a running conversation, a terminal tab and a commit graph tab are open
  When I pick "feature" in the branch list
  Then no unsaved-changes dialog appears
```

## SAFE-002: Save All, Continue Without Saving or Cancel

- Status: draft
- Commands: `git.switchBranch`, `git.checkoutTo`, `git.pull`
- Files:
  - `src/lib/gitTabs.ts` — `guardUnsaved` (acts on the answer: saves the listed files, or returns the files kept unsaved; null when the operation may not run), `withTabs` (answers "keep my version" ahead for the kept tabs and words the warning afterwards)
  - `src/lib/gitSafety.ts` — `keptNotice(names)` (the warning after Continue), `notSavedNotice(op, names)`
  - `src/lib/actions.ts` — `saveDocument` (per listed tab; its read-only and "changed on disk" paths), `answerAhead` and `checkExternalChanges` (no question about tabs the user chose to keep; their `modifiedMs` moves on so a later save does not ask either)
  - `src/lib/diff.ts` — `saveDiff(docId, side)` (saving the one file side of a Compare tab)
  - `src/lib/git.ts` — `guard`, `rewrite`
- Tests: `src/__tests__/gitSafety.test.ts`, `src/__tests__/gitSafetyGuard.test.ts`
- Docs: `docs/git.md`

**As a** developer who was just shown the unsaved files
**I want** to save them, carry on without saving, or back out
**So that** I decide what happens to my edits, not git

```gherkin
Scenario: SAFE-002.1 Save All saves the listed files, then runs the operation
  Given the dialog lists "src\store.ts" and "README.md"
  When I click "Save All"
  Then both files are written, their tabs lose the unsaved-changes dot, and then the switch to "feature" runs
  And the edits are now uncommitted changes that git carries to "feature" or refuses to overwrite, as it does for any saved change

Scenario: SAFE-002.2 Save All does not save other tabs
  Given the dialog lists "src\store.ts"
  And "Untitled-1" and "C:\notes\todo.txt" also have unsaved changes
  When I click "Save"
  Then only "src\store.ts" is saved and no Save As dialog appears for "Untitled-1"

Scenario: SAFE-002.3 Git refuses after the save
  Given my now saved changes to "src\store.ts" conflict with branch "feature"
  When "Save All" has saved them and the switch runs
  Then the branch does not change and git's message naming the file is shown as an error
  And nothing is lost: the edits are on disk and in the tab

Scenario: SAFE-002.4 A file cannot be saved: the operation does not run
  Given the dialog lists "src\store.ts" and "README.md", and "README.md" is read-only on disk
  When I click "Save All"
  Then "src\store.ts" is saved, "README.md" stays unsaved with the usual save error
  And git is not run and the branch is still "main"
  And a message says "Not switched: README.md could not be saved."

Scenario: SAFE-002.5 Declining to overwrite counts as not saved
  Given "src\store.ts" was also changed on disk by another program
  When I click "Save" and answer "Cancel" to "store.ts changed on disk"
  Then git is not run and the tab keeps its unsaved changes

Scenario: SAFE-002.6 Continue Without Saving keeps the text in the tabs
  Given the dialog lists "src\store.ts" and "README.md"
  And "src\store.ts" differs between "main" and "feature" and "README.md" does not
  When I click "Continue Without Saving"
  Then the switch to "feature" runs and nothing is written from the tabs
  And both tabs still show my unsaved text with the unsaved-changes dot
  And no "changed on disk" question appears for either
  And one warning says "store.ts changed on disk; its tab keeps your unsaved text. Saving it overwrites the file."

Scenario: SAFE-002.7 After Continue the question is not asked later either
  Given I continued without saving and "src\store.ts" changed on disk underneath its tab
  When I switch to another window and back to Quarry
  Then Quarry does not ask whether to reload "store.ts"
  And pressing Ctrl+S in that tab writes my text to the file

Scenario: SAFE-002.8 Cancel leaves everything untouched
  Given the dialog lists "src\store.ts" and "README.md"
  When I click "Cancel"
  Then git is not run, the branch is still "main" and no file is written
  And both tabs keep their unsaved changes and no message is shown

Scenario: SAFE-002.9 The operation's own confirmation comes first
  Given "src\store.ts" has unsaved changes
  When I choose "Cherry-pick onto main…" on a commit in the graph and confirm with "Cherry-pick"
  Then the unsaved-changes dialog appears next
  And "Cancel" there means no cherry-pick is made

Scenario: SAFE-002.10 Edits made while the dialog chain was open
  Given I clicked "Save All" and every listed file was saved
  When the operation runs
  Then no second unsaved-changes dialog appears for it
```

## SAFE-003: Every operation that can rewrite files asks

- Status: draft
- Commands: `git.switchBranch`, `git.checkoutTo`, `git.createBranch`, `git.pull`, `git.fetch`, `git.push`, `git.mergeBranch`, `git.rebaseBranch`, `git.mergeRef`, `git.rebaseOnto`, `git.stash`, `git.stashApply`, `git.stashPop`, `git.stashDrop`, `git.editHistory`, `git.undoLastCommit`, `git.forcePush`, `git.deleteBranch`, `git.renameBranch`, `git.setUpstream`, `git.pushBranch`, `git.deleteRemoteBranch`, `git.deleteTag`, `git.pushTag`
- Files:
  - `src/lib/git.ts` — `guard` in `checkout` (not when creating a branch), `checkoutRef`, `commitAction` (`actionOp`: checkout, branch-switch, cherry-pick, revert; not branch, tag, reset-soft, reset-mixed), `remote` (the three pulls only; not fetch, push), `continueOperation`, `stashChanges`, `stashAction` for apply and pop but not drop; `cleanGuard` (the clean-state order) in `startMerge`, `startRebase` and `planRun` (`dropCommit`, `squashCommit`, `rewordCommit` for a commit that is not the last, `runHistoryEdit`); not `undoLastCommit`, `forcePush`
  - `src/lib/gitSafety.ts` — `operationPhrase(op)` ("Switching to feature", "Pulling", "Merging feature into main", …), `localName` (a remote branch's local name), `asksAboutTabs(kind)` (the table of which operations ask), `needsCleanState(kind)`
  - `src/lib/gitTabs.ts` — `guardUnsaved` (passes operations that do not ask straight through)
  - `src/lib/gitMerge.ts` — `trackedChanges` / `dirtyRefusal` (the clean-state refusal that follows a Save All)
  - `src/lib/gitRefActions.ts` — `refAction` (never asks; its "Pull" / "Switch to" offers go through `remote` / `checkoutRef`)
  - `src/components/GraphView.tsx` — `act()` (order: own confirmation, then the action function, which holds the guard)
- Tests: `src/__tests__/gitSafety.test.ts`, `src/__tests__/gitSafetyGuard.test.ts`
- Docs: `docs/git.md`

**As a** developer using any of Quarry's git actions
**I want** the same unsaved-tabs question whichever operation is about to rewrite my files
**So that** the protection does not depend on which operation I happen to use

```gherkin
Scenario: SAFE-003.1 Switching branch
  Given "src\store.ts" has unsaved changes
  When I switch to the local branch "feature" or to the remote branch "origin/topic"
  Then the dialog says "Switching to feature can rewrite files in this repository" (or "Switching to topic")

Scenario: SAFE-003.2 Checking out a commit
  Given "src\store.ts" has unsaved changes
  When I confirm "Check Out This Commit…" for commit 18bc71d in the graph
  Then the dialog says "Checking out 18bc71d can rewrite files in this repository"
  And "Create Branch Here and Switch…" on a commit asks the same way with "Switching to <name>"

Scenario: SAFE-003.3 Pull
  Given "src\store.ts" has unsaved changes
  When I pull, with Pull, Pull (Merge) or Pull (Rebase)
  Then the dialog says "Pulling can rewrite files in this repository"
  And it appears even when the pull would have found nothing new

Scenario: SAFE-003.4 Merge and rebase
  Given "src\store.ts" has unsaved changes and I am on "main"
  When I start a merge of "feature", or a rebase onto "feature"
  Then the dialog says "Merging feature into main can rewrite files in this repository" or "Rebasing main onto feature can rewrite files in this repository"
  And it appears before the "Merge feature into main?" or "Rebase main onto feature?" dialog, not after it
  And "Continue Without Saving" goes on to that dialog, and the tab keeps my unsaved text through the merge or rebase
  And when there is nothing to merge or rebase, the notification says so and no dialog appears at all

Scenario: SAFE-003.5 Editing history
  Given "src\store.ts" has unsaved changes and no uncommitted changes on disk
  When I choose Drop Commit, submit the message of Squash into Parent or of Reword Message for a commit that is not the last, or click "Run" in the Edit History list
  Then the dialog says "Rewriting commits can rewrite files in this repository", before the edit's own confirmation
  And "Undo Last Commit…" and Reword Message of the last commit do not ask, because they leave the files alone

Scenario: SAFE-003.6 Stashing says the unsaved text would be left out
  Given "src\store.ts" has unsaved changes
  When I click "Stash" in the stash form with the message "wip"
  Then the dialog says "A stash takes the files as they are on disk, so the unsaved changes in this open file would not be in it:" followed by "src\store.ts" ("these open files" for several)
  And it ends "Save it first to stash it too, or continue and keep the unsaved text in its tab."
  And "Save" saves the file and then stashes it, so the tab shows the committed text afterwards
  And "Continue Without Saving" stashes what is on disk and the tab keeps my unsaved text
  And "Cancel" stashes nothing and leaves the stash form open with my message

Scenario: SAFE-003.7 Applying or popping a stash
  Given "src\store.ts" has unsaved changes
  When I click "Apply" or "Pop" on a stash, or run "Apply Latest Stash" or "Pop Latest Stash"
  Then the dialog says "Applying the stash can rewrite files in this repository", whether or not the stash touches "src\store.ts"
  And dropping a stash does not ask

Scenario: SAFE-003.8 Cherry-pick and revert
  Given "src\store.ts" has unsaved changes
  When I confirm a cherry-pick or a revert of commit 18bc71d
  Then the dialog says "Cherry-picking 18bc71d can rewrite files in this repository" or "Reverting 18bc71d can rewrite files in this repository"

Scenario: SAFE-003.9 Continue and Skip of a stopped operation
  Given a rebase stopped at step 2 of 5 and "src\notes.md", which has no conflict, has unsaved changes
  When I click "Continue Rebase" or "Skip"
  Then the dialog says "Continuing the rebase can rewrite files in this repository" and lists "src\notes.md"
  And for Skip it appears after "Skip this commit?" is confirmed

Scenario: SAFE-003.10 Operations that leave the files alone do not ask
  Given "src\store.ts" has unsaved changes
  When I fetch, push, force push, stage or unstage a file, create a branch from the current commit, create or delete a branch or tag without switching, rename a branch, set an upstream, push a branch or a tag, delete a branch on the remote, drop a stash, undo the last commit, or reset soft or mixed
  Then no unsaved-changes dialog appears

Scenario: SAFE-003.11 Commit keeps its own warning
  Given 2 open files of the repository have unsaved changes
  When I commit
  Then no unsaved-changes dialog appears
  And the warning "2 open files have unsaved changes that are not in this commit." is shown as before

Scenario: SAFE-003.12 Save All before a merge, rebase or history edit leads to the clean-state refusal
  Given I am on "main" with no uncommitted changes on disk, and "src\store.ts" has unsaved changes
  When I start a merge of "feature" and click "Save" in the unsaved-changes dialog
  Then "src\store.ts" is saved and is now an uncommitted change
  And the dialog "Commit or discard your changes first" appears, with "Show Source Control" and "Close"
  And the "Merge feature into main?" dialog never opened and git was not run

Scenario: SAFE-003.13 Uncommitted changes already on disk: one refusal, no question
  Given I have 2 uncommitted changes on disk and "src\store.ts" has unsaved changes
  When I start a rebase onto "feature"
  Then only the dialog "Commit or discard your changes first" appears
  And no unsaved-changes dialog is shown and nothing is saved
```

## SAFE-004: Operations that throw work away say which unsaved tabs go too

- Status: draft
- Commands: none
- Files:
  - `src/lib/git.ts` — `discard`, `takeSide`, `abortOperation`, `commitAction` (reset-hard): the extra sentence, and `noTabs(root, op, lose)` so the named tabs reload without a second question; `unsavedTabs(root)` for the graph
  - `src/lib/gitSafety.ts` — `discardText`, `lostEditsSentence(kind, tabs)`, `tabsOfPaths(tabs, paths)` (the path-scoped variant of `tabsAtRisk`)
  - `src/lib/gitTabs.ts` — `riskTabsOf`, `withTabs` (answers "reload" ahead for the tabs given up)
  - `src/lib/gitGraph.ts` — `actionConfirm` (hard-reset text takes the unsaved tabs)
  - `src/components/GraphView.tsx` — `act()` passes `unsavedTabs(root)` to `actionConfirm`
  - `src/components/panels/GitPanel.tsx` — discard, Current / Incoming and Abort buttons (unchanged callers)
  - `src/lib/actions.ts` — `answerAhead`, `checkExternalChanges` (reloads a tab given up where its file changed), `revertDocument`, `reloadBig`, `closeDocument`
  - `src/lib/gitStaging.ts` — `reloadChange` (a Source Control comparison whose edits were given up)
- Tests: `src/__tests__/gitSafety.test.ts`, `src/__tests__/gitSafetyGuard.test.ts`, `src/__tests__/gitSafetyRoutes.test.tsx`
- Docs: `docs/git.md`

**As a** developer about to discard changes, reset hard, abort or take one side of a file
**I want** the confirmation to say that unsaved edits in open tabs are lost as well
**So that** one clear question covers everything I am about to lose

```gherkin
Scenario: SAFE-004.1 Discard a file whose tab has unsaved edits
  Given "b.ts" has unstaged changes and its tab has further unsaved edits
  When I click "Discard changes" on its row
  Then the dialog "Discard changes?" says "Your changes to b.ts will be lost, including the unsaved edits in its open tab. Open tabs reload the committed text."
  And its buttons are "Discard" and "Cancel", with "Cancel" the default, and there is no "Save All"

Scenario: SAFE-004.2 Confirming reloads the tab without a second question
  Given that dialog is open
  When I click "Discard"
  Then "b.ts" on disk is restored and its tab shows the restored text with no unsaved-changes dot
  And no "b.ts changed on disk" question appears
  And had git left the file on disk as it was, its tab would keep its edits: only a rewritten file's tab is reloaded

Scenario: SAFE-004.3 Discard all names the unsaved tabs among the files
  Given 4 files under Changes, of which "a.ts" and "b.ts" have unsaved edits in their tabs
  And "notes.md", which is not under Changes, also has unsaved edits
  When I click "Discard all changes"
  Then the dialog says "Your changes to 4 files will be lost. Unsaved edits in 2 open tabs are lost too: a.ts, b.ts. Open tabs reload the committed text."
  And after "Discard" the "notes.md" tab still has its unsaved edits

Scenario: SAFE-004.4 Hard reset
  Given "src\store.ts" and "README.md" have unsaved changes
  When I choose "Reset main to Here (Hard)…" on a commit
  Then the dialog "Reset (hard) and discard changes?" adds, before "This can't be undone from Quarry.", "Unsaved edits in open tabs are lost too where the reset rewrites the file: src\store.ts, README.md."
  And its default button is still the cancelling one
  And no separate unsaved-changes dialog follows "Reset and Discard"

Scenario: SAFE-004.5 After a hard reset only rewritten files lose their tab edits
  Given the reset rewrote "src\store.ts" on disk and left "README.md" as it was
  When the reset has finished
  Then the "src\store.ts" tab shows the file's new text with no unsaved-changes dot, without asking
  And the "README.md" tab still has its unsaved edits

Scenario: SAFE-004.6 Abort
  Given a merge stopped on conflicts and "src\store.ts" has unsaved changes
  When I click "Abort"
  Then the dialog "Abort the merge?" adds "Unsaved edits in open tabs are lost too where the abort rewrites the file: src\store.ts."
  And after confirming, tabs of files the abort rewrote reload without asking and the others keep their edits

Scenario: SAFE-004.7 Take a side: large-file and Compare tabs are asked about too
  Given the conflicted file "data\big.csv" is open in a large-file tab with an unsaved edited line
  When I click "Incoming" on its Merge Changes row
  Then the dialog "Replace your edits to big.csv?" offers "Replace" and "Cancel" (default), as for a text tab
  And after "Replace" the tab shows the incoming version
  And a Compare tab with unsaved edits to that file is asked about and reloaded in the same way

Scenario: SAFE-004.8 Cancel
  Given any of these confirmations is open
  When I click "Cancel" or press Escape
  Then git is not run, no file changes and every tab keeps its unsaved edits

Scenario: SAFE-004.9 Soft and mixed reset do not mention tabs
  Given "src\store.ts" has unsaved changes
  When I choose "Reset main to Here (Soft)…" or the Mixed entry
  Then the dialog says nothing about open tabs and the tab keeps its unsaved edits afterwards

Scenario: SAFE-004.10 No unsaved tabs, unchanged wording
  Given no tab of the repository has unsaved changes
  When I open the Discard, hard reset or Abort confirmation
  Then it reads exactly as before, with no sentence about tabs
```

## SAFE-005: No route around the question

- Status: draft
- Commands: `git.switchBranch`, `git.checkoutTo`, `git.createBranch`, `git.pull`, `git.mergeBranch`, `git.rebaseBranch`, `git.mergeRef`, `git.rebaseOnto`, `git.stash`, `git.stashApply`, `git.stashPop`, `git.editHistory`
- Files:
  - `src/lib/git.ts` — the guard sits inside each exported action, so callers cannot skip it; no other file calls the file-rewriting `git.*` functions of gitApi.ts
  - `src/lib/gitTabs.ts` — `guardUnsaved`, `withTabs`
  - `src/lib/gitCommands.ts` — commands call the same actions (`checkout`, `remote`, `startMerge`, `startRebase`, `stashLatest`)
  - `src/lib/gitRefActions.ts` — the offers after a rejected push call `remote` / `checkoutRef`
  - `src/lib/gitStaging.ts` — `wholeFile` calls `discard`
  - `src/components/panels/GitPanel.tsx` — branch button, ↓ button, `SyncStatus` Pull buttons, Continue / Skip / Abort, discard buttons
  - `src/components/panels/GitMergeButton.tsx` — "Merge or Rebase" button
  - `src/components/panels/StashSection.tsx` — the stash form's Stash button, row Apply / Pop
  - `src/components/GraphView.tsx` — commit menu, ref-label menu, stash row menu, stopped-operation strip
  - `src/components/GraphHistory.tsx` — Reword / Drop / Squash entries and the message strip
  - `src/components/HistoryEditList.tsx` — Run
  - `src/components/CommandPalette.tsx` — `mode === "branch"` rows
  - `src/components/StatusBar.tsx` — branch item
  - `src/lib/macros.ts` — playback runs the recorded commands through `runCommand`
- Tests: `src/__tests__/gitSafetyGuard.test.ts`, `src/__tests__/gitSafetyRoutes.test.tsx`
- Docs: `docs/git.md`

**As a** developer who starts git operations from buttons, menus, the palette and the keyboard
**I want** the unsaved-tabs question on every one of those routes
**So that** there is no way to rewrite files under an unsaved tab without being told

```gherkin
Scenario: SAFE-005.1 Source Control panel buttons
  Given "src\store.ts" has unsaved changes
  When I use the branch button, the "Merge or Rebase" button, the ↓ Pull button, the status line's "Pull", "Pull (Merge)" or "Pull (Rebase)" button, the Stashes section's "Stash", "Apply" or "Pop", or "Continue Rebase" / "Skip"
  Then the unsaved-changes dialog appears before git runs, each time

Scenario: SAFE-005.2 Commit graph menus
  Given "src\store.ts" has unsaved changes
  When I use a commit's right-click menu (check out, create branch and switch, cherry-pick, revert, merge, rebase, reword, drop, squash), a branch or tag label's menu (switch, merge, rebase), a stash row's menu (Apply Stash, Pop Stash) or the Edit History list's "Run"
  Then the unsaved-changes dialog appears before git runs, each time
  And "Reset … (Hard)…" and the strip's "Abort" carry the sentence about unsaved tabs in their own confirmation

Scenario: SAFE-005.3 Command palette and Git menu
  Given "src\store.ts" has unsaved changes
  When I run Git › Pull, Stash › Apply Latest Stash or Stash › Pop Latest Stash from the menu bar or the command palette
  Then the unsaved-changes dialog appears before git runs
  And Switch Branch…, Merge Branch… and Rebase onto Branch… open the branch list, where picking a branch asks
  And Stash › Stash Changes… opens the stash form, whose "Stash" button asks

Scenario: SAFE-005.4 The branch list
  Given "src\store.ts" has unsaved changes and the branch list is open
  When I pick an existing branch with the mouse or with Enter
  Then the unsaved-changes dialog appears before the switch
  And typing a new name and picking "Create branch … from here" does not ask, because the files do not change

Scenario: SAFE-005.5 The status bar branch
  Given "src\store.ts" has unsaved changes
  When I click the branch in the status bar and pick "feature"
  Then the unsaved-changes dialog appears before the switch

Scenario: SAFE-005.6 Keyboard
  Given "src\store.ts" has unsaved changes
  When I open the Git menu with Alt+G and run Pull from it with the arrow keys and Enter
  Then the unsaved-changes dialog appears before the pull

Scenario: SAFE-005.7 A macro that switches branch
  Given a macro recorded "Switch to Branch feature" and "src\store.ts" has unsaved changes
  When I play the macro
  Then the unsaved-changes dialog appears before the switch
  And "Cancel" leaves the branch unchanged

Scenario: SAFE-005.8 "All" buttons
  Given 4 files under Changes, 2 with unsaved edits in their tabs
  When I use "Discard all changes", or stash everything with "Stash Changes…"
  Then the sentence about unsaved tabs (discard) or the unsaved-changes dialog (stash) appears exactly as it does for a single file

Scenario: SAFE-005.9 Pull started from the Add-and-Push or publish flows is not affected
  Given "src\store.ts" has unsaved changes
  When I push, publish the branch, or add a remote and push
  Then no unsaved-changes dialog appears, because nothing rewrites my files

Scenario: SAFE-005.10 While the dialog is open nothing else can start
  Given the unsaved-changes dialog is open
  When I press Ctrl+Shift+G or any other global shortcut
  Then nothing happens until I answer the dialog
```

## SAFE-006: Open tabs show what is on disk after every operation

- Status: draft
- Commands: `git.discardChange`, `git.discardLines`, `git.mergeRef`, `git.rebaseOnto`, `git.stash`, `git.stashApply`, `git.stashPop`, `git.editHistory`
- Files:
  - `src/lib/git.ts` — `rewrite(g, label, fn)`: the one after-operation step of every action that can rewrite files, run on success **and** on failure or a stop; `runStart`, `historyRun` and `stashAction` go through it; `stashRun` also refreshes the Source Control comparisons
  - `src/lib/gitTabs.ts` — `withTabs` / `after` (the quiet check, then one notice per kind), `tabsSettled`
  - `src/lib/actions.ts` — `checkExternalChanges` (calls are queued, never dropped; `quiet` returns what was reloaded, missing and kept; `checkCompareTabs`), `revertDocument`, `reloadBig`
  - `src/lib/diff.ts` — `refreshDiff` for a clean Compare tab whose file side changed
  - `src/lib/gitSafety.ts` — `reloadedNotice(names)` (one file / several files wording)
  - `src/lib/gitStaging.ts` — `applyGuarded` (Discard Change / Lines reloads the file's tab), `reloadChange`
  - `src/components/BigFileView.tsx` — follow mode stays in charge of a following tab
- Tests: `src/__tests__/gitSafety.test.ts`, `src/__tests__/gitSafetyGuard.test.ts`, `src/__tests__/gitStaging.test.tsx`
- Docs: `docs/git.md`

**As a** developer whose files were just rewritten by a git operation
**I want** every open tab to show the file as it is now, straight away
**So that** I never read or edit a stale copy

```gherkin
Scenario: SAFE-006.1 Clean tabs reload after a branch switch
  Given "src\store.ts" and "README.md" are open without unsaved changes and both differ on "feature"
  When I switch to "feature"
  Then both tabs show the "feature" text without my switching windows or tabs
  And one notice says "2 open files changed on disk and were reloaded."

Scenario: SAFE-006.2 One file keeps the familiar notice
  Given only "src\store.ts" is open and it differs on "feature"
  When I switch to "feature"
  Then a notice says "store.ts changed on disk and was reloaded."

Scenario: SAFE-006.3 Every file-rewriting operation reloads
  Given "src\store.ts" is open without unsaved changes
  When a pull, merge, rebase, Edit History run, Drop Commit, Squash into Parent, cherry-pick, revert, hard reset, abort, Stash Changes, stash Apply, stash Pop, discard, Discard Change, Discard Selected Lines, Continue or Skip changes "src\store.ts" on disk
  Then its tab shows the new text when the operation ends

Scenario: SAFE-006.4 An operation that stops on a conflict reloads too
  Given "src\store.ts" is open without unsaved changes
  When a cherry-pick, pull, merge, rebase or stash pop stops with a conflict in "src\store.ts"
  Then the tab shows the file with git's conflict markers and the conflict bars at once
  And this does not wait for the Quarry window to lose and regain focus

Scenario: SAFE-006.5 An operation that fails part-way reloads what it changed
  Given a rebase rewrote "a.ts" and then failed with an error
  When the error is shown
  Then the "a.ts" tab already shows what is on disk

Scenario: SAFE-006.6 Unchanged files are not reloaded
  Given "README.md" is open and is identical on "main" and "feature"
  When I switch to "feature"
  Then its tab, cursor and undo history are untouched and it is not counted in the notice

Scenario: SAFE-006.7 Large-file tabs
  Given the large-file tab "data\big.csv" has no unsaved edits and differs on "feature"
  When I switch to "feature"
  Then the tab is reopened from disk and is counted in the same notice
  And a large-file tab in follow mode is left to follow mode

Scenario: SAFE-006.8 Compare tabs
  Given a Compare tab whose right side is the file "src\api.ts", not edited there, and a Compare tab of "store.ts (HEAD)" against the open "store.ts" tab
  When I switch to "feature", where both files differ
  Then the first Compare tab shows the file's new text on its right side
  And the second shows the reloaded tab's text on its right side, while its left side keeps the version it was opened with
  And a Compare tab with unsaved edits is not reloaded

Scenario: SAFE-006.9 Tabs kept unsaved are not reloaded
  Given I answered "Continue Without Saving" for "src\store.ts"
  When the operation changes "src\store.ts" on disk
  Then the tab keeps my text and only the warning of SAFE-002.6 is shown

Scenario: SAFE-006.10 The check after an operation is never lost
  Given a "notes.txt changed on disk" question from before is still open
  When a pull finishes and I then answer that question
  Then tabs of files the pull changed are reloaded as well
  And the pull's own "Pulled." notification did not wait for my answer

Scenario: SAFE-006.11 Both panes follow
  Given "src\store.ts" is shown in both panes of the split editor
  When a pull changes it on disk
  Then both panes show the new text

Scenario: SAFE-006.12 Change markers and blame follow
  Given "src\store.ts" was reloaded after a switch to "feature"
  When I look at its gutter
  Then it has no change markers, because the tab equals the file committed on "feature"
```

## SAFE-007: Tabs whose file is not there after the operation

- Status: draft
- Commands: none
- Files:
  - `src/lib/actions.ts` — `checkExternalChanges` (`missingWarned`, the came-back path; the result lists the missing files), `missingOnly`, `closeDocument`
  - `src/lib/gitTabs.ts` — `after`: one folded warning; `Guarded.closeGone` closes the tab of a file the user deleted through `discard` (untracked) or `takeSide`
  - `src/lib/git.ts` — `discard`, `takeSide` (set `closeGone`)
  - `src/lib/gitSafety.ts` — `missingNotice(op, names)`, `afterPhrase`
- Tests: `src/__tests__/gitSafety.test.ts`, `src/__tests__/gitSafetyGuard.test.ts`
- Docs: `docs/git.md`

**As a** developer switching between branches that do not have the same files
**I want** tabs of files that are not on the new branch to stay open and come back by themselves
**So that** I lose neither the tab nor my place when I switch back

```gherkin
Scenario: SAFE-007.1 The tab stays open
  Given "old.ts" and "legacy.ts" are open without unsaved changes and neither exists on "feature"
  When I switch to "feature"
  Then both tabs stay open with their text and are marked as having unsaved changes
  And one warning says "old.ts and legacy.ts are not in the folder after switching to feature. Their tabs stay open; saving one recreates the file."
  And there is not a separate warning per file
  And for one file it says "old.ts is not in the folder after switching to feature. Its tab stays open; saving it recreates the file."

Scenario: SAFE-007.2 Switching back brings the tab back clean
  Given I switched to "feature" and did not type in the "old.ts" tab
  When I switch back to "main"
  Then no unsaved-changes dialog appears for "old.ts"
  And its tab loses the unsaved-changes dot, and shows the file's text from disk if that is newer

Scenario: SAFE-007.3 The warning is given once
  Given the warning about "old.ts" was shown after the switch
  When I switch to another window and back to Quarry
  Then it is not repeated

Scenario: SAFE-007.4 An unsaved tab whose file vanished keeps its edits
  Given I answered "Continue Without Saving" for "old.ts", which does not exist on "feature"
  When the switch has finished
  Then the "old.ts" tab still shows my unsaved text
  And the warning names it among the files that are not in the folder

Scenario: SAFE-007.5 A large-file tab
  Given the large-file tab "data\big.csv" has no unsaved edits and the file does not exist on "feature"
  When I switch to "feature" and later back to "main"
  Then the tab stays open on "feature" and is named in the warning
  And back on "main" it loses the unsaved-changes dot or is reopened from disk when the file is newer

Scenario: SAFE-007.6 A file I deleted on purpose closes its tab
  Given the untracked file "notes.txt" is open without unsaved changes
  When I click its "Delete (to the Recycle Bin)" button and confirm
  Then its tab is closed and no "deleted or moved" warning appears
  And taking the side that deleted a conflicted file closes that file's tab the same way

Scenario: SAFE-007.7 A deleted file with unsaved edits is said so first
  Given the untracked file "notes.txt" has unsaved edits in its tab
  When I click its "Delete (to the Recycle Bin)" button
  Then the dialog says "notes.txt is not tracked by git and will be moved to the Recycle Bin. The unsaved edits in its open tab are lost."
  And after "Discard" the tab is closed without a save question

Scenario: SAFE-007.8 Other operations that remove files
  Given "old.ts" is open without unsaved changes
  When a pull, merge, rebase, hard reset, Stash Changes with "Include untracked files" ticked, or check-out of a commit removes "old.ts" from the folder
  Then its tab stays open and one warning names it, worded for that operation ("… after the pull.")
```
