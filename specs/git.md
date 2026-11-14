---
area: Source Control
prefix: GIT
---

# Source Control

Git in the editor (change markers, peek / revert, line blame), the Source Control panel (branch, commit, changes, sync with the remote, commits, file history, identity, remotes, GitHub), the status bar branch and the Explorer decorations. Quarry shells out to the user's own `git`. User documentation: `docs/git.md`. The commit graph tab, merge conflicts, stopped operations (continue / skip / abort) and the Compare tabs themselves are specified elsewhere.

## GIT-001: Detect repositories and keep their status fresh

- Status: draft
- Commands: `git.refresh`
- Files:
  - `src/lib/git.ts` — `installGit`, `refreshGit` (debounce), `doRefresh` (a git failure goes to `statusErrors`, never `notRepo`; a known repository keeps its last status), `rescanGit` (clears `notRepo`, re-checks a missing git), `interesting`, `notRepo`, `repoOf`, `currentRepo`, `fileStatus`
  - `src/lib/gitApi.ts` — `git.available`, `git.status`, `GitStatus` / `GitFile`
  - `src-tauri/src/git.rs` — `git_available`, `git_status`, `find_root`, `parse_status`, `git()` (`--no-optional-locks`, `GIT_TERMINAL_PROMPT=0`); `status` also reads the newest stash's id and the number of stashes (STASH-004)
  - `src/components/panels/GitPanel.tsx` — header Refresh button (`rescanGit`), "Git was not found" / "not in a git repository" / "Git could not read" notes
  - `src/lib/gitCommands.ts` — `git.refresh` (runs `rescanGit`, like the panel's Refresh button)
  - `src/App.tsx` — calls `installGit()` at start-up
- Tests: `src-tauri/src/git.rs`, `src/__tests__/gitRefresh.test.ts`
- Docs: `docs/git.md`

**As a** developer who opens folders and files that live in git repositories
**I want** Quarry to notice the repository and keep its status current by itself
**So that** what the editor, Explorer and Source Control show always matches the work tree

```gherkin
Scenario: GIT-001.1 The open folder's repository is picked up
  Given git is installed
  When I open a folder that is inside a git repository
  Then the Source Control panel shows that repository's branch and changed files

Scenario: GIT-001.2 A file from outside the open folder brings its repository
  Given the open folder is not in a repository
  When I open a text or large file that is inside a git repository elsewhere
  Then that repository is shown in Source Control

Scenario: GIT-001.3 Status follows saves, file changes, git actions and window focus
  Given a repository with no changes is shown
  When I edit a tracked file and save it
  Then the file appears under Changes without me refreshing
  And the status is also re-read when a file changes in the open folder, after every git action, and when the Quarry window gets focus

Scenario: GIT-001.4 Refresh after git init in a terminal
  Given the open folder was not a repository and I ran "git init" in a terminal
  When I click the Refresh button in the Source Control header, or choose Git › Refresh Git Status
  Then folders that were remembered as "not a repository" are asked again and the new repository appears

Scenario: GIT-001.5 Git is not installed
  Given git cannot be run
  When I open the Source Control panel
  Then it says "Git was not found. Install Git for Windows (git-scm.com) and make sure git is on PATH, then click Refresh (after installing it, restart Quarry first: a running program keeps its old PATH)."
  And no repository features are shown

Scenario: GIT-001.6 No repository
  Given a folder is open that is not in a git repository
  When I open the Source Control panel
  Then it says "The open folder is not in a git repository."
  And with no folder open it says "Open a folder (or a file) in a git repository to see its changes here."

Scenario: GIT-001.7 Untracked files are listed one by one
  Given a repository with a new folder holding 3 new files
  When the status is read
  Then each of the 3 files is listed as untracked, not just the folder

Scenario: GIT-001.8 Refresh looks for git again
  Given the Source Control panel says "Git was not found"
  And git can now be run with Quarry's PATH (for example a broken install was repaired)
  When I click the Refresh button in the Source Control header, or choose Git › Refresh Git Status
  Then Quarry looks for git again and shows the repository

Scenario: GIT-001.9 Git fails to read a folder
  Given the open folder is in a repository git refuses to read ("detected dubious ownership")
  When the status is read
  Then the Source Control panel says "Git could not read the open folder:" followed by git's message
  And the folder is not remembered as "not a repository": the next refresh asks git again

Scenario: GIT-001.10 A failed read keeps the last status
  Given a repository is shown
  When one status read fails (for example a git lock held by another program)
  Then the panel keeps showing the repository's last status instead of dropping it
```

## GIT-002: Change markers in the gutter

- Status: draft
- Commands: none
- Files:
  - `src/editor/git.ts` — `gitDiff` field (`Chunk.build` / `Chunk.updateB`), `lineChange`, `changeRows`, `gitMarkers`, `ChangeMarker`, the `cm-git-gutter` gutter in `gitExtensions`
  - `src/lib/git.ts` — `syncBases` / `syncBase` (HEAD text per document, refetched when HEAD moves), `baseHead`
  - `src/editor/manager.ts` — installs `gitExtensions()` in every text document
  - `src-tauri/src/git.rs` — `git_show` (`cat-file --filters`, so line endings match the checkout)
  - `src/styles/app.css` — `.cm-git-mark`, `.cm-git-added` / `-modified` / `-deleted`
  - `src/styles/tokens.css` — `--git-added`, `--git-modified`, `--git-deleted`
- Tests: `src/__tests__/splitGit.test.ts`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer editing a tracked file
**I want** the gutter to mark the lines that differ from the last commit
**So that** I can see what I have changed without opening a diff

```gherkin
Scenario: GIT-002.1 Added, changed and deleted lines are marked
  Given a tracked file whose last commit is "one / two / three / four"
  When the text in the tab is "one / TWO / three / four / five" 
  Then line 2 has a blue "changed" marker and line 5 a green "added" marker
  And where committed lines were removed a red wedge is shown on the line at that place

Scenario: GIT-002.2 Markers follow typing, saved or not
  Given a tracked file with no changes is open
  When I type a new line without saving
  Then a green marker appears on that line at once
  And it disappears again when I delete the line

Scenario: GIT-002.3 Markers compare whole lines
  Given a committed file that ends with a line break
  When I add a new last line
  Then only the new line is marked as added, and the unchanged line before it is not marked

Scenario: GIT-002.4 No markers for files with nothing to compare with
  Given a file that is untracked, newly added to the index, binary in HEAD, or in a repository with no commits
  When I open and edit it
  Then no change markers are shown

Scenario: GIT-002.5 Markers reset after a commit
  Given a file with 2 marked changes
  When I commit the file
  Then the markers disappear because the text now matches the new last commit
```

## GIT-003: Peek at a change and revert it

- Status: draft
- Commands: `git.peekChange`, `git.revertChange`
- Files:
  - `src/editor/git.ts` — `peekField`, `setPeek`, `peekDOM`, `revertSpec`, `revertChange`, gutter `mousedown`, Escape handler, `changeAtLine`
  - `src/lib/gitCommands.ts` — `changeAtCursor`, `git.peekChange`, `git.revertChange`
  - `src/styles/app.css` — `.cm-git-peek*`
- Tests: `src/__tests__/splitGit.test.ts`
- Docs: `docs/git.md`

**As a** developer looking at a marked change
**I want** to see the committed text of that change and put it back
**So that** I can undo one change without discarding the whole file

```gherkin
Scenario: GIT-003.1 Click a marker to peek
  Given a file with 3 changes since the last commit
  When I click the marker of the second change
  Then a peek opens under the change titled "Changed lines · change 2 of 3 (since the last commit)" showing the committed text
  And it has the buttons "↑", "↓", "Revert" and "✕"

Scenario: GIT-003.2 Added lines have no old text
  Given a change that only adds lines
  When I peek at it
  Then the peek is titled "Added lines …" and says "These lines are new; Revert removes them."

Scenario: GIT-003.3 Revert puts the committed lines back as one undo step
  Given the peek of a changed line is open
  When I click "Revert"
  Then the committed text replaces the changed lines, the marker and the peek disappear
  And one Ctrl+Z brings my change back

Scenario: GIT-003.4 Closing the peek
  Given a peek is open
  When I press Escape, click "✕", click the same marker again, or edit the document
  Then the peek closes

Scenario: GIT-003.5 Moving between changes from the peek
  Given the peek of change 1 of 3 is open
  When I click "↓"
  Then the cursor moves to change 2, which is scrolled into view with its peek open
  And "↑" is disabled on the first change and "↓" on the last

Scenario: GIT-003.6 Commands act on the change under the cursor
  Given the cursor is on a changed line
  When I run "Show Change at Cursor"
  Then the peek of that change opens
  And "Revert Change at Cursor" reverts it

Scenario: GIT-003.7 Revert at cursor on an unchanged line
  Given the cursor is on a line with no marker
  When I run "Revert Change at Cursor"
  Then nothing is changed and a message says "The cursor is not on a changed line."
```

## GIT-004: Jump to the next or previous change

- Status: draft
- Commands: `git.nextChange`, `git.prevChange`
- Files:
  - `src/lib/gitCommands.ts` — `jumpChange` (opens the peek)
  - `src/lib/gitStatus.ts` — `nextChangeIndex` (which change, wrap-around)
  - `src/editor/git.ts` — `changesOf`, `changeRows`, `setPeek`
  - `src/components/MenuBar.tsx` — Git menu entries
- Tests: `src/__tests__/gitNav.test.ts`
- Docs: `docs/git.md`

**As a** developer reviewing my edits before committing
**I want** to step through the changes in a file from the keyboard
**So that** I can review each one quickly

```gherkin
Scenario: GIT-004.1 Next change
  Given a text file with changes on lines 10, 40 and 90 and the cursor on line 12
  When I press Alt+F5
  Then the cursor moves to line 40, the line is scrolled into view and its peek opens

Scenario: GIT-004.2 Previous change
  Given the same file and the cursor on line 50
  When I press Shift+Alt+F5
  Then the cursor moves to line 40 and its peek opens

Scenario: GIT-004.3 Wraps around
  Given the cursor is after the last change
  When I press Alt+F5
  Then the cursor moves to the first change on line 10

Scenario: GIT-004.4 No changes
  Given a file with no changes since the last commit
  When I press Alt+F5
  Then the cursor does not move and a message says "No changes since the last commit in this file."

Scenario: GIT-004.5 Only for text tabs
  Given the active tab is not a text document
  When I open the Git menu
  Then Next Change and Previous Change are greyed out
```

## GIT-005: Line blame

- Status: draft
- Commands: `git.toggleBlame`
- Files:
  - `src/lib/git.ts` — `toggleBlame`, `blameSoon` (0 ms on toggle / tab switch / save, 1500 ms after typing), `blameNow` (stale answers dropped), `blameOn`
  - `src/editor/git.ts` — `blameField`, `setBlame`, `blameDecorations`, `BlameWidget`, `relativeTime`
  - `src/lib/gitCommands.ts` — `git.toggleBlame` with `dynamicTitle` (Show / Hide Line Blame)
  - `src-tauri/src/git.rs` — `git_blame` (`blame --porcelain --contents -`), `buffer_bytes` (encoding, BOM, line endings), `parse_blame`
  - `src/styles/app.css` — `.cm-git-blame`
- Tests: `src-tauri/src/git.rs`, `src/__tests__/splitGit.test.ts`
- Docs: `docs/git.md`

**As a** developer reading unfamiliar code
**I want** to see who last changed the line my cursor is on
**So that** I know whom to ask and which commit to look at

```gherkin
Scenario: GIT-005.1 Show blame for the cursor line
  Given a tracked file is open
  When I run Git › Show Line Blame
  Then the end of the cursor line shows the author, how long ago and the commit summary, e.g. "Ada, 3 days ago · Fix tab order"
  And hovering it shows the short commit id, summary, author e-mail and date
  And the menu item now reads "Hide Line Blame"

Scenario: GIT-005.2 Blame follows the cursor
  Given line blame is on
  When I move the cursor to another line
  Then the blame text moves to that line and shows that line's commit

Scenario: GIT-005.3 Unsaved lines are not attributed to a commit
  Given line blame is on
  When I change a line without saving and stop typing for a moment
  Then that line shows "You · not committed yet"
  And unchanged lines keep their commits even when the file uses CRLF line endings or a non-UTF-8 encoding

Scenario: GIT-005.4 Blame is hidden while it would be wrong
  Given line blame is on
  When I type in the document
  Then the blame text disappears until it has been asked again for the new text
  And no blame is shown while there is more than one cursor

Scenario: GIT-005.5 Files without history show nothing
  Given line blame is on
  When I switch to an untracked file or a file outside any repository
  Then no blame text is shown and no error appears

Scenario: GIT-005.6 Hide blame
  Given line blame is on
  When I run Git › Hide Line Blame
  Then the blame text is removed from every open text tab
```

## GIT-006: Compare a file with the last commit

- Status: draft
- Commands: `git.compareWithHead`
- Files:
  - `src/lib/git.ts` — `compareWithHead` (HEAD text vs tab / file on disk / empty "(deleted)")
  - `src/lib/gitCommands.ts` — `git.compareWithHead`, `tracked()` enabled rule
  - `src/components/TitleBar.tsx` — tab right-click item "Compare with Last Commit" (`runCommand("git.compareWithHead", { docId })`)
  - `src/components/MenuBar.tsx` — Git menu entry
  - `src-tauri/src/git.rs` — `git_show`
- Tests: `src-tauri/src/git.rs`
- Docs: `docs/git.md`, `docs/compare.md`

**As a** developer with uncommitted edits in a file
**I want** to open the file against its last committed version
**So that** I can review all my changes side by side

```gherkin
Scenario: GIT-006.1 Compare the active tab with HEAD
  Given a tracked file "app.ts" is the active tab
  When I run Git › Compare with Last Commit (HEAD)
  Then a Compare tab opens with "app.ts (HEAD)" on the left and my tab, editable, on the right

Scenario: GIT-006.2 From the tab's right-click menu
  Given a tab of a tracked file
  When I right-click the tab and choose "Compare with Last Commit"
  Then the same Compare tab opens

Scenario: GIT-006.3 Not offered for untracked files
  Given the active file is untracked or not in a repository
  When I open the Git menu or the tab's right-click menu
  Then Compare with Last Commit is greyed out in the menu and absent from the tab menu

Scenario: GIT-006.4 A file that is not in the last commit
  Given a file that was added to the index but never committed
  When I run Compare with Last Commit (HEAD)
  Then no Compare tab opens and a message says "<name> is not in the last commit."

Scenario: GIT-006.5 Binary files
  Given a tracked binary file
  When I run Compare with Last Commit (HEAD)
  Then no Compare tab opens and a message says "<name> is a binary file."
```

## GIT-007: Switch and create branches

- Status: draft
- Commands: `git.switchBranch`, `git.checkoutTo`, `git.createBranch`
- Files:
  - `src/lib/git.ts` — `pickBranch(purpose)` (opens palette mode `branch` for the purpose `"switch"`, the default; loads `branches`; the other purposes are MERGE-003's), `checkout`
  - `src/lib/gitRefs.ts` — `branchPick("switch", …)` (prompt, `git.checkoutTo`, the "Create branch" row), `pickList`
  - `src/components/CommandPalette.tsx` — `mode === "branch"` item list from the purpose in `useGit().branchPick` ("Create branch …" row, `current` / `remote` labels), placeholder, "Loading branches…"
  - `src/lib/gitCommands.ts` — `git.switchBranch`, hidden `git.checkoutTo` / `git.createBranch`
  - `src/components/panels/GitPanel.tsx` — branch button (`branchLabel`, disabled while busy); the "Merge or Rebase" button after it is MERGE-003's
  - `src-tauri/src/git.rs` — `git_branches` (`for-each-ref`, local first, newest first, symbolic refs skipped), `git_checkout` (`switch`, `switch -c`, `switch --track`)
- Tests: `src-tauri/src/git.rs`, `src/__tests__/branchPicker.test.tsx`, `src/__tests__/gitRefs.test.ts`
- Docs: `docs/git.md`

**As a** developer working on several branches
**I want** to switch to another branch or create one from a searchable list
**So that** I can change what I am working on without a terminal

```gherkin
Scenario: GIT-007.1 Open the branch list
  Given a repository on branch "main" with local branch "feature" and remote branch "origin/topic"
  When I click the branch button at the top of Source Control, or run Git › Switch Branch…
  Then a list opens with the prompt "Switch to a branch, or type a name to create one…"
  And local branches come first, then remote ones, each group newest first
  And "main" is labelled "current" and "origin/topic" is labelled "remote"

Scenario: GIT-007.2 Switch to a local branch
  Given the branch list is open
  When I pick "feature"
  Then the repository is on "feature", a message says "Switched to feature"
  And open tabs whose files changed on disk are re-checked

Scenario: GIT-007.3 A remote branch becomes a local tracking branch
  Given there is no local branch "topic"
  When I pick "origin/topic"
  Then a local branch "topic" tracking "origin/topic" is created and checked out
  And when a local "topic" already exists it is switched to instead

Scenario: GIT-007.4 Create a branch by typing a new name
  Given the branch list is open and no branch is called "fix-login"
  When I type "fix login" and pick the first row, Create branch "fix-login" from here
  Then branch "fix-login" is created from the current commit and checked out
  And a message says "Created and switched to fix-login"

Scenario: GIT-007.5 Git refuses a switch that would overwrite my changes
  Given uncommitted changes that conflict with branch "feature"
  When I pick "feature"
  Then the branch does not change and git's message naming the files is shown as an error

Scenario: GIT-007.6 Detached HEAD
  Given HEAD is detached at commit 1a2b3c4
  When I look at the branch button
  Then it reads "1a2b3c4 (detached)"
  And in a repository with no commits it reads "no commits yet"

Scenario: GIT-007.7 Unavailable without a repository or while git is busy
  Given no repository is known
  When I open the Git menu
  Then Switch Branch… is greyed out
  And while a git action is running the panel's branch button is disabled
```

## GIT-008: Commit from the Source Control panel

- Status: draft
- Commands: `git.showPanel`
- Files:
  - `src/components/panels/GitPanel.tsx` — `GitPanel`: message box (Ctrl+Enter), Commit button and its disabled rule, `doCommit`, "as name <email>" hint
  - `src/lib/git.ts` — `commit()` (message check, Stage All and Commit dialog, unsaved-tabs warning, success toast), `run` (busy label)
  - `src/lib/gitStatus.ts` — `commitLabel`, `groupFiles`
  - `src/lib/gitCommands.ts` — `git.showPanel` (Ctrl+Shift+G)
  - `src/components/SidebarRail.tsx` — Source Control rail button
  - `src-tauri/src/git.rs` — `git_commit` (`commit -F -`, message on stdin; returns short id + summary)
- Tests: `src/__tests__/gitRemote.test.ts`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer working in a git repository
**I want** to commit my changes from the Source Control panel with a button that says what it will take
**So that** I can record my work without leaving the editor and without surprises

```gherkin
Scenario: GIT-008.1 Open Source Control
  Given a repository is open
  When I press Ctrl+Shift+G, click the branch icon in the rail, or run Git › Show Source Control
  Then the Source Control panel opens with the branch, the message box, the Commit button and the changed files

Scenario: GIT-008.2 Commit what is staged
  Given a repository with 3 staged files and 2 unstaged changes
  And the message box contains "Fix tab order"
  When I click "Commit 3 Staged"
  Then a commit "Fix tab order" is created with the 3 staged files
  And the 2 unstaged changes remain in Changes
  And a message says "Committed <short id>: Fix tab order" and the message box is emptied

Scenario: GIT-008.3 Ctrl+Enter commits
  Given staged files and a message in the message box, whose placeholder reads "Message (Ctrl+Enter to commit on main)"
  When I press Ctrl+Enter in the message box
  Then the commit is made as if I had clicked the button

Scenario: GIT-008.4 Nothing staged: Commit All asks first
  Given 14 changed files, none staged, and a message
  When I click "Commit All (14 files)"
  Then a dialog "Nothing is staged" asks "Stage all 14 changed files and commit them?"
  And "Stage All and Commit" stages every change and commits it
  And "Cancel" leaves everything as it was

Scenario: GIT-008.5 The button is disabled when there is nothing it could do
  Given a repository with no changes, or an empty message box, or a git action in progress
  When I look at the Commit button
  Then it is disabled
  And with no changes it reads "Commit All"

Scenario: GIT-008.6 Unsaved tabs are not in the commit
  Given 2 open files of the repository have unsaved changes
  When I commit
  Then the commit is made from what is on disk
  And a warning says "2 open files have unsaved changes that are not in this commit."

Scenario: GIT-008.7 The panel says who the commit is made as
  Given git's user.name is "Ada" and user.email is "ada@example.com"
  When I look under the Commit button
  Then a line reads "as Ada <ada@example.com>"

Scenario: GIT-008.8 Ctrl+Enter while the button is disabled says why
  Given the Commit button is disabled
  When I press Ctrl+Enter in the message box
  Then no commit is made
  And a message says why: "Write a commit message first." with an empty box, "There is nothing to commit." with no changes, or the conflicts warning (CONFLICT-010.2)
  And while a git action is running nothing happens
```

## GIT-009: Amend the last commit

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/GitPanel.tsx` — Amend checkbox (disabled without HEAD, cleared after a commit), button disabled rule
  - `src/lib/git.ts` — `commit(root, message, amend)` (no Stage All question when amending)
  - `src/lib/gitStatus.ts` — `commitLabel` ("Amend Last Commit")
  - `src-tauri/src/git.rs` — `commit` (`--amend`, `--no-edit` when the message is empty)
- Tests: `src/__tests__/gitRemote.test.ts`
- Docs: `docs/git.md`

**As a** developer who just committed with a typo or a missing file
**I want** to replace the last commit
**So that** the history has one correct commit instead of a fix-up

```gherkin
Scenario: GIT-009.1 Amend with a new message
  Given the last commit is "Fix tab ordr" and I tick "Amend"
  When I type "Fix tab order" and click "Amend Last Commit"
  Then the last commit is replaced by one with the message "Fix tab order" including anything staged
  And the Amend box is unticked again

Scenario: GIT-009.2 An empty message keeps the old one
  Given "Amend" is ticked, one more file is staged and the message box is empty
  When I click "Amend Last Commit"
  Then the last commit now includes the staged file and keeps its message

Scenario: GIT-009.3 Amend never stages everything by itself
  Given "Amend" is ticked and nothing is staged
  When I click "Amend Last Commit"
  Then no "Nothing is staged" question is asked and unstaged changes stay unstaged

Scenario: GIT-009.4 Nothing to amend before the first commit
  Given a repository with no commits yet
  When I look at the Amend checkbox
  Then it is disabled
```

## GIT-010: See the changed files and open their changes

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/GitPanel.tsx` — `Section`, `FileRow` (click / Enter = `openChange`, double-click = open file, letter, folder, tooltip), "No uncommitted changes." note
  - `src/lib/gitStatus.ts` — `groupFiles`, `rowKind`, `kindOf`, `KIND_LETTER`, `KIND_LABEL`
  - `src/lib/git.ts` — `openChange` (untracked files just open; the rest is a Source Control comparison)
  - `src/lib/gitStaging.ts` — `openChangeCompare` / `changeSources` (staged: HEAD vs index; changes: index vs tab / file, labelled "(staged)" or "(HEAD)"; an open comparison is reused)
  - `src-tauri/src/git.rs` — `parse_status` (porcelain v2, renames with original path), `git_show` (`rev` "" / ":" = index)
  - `src/styles/app.css` — `.scm-*` rows, `.git-*` colours
- Tests: `src/__tests__/splitGit.test.ts`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer about to commit
**I want** the panel to list what is staged and what is not, and to open each file's change
**So that** I know exactly what will go into the commit

```gherkin
Scenario: GIT-010.1 Files are grouped into Staged Changes and Changes
  Given "a.ts" is modified and staged, "b.ts" is modified and not staged, and "c.ts" is new and untracked
  When I look at Source Control
  Then Staged Changes (1) lists "a.ts" with the letter M
  And Changes (2) lists "b.ts" with M and "c.ts" with U
  And each row shows the file's folder relative to the repository

Scenario: GIT-010.2 A file staged and then changed again is in both lists
  Given "a.ts" was staged and then edited again
  When I look at Source Control
  Then "a.ts" is listed under both Staged Changes and Changes

Scenario: GIT-010.3 Each list shows its own side's change
  Given a new file was staged with "git add" and then edited
  When I look at Source Control
  Then its row under Staged Changes shows A and its row under Changes shows M
  And a deleted file shows D with its name struck through, and a staged rename shows R

Scenario: GIT-010.4 Click a staged file
  Given "a.ts" is under Staged Changes
  When I click its row
  Then a Compare tab opens with "a.ts (HEAD)" on the left and "a.ts (staged)" on the right
  And each change in it can be unstaged by itself (STAGE-002)

Scenario: GIT-010.5 Click a file under Changes
  Given "b.ts" is under Changes and is not staged
  When I click its row
  Then a Compare tab opens with "b.ts (HEAD)" on the left and the working copy on the right, using the open tab when there is one
  And for a file that is also staged the left side is "(staged)" instead
  And each change in it can be staged or discarded by itself (STAGE-001, STAGE-003)
  And clicking the row again shows that same tab instead of opening another

Scenario: GIT-010.6 New files just open
  Given an untracked file under Changes
  When I click its row
  Then the file itself opens in a tab, since there is nothing to compare it with
  And a new file that was staged and then edited again opens a Compare tab instead: "(staged)" on the left, the working copy on the right

Scenario: GIT-010.7 Double-click opens the file
  Given any row of a file that still exists
  When I double-click it, or click its "Open file" button
  Then the file opens in an editor tab

Scenario: GIT-010.8 Sections collapse and empty ones are hidden
  Given nothing is staged
  When I look at Source Control
  Then there is no Staged Changes heading
  And clicking a section heading collapses or expands its list
  And with no changes at all the panel says "No uncommitted changes."
```

## GIT-011: Stage and unstage files

- Status: draft
- Commands: `git.stageFile`, `git.unstageFile`
- Files:
  - `src/components/panels/GitPanel.tsx` — row "Stage" (+) / "Unstage" (−) buttons, heading "Stage all" / "Unstage all"
  - `src/lib/git.ts` — `stage`, `unstage` (open Source Control comparisons of the file are refreshed afterwards, STAGE-009; staging part of a file is STAGE-001 to STAGE-004)
  - `src/lib/gitCommands.ts` — `git.stageFile` (a conflicted file goes through `resolveConflicts`), `git.unstageFile`, their `enabled` rules
  - `src-tauri/src/git.rs` — `git_stage` (`add -A`, paths on stdin as a NUL list), `git_unstage` (`restore --staged`, or `rm --cached` before the first commit)
- Tests: `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer preparing a commit
**I want** to choose which files go into it
**So that** unrelated changes stay out of the commit

```gherkin
Scenario: GIT-011.1 Stage one file
  Given "b.ts" is under Changes
  When I hover its row and click "Stage" (+)
  Then "b.ts" moves to Staged Changes

Scenario: GIT-011.2 Unstage one file
  Given "a.ts" is under Staged Changes
  When I hover its row and click "Unstage" (−)
  Then "a.ts" is back under Changes with its edits intact

Scenario: GIT-011.3 Stage or unstage a whole section
  Given 5 files under Changes
  When I click "Stage all" on the Changes heading
  Then all 5 files are under Staged Changes
  And "Unstage all" on the Staged Changes heading moves them back

Scenario: GIT-011.4 Staging a deleted file stages the deletion
  Given a tracked file was deleted from the folder
  When I stage its row
  Then the deletion is staged and shows D under Staged Changes

Scenario: GIT-011.5 Unstage before the first commit
  Given a repository with no commits and a staged new file
  When I unstage it
  Then it becomes untracked again and the file stays on disk

Scenario: GIT-011.6 Stage or unstage the current file from the menu
  Given the active tab's file has unstaged changes
  When I run Git › Stage Current File
  Then that file is staged
  And Git › Unstage Current File takes it back out
  And an open comparison of that file from Changes or Staged Changes shows the new state without reloading

Scenario: GIT-011.7 Menu commands are greyed out when they do not apply
  Given the active file has no changes
  When I open the Git menu
  Then Stage Current File is greyed out
  And Unstage Current File is greyed out unless the active file has something staged
```

## GIT-012: Discard changes

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/GitPanel.tsx` — row "Discard changes" / "Delete (to the Recycle Bin)" button, heading "Discard all changes" (Changes section only)
  - `src/lib/git.ts` — `discard` (confirmation wording, `checkExternalChanges` afterwards); discarding one change or some lines of a file is STAGE-003 / STAGE-004
  - `src/lib/dialogs.ts` — `choose`
  - `src-tauri/src/git.rs` — `git_discard` (`restore --worktree` for tracked files, `trash::delete_all` for untracked ones)
- Tests: `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer who tried something that did not work out
**I want** to throw away the changes to a file, after being asked
**So that** I get back to the committed state without losing anything by accident

```gherkin
Scenario: GIT-012.1 Discard asks first
  Given "b.ts" has unstaged changes
  When I click "Discard changes" on its row
  Then a dialog "Discard changes?" says "Your changes to b.ts will be lost. Open tabs reload the committed text."
  And "Cancel" is the default button and leaves the file untouched

Scenario: GIT-012.2 Discard restores the file and reloads its tab
  Given the dialog for "b.ts" is open
  When I click "Discard"
  Then "b.ts" on disk is back to its staged version, or the committed one when nothing is staged
  And "b.ts" leaves the Changes list and an open tab of it shows the restored text

Scenario: GIT-012.3 Staged work survives a discard
  Given "a.ts" was staged and then edited again
  When I discard "a.ts" under Changes
  Then only the later edits are lost and "a.ts" stays under Staged Changes

Scenario: GIT-012.4 An untracked file goes to the Recycle Bin
  Given an untracked file "notes.txt" under Changes
  When I click its "Delete (to the Recycle Bin)" button and confirm
  Then the dialog had said "notes.txt is not tracked by git and will be moved to the Recycle Bin."
  And the file is in the Windows Recycle Bin, not permanently deleted

Scenario: GIT-012.5 Discard all
  Given 4 files under Changes, 1 of them untracked
  When I click "Discard all changes" on the Changes heading
  Then the dialog says "Your changes to 4 files will be lost (1 untracked file goes to the Recycle Bin). Open tabs reload the committed text."
  And nothing happens unless I click "Discard"

Scenario: GIT-012.6 No discard for staged rows
  Given a file under Staged Changes
  When I hover its row
  Then there is no Discard button, only Open file and Unstage
```

## GIT-013: Status line: where the branch stands against its remote

- Status: draft
- Commands: none
- Files:
  - `src/lib/gitStatus.ts` — `syncLine` (its `rewritten` case is MERGE-009's), `SyncKind`
  - `src/components/panels/GitPanel.tsx` — `SyncStatus` (text, icon per kind, action buttons, "Checking the remote…"; "Force Push…" after a rewrite of pushed commits, MERGE-009)
  - `src-tauri/src/git.rs` — `parse_status` (`branch.upstream`, `branch.ab`, `upstream_gone`)
  - `src/styles/app.css` — `.scm-sync`, `.scm-status-row`
- Tests: `src/__tests__/gitRemote.test.ts`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer who needs to know whether my work is safe on the remote
**I want** one line that separates uncommitted work from commits to push or pull
**So that** I never mistake "matches the remote" for "everything is saved"

```gherkin
Scenario: GIT-013.1 Everything is committed and pushed
  Given branch "main" tracks "origin/main" with no changes, nothing to push and nothing to pull
  When I look at the status line beside the branch
  Then it shows a tick and "Everything is committed and matches origin/main."

Scenario: GIT-013.2 Uncommitted work is never called up to date
  Given 14 changed files and nothing to push or pull
  When I look at the status line
  Then it reads "14 uncommitted changes. Your commits match origin/main."
  And it does not show the tick or the words "Everything is committed"

Scenario: GIT-013.3 Commits to push
  Given 2 local commits that origin/main does not have and 1 changed file
  When I look at the status line
  Then it reads "1 uncommitted change, 2 commits to push to origin/main."
  And a "Push" button is offered

Scenario: GIT-013.4 Commits to pull
  Given origin/main has 3 commits I do not have
  When I look at the status line
  Then it reads "3 commits to pull from origin/main."
  And a "Pull" button is offered

Scenario: GIT-013.5 Diverged branches offer both ways to pull
  Given 2 commits to push and 1 to pull
  When I look at the status line
  Then it shows a warning and "Diverged from origin/main: 2 commits to push, 1 to pull. Pull first, then push."
  And the buttons "Pull (Merge)" and "Pull (Rebase)" are offered
  And when the branch differs because Quarry rewrote commits that were already pushed, the line offers "Force Push…" instead (MERGE-009.1)

Scenario: GIT-013.6 Pull (Merge) and Pull (Rebase)
  Given diverged branches
  When I click "Pull (Merge)"
  Then the remote's commits are merged in with a merge commit
  And "Pull (Rebase)" instead replays my commits on top of the remote's without a merge commit

Scenario: GIT-013.7 A branch that is not on the remote yet
  Given branch "feature" has no upstream and the repository has a remote
  When I look at the status line
  Then it reads "feature isn't on the remote yet." with the button "Publish Branch"

Scenario: GIT-013.8 The remote branch was deleted
  Given "feature" tracks "origin/feature", which no longer exists on the remote
  When I look at the status line
  Then it shows a warning "origin/feature no longer exists on the remote." with the button "Push to Recreate It"
  And no ahead / behind numbers are shown

Scenario: GIT-013.9 No line without a remote or a branch
  Given a repository with no remote, or a detached HEAD
  When I look at Source Control
  Then no status line is shown
```

## GIT-014: Background check of the remote

- Status: draft
- Commands: none
- Files:
  - `src/lib/git.ts` — `checkRemote` (`CHECK_EVERY` = 60 s counted from the last check, failed or not; skipped while busy / already checking / no remote), `markChecked`, `remoteCheck` state
  - `src/components/panels/GitPanel.tsx` — `SyncStatus` effect (on mount and window focus), ↻ "Check the remote now" button, "Couldn't check the remote" row with Fetch
  - `src-tauri/src/git.rs` — `remote_op` "check" (`fetch --prune --quiet`, no `--all`: git fetches the branch's remote, else origin; `GCM_INTERACTIVE=never`), `quiet_options` (BatchMode ssh, HTTP low-speed limits), `GIT_TERMINAL_PROMPT=0` in `git()`
  - `src/lib/gitApi.ts` — `GitRemoteOp` "check"
- Tests: `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer who shares a branch with others
**I want** the panel to look at the remote by itself, quietly
**So that** the push / pull counts are true without me fetching, and I am never interrupted by a sign-in window I did not ask for

```gherkin
Scenario: GIT-014.1 The remote is checked when the panel opens
  Given a colleague pushed 2 commits to origin/main since my last fetch
  When I open Source Control
  Then "Checking the remote…" is shown briefly
  And the status line then reads "2 commits to pull from origin/main."

Scenario: GIT-014.2 At most once a minute
  Given the remote was checked 20 seconds ago
  When I switch to another window and back to Quarry
  Then no new check is made
  And after more than 60 seconds the next focus does check again

Scenario: GIT-014.3 Check now
  Given the remote was checked 20 seconds ago
  When I click the ↻ button on the status line, whose tooltip reads "Check the remote now (checked just now)"
  Then the remote is checked immediately

Scenario: GIT-014.4 The check only updates what git knows about the remote
  Given uncommitted changes and local commits
  When the background check runs
  Then my files, my branches and my index are unchanged
  And only the remote-tracking branches (origin/…) are updated, with deleted remote branches pruned

Scenario: GIT-014.5 The background check never asks for a sign-in
  Given the remote needs a sign-in that is not stored, or an SSH key with a passphrase
  When the background check runs
  Then no Git Credential Manager window and no SSH prompt appears
  And the panel says "Couldn't check the remote (<reason>), so this may be out of date. Fetch tries again and can ask you to sign in." with a "Fetch" button

Scenario: GIT-014.6 Not while another git action runs
  Given a push is in progress
  When Quarry gets focus
  Then no background check is started
  And the status line's action buttons are disabled while a check or another action is running

Scenario: GIT-014.7 A failed check also waits a minute
  Given the last background check failed 20 seconds ago because the network is down
  When Quarry gets focus
  Then no new check is made (an offline machine is not asked again on every focus)
  And the ↻ button or Fetch still tries at once

Scenario: GIT-014.8 Only the branch's remote is checked
  Given the repository has remotes "origin" (the branch's upstream) and "backup"
  When the background check runs
  Then only "origin" is fetched, since the status line is about the upstream
  And the header's Fetch button fetches every remote
```

## GIT-015: Fetch, pull, push and publish a branch

- Status: draft
- Commands: `git.fetch`, `git.pull`, `git.push`
- Files:
  - `src/lib/git.ts` — `remote()` (no-remote redirect, busy labels, result toasts, `checkExternalChanges` after a pull, missing-repository detection), `run`
  - `src/components/panels/GitPanel.tsx` — header Fetch / Pull / Push buttons and tooltips, `SyncStatus` action buttons, busy label
  - `src/lib/gitCommands.ts` — `git.fetch`, `git.pull`, `git.push`
  - `src/lib/gitStatus.ts` — `gitErrorText` (hint lines dropped)
  - `src-tauri/src/git.rs` — `git_remote` / `remote_op` (`fetch --all --prune`, `pull`, `pull --no-rebase`, `pull --rebase`, `push`, `push --set-upstream <origin or first remote> HEAD`; `"push-force"` is Force Push, MERGE-009: none of these ever forces)
  - `src/components/StatusBar.tsx` — busy label after the branch
- Tests: `src-tauri/src/git.rs`, `src/__tests__/gitRemote.test.ts`
- Docs: `docs/git.md`

**As a** developer sharing work through a remote
**I want** Fetch, Pull and Push one click away
**So that** I can exchange commits without a terminal

```gherkin
Scenario: GIT-015.1 Push
  Given 2 commits to push on a branch that tracks origin/main
  When I click the ↑ button in the Source Control header, whose tooltip reads "Push (2 outgoing)", or run Git › Push
  Then "Pushing…" is shown beside the branch and in the status bar while it runs
  And afterwards a message says "Pushed." and the status line shows nothing to push

Scenario: GIT-015.2 Push publishes a branch that has no upstream
  Given branch "feature" has no upstream and the remotes are "origin" and "backup"
  When I push or click "Publish Branch"
  Then "feature" is pushed to "origin" and tracks "origin/feature" from then on
  And with no remote called origin the first remote is used

Scenario: GIT-015.3 Pull
  Given 3 commits to pull
  When I click the ↓ button, whose tooltip reads "Pull (3 incoming)", or run Git › Pull
  Then the commits are brought in and a message says "Pulled."
  And open tabs whose files changed on disk are re-checked
  And when there was nothing to bring in the message is "Already up to date."

Scenario: GIT-015.4 Fetch
  Given two remotes
  When I click the cloud button, "Fetch from all remotes", or run Git › Fetch
  Then every remote is fetched and deleted remote branches are pruned
  And a message says "Fetched." and my files and branches are unchanged

Scenario: GIT-015.5 No remote yet: pointed to the form instead of failing
  Given a repository with no remote
  When I run Fetch, Pull or Push
  Then git is not run
  And Source Control opens on its Add Remote form with the message "This repository has no remote yet. Add one in Source Control."

Scenario: GIT-015.6 Failures show git's message without command-line hints
  Given the remote rejects my push because it has commits I do not have
  When I push
  Then an error shows git's message with the "hint:" lines left out
  And the status is refreshed

Scenario: GIT-015.7 One action at a time
  Given a pull is running
  When I look at the Source Control header
  Then the Fetch, Pull and Push buttons are disabled until it ends

Scenario: GIT-015.8 Unavailable without a repository
  Given no repository is known
  When I open the Git menu
  Then Fetch, Pull and Push are greyed out
```

## GIT-016: Recover when the remote repository is gone

- Status: draft
- Commands: none
- Files:
  - `src/lib/gitStatus.ts` — `isMissingRepo`
  - `src/components/panels/GitPanel.tsx` — `SyncStatus` missing-repository branch ("Create It on GitHub" only for github.com URLs, "Change URL"), sets `editRemote`
  - `src/lib/git.ts` — `remote()` and `checkRemote()` record the failure in `remoteCheck`; `editRemote` state
  - `src/components/panels/GitRepoSettings.tsx` — `RemoteForm` opens on the requested choice (`startHow`)
- Tests: `src/__tests__/gitRemote.test.ts`
- Docs: `docs/git.md`

**As a** developer whose remote repository was deleted, renamed or made invisible to my account
**I want** the panel to say so and offer the ways out
**So that** I am not left retrying a push that can never work

```gherkin
Scenario: GIT-016.1 The repository is not there
  Given remote "origin" points to a GitHub repository that was deleted
  When the remote is checked, or a fetch, pull or push fails with "repository not found"
  Then the status line shows a warning "The repository origin points to isn't there: it was deleted or renamed, or your account can't see it."
  And the buttons "Create It on GitHub" and "Change URL" are offered instead of Push or Pull

Scenario: GIT-016.2 Create It on GitHub
  Given the missing-repository warning for a github.com remote
  When I click "Create It on GitHub"
  Then the Repository section opens the Change form for "origin" with "Create a new repository on GitHub" selected

Scenario: GIT-016.3 Change URL
  Given the missing-repository warning
  When I click "Change URL"
  Then the Change form for "origin" opens with the URL choice selected and the current URL filled in

Scenario: GIT-016.4 Other hosts only offer Change URL
  Given the missing remote is not on github.com
  When I look at the status line
  Then only "Change URL" is offered

Scenario: GIT-016.5 The warning clears when the remote is changed
  Given the missing-repository warning
  When I save a new URL for "origin"
  Then the warning is gone and the remote is checked again
```

## GIT-017: Commits of the current branch

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/GitPanel.tsx` — `CommitsSection` (`COMMITS_PAGE` = 30, "N to push" (the status's ahead count) / "N to pull" counts, expand to files, "Show more", graph button)
  - `src/lib/git.ts` — `openCommitFile` (parent vs commit, `preview` Compare tab)
  - `src/lib/gitStatus.ts` — `commitFileKind`
  - `src/editor/git.ts` — `relativeTime`
  - `src-tauri/src/git.rs` — `git_log` (repository log for the root), `git_unpushed` (`rev-list --max-count=500 @{upstream}..HEAD`), `git_commit_files` (`show --name-status -M --diff-merges=first-parent`)
- Tests: `src-tauri/src/git.rs`, `src/__tests__/splitGit.test.ts`
- Docs: `docs/git.md`

**As a** developer who just committed
**I want** to see the branch's recent commits, which of them are not pushed, and what each one contains
**So that** I can check my work before pushing it

```gherkin
Scenario: GIT-017.1 The newest 30 commits are listed
  Given a branch with 75 commits
  When I look at the Commits section under the changes
  Then the 30 newest commits are listed, each with its summary, author, age and short id
  And "Show more" loads the next 30

Scenario: GIT-017.2 Unpushed commits are marked
  Given branch "main" tracks "origin/main" and has 2 commits origin does not have
  When I look at the Commits section
  Then those 2 commits are shown with an up arrow and "not pushed"
  And the section heading shows "2 to push"
  And commits already on origin/main have a tick

Scenario: GIT-017.3 Commits to pull are counted
  Given origin/main has 3 commits I do not have
  When I look at the Commits heading
  Then it shows "3 to pull"

Scenario: GIT-017.4 No marks without a remote branch
  Given a branch with no upstream, or whose upstream is gone
  When I look at the Commits section
  Then commits show neither a tick nor an arrow
  And a commit's tooltip says "This branch has no remote branch yet"

Scenario: GIT-017.5 Expand a commit to its files
  Given a commit that added "new.ts", modified "app.ts" and renamed "old.ts" to "util.ts"
  When I click the commit
  Then its files are listed under it with the letters A, M and R
  And clicking the commit again closes the list

Scenario: GIT-017.6 Open what a commit changed in a file
  Given an expanded commit 1a2b3c4 with the file "app.ts"
  When I click "app.ts"
  Then a Compare tab opens with "app.ts @ 1a2b3c4^" on the left and "app.ts @ 1a2b3c4" on the right
  And it is a preview tab that the next such click replaces
  And double-clicking a file that the commit did not delete opens the file as it is now

Scenario: GIT-017.7 Merges and empty commits
  Given a merge commit that changed nothing against its first parent
  When I expand it
  Then it says "No file changes (a merge, or an empty commit)."

Scenario: GIT-017.8 The list follows the branch
  Given the Commits section is showing
  When I commit, pull, push or switch branch
  Then the list and the pushed / not pushed marks are reloaded

Scenario: GIT-017.9 No commits yet
  Given a repository with no commits
  When I look at Source Control
  Then there is no Commits section

Scenario: GIT-017.10 A long run of unpushed commits is counted in full
  Given branch "main" has 750 commits origin/main does not have
  When I look at the Commits heading
  Then it shows "750 to push", the same count as the status line
```

## GIT-018: File history

- Status: draft
- Commands: `git.fileHistory`
- Files:
  - `src/lib/git.ts` — `showHistory`, `moreHistory` (`PAGE` = 100), `openCommitChange`, `compareCommitWithCurrent`, `history` state
  - `src/components/panels/GitPanel.tsx` — `HistorySection` ("History: name", close, rows, "Show more")
  - `src/lib/gitCommands.ts` — `git.fileHistory` (takes an optional path), `tracked()`
  - `src/components/TitleBar.tsx` — tab right-click item "Show File History"
  - `src-tauri/src/git.rs` — `git_log` (`--follow --name-only`), `parse_log` (path per commit across renames), `git_show` with `rel`
- Tests: `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer wondering how a file got the way it is
**I want** the list of commits that changed it
**So that** I can open any of those changes or compare an old version with today's

```gherkin
Scenario: GIT-018.1 Show the active file's history
  Given a tracked file "app.ts" is the active tab
  When I run Git › Show File History, or choose "Show File History" on the tab's right-click menu
  Then Source Control opens with a section "History: app.ts", below Commits and above Repository, listing the commits that changed it, newest first

Scenario: GIT-018.2 History follows renames
  Given "util.ts" was called "old.ts" three commits ago
  When I show the history of "util.ts"
  Then the commits made while it was "old.ts" are listed too
  And opening one of them shows the file under its old name

Scenario: GIT-018.3 See what a commit changed in the file
  Given the history of "app.ts" is showing
  When I click the commit 1a2b3c4
  Then a Compare tab opens with "app.ts @ 1a2b3c4^" on the left and "app.ts @ 1a2b3c4" on the right

Scenario: GIT-018.4 Compare an old version with the current file
  Given the history of "app.ts" is showing
  When I click the compare button on a commit's row, "Compare this version with the current file"
  Then a Compare tab opens with that version on the left and the open tab, or the file on disk, on the right

Scenario: GIT-018.5 Older commits load on demand
  Given a file changed by 250 commits
  When I show its history
  Then 100 commits are listed with a "Show more" button that loads the next 100

Scenario: GIT-018.6 Close the history
  Given a history section is showing
  When I click its ✕, "Close history"
  Then the section is removed from the panel

Scenario: GIT-018.7 Not offered for untracked files
  Given the active file is untracked or not in a repository
  When I open the Git menu
  Then Show File History is greyed out and the tab's right-click menu does not list it
```

## GIT-019: Commit identity (name and email)

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/GitRepoSettings.tsx` — `RepoSettings` (Repository section, opens itself when something is missing, summary line), `IdentityForm` ("Only this repository", Enter saves, Escape cancels)
  - `src/lib/git.ts` — `loadIdentity`, `saveIdentity`, `identity` state
  - `src-tauri/src/git.rs` — `git_identity` (`config --show-scope --get`), `git_set_identity` (`--global` or `--local`; a global save unsets the local values)
  - `src/components/panels/GitPanel.tsx` — "as name <email>" line under the Commit button
- Tests: `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer on a new machine or a repository that needs another identity
**I want** to see and set the name and email my commits are made with
**So that** commits are attributed to me correctly

```gherkin
Scenario: GIT-019.1 The Repository section is closed when nothing needs me
  Given a name, an email and a remote "origin" are set
  When I look at the bottom of Source Control
  Then the Repository section is collapsed and shows a summary such as "Ada · origin (private)"
  And clicking it opens "Your identity" with "Commits as Ada <ada@example.com>" and the remotes

Scenario: GIT-019.2 Missing identity opens a form by itself
  Given git has no user.name or user.email
  When I open Source Control
  Then the Repository section is open with a form saying "Git needs a name and an email to commit with."
  And the form cannot be cancelled and the section cannot be collapsed

Scenario: GIT-019.3 Save for all repositories
  Given the identity form with "Only this repository" unticked
  When I enter "Ada" and "ada@example.com" and click "Save"
  Then both are saved in git's global configuration
  And any name and email set for this repository alone are removed so the new ones apply here

Scenario: GIT-019.4 Save for this repository only
  Given the identity form
  When I tick "Only this repository" and save
  Then the name and email are saved in this repository's own configuration and other repositories are unaffected

Scenario: GIT-019.5 Both fields are required
  Given the identity form with an empty email
  When I look at the "Save" button
  Then it is disabled

Scenario: GIT-019.6 Change an existing identity
  Given "Commits as Ada <ada@example.com>" is shown
  When I click the pencil, "Change name / email"
  Then the form opens with the current values, and Escape or ✕ cancels it without saving
```

## GIT-020: Add a remote by URL

- Status: draft
- Commands: `git.addRemote`
- Files:
  - `src/components/panels/GitRepoSettings.tsx` — `RemoteForm` (URL choice, `RemoteNameInput`, "Add and Push" / "Add", Enter = and push, `canPush` needs a commit), `showForm` rule
  - `src/lib/git.ts` — `showAddRemote`, `saveRemote` (add, `noteRemote`, optional push, re-check), `addingRemote` state
  - `src/lib/gitCommands.ts` — `git.addRemote`
  - `src-tauri/src/git.rs` — `git_add_remote` (`remote add -- name url`), `remote_list`
- Tests: `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer with a local repository and an existing repository elsewhere
**I want** to add that repository as a remote and publish my branch to it
**So that** my work is backed up and shareable

```gherkin
Scenario: GIT-020.1 A repository with no remote shows the form
  Given a repository with no remote
  When I open Source Control
  Then the Repository section is open with a form saying "No remote yet. Create a repository on GitHub for this one, or use the URL of an existing, empty one."
  And the form cannot be cancelled

Scenario: GIT-020.2 Add and push
  Given the form with "Use an existing repository's URL" selected, the name "origin" and a URL typed in
  When I click "Add and Push" or press Enter in a field
  Then the remote "origin" is added with a message "Added remote origin."
  And the current branch is pushed there and tracks it

Scenario: GIT-020.3 Add without pushing
  Given the same form
  When I click "Add"
  Then the remote is added and nothing is pushed

Scenario: GIT-020.4 Nothing is pushed before the first commit
  Given a repository with no commits
  When I look at the form's buttons
  Then there is a single "Add" button, with the tooltip "Nothing is pushed until there is a commit"

Scenario: GIT-020.5 Add another remote later
  Given a repository that already has "origin"
  When I run Git › Add Remote…
  Then Source Control opens with the form saying "Add another remote." and an empty name field
  And typing the name "origin" marks the field invalid and disables the buttons
  And ✕ or Escape closes the form

Scenario: GIT-020.6 A name and a URL are required
  Given the form with an empty URL
  When I look at the buttons
  Then "Add and Push" and "Add" are disabled
```

## GIT-021: See, open and change remotes

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/GitRepoSettings.tsx` — remote rows (name, short URL, Open, Change), `RemoteForm` with `change` ("Save and Push" / "Save"; URL prefilled through `displayUrl`), `shortUrl`
  - `src/lib/gitStatus.ts` — `remoteWebUrl`, `displayUrl`
  - `src/lib/git.ts` — `saveRemote` with `replace` (toast via `displayUrl`), `markChecked`, `checkRemote(root, true)`
  - `src-tauri/src/git.rs` — `git_set_remote_url` (`remote set-url`, then drops `refs/remotes/<name>/*` with `update-ref --no-deref --stdin`)
- Tests: `src/__tests__/gitRemote.test.ts`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer whose project moves to another repository
**I want** to see my remotes, open their web page and point one somewhere else
**So that** I can carry on in the new place without editing git config by hand

```gherkin
Scenario: GIT-021.1 Remotes are listed without secrets
  Given remote "origin" is "https://ada:ghp_secret@github.com/ada/demo.git"
  When I open the Repository section
  Then the row shows "origin" and "github.com/ada/demo"
  And the token is not shown, not even in the tooltip

Scenario: GIT-021.2 Open the remote's web page
  Given remote "origin" is "git@github.com:ada/demo.git"
  When I click the arrow button on its row
  Then "https://github.com/ada/demo" opens in the browser
  And a remote whose URL has no web form has no such button

Scenario: GIT-021.3 Point a remote at another URL
  Given remote "origin" and its Change form opened with the pencil
  When I replace the URL and click "Save and Push"
  Then "origin" points to the new URL with a message "Remote origin now points to <url>."
  And the current branch is pushed to the new repository and tracks it
  And the old repository is not touched

Scenario: GIT-021.4 Old remote branches are forgotten
  Given "origin/main" and "origin/topic" were known from the old repository
  When I change the URL of "origin"
  Then those remote branches are no longer listed until the new repository has them
  And my local branches and commits are unchanged

Scenario: GIT-021.5 Save needs a different URL
  Given the Change form showing the current URL
  When I have not changed the URL
  Then "Save and Push" and "Save" are disabled

Scenario: GIT-021.6 Cancel a change
  Given the Change form is open
  When I press Escape in a field or click ✕
  Then the form closes and the remote is unchanged

Scenario: GIT-021.7 A token in the URL stays hidden when changing it
  Given remote "origin" is "https://ada:ghp_secret@github.com/ada/demo.git"
  When I open its Change form
  Then the URL field shows "https://github.com/ada/demo.git" and Save is disabled
  And after saving "https://ada:ghp_new@github.com/ada/other.git" the message reads "Remote origin now points to https://github.com/ada/other.git."
```

## GIT-022: Create a repository on GitHub and push to it

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/GitRepoSettings.tsx` — `RemoteForm` GitHub choice (repository name, Private, `GithubTarget`, "Create and Push" / "Create")
  - `src/lib/git.ts` — `createOnGithub` (sign-in toast, "Repository already exists" dialog, then `saveRemote`)
  - `src/lib/gitStatus.ts` — `repoNameFor`
  - `src-tauri/src/git.rs` — `github_create_repo` / `github_create` (`git credential fill` with optional `username=`, `approve` / `reject`), `github_api` (System32 curl, Authorization header in `-K -` on stdin), `create_repo_request` (POST /user/repos, 422 → `existing_repo`), `valid_repo_name`, `repo_from`
  - `src/lib/gitApi.ts` — `git.githubCreate`, `GithubRepo`
- Tests: `src-tauri/src/git.rs`, `src/__tests__/gitRemote.test.ts`
- Docs: `docs/git.md`

**As a** developer with a local repository that is not on GitHub yet
**I want** to create the GitHub repository and publish my branch in one step
**So that** I do not have to switch to the browser and copy URLs around

```gherkin
Scenario: GIT-022.1 Create and push
  Given a repository in the folder "My Demo" with a commit and no remote
  And the form shows "Create a new repository on GitHub" with the name "My-Demo" and "Private" ticked
  When I click "Create and Push"
  Then a private repository "My-Demo" is created on my GitHub account with a message "Created ada/My-Demo (private) on GitHub."
  And it is added as "origin" and the current branch is pushed there and tracks it

Scenario: GIT-022.2 It uses the sign-in git already has
  Given Git Credential Manager has a GitHub sign-in stored
  When I create a repository
  Then no sign-in window appears
  And with no stored sign-in Git Credential Manager opens its own sign-in window first

Scenario: GIT-022.3 The token never appears on a command line
  Given a repository is being created
  When Quarry talks to git and to GitHub
  Then the sign-in is passed to git and to curl on standard input only
  And it is never part of any process's command line, any URL or any message shown

Scenario: GIT-022.4 The name is already taken on my account, and empty
  Given my account already has an empty private repository "demo"
  When I click "Create and Push" with the name "demo"
  Then nothing is created and a dialog "Repository already exists" says "Your GitHub account already has ada/demo. It is private and empty."
  And "Use It and Push" adds it as the remote and pushes
  And "Cancel" adds no remote

Scenario: GIT-022.5 The existing repository already has commits
  Given my account already has a public repository "demo" with commits
  When the "Repository already exists" dialog is shown
  Then it says the repository is public and already has commits, and that git refuses the push if they are not part of this repository's history
  And nothing on GitHub is ever overwritten

Scenario: GIT-022.6 Invalid repository name
  Given the repository name "my demo!"
  When I click "Create and Push"
  Then nothing is sent to GitHub and an error says "a GitHub repository name can only use letters, digits, '-', '_' and '.'"

Scenario: GIT-022.7 GitHub turns the sign-in down
  Given the stored sign-in has been revoked
  When I create a repository
  Then the stored sign-in is forgotten and an error says "GitHub did not accept your sign-in. Try again to sign in afresh."

Scenario: GIT-022.8 Carry a project on in a new GitHub repository
  Given remote "origin" exists and its Change form is on "Create a new repository on GitHub"
  When I click "Create and Push"
  Then the new repository is created, "origin" is pointed at it and my branch is pushed there
  And the old repository is left as it is
```

## GIT-023: GitHub accounts

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/GitRepoSettings.tsx` — `GithubRow` (account text / `Select` for several / "Sign in" / add-account button), `GithubTarget`, `onGithub` rule
  - `src/lib/git.ts` — `loadGithub`, `setGithub`, `chooseGithub` (localStorage `quarry.githubAccount`), `githubSignIn`
  - `src-tauri/src/git.rs` — `github_accounts_list` (`git credential-manager github list`), `github_sign_in` (`github login`), `account_lines`, `github_create` (`username=` in `credential fill`)
  - `src/components/Select.tsx` — the account picker
- Tests: `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer with a personal and a work GitHub account
**I want** to see and choose which account Quarry creates repositories under
**So that** a new repository does not end up on the wrong account

```gherkin
Scenario: GIT-023.1 The signed-in account is shown
  Given Git Credential Manager is signed in to GitHub as "ada" and the repository has a github.com remote
  When I open the Repository section
  Then "Your identity" shows "GitHub ada"
  And the Create on GitHub form says "Created on the GitHub account ada (shown under Repository)."

Scenario: GIT-023.2 Choose between several accounts
  Given Git Credential Manager is signed in as "ada" and "ada-work"
  When I pick "ada-work" in the GitHub account list
  Then new repositories are created under "ada-work"
  And the choice is remembered the next time Quarry starts

Scenario: GIT-023.3 Sign in to another account
  Given "ada" is the only account
  When I click the person icon, "Sign in to another GitHub account"
  Then Git Credential Manager opens its own sign-in window
  And after signing in as "ada-work" that account is chosen and a message says "Signed in to GitHub as ada-work."

Scenario: GIT-023.4 Not signed in
  Given Git Credential Manager has no GitHub account
  When I open the Repository section of a repository with no remote
  Then the GitHub row reads "not signed in" with a "Sign in" button
  And the Create on GitHub form says "Created on your GitHub account; Git Credential Manager asks you to sign in first."

Scenario: GIT-023.5 Listing accounts never opens a window
  Given the Repository section loads
  When the accounts are read
  Then no sign-in window appears and nothing is sent over the network

Scenario: GIT-023.6 Only shown when GitHub is involved
  Given every remote is on another host and no Add Remote form is showing, or Git Credential Manager is not installed
  When I open the Repository section
  Then there is no GitHub row
```

## GIT-024: Private / Public badge on GitHub remotes

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/GitRepoSettings.tsx` — `Visibility` badge, summary "(private)" / "(public)", section kept mounted while closed
  - `src/lib/git.ts` — `loadRemoteInfo` (once per account + URL), `remoteInfo` state
  - `src-tauri/src/git.rs` — `github_repo` / `github_repo_info`, `github_slug`, `stored_github_token` (`credential fill` with `GCM_INTERACTIVE=never`), `repo_info_request`
- Tests: `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer about to push
**I want** to see whether the GitHub repository behind a remote is private or public
**So that** I do not publish something by mistake

```gherkin
Scenario: GIT-024.1 A private repository
  Given remote "origin" is a private github.com repository my stored sign-in can see
  When I open the Repository section
  Then the remote's row shows a "Private" badge
  And the collapsed section's summary reads "origin (private)"

Scenario: GIT-024.2 A public repository
  Given remote "origin" is a public github.com repository
  When I open the Repository section
  Then the row shows a "Public" badge, even when I am not signed in

Scenario: GIT-024.3 Reading visibility never asks for a sign-in
  Given no GitHub sign-in is stored
  When the badge is looked up for a private repository
  Then no sign-in window appears
  And the row shows no badge at all

Scenario: GIT-024.4 Other hosts have no badge
  Given remote "origin" is on gitlab.com, or on a host whose name merely contains "github.com" such as "notgithub.com"
  When I open the Repository section
  Then no badge is shown and GitHub is not asked

Scenario: GIT-024.5 A repository created from Quarry is badged at once
  Given I just created "ada/demo" as private from the form
  When the remote row appears
  Then it shows "Private" without another lookup
```

## GIT-025: Work with more than one repository

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/GitPanel.tsx` — repository `Select` (shown when more than one repository is known; "Show a repository…" when the open folder is not in one), `context` line under the header
  - `src/styles/app.css` — `.scm-context`, `.scm-context-name`, `.scm-context-path`
  - `src/lib/git.ts` — `current`, `currentRepo` (none while a folder that is not in a repository is open and nothing is picked), `doRefresh` (default = the open folder's deepest repository; `followFolder` only settles once a refresh has looked at the new folder, so one already running can't put the previous folder's repository back), `followOpenFolder` (called by `installGit` on a folder change), `repoKeyOf`, `repoOf` (deepest repository wins)
  - `src/components/StatusBar.tsx` — `GitStatusItem` sets `current` on click
  - `src/components/Select.tsx` — the picker
- Tests: `src/__tests__/gitRefresh.test.ts`
- Docs: `docs/git.md`

**As a** developer with a project folder open and a file from another repository in a tab
**I want** to choose which repository Source Control shows
**So that** I can commit in either without reopening folders

```gherkin
Scenario: GIT-025.1 A picker appears with two repositories
  Given the open folder is repository "quarry" and a tab holds a file from repository "notes"
  When I open Source Control
  Then a "Repository" picker at the top lists "quarry" and "notes" with their full paths as hints
  And the panel shows "quarry", the open folder's repository

Scenario: GIT-025.2 Pick the other repository
  Given the picker is showing
  When I choose "notes"
  Then the branch, changes, commits and Repository section are those of "notes"
  And the Git menu's Fetch, Pull, Push and Switch Branch… act on "notes"

Scenario: GIT-025.3 No picker with one repository
  Given only one repository is known
  When I open Source Control
  Then no repository picker is shown

Scenario: GIT-025.4 Opening another folder follows it
  Given the panel shows "notes"
  When I open a different folder that is a repository
  Then the panel shows the newly opened folder's repository

Scenario: GIT-025.5 Nested repositories
  Given a repository inside another repository's folder
  When I open a file from the inner one
  Then its markers, blame and status come from the inner repository

Scenario: GIT-025.6 The previous folder's repository does not come back
  Given the folder "quarry" (a repository) is open and a file from it is still open in a tab
  When I open the folder "site", another repository, while git status of "quarry" is still being read
  Then the panel shows "site"
  And "quarry" is only offered in the repository picker, for the tab that is still open

Scenario: GIT-025.7 Opening a folder that is not a repository
  Given the panel shows the repository "quarry" and a file from it is still open in a tab
  When I open the folder "C:\scratch", which is not in a repository
  Then the panel says "The open folder is not in a git repository."
  And a "Show a repository…" picker lists "quarry"
  And the tab's change markers still come from "quarry"

Scenario: GIT-025.8 The panel names its folder under the buttons
  Given the panel shows the repository at "C:\work\a-rather-long-project-name"
  When I open Source Control in a narrow side panel
  Then a line under the Fetch / Pull / Push / Refresh buttons shows "a-rather-long-project-name" in bold with "C:\work\a-rather-long-project-name" below it
  And both wrap onto further lines instead of being cut off
  Given the open folder is not in a repository
  When I open Source Control
  Then that line names the open folder

```

## GIT-028: Set a folder as the Source Control context

- Status: draft
- Commands: `git.setContext`
- Files:
  - `src/lib/git.ts` — `setSourceControlContext` (asks git for the folder's repository, makes it `current`, keeps the folder in view as `contextPlace` until another folder opens, opens the panel), `interesting`, `followOpenFolder` (drops it)
  - `src/lib/gitCommands.ts` — `git.setContext` (`{ path }`, else the open folder), `pathArg` (pure)
  - `src/components/FileMenu.tsx` — "Set as Source Control Context" on one folder
  - `src/lib/panels.ts` — `showPanel`
- Tests: `src/__tests__/gitRefresh.test.ts`
- Docs: `docs/git.md`, `docs/editing.md`

**As a** developer whose folder holds more than one repository, or who wants another repository in view
**I want** to point Source Control at any folder from the Explorer
**So that** I can commit there without reopening folders

```gherkin
Scenario: GIT-028.1 Set a folder from the Explorer
  Given the open folder is "C:\work" and "C:\work\api" is a repository inside it
  When I right-click the folder "api" and choose "Set as Source Control Context"
  Then the Source Control panel opens and shows the repository "api"
  And the Git menu's Fetch, Pull, Push and Switch Branch… act on "api"

Scenario: GIT-028.2 A folder inside a repository
  When I right-click "C:\work\api\src" and choose "Set as Source Control Context"
  Then the panel shows the repository "api" that holds it

Scenario: GIT-028.3 It lasts until another folder opens
  Given I set "api" as the Source Control context
  When the status refreshes (a save, window focus, Refresh)
  Then the panel still shows "api"
  When I open another folder
  Then the panel follows the new folder (GIT-025.4)

Scenario: GIT-028.4 A folder outside any repository
  When I choose "Set as Source Control Context" on a folder that is not in a repository
  Then a message says "<folder name> is not in a git repository."
  And the panel keeps showing what it showed

Scenario: GIT-028.5 From the palette
  Given a folder is open
  When I run "Set Folder as Source Control Context" from the command palette
  Then the panel shows the open folder's repository again

Scenario: GIT-028.6 Git missing or failing
  Given git is not installed, or cannot read the folder (for example "dubious ownership")
  When I choose "Set as Source Control Context"
  Then a message says so and nothing changes
```

## GIT-026: Branch in the status bar

- Status: draft
- Commands: none
- Files:
  - `src/components/StatusBar.tsx` — `GitStatusItem` (click = `pickBranch`)
  - `src/lib/gitStatus.ts` — `statusBarBranch` (branch, `*`, ↓ / ↑ counts, busy label, tooltip)
  - `src/lib/git.ts` — `repoOf`, `currentRepo`, `pickBranch`, `busy`
- Tests: `src/__tests__/gitNav.test.ts`
- Docs: `docs/git.md`

**As a** developer editing a file
**I want** the status bar to show the branch of that file's repository and whether there is work pending
**So that** I always know where I am without opening the panel

```gherkin
Scenario: GIT-026.1 Branch, changes and counts
  Given the active file is in a repository on "main" with 2 changed files, 1 commit to pull and 3 to push
  When I look at the status bar
  Then it shows "main* ↓1 ↑3"
  And its tooltip gives the repository path, "Branch main, tracking origin/main (3 to push, 1 to pull)", "2 changed files" and "Click to switch branch"

Scenario: GIT-026.2 Clean branch
  Given no changes and nothing to push or pull
  When I look at the status bar
  Then it shows just "main"

Scenario: GIT-026.3 It follows the active file
  Given tabs from two repositories
  When I switch to a tab of the other repository
  Then the status bar shows that repository's branch
  And with a tab that is in no repository it shows the Source Control panel's repository

Scenario: GIT-026.4 Click to switch branch
  Given the status bar shows the branch of repository "notes"
  When I click it
  Then the branch list opens for "notes" and Source Control now shows "notes"

Scenario: GIT-026.5 Detached, empty and busy states
  Given HEAD is detached at 1a2b3c4
  When I look at the status bar
  Then it shows "1a2b3c4 (detached)"
  And a repository with no commits shows "no commits"
  And while a push runs it shows "main · Pushing…"

Scenario: GIT-026.6 Hidden without a repository
  Given no repository is known
  When I look at the status bar
  Then there is no branch item
```

## GIT-027: Git decorations in the Explorer

- Status: draft
- Commands: none
- Files:
  - `src/components/panels/ExplorerPanel.tsx` — `gitFiles` / `gitDirs` lookups, `tree-label git-<kind>`, `tree-git` letter, `tree-git-dot`
  - `src/lib/git.ts` — `doRefresh` builds `files` and `dirs` (every folder up to the repository root, strongest kind wins)
  - `src/lib/gitStatus.ts` — `kindOf`, `KIND_RANK`, `KIND_LETTER`, `KIND_LABEL`
  - `src/styles/app.css` — `.git-*`, `.tree-git`, `.tree-git-dot`, struck-through deleted label
  - `src/styles/tokens.css` — `--git-*` colours (light and dark)
- Tests: `src/__tests__/splitGit.test.ts`
- Docs: `docs/git.md`

**As a** developer browsing the project tree
**I want** changed files and the folders that hold them to stand out
**So that** I can find my uncommitted work at a glance

```gherkin
Scenario: GIT-027.1 Changed files are coloured and lettered
  Given "app.ts" is modified, "new.ts" is untracked and "added.ts" is newly staged
  When I look at the Explorer
  Then "app.ts" is coloured as modified with the letter M, "new.ts" shows U and "added.ts" shows A
  And hovering a letter names the change, e.g. "Modified"

Scenario: GIT-027.2 Folders holding changes get a dot
  Given "src/lib/app.ts" is modified
  When I look at the Explorer
  Then the folders "src" and "src/lib" each show a dot with the tooltip "Contains changes"
  And folders with no changes inside show nothing

Scenario: GIT-027.3 A folder shows its strongest change
  Given a folder holding one untracked file and one conflicted file
  When I look at the folder's dot
  Then it has the conflict colour, since conflict outranks modified, which outranks added / renamed, which outrank deleted / untracked

Scenario: GIT-027.4 Decorations clear after a commit
  Given decorated files
  When I commit them
  Then their colours, letters and their folders' dots disappear without a manual refresh

Scenario: GIT-027.5 Unchanged and ignored files are plain
  Given a file that is unchanged, or ignored by .gitignore
  When I look at the Explorer
  Then it has no colour and no letter
```
