# Live results, Group A (dev build over CDP, 2026-11-14)

Window: 1536 x 816 CSS px (the owner's saved window state, 250 % scaling). Light theme unless said. Screenshots: live-A/shots/.
Clicks, right-clicks, hovers and keys were sent as real input through CDP Input.* unless a line says "internal".

## A0.4 PASS
- No folder open. Git menu: "Show Commit Graph" is enabled (A0.4-git-menu-no-repo.png); clicking it gives the info toast "Open a folder in a git repository", no tab (A0.4-menu-run.png).
- Palette (Ctrl+Shift+P, typed "graph"): "Git: Show Commit Graph" is listed (A0.4-palette.png); Enter gives the same toast, no tab.
- SEEN, not asked: the Git menu is 883 px tall and the window is 816 px: the flyout runs off the bottom of the window (bottom edge at y=917) and does not scroll, so the last entries (Force Push…, Add Remote…, Claude) cannot be seen or clicked with the mouse at this window size. See "Open bugs".

## A0.1 PASS (repo rb1: main has 2 commits, each conflicting with feature in notes.txt)
- Started from the panel's Merge or Rebase button > Rebase onto Branch… > picked "feature" > dialog "Rebase main onto feature?" (text as MERGE-005.1, Cancel focused) > clicked Rebase.
- Stop 1: error toast "Stopped on a conflict. Resolve the files under Merge Changes in Source Control and commit, or press Abort to go back." + "CONFLICT (content): Merge conflict in notes.txt"; badge "Rebasing 1 of 2", Skip (disabled), Abort; main button "Resolve 1 Conflict First" (disabled); message box disabled with the rebase placeholder; the open notes.txt tab reloaded with the conflict bar and the note "Rebasing: Current is the branch you are rebasing onto, Incoming is your own commit." (A0.1-01-stop1.png)
- Accept Incoming in the bar > dialog "No conflicts left in notes.txt" > Save and Mark Resolved > button "Continue Rebase" > clicked.
- Stop 2: the same error toast again, badge "Rebasing 2 of 2", notes.txt under Merge Changes again, tab reloaded with the new conflict (A0.1-04-stop2.png).
- Enter on the "Rebase main onto feature?" dialog cancelled it (HEAD unchanged). Escape was also pressed on a second opening and nothing ran.
- SEEN: during the rebase the branch button reads "e2bbe0b (d…" (detached id, truncated) and the badge wraps to two lines ("Rebasing" / "1 of 2") at the 333 px panel width. Cosmetic.
- SEEN: with Source Control open but NOT pinned (floating), the first click on "Accept Incoming" in the conflict bar did nothing: the click closed the floating panel, the editor moved left under the pointer, and the button was not pressed. A second click worked. Existing floating-panel behaviour, but it hits the conflict flow directly because MERGE-007 opens the panel by itself. For the owner to judge.

## A0.2 PASS
- At stop 2 "Skip" was disabled while notes.txt was in conflict (title "Resolve the conflicts first (or Abort)").
- Accept Current > Save and Mark Resolved: nothing left to commit; Skip enabled. Clicked Skip: dialog "Skip this commit?" / "The commit the rebase stopped on is left out: its changes will not be on the branch. The rebase then carries on with the rest." with Skip Commit (red) and Cancel (focused) (A0.2-02-skip-dialog.png). Clicked Skip Commit: toast "The rebase is finished.", branch button back to "main" (A0.2-03-finished.png). `git log`: base, feature commit, "main: first change" only; the second commit is gone.
- SEEN: in that nothing-left state during a rebase the panel says "No uncommitted changes." and offers Continue Rebase (the "Nothing is left to commit… Press Skip" note is deliberately not shown for a rebase in GitPanel.tsx). Fine by CONFLICT-012.4 as written (it names a cherry-pick), noted only.
- The native tooltip on the disabled Skip button cannot be seen in a CDP screenshot (see A3.2).

## A0.3 PASS for the check itself; one real dead end found (open bug 2)
- del1 (main changed old.txt, feature deleted it), Git menu > Merge Branch… > feature > Merge: error toast with "CONFLICT (modify/delete): old.txt deleted in feature and modified in HEAD…", badge "Merging", Abort and no Skip, message box prefilled "Merge branch 'feature'" (A0.3-01-stopped.png). Row hover shows Current / Incoming / + (A0.3-02-row-hover.png).
- "Current": toast "old.txt: took the current version.", file still on disk with main's text, conflict gone (A0.3-03-current-kept.png).
- del2, same merge, "Incoming": toast "old.txt: deleted (the incoming side had deleted it).", file gone from disk, its open tab closed, old.txt under Staged Changes as a deletion, button "Commit 1 Staged" (A0.3-04-incoming-deleted.png); clicking it made the merge commit and the badge went (A0.3-05-merge-committed.png).
- BUG (open, bug 2): after "Current" in del1 the tree equals HEAD, so the panel shows "Nothing is left to commit for this merge: its changes are already on the branch. Abort to end it." with the Commit button disabled. Abort is the only way out, which throws the resolution away and leaves feature unmerged for ever (the next merge conflicts again). git itself says "All conflicts fixed but you are still merging. (use "git commit" to conclude merge)". Keeping your own file against a deletion is exactly the A0.3 case, so the merge cannot be finished in Quarry.

## A3.10 PASS (repo mg, bare remote remotes/mg.git)
- One tracked file modified; palette "Git: Merge Branch…" > feature: dialog "Commit or discard your changes first" / "There is 1 uncommitted change to tracked files. A merge is only started from a clean state, so that Abort can bring everything back exactly as it was." / "Commit or discard it in Source Control, then try again." Buttons Show Source Control, Close (focused) (A3.10-refusal.png). Show Source Control opened the (closed) panel with app.txt under Changes (A3.10-after-show-sc.png). git not run.
- Only an untracked scratch.txt: the ordinary "Merge feature into main?" dialog opened (A3.5-ff-dialog.png).
- Not done: the rebase wording of the refusal (MERGE-008.2), MERGE-008.4 (untracked file in the way).
- SEEN: in the CDP screenshots and on the real screen the dialog and the context menus are see-through: text of what is behind (welcome page recent list, graph rows) shows through quite clearly (A3.10-refusal.png, A3.2-real-hover-disabled-entry.png). `.dialog` background is rgba(252,252,252,0.96) with no backdrop blur. Not new with these features; for the owner to judge.

## A3.1 PASS
- Commit row without labels ("feature: two", on main): menu head "ae619ca feature: two"; after Cherry-pick onto main… and Revert This Commit… come "Merge ae619ca into main…" and "Rebase main onto This…", then the three Reset entries, then the Edit History group (A3.1-01-commit-menu.png). Order matches the planned layout.
- Row with one branch label (feature2, side): "Merge feature2 into main…" / "Rebase main onto feature2…".
- Label right-clicks in a row (A3.1-02-label-*.png): "Branch feature" (Switch, Merge feature into main…, Rebase main onto feature…, Rename, Set Upstream, Push, Delete, Copy), "Remote branch origin/topic", "Tag v1.2.0", "Branch main" (merge and rebase entries greyed, title "This is the branch you are on"). Each time exactly one menu was open (the commit menu did not also open) and the label's commit became the selected row.
- Details pane Refs line: right-click "feature" and "origin/feature" open the same label menus (A3.1-03-details-label.png).
- Escape closes the menu; a left click elsewhere in the graph closes it; nothing ran.
- SEEN: "Create Branch Here (Don't Switch)…" is cut to "Create Branch Here (Don't …" in the commit menu. Merge and Rebase use the same icon in the graph menus (the panel menu has two different ones). The own-branch entries read "Merge main into main…" / "Rebase main onto main…" (greyed), which reads oddly.

## A3.5 PASS
- Fast-forward case (feature 3 ahead, main nothing of its own): dialog text as MERGE-004.4 with Fast-forward (primary), Create a Merge Commit, Cancel (focused) (A3.5-ff-dialog.png). Enter closed it and nothing ran; Escape on a second opening the same (HEAD unchanged both times).
- Fast-forward clicked (from the graph label menu of "feature"): toast "main moved forward to feature (3 commits)"; the graph reloaded with main on "feature: three" (A3.5-ff-done.png). "Merging…" beside the branch: seen in the DOM by a store subscriber (`.scm-busy` = "Merging…") while it ran; too short for a screenshot.
- Create a Merge Commit (feature2, from the row's menu): toast "Merged feature2 into main"; `git log`: "Merge branch 'feature2'", parents 6bbd3ef d69cc64.
- Both sides have commits (side): dialog with one "Merge" button + Cancel (A3.5-merge-dialog-one-button.png); toast "Merged side into main"; graph reloaded with main on "Merge branch 'side'" (A3.5-merge-commit-done.png). Status line "7 commits to push to origin/main." with Push; nothing was pushed.

## A3.6 PASS
- Source Control unpinned and closed, notes.txt open in a background tab (clean), graph tab in front. Graph > right-click the "clash" row > Merge clash into main… > Merge.
- Seen at once (A3.6-01-stopped-graph.png): error toast "Stopped on a conflict. Resolve the files under Merge Changes in Source Control and commit, or press Abort to go back." + "CONFLICT (content): Merge conflict in notes.txt"; Source Control opened by itself with notes.txt under Merge Changes, badge "Merging", Abort, no Skip, message box "Merge branch 'clash'", button "Resolve 1 Conflict First"; graph strip "The merge stopped part-way: 1 file has conflicts. Resolve them in Source Control and commit, or abort to go back to how things were." with Abort; an "Uncommitted changes (1)" row on top.
- The notes.txt tab had reloaded ("notes.txt changed on disk and was reloaded.") and shows the conflict bar Accept Current / Accept Incoming / Accept Both / Compare / Explain, with no rebase note (A3.6-02-tab-conflict-bars.png).
- Abort (the graph strip's button) > dialog "Abort the merge?" with Abort Merge (red) and Cancel (focused) > Abort Merge: toast "Aborted the merge.", strip and badge gone, `git status` clean, HEAD unchanged (A3.6-04-aborted.png).
- Merged again, Accept Both > Save and Mark Resolved > "Commit 1 Staged": toast "Committed 526519c: Merge branch 'clash'", parents 847364f 792aba0, badge gone (A3.6-05-committed.png).
- BUG (open, bug 3): after Abort the commit message box still held "Merge branch 'clash'" although no merge was in progress any more (seen in the panel after the abort). To be re-checked below.

## A3.11 PASS
- With notes.txt in front (Start Macro Recording is greyed out on the graph tab), recorded: Git > Merge Branch… > clash > Merge (it stopped on the conflict). The macro has 2 steps: `git.mergeBranch` and `git.mergeRef "clash"`.
- Macros > Play Macro "Macro 1" > confirm dialog > Run, during the stopped merge: one info toast "Finish or abort the merge first.", no picker, no dialog, git not run (A3.11-02-after-play.png).
- SEEN: the recorder keeps the picker command (`git.mergeBranch`) as a step as well as the hidden `git.mergeRef`; replayed in a normal state that would open the branch list and then also start the merge dialog. Not tried. The run-confirmation says "This will edit notes.txt", which is not what this macro does.

## A3.2 FAIL, fixed (see "Bugs fixed")
- A CDP screenshot never shows native tooltips, so these were checked with the real pointer (moved by SetCursorPos, no click) and a real screen capture.
- Disabled graph-menu entry ("Merge main into main…" in the label menu of main): tooltip "This is the branch you are on" shows (A3.2-real-hover-disabled-entry.png). PASS.
- Disabled panel button "Merge or Rebase" during the stopped merge: NO tooltip (A3.2-real-hover-disabled-panel-button.png). Cause: `.btn:disabled { pointer-events: none }` in app.css; WebView2 then shows no title tooltip. Same for the disabled Skip button ("Resolve the conflicts first (or Abort)").
- After the fix the tooltip "Finish or abort the merge first" shows (A3.2-real-hover-disabled-panel-button-fixed.png).
- Left open: every other disabled `.btn` / `.icon-btn` in the app has the same problem (e.g. the disabled Commit button's "Open each file under Merge Changes…" title, disabled header icons, stash buttons). See "Open bugs" 4.

## A3.7 PASS (repo rb2)
- Clean: Git menu > Rebase onto Branch… > clean: dialog "Rebase main onto clean?" > Rebase: toast "Rebased main onto clean (2 commits replayed)"; "Rebasing…" was in `.scm-busy` while it ran (store subscriber; too short to photograph); `git log`: base, clean, then the two main commits with new ids (A3.7-01-clean-rebase-done.png).
- Conflict: palette "Git: Rebase onto Branch…" > feature: stop with badge "Rebasing 2 of 3" (the clean commit replayed first), Skip disabled, Abort, "Resolve 1 Conflict First", bar note "Rebasing: Current is the branch you are rebasing onto, Incoming is your own commit." (A3.3-narrow-panel-rebase.png shows it at 280 px). "Rebasing 1 of 2" was seen in A0.1.
- Skip (after Accept Current + Save and Mark Resolved): "Skip this commit?" > Skip Commit: the next commit stopped too: badge "Rebasing 3 of 3", the "Stopped on a conflict…" error toast (A3.7-02-skipped-next-stop.png). CONFLICT-012.3 names only "Skipped that commit: the rebase is on its next commit." / "The rebase is finished."; when the next commit conflicts the error toast is what shows (same as Continue, CONFLICT-013.5). Wording note for the story, not a defect.
- Continue: seen in A0.1. Abort: "Abort the rebase?" > Abort Rebase: toast "Aborted the rebase.", branch back to main at 8d02d4e (ids unchanged), tree clean.
- BUG found here and FIXED (fb5a797): right after Abort Rebase, with notes.txt in the front tab, the dialog "No conflicts left in notes.txt / Save notes.txt and mark it resolved? It is the last file: after this, Continue Rebase carries on." came up with Save and Mark Resolved focused (A3.3-narrow-panel-menu.png shows it). Re-checked after the fix: no dialog after Abort (BUG5-after-abort-fixed.png), none after taking "Incoming" from the row, and the dialog still comes after Accept Current / Incoming in the bar.
- SEEN: every rebase / abort gives an extra "notes.txt changed on disk and was reloaded." toast, also when the text did not change.

## A3.3 PASS, with layout notes
- The "Merge or Rebase" icon button sits right after the branch button; its menu (Merge Branch…, Rebase onto Branch…, each with its own icon) opens below it, left-aligned with the button, over the message box (A3.3-panel-menu.png). A click elsewhere closes it; Escape was not tried on this menu (covered by a unit test).
- Narrow panel (width set to 280 through the store: internal, not a drag): the row still fits on one line during a rebase but everything is tight: branch button shows "3afe1…", the badge wraps to two lines, and the main button's label is clipped on both sides ("esolve 1 Conflict Fir") because Draft and Amend share its row; the header "SOURCE CONTROL" wraps to two lines (A3.3-narrow-panel-rebase.png). The menu itself was not photographed at 280 px (a stray dialog was in the way, see A3.7); it is 210 px wide and starts at the button, so it fits.

## A3.8 PASS (repo fp: main tracks origin/main, 3 pushed + 2 local commits; bare remote remotes/fp.git)
- Panel > Rebase onto Branch… > featureA: danger dialog "Rebase commits that are already pushed?" / "3 of the 5 commits to replay are already on origin/main:" + the three by short id and message / the new-ids, refused Push, Force Push and repair sentences / "Merging featureA into main instead rewrites nothing." Buttons Rebase Anyway (red) and Cancel (focused) (A3.8-01-danger-dialog.png). Enter cancelled, HEAD unchanged.
- Rebase Anyway: toast "Rebased main onto featureA (5 commits replayed)"; status line (warning box) "main was rewritten: origin/main still has the 3 old commits. Force Push replaces them with yours." with the single red button "Force Push…", no Pull buttons (A3.8-02-force-push-offer.png). Remote untouched.
- Plain Push (header arrow) while the offer shows: refused with git's "! [rejected] main -> main (non-fast-forward)" error toast; remote untouched (A3.8-03-plain-push-refused.png).
- Force Push… > danger dialog "Replace origin/main with your main?" listing the 3 commits, Force Push (red) / Cancel (focused) (A3.8-04-force-push-dialog.png). Enter cancelled: nothing pushed, offer still there. Force Push: "Pushing…" in `.scm-busy` (subscriber), toast "Replaced origin/main with your main.", status line "Everything is committed and matches origin/main.", the offer gone, bare remote at the new tip (A3.8-05-force-pushed.png).
- Offer after a branch switch: rebased again (onto featureB, "All 6 commits to replay are already on origin/main"), offer shown; switched to featureA and back to main through the branch button: status line is the ordinary "Diverged from origin/main: 7 commits to push, 6 to pull. Pull first, then push." with Pull (Merge) / Pull (Rebase) (A3.8-06-after-branch-switch.png).
- Offer after a restart: force-pushed from the palette ("Git: Force Push (Replace Remote Branch)…", works without the offer and listed the 6 commits), rebased onto featureC with Rebase Anyway (offer shown), closed the app with its own close button and started the dev build again: the session reopened fp and the status line is the ordinary Diverged one (A3.8-07-after-restart.png).
- Also seen: a rebase whose commits are on no remote branch (after the un-pushed rewrite) gets the ordinary "Rebase main onto featureC?" dialog (MERGE-006.4).
- Not done: MERGE-006.5 (pushed elsewhere than the upstream), MERGE-009.6 (list of more than 12), the Git menu entry for Force Push (it is below the bottom edge of the window, see open bug 1).

## A3.9 PASS
- A second clone pushed "colleague: their commit" to the bare remote; nothing fetched in Quarry. Palette > Force Push: the dialog listed the 7 commits known locally; Force Push: error toast "origin/main has commits you have not fetched. Fetch and look at them first." (A3.9-01-refused.png). Bare remote still at 820b39e (their commit); local origin/main unchanged.
- Then the panel's "Check the remote now" (the same fetch the background check does): status line "Diverged… 8 commits to push, 8 to pull"; opening Force Push again now lists 8 commits with "820b39e colleague: their commit" first (A3.9-02-after-check-dialog.png). Escape cancelled. So after a background fetch the lease would pass, but the dialog names their commit before anything is sent.

## A3.4 PASS for wording and greying; FAIL for layout at this window size (open bug 1)
- Git menu with a repository (A3.4-git-menu-repo.png, order read from the DOM): (1) Show Source Control, Show Commit Graph, Refresh Git Status; (2) Compare with Last Commit (HEAD), Compare with Branch…, Show File History, Show Line Blame; (3) Next Change, Previous Change, Show Change at Cursor, Revert Change at Cursor; (4) Conflicts ▸; (5) Stage Current File, Unstage Current File, Stash ▸, Stage Part of a File ▸; (6) Switch Branch…, Merge Branch…, Rebase onto Branch…, Branches and Tags ▸, Edit History ▸; (7) Fetch, Pull, Push, Force Push (Replace Remote Branch)…, Add Remote…; (8) Claude ▸.
- Against the planned layout: all eight groups are there in order. One difference: in group 5 the plan has "Stage Part of a File ▸" before "Stash ▸"; the menu has Stash first.
- Greying: with no repository Merge Branch…, Rebase onto Branch…, Switch Branch… and the rest of groups 2-7 are grey, Show Commit Graph is not (A0.4-git-menu-no-repo.png). During a stopped merge Merge Branch…, Rebase onto Branch… and Force Push are grey, Switch Branch… is not. With no upstream Force Push is grey.
- FAIL (layout): the menu is 883 px tall, the window 816 px (776 with the tab row). The flyout does not scroll, so Push / Force Push… / Add Remote… / Claude are below the window's bottom edge and cannot be reached with the mouse (A3.4-git-menu-repo.png: the last visible entry is Pull). Force Push was therefore only run from the status line and the palette.
- Palette: "Git: Merge Branch…" > prompt "Merge which branch into main?", rows feature, feature2, clash, side, then "remote: origin/feature", "remote: origin/main", "remote: origin/topic"; no "main", no Create row (A3.4-merge-picker-mg.png). "Git: Rebase onto Branch…" > prompt "Rebase main onto which branch?" (A3.4-rebase-picker.png). A made-up name: "No matches", Enter does nothing, the list stays open (A3.4-rebase-picker-nomatch.png).
- Note: the merge list contains "remote: origin/main", the upstream of the branch I am on (allowed by the spec: only the current branch is left out).
- Not checked: palette without a repository (MERGE-003.8), detached HEAD (MERGE-003.10), the repository with no commits (MERGE-008.7).

# Bugs fixed (each its own commit in C:\coding_projects\Quarry, branch main, not pushed)
1. ace9f47 "Fix: tooltips on disabled buttons in the Source Control branch row": `.btn:disabled { pointer-events: none }` suppressed the title tooltip of the disabled Merge or Rebase / Skip buttons (MERGE-003.9, CONFLICT-012.2). Re-checked with the real pointer.
2. fb5a797 "Fix: no "No conflicts left" offer after an Abort reloads the tab": after Abort Rebase the dialog "No conflicts left in notes.txt … Continue Rebase carries on" appeared with Save and Mark Resolved as default. `conflictsCleared` now asks git for the status first. New scenario CONFLICT-006.7, new test conflictsCleared.test.ts. Re-checked live.
3. f623740 "Fix: the graph's commit menu squashed its rows and clipped its heading": the 23-entry commit menu was limited to 60vh as a flex column; rows 19 px, heading 11 px. Now full rows inside the window (BUG6-commit-menu-fixed.png).
4. 3f2bd03 "Fix: git's prepared merge message stayed in the box after Abort": "Merge branch 'clash'" stayed after Abort Merge and was still in the box in another repository (visible in A3.8-01-danger-dialog.png). New scenario CONFLICT-010.7. Re-checked live (rb3).
5. a06eb63 "Fix: a merge that changes no file could not be committed, only aborted": see A0.3. Button "Commit Merge", new note text, scenario CONFLICT-010.8, CONFLICT-012.4 reworded. Re-checked live (del1: merge commit da7a93a made by the button). NOTE: this one changes wording the owner may want to choose himself ("Commit Merge", "The merge changes none of your files: what it brings is already on the branch. Commit to record the merge, or Abort.").
After each: `npx tsc --noEmit`, `pnpm test` (74 files, 1296 tests pass at the end), `pnpm specs` 0 problems. No Rust was changed. docs/git.md and CLAUDE.md were not touched.

# Open bugs (not fixed)
1. Git menu taller than the window (see A3.4): `.menu-flyout` top level has no max-height / scrolling (only `.submenu` has); at 1536 x 816 CSS px the last four entries are unreachable by mouse. A scrolling top-level flyout would clip its submenus, so this needs a design decision (denser rows, regrouping into submenus, or submenus positioned `fixed`).
2. Disabled `.btn` / `.icon-btn` everywhere else still show no tooltip (same cause as fixed bug 1): e.g. the disabled Commit button's "Open each file under Merge Changes…" title, header Fetch / Pull / Push while busy, stash buttons, the Draft button. Removing `pointer-events: none` globally changes hover styling and click-through for every disabled button, so it was left for the owner.
3. Floating (unpinned) Source Control + conflict bar: the first click on Accept Current / Incoming closes the panel, the editor shifts, and the button is not pressed (A0.1). Since a conflict stop opens the panel by itself, this is the normal state after a stop.
4. Context menus and dialogs are see-through enough that the text behind is readable through them (A3.2-real-hover-disabled-entry.png, A3.8-04-force-push-dialog.png).
5. Graph commit menu is 220 px wide: "Create Branch Here (Don't Switch)…", "Summarise feature with Claude…" and "Summarise from Here to main…" are cut with "…".
6. Narrow panel (280 px): main button label clipped on both sides, see A3.3.
7. Macro recorder records the picker command as well as the hidden command (A3.11), not tried in replay in a normal state.
8. Small wording: "Merge main into main…" / "Rebase main onto main…" on the own-branch label (greyed); the macro confirmation "This will edit notes.txt" for a git-only macro; an error toast with a long path runs off the right edge of the toast (seen once with a bad path of my own).

# Not verified through the real UI
- Folders and files were opened with `__shi.openFolder` / `openPath` (native dialogs cannot be driven); tabs were closed with `runCommand('file.closeAll')`; twice a tab was brought to front with `store.setActive`; `git.refresh` and `git.graph` were run through `runCommand` a few times between checks; the dark theme and the 280 px panel width were set through the store.
- "Merging…" / "Rebasing…" / "Pushing…" beside the branch: read from the DOM by a store subscriber, never caught in a screenshot (the operations take well under 100 ms on these repos).
- Tooltips: only two were looked at with the real pointer (one disabled menu entry, the disabled panel button). The others were read as `title` attributes.
- Everything else (menus, right-clicks, pickers, dialog buttons, Enter / Escape, bar buttons, row buttons, the window's close button for the restart) went through CDP Input mouse / key events.

# Incident
- One stray click: testing "outside click closes the panel menu" with no tab open, the click landed on the Welcome page's recent list and opened C:\coding_projects\Quarry\test-fixtures\messy.css as a tab. It was closed at once; no folder of the Quarry repo was opened, Source Control stayed on the throwaway repo (checked: one repo known), no git action touched it. `git status` there shows only the fix commits.

# End state
- Dev app closed with its own close button both times (nothing was killed); no quarry.exe, no msedgewebview2 with the live-A\wv profile, ports 1420 / 9333 free.
- %APPDATA%\com.quarry.app\session.json and settings.json restored from live-A\backup and verified by SHA-256 (92024E90…, 16C4DBE3…). `.window-state.json` and `search-history.json` in that folder were not backed up (the app may have rewritten them); the recorded test macro was never saved.
- C:\coding_projects\Quarry: clean tree, five "Fix:" commits on main after 220d782, nothing pushed.
