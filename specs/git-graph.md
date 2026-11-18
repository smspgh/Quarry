---
area: Commit Graph
prefix: GRAPH
---

# Commit Graph

The commit graph tab (`kind: "graph"`): a repository's history as a lane graph with branch and tag labels, paging, search, a details pane and the right-click actions on a commit. User documentation: `docs/git.md` ("Commit graph"). The Source Control panel itself is in `specs/git.md`; conflicts and stopped operations are in `specs/git-conflicts.md`.

## GRAPH-001: Open the commit graph in a tab

- Status: verified
- Commands: `git.graph`
- Files:
  - `src/lib/gitCommands.ts` — registers `git.graph` (always enabled, GRAPH-019)
  - `src/lib/git.ts` — `openGraph()`: reuses the repository's open graph tab, tab name `Graph · <folder>`; a notification when there is no repository
  - `src/components/GraphView.tsx` — `GraphView`, toolbar (Fetch, Reload), reload effect keyed on the repository `stamp`, `editor.registerFocus`
  - `src/components/panels/GitPanel.tsx` — graph button in `CommitsSection`
  - `src/components/MenuBar.tsx` — Git menu item
  - `src/components/TitleBar.tsx` — `DocIcon` for graph tabs
  - `src/App.tsx` — renders one `GraphView` per graph doc
  - `src/lib/store.ts` — `Doc.graph`
  - `src/lib/actions.ts` — `sessionDocs()` keeps only text and large-file tabs, so graph tabs are not saved
- Tests: `src/__tests__/graphView.test.tsx`
- Docs: `docs/git.md`

**As a** developer working in a git repository
**I want** to open the repository's history as a graph in a full-width tab
**So that** I can read branches and merges without squeezing them into the side panel

```gherkin
Scenario: GRAPH-001.1 Open from the menu
  Given the folder "C:\work\quarry" is a git repository
  When I choose Git › Show Commit Graph
  Then a tab named "Graph · quarry" opens and becomes the active tab
  And it lists the commits with the columns Commit, Author, Date and Id

Scenario: GRAPH-001.2 Open from the Source Control panel
  Given the Source Control panel shows the Commits section
  When I click the graph button in the Commits heading
  Then the graph tab of that repository opens

Scenario: GRAPH-001.3 An open graph is reused
  Given a graph tab for "C:\work\quarry" is already open behind another tab
  When I run Show Commit Graph again
  Then that tab is brought to the front
  And no second graph tab is created

Scenario: GRAPH-001.4 No repository
  Given nothing open is inside a git repository
  When I run Show Commit Graph from the Git menu or the command palette
  Then no tab opens
  And a notification says "Open a folder in a git repository"

Scenario: GRAPH-001.5 The graph follows the repository
  Given the graph tab is showing
  When I make a commit, pull, push, fetch or switch branch
  Then the graph is loaded again from the first page
  And clicking "Reload the graph" does the same on demand
  And "Fetch from all remotes" fetches and then reloads
  But switching to another tab and back, with nothing changed in the repository, keeps the pages loaded and the place in the list
  And the heading counts commits only: stash rows are not counted
  And a graph tab keeps its repository known (also after another folder is opened), so its label menus work

Scenario: GRAPH-001.6 Not restored after a restart
  Given a graph tab is open
  When I close and start Quarry again
  Then the graph tab is not among the restored tabs
```

## GRAPH-002: Read branches and merges as lanes with labels

- Status: verified
- Commands: none
- Files:
  - `src/lib/gitGraph.ts` — `layoutGraph` (first parent keeps the lane, lowest free lane reused, carried `GraphState`), `refLabels`
  - `src/components/GraphView.tsx` — `RowGraph` (SVG lines and dot), `RefBadge` (its right-click opens the ref-label menu of MERGE-002 and BRANCH-001; `open` marks the label whose menu is showing), `MAX_LANES` = 16 (the lanes shown at once; a wider graph scrolls sideways, GRAPH-017), `LANE_COLORS` = 8, `ROW` = 26
  - `src-tauri/src/git.rs` — `graph_ordered` (`log --topo-order --decorate=full`; `--author-date-order` when Date order is on, GRAPH-018), `parse_graph`, command `git_graph`
  - `src/lib/gitApi.ts` — `git.graph`, `GitGraphCommit`
  - `src/styles/app.css` — `.graph-*`, `.gl-*` lane colours
- Tests: `src/__tests__/gitGraph.test.ts`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer reading a repository's history
**I want** each branch drawn as its own line with its branch and tag names on the commits
**So that** I can see where branches fork, where they merge and what is still to push or pull

```gherkin
Scenario: GRAPH-002.1 A straight history stays in one lane
  Given a branch with 3 commits and no merges
  When I open the graph
  Then all 3 dots sit in the first lane, joined by one line

Scenario: GRAPH-002.2 A merged branch gets a second lane, then frees it
  Given "main" has a merge commit that merged branch "feature" with 1 commit
  When I open the graph
  Then the merge commit sits in the first lane with a line to each parent
  And the "feature" commit sits in the second lane
  And both lines join at the commit the branch forked from
  And the graph is 1 lane wide again below the fork

Scenario: GRAPH-002.3 The first parent keeps the lane
  Given a side branch forked from an older commit of "main"
  When I open the graph
  Then the commits of "main" stay in the first lane all the way down
  And the side branch runs beside it until its fork point
  And with uncommitted changes the first lane is that of their row and of the commit I am on: commits to pull then sit in the second lane (GRAPH-015.3)

Scenario: GRAPH-002.4 A freed lane is reused
  Given two side branches that were merged one after the other
  When I open the graph
  Then the second branch uses the lane the first one left
  And the graph never needs more than 2 lanes

Scenario: GRAPH-002.5 Commits are listed branch by branch
  Given a merged branch whose commits are older than later commits on "main"
  When I open the graph
  Then the branch's commits are listed together under the merge, not interleaved by date
  But with "Date order" on (GRAPH-018) they are listed by author date across branches

Scenario: GRAPH-002.6 Labels
  Given I am on "main", which is on the same commit as "origin/main", and tag "v1.0" and branch "feature" exist
  When I open the graph
  Then the commit of "main" shows a filled label "main" and a larger dot
  And "feature" shows an outlined label, "origin/main" a remote label and "v1.0" a tag label
  And the labels are ordered: current branch, other local branches, remote branches, tags
  And a stash row (All branches) carries a "stash" label and a hollow dot instead (STASH-010)
  And no label is shown for "origin/HEAD"
  And a right-click on a branch or tag label opens that label's own menu (MERGE-002, BRANCH-001), not the commit's
  And a branch or tag label is outlined while I point at it and while its menu is open

Scenario: GRAPH-002.7 Detached HEAD
  Given HEAD is detached on a commit
  When I open the graph
  Then that commit shows a label "HEAD" whose tooltip says "You are here (detached: not on a branch)"

Scenario: GRAPH-002.8 Very wide histories
  Given a history that needs more than 16 lanes at once
  When I open the graph
  Then the graph column stops growing at 16 lanes
  And the lanes beyond keep their own place: the column scrolls sideways to them (GRAPH-017)
```

## GRAPH-003: Long branch lines are cut short

- Status: verified
- Commands: none
- Files:
  - `src/lib/gitGraph.ts` — `MAX_SPAN` = 40, `GraphRow.cut` / `GraphRow.from`, `GraphState.cut`; lane 0 is never cut
  - `src/components/GraphView.tsx` — `RowGraph` arrows, "Continues" row of the details pane
- Tests: `src/__tests__/gitGraph.test.ts`
- Docs: `docs/git.md`

**As a** developer looking at a history with many long-lived branches
**I want** a line that would run a long way to its commit to be cut with arrows
**So that** the graph stays a few lanes wide instead of over a hundred

```gherkin
Scenario: GRAPH-003.1 A line that runs 40 rows is cut
  Given a branch that forked from a commit more than 40 rows further down
  When I scroll through the graph
  Then its line ends in a small down arrow after running 40 rows
  And its lane is free for other branches from there on
  And the commit it leads to shows an up arrow where the line comes back in

Scenario: GRAPH-003.2 Follow a cut line from the far end
  Given I select the commit a cut line leads to
  Then the details pane has a "Continues" row listing the short id of each commit whose line was cut
  When I click one of those ids
  Then that commit is selected and scrolled into view

Scenario: GRAPH-003.3 Follow a cut line from the near end
  Given I select the commit a cut line started at
  When I click its Parent link in the details pane
  Then the graph jumps to the commit at the other end of the line

Scenario: GRAPH-003.4 The first lane is never cut
  Given the branch in the first lane runs for 200 rows
  When I open the graph
  Then its line is drawn unbroken for all 200 rows
  And so is the dashed line from the uncommitted-changes row down to the commit I am on, which always runs in the first lane (GRAPH-015.4)

Scenario: GRAPH-003.5 Paging does not change the picture
  Given a history laid out in one go
  When the same history is loaded in several pages instead
  Then every commit has the same lane, lines and arrows
```

## GRAPH-004: Show the current branch or all branches

- Status: verified
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — "Current branch" / "All branches" segmented control (`all` state, starts on Current branch)
  - `src-tauri/src/git.rs` — `graph_scope` (HEAD + `@{upstream}`, or `--all` without `refs/stash`); with All branches `graph_ordered` adds one row per stash (STASH-010)
- Tests: `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer
**I want** to switch the graph between my branch and every branch
**So that** I can focus on what I am working on or look across the whole repository

```gherkin
Scenario: GRAPH-004.1 Current branch is the default
  Given "main" tracks "origin/main", which has 2 commits I have not pulled
  When I open the graph
  Then "Current branch" is selected
  And the graph shows the commits of "main" and of "origin/main", including the 2 incoming ones
  And commits that are only on other branches are not shown

Scenario: GRAPH-004.2 All branches
  When I click "All branches"
  Then the graph is loaded again with every local branch, remote branch and tag
  And each stash is shown as one row with a "stash" label above the commit it was made on (STASH-010)
  And the commits git keeps behind a stash ("index on main: …", "untracked files on main: …") are not shown

Scenario: GRAPH-004.3 A branch with no remote branch
  Given the current branch has no upstream
  When "Current branch" is selected
  Then only the commits reachable from the current commit are shown
```

## GRAPH-005: Load a long history in pages

- Status: verified
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — `load()`, `PAGE` = 300, `SLOW_PAGE_MS` = 400, `MAX_PAGE` = 4800, `generation` guard, reload on the `stamp` (head, branch, ahead / behind, upstream, operation) keeping `selected` and the scroll offset, windowed rows (`first` / `last`, 8 rows of overscan), next page when within 40 rows of the end; the first page asks git for one commit more than it shows (`takePage`), the next pages for exactly the page size
  - `src/lib/gitGraph.ts` — `GraphState` carried from page to page, `takePage` (keeps the page size, says whether one more commit came)
  - `src-tauri/src/git.rs` — `graph_ordered` (`--skip`, `--max-count` clamped to 5000; no commits before the first commit; branch order unless asked for date order, GRAPH-018)
- Tests: `src/__tests__/gitGraph.test.ts`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer with a repository of many thousands of commits
**I want** the graph to load as I scroll
**So that** it opens at once and never holds up the rest of the editor

```gherkin
Scenario: GRAPH-005.1 The first page
  Given a repository with 5,000 commits
  When I open the graph
  Then the first 300 commits are listed
  And the toolbar says "300+ commits"
  And git was asked for 301 commits: the extra one only tells "more than 300" from "exactly 300" and is not listed

Scenario: GRAPH-005.2 More commits load while scrolling
  Given 300 commits are loaded and more exist
  When I scroll to within 40 rows of the end of the list
  Then the next 300 commits are added below, with the lanes continuing unbroken
  And "Loading…" shows in the toolbar while git works

Scenario: GRAPH-005.3 The end of the history
  Given a repository with 120 commits
  When I open the graph
  Then the toolbar says "120 commits" with no plus sign
  And nothing more is requested when I scroll to the end
  And a repository with exactly 300 commits says "300 commits" at once, also with no plus sign (GRAPH-018.6)

Scenario: GRAPH-005.4 Slow pages grow
  Given a page of 300 commits took git longer than 400 ms
  When I keep scrolling down
  Then the next page asks for 1,200 commits, and after further slow pages 4,800
  And a page never asks for more than 4,800 commits

Scenario: GRAPH-005.5 Only visible rows are drawn
  Given 10,000 commits are loaded
  When I scroll through the list
  Then only the rows on screen, plus a few above and below, exist in the list
  And the scroll bar still reflects all 10,000 rows of 26 px

Scenario: GRAPH-005.6 A repository without commits
  Given a repository in which nothing has been committed yet
  When I open the graph
  Then the list says "No commits yet."
  And when files exist already, the row "Uncommitted changes (5)" stands above that note (GRAPH-015.14)

Scenario: GRAPH-005.7 git fails
  Given git cannot read the history
  When I open the graph
  Then the list says "Could not read the history:" followed by git's message

Scenario: GRAPH-005.8 A reload discards late pages
  Given a page is still being loaded
  When the graph is reloaded
  Then the late page's commits are not added to the new list

Scenario: GRAPH-005.9 What a reload keeps
  Given commit 150 of the list is selected and on screen
  When the repository changes (a commit, pull, push, checkout, a fetch that moves the upstream, or an operation starting or ending) and the graph reloads from the first page
  Then the scroll position, the selected commit and its details pane are kept
  And a selected commit beyond the first page (300 rows, or the grown page size) is no longer shown: its details pane closes and the list is left at the end of the first page, where scrolling loads the next page
  And two commits being compared stay compared, with the comparison pane unchanged, also when one is beyond the first page (COMMITCMP-001.10)
  And a selected uncommitted-changes row stays selected while there are changes (GRAPH-015), the lane column keeps its sideways scroll (GRAPH-017.9) and "Date order" stays on (GRAPH-018.10)
  But a change to the working folder alone (a file saved, staged or discarded) does not reload the graph: only the uncommitted-changes row follows it (GRAPH-015.7)
```

## GRAPH-006: Speed up a very large history

- Status: verified
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — Speed Up strip (`slowMs`, `indexed`, `indexing`, `hideSpeedUp`)
  - `src-tauri/src/git.rs` — `has_commit_graph` / `git_graph_indexed`, `write_commit_graph` / `git_graph_index` (`commit-graph write --reachable`)
  - `src/lib/gitApi.ts` — `git.graphIndexed`, `git.graphIndex`
- Tests: `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer with a very large repository
**I want** Quarry to offer to have git index the history
**So that** pages of the graph load several times faster, and only when I agree to it

```gherkin
Scenario: GRAPH-006.1 The offer appears for a slow, unindexed history
  Given the repository has no commit-graph file
  And the last page took git 1.8 seconds
  When that page has been added to the graph
  Then a strip says "This is a large history: git needed 1.8 s for the last page." and explains the index
  And it has a "Speed Up" button and a "Not now" close button

Scenario: GRAPH-006.2 Speed Up writes the index
  When I click "Speed Up"
  Then the button reads "Indexing…" and is disabled while git works
  And git writes its commit-graph file inside .git
  And a notification says "History indexed."
  And the strip disappears and pages are 300 commits again

Scenario: GRAPH-006.3 Never without being asked
  Given a slow history without a commit-graph file
  When I open, scroll, search and reload the graph without pressing "Speed Up"
  Then no commit-graph file is written

Scenario: GRAPH-006.4 Not now
  When I click the strip's "Not now" button
  Then the strip stays hidden for as long as this graph tab is open

Scenario: GRAPH-006.5 Already indexed
  Given the repository already has a commit-graph file
  When a page takes git longer than 400 ms
  Then the strip is not shown even after a slow page

Scenario: GRAPH-006.6 Indexing fails
  Given git cannot write the file
  When I click "Speed Up"
  Then git's error is shown as a notification
  And the strip stays so I can try again
```

## GRAPH-007: Find among the loaded commits

- Status: verified
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — search box, `matches` / `matchCount`, `nextMatch`, dimmed rows, Ctrl+F in `onKeyDown`
  - `src/lib/gitGraph.ts` — `commitMatches` (message, author, email, id prefix, ref names; case-insensitive)
- Tests: `src/__tests__/gitGraph.test.ts`
- Docs: `docs/git.md`

**As a** developer looking for a commit
**I want** to filter the loaded commits by message, author, id or branch name
**So that** I can step through the ones that match

```gherkin
Scenario: GRAPH-007.1 Typing marks the matches
  Given 1,200 commits are loaded and 6 of them mention "updater"
  When I type "updater" in the Find box
  Then the count next to the box says "6 in 1200 loaded"
  And the 6 matching rows stay bright while the others are dimmed
  And the uncommitted-changes row is not one of the 1,200: it never matches and is dimmed with the others (GRAPH-015.11)

Scenario: GRAPH-007.2 What is matched
  When I type text in the Find box
  Then a commit matches when the text is in its message, author name, author email or a branch / tag name on it, ignoring case
  And a commit matches when its full id starts with the text

Scenario: GRAPH-007.3 Step through the matches
  Given 6 commits match
  When I press Enter in the Find box
  Then the next match below the selected commit is selected and scrolled into view
  And Shift+Enter selects the previous one
  And stepping past the last match wraps to the first
  And the up and down arrow buttons beside the count do the same

Scenario: GRAPH-007.4 Focus the Find box
  Given the commit list has the keyboard focus
  When I press Ctrl+F
  Then the Find box is focused

Scenario: GRAPH-007.5 Escape clears the search
  Given "updater" is in the Find box
  When I press Escape in the box
  Then the box is emptied, no row is dimmed and focus returns to the commit list

Scenario: GRAPH-007.6 Nothing matches
  Given no loaded commit matches the text
  When I have typed it in the Find box
  Then the count says "0 in 1200 loaded"
  And the previous / next match buttons are disabled
  And that is also what "uncommitted" finds when only the uncommitted-changes row carries the word
```

## GRAPH-008: Search the whole history and go to a result

- Status: verified
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — `searchAll`, results list (`hits`, `hitsOpen`, `pickHit`), `goTo` (loads pages of 4,800 until the commit is in the graph, then centres it), "Show in Graph"
  - `src-tauri/src/git.rs` — `graph_search` / `git_graph_search` (`--grep`, `--author`, `-i --fixed-strings`, branch / tag names via `for-each-ref` + `--simplify-by-decoration --decorate-refs`, an id of 4-64 hex digits; newest first, de-duplicated)
  - `src/lib/gitApi.ts` — `git.graphSearch`
- Tests: `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer looking for an old commit
**I want** git to search every commit, not just the pages loaded so far
**So that** I can find a commit thousands of rows back and jump to it in the graph

```gherkin
Scenario: GRAPH-008.1 Search All History
  Given 300 commits are loaded, more exist, and "tokenizer" is in the Find box
  When I click "Search All History"
  Then a results list appears headed '3 commits in the whole history match "tokenizer" (message, author, branch / tag or id)'
  And the results are listed newest first with id, message, author and date
  And the edge under the list can be dragged to change its height (GRAPH-016)

Scenario: GRAPH-008.2 Keyboard
  Given text is in the Find box
  When I press Ctrl+Enter
  Then the whole history is searched
  And plain Enter also searches the whole history when no loaded commit matches

Scenario: GRAPH-008.3 The button is only offered while commits remain unloaded
  Given every commit of the history is already loaded
  When I type text in the Find box
  Then "Search All History" is not shown

Scenario: GRAPH-008.4 At most 200 results
  Given 450 commits match
  When I search the whole history
  Then 200 results are listed and the heading says "200+ commits"

Scenario: GRAPH-008.5 Search by id
  Given a commit with id "18bc71d…" exists
  When I search the whole history for "18bc71d"
  Then that commit is among the results

Scenario: GRAPH-008.6 The scope follows Current branch / All branches
  Given "Current branch" is selected and the text only matches a commit on another branch
  When I search the whole history
  Then the heading says 'No commit on this branch matches "…". Try All branches.'

Scenario: GRAPH-008.7 Click a result for its details
  Given a result that is not among the loaded commits
  When I click it
  Then the details pane shows that commit with a "Show in Graph" button
  And the results list shrinks to a few rows ("Show More" opens it again)
  But a list whose height I dragged keeps that height (GRAPH-016.4)

Scenario: GRAPH-008.8 Go to a result in the graph
  When I double-click a result, or click "Show in Graph"
  Then the toolbar says "Loading back to that commit…" while older pages are loaded
  And the commit is then selected and centred in the graph

Scenario: GRAPH-008.9 The commit is not in the graph shown
  Given "Current branch" is selected and I ask to go to a commit that is not on it
  When the graph has loaded to the end without finding it
  Then after loading to the end a notification says "That commit is not on this branch. Switch to All branches to see it."

Scenario: GRAPH-008.10 Editing the text closes the results
  Given the results list is showing
  When I change the text in the Find box, or click the list's close button
  Then the results list disappears

Scenario: GRAPH-008.11 Search by branch or tag name
  Given tag "v0.3.0" points at a commit far back in the history and branch "Release-2" at another
  When I search the whole history for "v0.3" or for "release"
  Then the commit the tag or branch points at is among the results, ignoring case
  And with "Current branch" selected a branch or tag on another branch's commits is not listed
```

## GRAPH-009: See a commit's details

- Status: verified
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — selection (`select`, `onKeyDown`: arrows, PageUp / PageDown, Home / End), details pane, `startResize` (120 px to 70% of the window), `copy`
  - `src-tauri/src/git.rs` — `commit_detail` / `git_commit_detail` (`--shortstat --diff-merges=first-parent`), `commit_files`
  - `src/lib/gitApi.ts` — `git.commitDetail`, `GitCommitDetail`
  - `src/lib/gitStatus.ts` — `commitFileKind`, `KIND_LETTER`, `KIND_LABEL`
- Tests: `src-tauri/src/git.rs`, `src/__tests__/graphView.test.tsx`
- Docs: `docs/git.md`

**As a** developer inspecting a commit
**I want** its full message, people, parents and changed files in a pane under the graph
**So that** I understand what it did without leaving the graph

```gherkin
Scenario: GRAPH-009.1 Select a commit
  When I click a commit in the graph
  Then that commit alone is selected (a comparison of two commits that was showing ends, COMMITCMP-001.5)
  And a details pane opens below with the full commit id, the whole message, the author with e-mail and date, its parents, its branch and tag labels
  But a Ctrl+click on another commit keeps the first and compares the two: the comparison pane takes the details pane's place (COMMITCMP-001.1)
  And it lists the changed files with their letter (A, M, D, R) under a summary such as "3 files changed, 10 insertions(+), 2 deletions(-)"
  And for a stash row it shows the stash's message, who stashed it and when, the commit it was made on as its only Parent, and the files it holds under "2 files in this stash" (STASH-010.6)

Scenario: GRAPH-009.2 Move with the keyboard
  Given the commit list has focus and a commit is selected
  When I press Down, Up, PageDown, PageUp, Home or End
  Then the selection moves by one row, by one screen, or to the first / last loaded row (the first row is the uncommitted-changes row when there is one, GRAPH-015.10)
  And the selected row is scrolled into view and the details follow
  And while two commits are being compared the move starts from the first of them and ends the comparison, and Escape ends it leaving the first selected (COMMITCMP-001.6)

Scenario: GRAPH-009.3 Copy the id
  When I click the copy button beside the full id
  Then the full commit id is on the clipboard
  And a notification says "Copied the commit id"

Scenario: GRAPH-009.4 Jump to a parent
  Given a commit with one parent
  When I click the short id after "Parent"
  Then the parent is selected in the graph, loading older pages first if needed

Scenario: GRAPH-009.5 A merge commit
  Given I select a merge commit
  When I look at the details pane
  Then the row is labelled "Parents" and lists both ids
  And the file summary ends with "(against the first parent)"

Scenario: GRAPH-009.6 The first commit
  Given I select the repository's first commit
  When I look at the details pane
  Then Parent says "none (the first commit)"

Scenario: GRAPH-009.7 Committer differs from author
  Given a commit whose committer or commit date differs from the author's
  When I look at the details pane
  Then a "Committed" row shows the committer, e-mail and date

Scenario: GRAPH-009.8 Resize and close
  When I drag the top edge of the details pane
  Then its height follows, between 120 px and 70% of the window height
  And the pane's close button clears the selection and hides the pane
  And the comparison pane of COMMITCMP-002 uses the same edge and the same height
```

## GRAPH-010: Open what a commit changed in a file

- Status: verified
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — `DetailFile` (click / Enter, double-click)
  - `src/lib/git.ts` — `openCommitFile` (parent's text vs the commit's, `preview: true`)
  - `src/lib/diff.ts` — `openCompare` replaces the previous clean preview Compare tab (also one opened from the comparison pane, `openCompareFile`, COMMITCMP-003)
  - `src-tauri/src/git.rs` — `show` / `git_show`
- Tests: none
- Docs: `docs/git.md`, `docs/compare.md`

**As a** developer reviewing a commit
**I want** to click a file in the details pane and see what the commit changed in it
**So that** I can review a commit file by file without piling up tabs

```gherkin
Scenario: GRAPH-010.1 Click a file
  Given commit "18bc71d" modified "store.ts"
  When I click "store.ts" in the details pane
  Then a Compare tab opens with "store.ts @ 18bc71d^" on the left and "store.ts @ 18bc71d" on the right
  And both sides are read-only

Scenario: GRAPH-010.2 The next file reuses the tab
  Given that Compare tab is open and untouched
  When I click another file of the commit, or a file in the comparison pane of two commits (COMMITCMP-003.3)
  Then its comparison replaces the previous one instead of adding a tab

Scenario: GRAPH-010.3 Keep a comparison
  Given a Compare tab opened from the graph
  When I double-click its tab and then click another file in the graph
  Then the first Compare tab stays and a second one opens

Scenario: GRAPH-010.4 Added and deleted files
  Given a commit added "new.ts" and deleted "old.ts"
  When I click "new.ts"
  Then the left side is empty
  And clicking "old.ts" shows its text on the left and an empty right side

Scenario: GRAPH-010.5 Binary file
  When I click a binary file in the details pane
  Then no tab opens and a notification says "This file is binary."

Scenario: GRAPH-010.6 Open the file as it is now
  When I double-click a file in the details pane
  Then the file itself opens from the working folder
  But a file the commit deleted is not opened
```

## GRAPH-011: Copy, switch, branch and tag from a commit's right-click menu

- Status: verified
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — `GraphMenu` (kept inside the window, as tall as the window allows and scrolling beyond that: `.graph-menu` in app.css; closes on outside click, Escape, window blur), naming strip (`Naming`, `commitNaming`; it also renames a branch, BRANCH-004), `act`
  - `src/lib/gitGraph.ts` — `actionDone` (success notifications)
  - `src/lib/git.ts` — `commitAction`, `checkoutRef`
  - `src-tauri/src/git.rs` — `commit_action` / `git_commit_action` (`branch` = `branch`, `branch-switch` = `switch -c`, `tag`), `valid_ref_name`, `checkout`
  - `src/lib/gitApi.ts` — `GitCommitAction`, `git.commitAction`
- Tests: `src-tauri/src/git.rs`, `src/__tests__/gitGraph.test.ts`, `src/__tests__/graphView.test.tsx`, `src/__tests__/graphMenuStyle.test.ts`
- Docs: `docs/git.md`

**As a** developer
**I want** to copy a commit's id, switch to a branch on it, or start a branch or tag there
**So that** I can act on the commit I am looking at

```gherkin
Scenario: GRAPH-011.1 The menu
  When I right-click a commit
  Then the commit is selected (alone: a comparison of two commits that was showing ends)
  And a menu opens headed by its short id and message
  And it offers Copy Commit Id, Copy Message, Create Branch Here…, Create Branch Here (Don't Switch)…, Create Tag Here…, Check Out This Commit…, the compare entries (Compare with <short id> when another commit was selected, Compare with Working Tree, Compare with Branch…; COMMITCMP-001.8, COMMITCMP-004, COMMITCMP-005), Cherry-pick, Revert This Commit…, the merge and rebase entries of MERGE-001, three Reset entries, and the edit-history group (Undo Last Commit… on the tip commit only, Reword Message…, Squash into Parent…, Drop Commit…, Edit History from Here…; HISTORY-001)
  And a stash row gets none of these: its menu is Apply Stash, Pop Stash, Drop Stash… and Copy Message (STASH-010.7)
  And it closes on Escape or a click elsewhere
  And a right-click on a branch or tag label of the row opens that label's menu instead (MERGE-002; its rename, upstream, push and delete entries are BRANCH-001)

Scenario: GRAPH-011.2 Copy
  When I choose "Copy Commit Id"
  Then the full id is on the clipboard and a notification says "Copied the commit id"
  And "Copy Message" copies the commit's first line and says "Copied the message"

Scenario: GRAPH-011.3 Switch to a branch on the commit
  Given the commit carries the labels "feature" and "origin/review"
  Then the menu has "Switch to feature" and "Switch to origin/review"
  When I choose "Switch to origin/review"
  Then a local branch "review" tracking it is checked out
  And open files that changed on disk are reloaded (SAFE-006)
  And when tabs of the repository have unsaved changes the unsaved-changes dialog comes first (SAFE-003.1)
  And the label menus of "feature" and "origin/review" have the same "Switch to …" entry, doing the same (BRANCH-001.1, BRANCH-001.3)

Scenario: GRAPH-011.4 No switch entry for the branch I am on
  Given the commit carries only the label of the current branch
  When I right-click it
  Then the menu has no "Switch to" entry

Scenario: GRAPH-011.5 Create a branch
  When I choose "Create Branch Here…"
  Then a strip "New branch at 18bc71d:" appears with a name box and a disabled "Create and Switch" button
  When I type "hotfix" and press Enter
  Then branch "hotfix" is created at that commit and checked out
  And a notification says "On new branch hotfix"

Scenario: GRAPH-011.6 Create a tag
  When I choose "Create Tag Here…", type "v1.2.0" and click "Create"
  Then tag "v1.2.0" is created on that commit
  And a notification says "Created tag v1.2.0" and the graph reloads showing the tag label

Scenario: GRAPH-011.7 Cancel naming
  Given the naming strip is open
  When I press Escape or click its Cancel button
  Then the strip closes and nothing is created

Scenario: GRAPH-011.8 Invalid name
  When I enter the name "bad name" or "-D"
  Then nothing is created and an error says the name is not valid

Scenario: GRAPH-011.9 Create a branch without switching
  Given I am on branch "main"
  When I choose "Create Branch Here (Don't Switch)…"
  Then a strip "New branch at 18bc71d:" appears with a name box and a disabled "Create" button
  When I type "keep-this" and press Enter
  Then branch "keep-this" is created at that commit
  And I am still on "main" and my files are not touched
  And a notification says "Created branch keep-this" and the graph reloads showing the new label
```

## GRAPH-012: Check out, cherry-pick or revert a commit

- Status: verified
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — `act()`
  - `src/lib/gitGraph.ts` — `actionConfirm` (the dialogs), `actionDone` (success notifications)
  - `src/lib/git.ts` — `commitAction` (busy label, error via `gitErrorText`; the unsaved-tabs `guard` for check-out, create-and-switch, cherry-pick and revert, and the tab check afterwards through `rewrite`, also after a stop or failure: SAFE-003, SAFE-006)
  - `src/lib/gitStatus.ts` — `gitErrorText` ("Stopped on a conflict…")
  - `src/lib/actions.ts` — `askDialog`
  - `src-tauri/src/git.rs` — `commit_action` (`checkout --detach`, `cherry-pick`, `revert --no-edit`; merges with `-m 1`; `GIT_EDITOR=true`)
- Tests: `src-tauri/src/git.rs`, `src/__tests__/gitRemote.test.ts`, `src/__tests__/gitGraph.test.ts`
- Docs: `docs/git.md`

**As a** developer
**I want** to check out, cherry-pick or revert a commit from the graph
**So that** I can look at an old state or move a change without the command line

```gherkin
Scenario: GRAPH-012.1 Check out asks first
  When I choose "Check Out This Commit…"
  Then a dialog "Check out this commit?" explains that I will be on no branch ("detached")
  When I confirm with "Check Out"
  Then my files become that commit and a notification says "Checked out 18bc71d"
  And the graph shows the label "HEAD" on that commit
  And when tabs of the repository have unsaved changes the unsaved-changes dialog follows my confirmation, before git runs (SAFE-002.9, SAFE-003.2)

Scenario: GRAPH-012.2 Cherry-pick
  Given I am on "main"
  Then the menu entry reads "Cherry-pick onto main…"
  When I choose it and confirm "Cherry-pick this commit?" with "Cherry-pick"
  Then a new commit with that commit's changes is on "main"
  And a notification says "Cherry-picked 18bc71d"
  And when tabs of the repository have unsaved changes the unsaved-changes dialog follows my confirmation, before git runs (SAFE-003.8)

Scenario: GRAPH-012.3 Revert
  When I choose "Revert This Commit…" and confirm with "Revert"
  Then a new commit that undoes it is added on the current branch, without asking for a message
  And a notification says "Reverted 18bc71d"
  And when tabs of the repository have unsaved changes the unsaved-changes dialog follows my confirmation, before git runs (SAFE-003.8)

Scenario: GRAPH-012.4 Cancelling does nothing
  When I cancel any of these dialogs, or the unsaved-changes dialog that follows one
  Then git is not run and nothing changes

Scenario: GRAPH-012.5 A conflict stops the operation
  Given the commit's changes conflict with my branch
  When I confirm the cherry-pick
  Then an error says "Stopped on a conflict. Resolve the files under Merge Changes in Source Control and commit, or press Abort to go back." followed by git's CONFLICT lines
  And the graph shows the stopped-operation strip
  And open tabs of the conflicted files show git's conflict markers at once (SAFE-006.4)

Scenario: GRAPH-012.6 A merge commit
  When I cherry-pick or revert a merge commit
  Then its changes against its first parent are picked or undone

Scenario: GRAPH-012.7 Detached HEAD wording
  Given HEAD is detached
  When I right-click a commit
  Then the menu entry reads "Cherry-pick onto Here…"
  And the dialog says the commit is copied onto "the current commit (not on a branch)"
```

## GRAPH-013: Reset the branch to a commit

- Status: verified
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — Reset menu entries (hard one styled as dangerous), `act()`
  - `src/lib/gitGraph.ts` — `actionConfirm` (the dialogs; the hard reset counts the changes it loses)
  - `src/lib/git.ts` — `commitAction`
  - `src-tauri/src/git.rs` — `commit_action` (`reset --soft` / `--mixed` / `--hard`)
- Tests: `src-tauri/src/git.rs`, `src/__tests__/gitGraph.test.ts`
- Docs: `docs/git.md`

**As a** developer who wants to take commits back
**I want** to move my branch to an earlier commit, choosing what happens to the later changes
**So that** I can redo commits, and never lose work without being told

```gherkin
Scenario: GRAPH-013.1 The entries name the branch
  Given I am on "main"
  When I right-click a commit
  Then the menu has "Reset main to Here (Soft)…", "Reset main to Here (Mixed)…" and "Reset main to Here (Hard)…"
  And with a detached HEAD they read "Reset HEAD to Here (…)…"

Scenario: GRAPH-013.2 Soft
  When I choose the Soft entry and confirm "Reset (soft)?" with "Reset (Soft)"
  Then "main" points at that commit
  And the changes of the commits after it are staged, and my files are untouched
  And a notification says "Reset to 18bc71d"

Scenario: GRAPH-013.3 Mixed
  When I choose the Mixed entry and confirm with "Reset (Mixed)"
  Then "main" points at that commit and the later changes are in my files, unstaged

Scenario: GRAPH-013.4 Hard warns about uncommitted work
  Given I have 3 uncommitted changes
  When I choose the Hard entry
  Then a dialog "Reset (hard) and discard changes?" says the later commits leave the branch, "and your 3 uncommitted changes to tracked files are lost", and that it can't be undone from Quarry
  When I confirm with "Reset and Discard"
  Then every tracked file matches that commit
  And open tabs of files that changed are reloaded from the disk
  And when tabs of the repository have unsaved edits the dialog names them, and those whose file the reset rewrote reload without a second question (SAFE-004.4, SAFE-004.5)

Scenario: GRAPH-013.5 Cancel
  When I cancel a reset dialog
  Then the branch and files are unchanged
```

## GRAPH-014: See a stopped operation above the graph

- Status: verified
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — `.graph-strip` rows (stopped operation, stash conflicts; uncommitted changes are a row of the list, GRAPH-015), `openSourceControl()` (focuses the first Merge Changes row, else the first change), Abort button
  - `src/lib/git.ts` — `abortOperation`
  - `src/lib/gitStash.ts` — `isStashConflict`, `stashConflictStrip` (the strip for conflicts with no operation in progress)
  - `src/lib/panels.ts` — `isPanelShown`, `showPanel`
- Tests: `src/__tests__/graphView.test.tsx`
- Docs: `docs/git.md`

**As a** developer looking at the graph
**I want** to be told about work that is not in it and about an operation that stopped part-way
**So that** I am not misled by the graph and can get to the fix

```gherkin
Scenario: GRAPH-014.1 Uncommitted changes are a row, not a strip
  Given I have 4 uncommitted changes on "main" and nothing is in progress
  When I look at the graph tab
  Then no strip under the toolbar mentions them
  And they are the first row of the graph, "Uncommitted changes (4)" (GRAPH-015.1)

Scenario: GRAPH-014.2 A stopped operation
  Given a cherry-pick stopped with 1 conflicted file
  When I look at the graph tab
  Then a warning strip says "The cherry-pick stopped part-way: 1 file has conflicts. Resolve them in Source Control and commit, or abort to go back to how things were."
  And it has an "Abort" button
  And the conflicted file is counted in the uncommitted-changes row below, the first row of the list (GRAPH-015.12)

Scenario: GRAPH-014.3 Open Source Control from the strip
  Given the Source Control panel is not showing
  When I click "Open Source Control" in the strip, or in the details pane of the uncommitted-changes row (GRAPH-015.5)
  Then the panel opens with focus on the first file under Merge Changes, or on the first changed file

Scenario: GRAPH-014.4 The button is hidden when it would do nothing
  Given the Source Control panel is already showing
  When I look at the graph tab
  Then the strips have no "Open Source Control" button
  And neither has the details pane of the uncommitted-changes row

Scenario: GRAPH-014.5 Abort from the strip
  When I click "Abort" in the strip
  Then I am asked "Abort the cherry-pick?" before anything is undone

Scenario: GRAPH-014.6 Conflicts left by a stash
  Given 2 files are in conflict and no operation is in progress (a stash was applied or popped, STASH-009)
  When I look at the graph tab
  Then a warning strip says "A stash was applied with conflicts: 2 files have conflicts. Resolve them in Source Control."
  And it has no "Abort" button
  And the 2 files are counted in the uncommitted-changes row, the first row of the list

Scenario: GRAPH-014.7 While the Edit History list is open
  Given the Edit History list is open in the graph tab (HISTORY-007)
  When I look at the graph tab
  Then the strips are still shown above the list
  And when an operation stops part-way the list closes and the commit rows are back under the stopped-operation strip
```

### Decisions (planned stories)

GRAPH-015 to GRAPH-019 come from `GIT-ROADMAP.md` ("7. Graph polish" and the `git.graph` fix in "0."); all five are built (`draft`). The roadmap left some choices open; these are the ones the stories below assume.

Built as decided, with these additions: the uncommitted row's parent is the current commit's full id, taken from the loaded page or asked from git (`git_head_sha`) when that commit is further down; the row's count follows the status on its own, and only its coming and going lays the loaded rows out again (no history is read for it); the first page of every load asks for one commit more than it shows, which is how "exactly 300 commits" is known; a results list that already shows everything is not given a remembered height by a drag that changes nothing.

- **Uncommitted row (GRAPH-015).** The row is laid out as one extra commit whose only parent is the current commit, placed first in the list. It therefore takes the first lane, and so does the current commit's line below it; the first lane is never cut (GRAPH-003.4), so the row's line always reaches the current commit, however far down that is. The row replaces the uncommitted-changes strip of GRAPH-014.1; the stopped-operation strip with Abort stays, and the row shows during a stopped operation too. The row has no right-click menu. The count is the number of changed files, as in the strip today. Next to the other planned git specs: the warning strip a stash leaves when it came back with conflicts (STASH-009.12) stays a strip, like the stopped-operation strip; the row is not a commit, so none of the entries other specs add to the commit menu (merge, rebase, compare, edit history) applies to it, and it cannot be picked with Ctrl+click for Compare Commits (COMMITCMP-001: Compare with Working Tree on a commit is the way to compare with uncommitted work); while the Edit History list is open (HISTORY-007) it replaces every row, this one included; a file clicked in the row's details pane opens the Source Control comparison, so it has the partial-staging controls of STAGE-001.
- **Results divider (GRAPH-016).** Same kind of divider as the details pane. Limits: at least 80 px, never taller than its content, and the commit list always keeps 156 px (6 rows). A dragged height is the user's choice: it is kept for the tab, and clicking a result no longer shrinks the list. Not saved across restarts (graph tabs are not in the session).
- **Lanes beyond 16 (GRAPH-017): horizontal scroll of the lane column**, not a wider cap and not smarter cutting. A wider cap takes the room from the Commit column on every row (44 lanes = 534 px) for the sake of a few rows; smarter cutting means changing `layoutGraph`, whose results must stay identical page by page (GRAPH-003.5) and keep lane 0 uncut. Scrolling is drawing only: every lane gets its own position (none share a column), the column still shows at most 16 lanes (198 px), and the layout is untouched. To make hidden lanes hard to miss: faded edges, a scroll bar under the column heading, and selecting a commit scrolls its dot into view.
- **Owner confirmations (2026-11-16).** Lanes beyond 16 scroll sideways: confirmed. Date order has no size limit any more (GRAPH-018, below).
- **Date order (GRAPH-018).** For a history of any size (owner, 2026-11-16; it was first limited to 300 commits, because date order spreads a large history over more lanes, but the lane column scrolls sideways (GRAPH-017) and long lines are cut after 40 rows, so the width stays usable). The order is git's author-date order (newest first, but a commit is never listed above one of its children), so the rows follow the Date column, which shows author dates. Per graph tab, off by default, not saved. Long lines are still cut after 40 rows.
- **Palette entry without a repository (GRAPH-019).** `git.graph` loses its `enabled` condition, so it is available everywhere (palette, Git menu, a recorded macro), and running it with no repository shows one notification, "Open a folder in a git repository", whether or not a folder is open. The other repository commands (Fetch, Pull, Push, Switch Branch…, Add Remote…) keep their condition.
- **Shared with the other planned git specs.** The planned order of the commit's right-click menu and of the Git menu, the ref-label menu (a right-click on a branch or tag label, MERGE-002 / BRANCH-001) and the branch picker's purposes are written down once, in the Decisions of `specs/git-merge-rebase.md`. None of the owner decisions of 2026-11-13 (Force Push after rewriting pushed commits, the one unsaved-tabs dialog) changes GRAPH-015 to GRAPH-019.

## GRAPH-015: Uncommitted changes as the first row of the graph

- Status: verified
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — the uncommitted row (`uncommittedRow`, first row of `commits` with the id `UNCOMMITTED`; `RowGraph` `uncommitted`: hollow dot, dashed line in lane 0 down to `lineEnd`), added by `load()` on the first page and by the `dirty` effect (`place()` lays the loaded rows out again when the row comes or goes; `headOf` finds the current commit's full id), `extra` / `total` (counts and paging without the row), selection / keyboard / find / right-click / Ctrl+click over a row that is not a commit; there is no uncommitted-changes `.graph-strip` any more
  - `src/components/GraphUncommitted.tsx` — the row's details pane: heading (`uncommittedHeading`), Based on, the files in Source Control's groups (`ChangedFile`: click = `openChange`, double-click = the file), Open Source Control
  - `src/lib/gitGraph.ts` — `UNCOMMITTED`, `isUncommitted`, `withUncommitted` (the extra row first, before `layoutGraph`), `withoutUncommitted`, `rowOffset` (row index = commit index + this), `uncommittedLineEnd`
  - `src/lib/git.ts` — `openChange` (reused for a click on a file), `useGit` repository `files` (the row follows it without reloading the history)
  - `src/lib/gitStatus.ts` — `groupFiles`, `rowKind`: Merge Changes / Staged Changes / Changes and the letters, shared with the panel
  - `src-tauri/src/git.rs` — `head_sha` / `git_head_sha` (the current commit's full id, when it is not on the first page)
  - `src/lib/gitApi.ts` — `git.headSha`
  - `src/styles/app.css` — `.graph-row.uncommitted`, `.gn.uncommitted` (hollow dot), `.gl.dashed`, `.graph-uncommitted-*`
- Tests: `src/__tests__/gitGraph.test.ts`, `src/__tests__/graphPolish.test.tsx`, `src/__tests__/graphView.test.tsx`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer with work that is not committed yet
**I want** that work to be the top row of the graph, on the commit it sits on
**So that** I see where my changes belong and can look at the changed files without leaving the graph

```gherkin
Scenario: GRAPH-015.1 The row
  Given I am on "main" with 4 changed files and the newest commit of "main" is "18bc71d"
  When I open the graph
  Then the first row of the list reads "Uncommitted changes (4)" with a hollow dot in the first lane
  And a dashed line joins it to the commit "18bc71d" below it
  And its Author, Date and Id columns are empty
  And no strip under the toolbar mentions uncommitted changes

Scenario: GRAPH-015.2 Nothing to commit
  Given the working folder has no changes
  When I open the graph
  Then the first row is the newest commit
  And there is no "Uncommitted changes" row

Scenario: GRAPH-015.3 The current commit is not the newest row
  Given "origin/main" has 2 commits I have not pulled and I have 1 changed file
  When I open the graph
  Then "Uncommitted changes (1)" is the first row, above the 2 incoming commits
  And its line runs down the first lane past them and ends at the commit labelled "main"
  And the 2 incoming commits sit in the second lane

Scenario: GRAPH-015.4 The current commit is far down
  Given "All branches" is selected and the commit I am on is 500 rows down
  When I look at the top of the graph
  Then the row's line runs down the first lane, never cut by an arrow, until it reaches that commit

Scenario: GRAPH-015.5 Select the row
  Given 1 staged file "store.ts" and 2 unstaged files "app.css" and "notes.txt" (new)
  When I click the "Uncommitted changes (3)" row
  Then the details pane is headed "Uncommitted changes on main"
  And it lists "store.ts" under "Staged Changes" and "app.css" and "notes.txt" under "Changes", each with the letter Source Control shows for it
  And it has a "Based on" row with the short id "18bc71d", which selects that commit when clicked
  And it shows no message, author, parent or copy-id button
  And when Source Control is not showing it has an "Open Source Control" button

Scenario: GRAPH-015.6 Open a changed file
  Given the uncommitted row is selected
  When I click "app.css" in the details pane
  Then the Compare tab that Source Control opens for that file opens, with "app.css (HEAD)" on the left and the working file on the right
  And clicking the new file "notes.txt" opens the file itself
  And double-clicking a file opens it from the working folder, in front of the Compare tab its first click opened, and the second click opens no second Compare tab (`fileRowClick` / `fileRowDoubleClick` in `src/lib/gitCompare.ts`; the same in an ordinary commit's file list)

Scenario: GRAPH-015.7 The row follows my work
  Given the graph shows "Uncommitted changes (3)" and I have scrolled 200 rows down with a commit selected
  When I save an edit to a fourth file
  Then the row reads "Uncommitted changes (4)"
  And the scroll position and the selected commit are unchanged

Scenario: GRAPH-015.8 The changes go away
  Given the uncommitted row is selected and its details pane is open
  When I commit or discard every change
  Then the row disappears and the details pane closes
  And the newest commit is the first row

Scenario: GRAPH-015.9 No commit actions on the row
  When I right-click the uncommitted row
  Then the row is selected
  And no menu opens: nothing offers to cherry-pick, revert, check out, reset to, branch from or tag it

Scenario: GRAPH-015.10 Keyboard
  Given the commit list has focus and the first commit is selected
  When I press Up
  Then the uncommitted row is selected and its files are shown
  And Home selects it too, and Down moves back to the first commit

Scenario: GRAPH-015.11 Find and counts leave the row out
  Given 300 commits are loaded and I have 4 changed files
  When I type "uncommitted" in the Find box
  Then the count says "0 in 300 loaded" and the toolbar still says "300+ commits"
  And the uncommitted row is dimmed like the commits that do not match
  And Enter never steps onto it

Scenario: GRAPH-015.12 During a stopped operation
  Given a cherry-pick stopped with 1 conflicted file and 2 other changed files
  When I look at the graph tab
  Then the warning strip with "Abort" is shown under the toolbar as before
  And the first row reads "Uncommitted changes (3)"
  And selecting it lists the conflicted file under "Merge Changes", and clicking that file opens the file itself with its conflict bars

Scenario: GRAPH-015.13 Detached HEAD
  Given HEAD is detached on a commit and I have 2 changed files
  When I select the uncommitted row
  Then the details pane is headed "Uncommitted changes (not on a branch)"
  And the row's line ends at the commit labelled "HEAD"

Scenario: GRAPH-015.14 A repository without commits
  Given nothing has been committed yet and 5 new files exist
  When I open the graph
  Then the list shows the row "Uncommitted changes (5)" with no line below it, above "No commits yet."

Scenario: GRAPH-015.15 The row scrolls with the list
  Given the graph shows the uncommitted row
  When I scroll 100 rows down
  Then the row has scrolled out of view with the commits; it is not pinned to the top

Scenario: GRAPH-015.16 The row cannot be picked for a comparison
  Given commit "18bc71d" is selected and the uncommitted row is showing
  When I Ctrl+click the uncommitted row
  Then the row is selected alone, as with a plain click, and its file list shows
  And no comparison of two commits opens
```

## GRAPH-016: Drag the height of the Search All History results

- Status: verified
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — results list height (`hitsH`, an inline `max-height` while the list is open; `startHitsResize` beside `startResize`, measuring the limits when the drag starts), divider `.graph-hits-resizer` under `.graph-hits` (double-click clears `hitsH`), how `hitsOpen` / Show Fewer / Show More and `pickHit` behave once a height was dragged
  - `src/lib/gitGraph.ts` — pure `clampHitsHeight(wanted, content, available)`, `HITS_MIN` = 80, `LIST_MIN` = 156
  - `src/styles/app.css` — `.graph-hits` (`max-height: 34%` / compact 100 px are the defaults only), `.graph-hits.sized` (a dragged list gives way to the commit list's 156 px in a small window), `.graph-hits-resizer` (reuses `.graph-resizer`)
- Tests: `src/__tests__/gitGraph.test.ts`, `src/__tests__/graphPolish.test.tsx`
- Docs: `docs/git.md`

**As a** developer going through many search results
**I want** to drag the edge between the results and the graph
**So that** I decide how much room each gets, as I already can for the details pane

```gherkin
Scenario: GRAPH-016.1 Drag the divider
  Given a search of the whole history lists 60 results in a list 220 px tall
  When I drag the divider under the results 150 px down
  Then the results list is 370 px tall and the commit list below is 150 px shorter
  And the pointer shows the up-down resize cursor over the divider

Scenario: GRAPH-016.2 Limits
  Given the results list is showing
  When I drag the divider as far up as it goes
  Then the results list stops at 80 px: its heading and one result stay visible
  When I drag it as far down as it goes
  Then it stops while the commit list still has 156 px (6 rows)

Scenario: GRAPH-016.3 Never taller than its content
  Given a search found 2 results
  When I drag the divider down
  Then the results list does not grow beyond its heading and 2 rows: no empty space opens under them

Scenario: GRAPH-016.4 A dragged height stays when I pick a result
  Given I dragged the results list to 370 px
  When I click a result
  Then its details open and the results list is still 370 px tall
  And the clicked result is still in view

Scenario: GRAPH-016.5 Before any drag nothing changes
  Given I have not dragged the divider in this tab
  When I click a result
  Then the results list shrinks to a few rows as before, and "Show More" opens it again

Scenario: GRAPH-016.6 Show Fewer and Show More after a drag
  Given I dragged the results list to 370 px
  When I click "Show Fewer"
  Then the list shrinks to a few rows
  When I click "Show More"
  Then it is 370 px tall again

Scenario: GRAPH-016.7 The height is kept for the tab
  Given I dragged the results list to 370 px and closed the results
  When I search the whole history for another text in the same graph tab
  Then the new results open 370 px tall, or as tall as their content when that is less
  But after Quarry restarts and the graph is opened again the results use the default height

Scenario: GRAPH-016.8 Double-click resets
  Given I dragged the results list to 370 px
  When I double-click the divider
  Then the results list goes back to its default height and shrinks again when a result is picked

Scenario: GRAPH-016.9 The window gets smaller
  Given the results list is 370 px tall
  When I shrink the window until 370 px no longer leaves 156 px for the commit list
  Then the results list becomes shorter so the commit list keeps 156 px

Scenario: GRAPH-016.10 No divider without results
  Given no whole-history search has been run, its results were closed, or it found no commit
  When I look at the graph tab
  Then there is no results divider
  And the details pane's own divider works as before
```

## GRAPH-017: Scroll sideways through a graph wider than 16 lanes

- Status: verified
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — `x()` gives every lane its own place; `RowGraph` drawn at the full width (`fullW`) inside the `graphW` column and shifted by the shared `laneScroll` (in lanes; `lanePx` goes to the rows as the CSS variable `--lane-scroll`); `MAX_LANES` = 16 stays the visible width; Shift+wheel on the lane column (a non-passive `wheel` listener on the list), reveal of the selected dot, `lanes-left` / `lanes-right` (faded edges), reset on a scope switch
  - `src/components/GraphLaneScroll.tsx` — the scroll bar under the lane column's heading (in `.graph-head`), only while the graph is wider than 16 lanes
  - `src/lib/gitGraph.ts` — pure `revealLane(scroll, lane, visibleLanes, totalLanes)`, `clampLaneScroll`; `layoutGraph` is not changed
  - `src/styles/app.css` — `.graph-lanes` (shifted by `--lane-scroll`), `.graph-list.lanes-left` / `.lanes-right` (edge fades on `.graph-lane-cell`), `.graph-lane-scroll`
- Tests: `src/__tests__/gitGraph.test.ts`, `src/__tests__/graphPolish.test.tsx`
- Docs: `docs/git.md`

**As a** developer reading a history with dozens of branches open at once
**I want** every lane to keep its own place, with the lane column scrolling sideways
**So that** lines past the 16th are not drawn on top of each other and the Commit column keeps its room

```gherkin
Scenario: GRAPH-017.1 Lanes past the 16th keep their own place
  Given a row with commits or lines in lanes 17, 20 and 33
  When I scroll the lane column all the way to the right
  Then the three are drawn in three different places, 12 px per lane apart
  And no two lanes are ever drawn in the same place

Scenario: GRAPH-017.2 The column does not grow
  Given the widest loaded row needs 44 lanes
  When I look at the graph
  Then the lane column is 16 lanes (198 px) wide, showing lanes 1 to 16
  And the Commit, Author, Date and Id columns are where they are in a 16-lane graph

Scenario: GRAPH-017.3 Scroll sideways
  Given the widest loaded row needs 44 lanes
  When I hold Shift and turn the mouse wheel over the lane column, or drag the scroll bar under the lane column's heading
  Then the lanes of every row move sideways together
  And the text columns do not move
  And the list does not scroll up or down

Scenario: GRAPH-017.4 Hidden lanes are signalled
  Given the widest loaded row needs 44 lanes and the column shows lanes 1 to 16
  When I look at the lane column
  Then its right edge is faded
  When I scroll it to lanes 10 to 25
  Then both edges are faded
  And at lanes 29 to 44 only the left edge is faded

Scenario: GRAPH-017.5 Selecting a commit brings its dot into view
  Given the column shows lanes 1 to 16
  When I select a commit in lane 30 by clicking its text, with the arrow keys, by stepping through Find matches or with "Show in Graph"
  Then the lane column scrolls just far enough to show its dot
  When I then select a commit in lane 1
  Then the column scrolls back to show lane 1

Scenario: GRAPH-017.6 Narrow histories are unchanged
  Given no loaded row needs more than 16 lanes
  When I look at the graph
  Then there is no lane scroll bar and no faded edge
  And Shift+wheel over the lane column does nothing
  And the column is only as wide as the widest row, as before

Scenario: GRAPH-017.7 The scroll bar appears when a wider page loads
  Given the first 300 commits need 9 lanes
  When a later page with a row of 22 lanes is loaded
  Then the lane column is 16 lanes wide and its scroll bar appears
  And the lanes shown do not jump: lanes 1 to 16 are still in view

Scenario: GRAPH-017.8 The layout itself is the same
  Given a history whose worst row needs 44 lanes
  When I compare it with the graph before this change
  Then every commit is in the same lane with the same lines, cut arrows and colours
  And lines are still cut after 40 rows

Scenario: GRAPH-017.9 Reload and switching scope
  Given the lane column is scrolled to lanes 10 to 25
  When the graph reloads after a commit
  Then lanes 10 to 25 are still in view if the graph is still that wide
  When I switch between "Current branch" and "All branches"
  Then the column starts again at lane 1
```

## GRAPH-018: List the history by date

- Status: verified
- Commands: none
- Files:
  - `src/components/GraphView.tsx` — "Date order" toggle in the toolbar (`byDate` state, off by default; `orderOk`), enabled once the first page of the scope shown has arrived (`countedFor`), for a history of any size; pages in date order like branch order; `orderKeep` (the selected commit is brought back into view after the switch)
  - `src-tauri/src/git.rs` — `graph_ordered` / `git_graph` take the order (`--topo-order`, or `--author-date-order` for `order: "date"`)
  - `src/lib/gitApi.ts` — `git.graph` order argument
  - `src/lib/gitGraph.ts` — `takePage` (the "300+ commits" count); `layoutGraph` unchanged (works on any children-before-parents order)
  - `src/styles/app.css` — `.graph-order` (the toggle, disabled while loading)
- Tests: `src/__tests__/gitGraph.test.ts`, `src/__tests__/graphPolish.test.tsx`, `src-tauri/src/git.rs`
- Docs: `docs/git.md`

**As a** developer
**I want** to list the commits newest first across branches
**So that** I can read what happened in the order it happened

```gherkin
Scenario: GRAPH-018.1 Branch order is the default
  Given a repository with 40 commits
  When I open the graph
  Then the "Date order" button in the toolbar is not pressed
  And commits are listed branch by branch, as before

Scenario: GRAPH-018.2 Date order interleaves branches
  Given "main" has commits authored at 10:00 and 12:00, branch "feature" has one authored at 11:00, and "feature" was merged into "main" at 13:00
  When I click "Date order"
  Then the rows from the top are: the 13:00 merge, the 12:00 commit, the 11:00 "feature" commit, the 10:00 commit
  And the lines still join each commit to its parents, with "main" in the first lane
  When I click "Date order" again
  Then the "feature" commit is listed directly under the merge again

Scenario: GRAPH-018.3 A commit is never above its child
  Given a commit whose author date is later than that of the commit made on top of it (a clock was wrong, or it was amended)
  When "Date order" is on
  Then the commit made on top is still listed above it

Scenario: GRAPH-018.4 The order follows the Date column
  Given a commit authored on 1 March was cherry-picked onto "main" on 20 March, above commits authored on 10 March
  When "Date order" is on and nothing else forces its place
  Then it is listed by 1 March, the date its Date column shows

Scenario: GRAPH-018.5 Any size of history
  Given the history shown has more than 300 commits (the toolbar says "300+ commits")
  When I click "Date order"
  Then the first 300 commits are listed in date order
  And scrolling to the end loads the next 300, still in date order, with the lanes continuing unbroken
  And when the branches spread over more than 16 lanes the lane column scrolls sideways (GRAPH-017)

Scenario: GRAPH-018.6 Exactly 300 commits
  Given the history shown has exactly 300 commits
  When I look at the toolbar
  Then it says "300 commits", with no plus sign: the first page asks git for one commit more than it shows
  And with 301 commits it says "300+ commits"

Scenario: GRAPH-018.7 It stays on when the scope changes
  Given "Current branch" shows 120 commits and "Date order" is on
  When I click "All branches", which has 2,000 commits
  Then the graph is listed in date order
  And no notification is shown

Scenario: GRAPH-018.8 It stays on when the history grows
  Given "Date order" is on with 298 commits shown
  When a fetch brings 5 more commits into the graph
  Then the graph reloads, still in date order

Scenario: GRAPH-018.9 Switching keeps my place
  Given a commit is selected and its details pane is open
  When I turn "Date order" on or off
  Then the same commit is still selected, scrolled into view, with its details showing

Scenario: GRAPH-018.10 Everything else works the same
  Given "Date order" is on
  When I use Find, the right-click actions, the details pane or the uncommitted-changes row
  Then they behave as in branch order
  And a reload after a commit keeps "Date order" on
  And a line that would run 40 rows is still cut with arrows

Scenario: GRAPH-018.11 Not remembered
  Given "Date order" is on in a graph tab
  When I close the tab and open the graph again
  Then the graph is in branch order

Scenario: GRAPH-018.12 While loading
  Given the first page has not arrived yet
  When I look at the toolbar
  Then "Date order" is disabled until the commit count is known
  And its tooltip says "Available once the commits are counted"
```

## GRAPH-019: Show Commit Graph is in the palette without a repository

- Status: verified
- Commands: `git.graph`
- Files:
  - `src/lib/gitCommands.ts` — `git.graph` registered without `enabled: hasRepo`
  - `src/lib/git.ts` — `openGraph()`: the notification when there is no repository
- Tests: `src/__tests__/gitCommands.test.ts`
- Docs: `docs/git.md`

**As a** developer who has not opened a repository yet
**I want** Show Commit Graph to be in the command palette anyway and tell me what it needs
**So that** I find the feature when I search for it instead of concluding Quarry has no commit graph

```gherkin
Scenario: GRAPH-019.1 Listed with nothing open
  Given no folder and no file is open
  When I open the command palette and type "graph"
  Then "Git: Show Commit Graph" is listed

Scenario: GRAPH-019.2 Running it says what is needed
  Given no folder and no file is open
  When I run "Show Commit Graph" from the palette
  Then no tab opens
  And a notification says "Open a folder in a git repository"

Scenario: GRAPH-019.3 A folder that is not a repository
  Given the open folder "C:\notes" is not inside a git repository
  When I run "Show Commit Graph" from the palette
  Then no tab opens
  And the notification says "Open a folder in a git repository"

Scenario: GRAPH-019.4 The same from the Git menu
  Given nothing open is inside a git repository
  When I open the Git menu
  Then "Show Commit Graph" is not greyed out
  And choosing it shows the same notification and opens nothing

Scenario: GRAPH-019.5 With a repository nothing changes
  Given the folder "C:\work\quarry" is a git repository
  When I run "Show Commit Graph" from the palette
  Then the tab "Graph · quarry" opens and no notification is shown

Scenario: GRAPH-019.6 Other repository commands stay out of the palette
  Given nothing open is inside a git repository
  When I open the command palette and type "git"
  Then Fetch, Pull, Push, Switch Branch… and Add Remote… are not listed
  And "Show Commit Graph", "Show Source Control" and "Refresh Git Status" are

Scenario: GRAPH-019.7 Not recorded as a failure
  Given nothing open is inside a git repository
  When I run "Show Commit Graph" several times
  Then each run shows the notification once and nothing else happens: no error, no empty graph tab
```
