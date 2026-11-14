# Live results, Group C (dev build over CDP, 2026-11-14)

Window 1536 x 816 CSS px (250 % scaling), light theme unless said. Screenshots: live-C/shots/. Repos: live-C/repos/* (fresh, local bare remotes in live-C/remotes); large fixture live-C/big/git (git.git, treeless, no checkout, graph tab only).
Clicks, right-clicks, Ctrl+clicks, drags, wheel and keys were real input through CDP Input.* unless a line says "internal". No real pointer, no OS screen capture: tooltips were read as `title` attributes only. Source Control was pinned for the run (known issue 3 otherwise eats first clicks).

## C4.1 PASS (one fix, 59dd7a1)
- br1, graph on All branches. Label menus read from the DOM and looked at (C4.1-menu-*.png):
  - local "feature": head "Branch feature"; Switch to feature | sep | Merge feature into main…, Rebase main onto feature… | sep | Rename Branch…, Set Upstream…, Push feature to origin, Delete Branch… (red) | sep | Copy Branch Name. Each entry has its own icon (branch, merge, pencil, link, cloud-up, bin, copy); Merge and Rebase share one icon.
  - current "main": no Switch; Merge / Rebase greyed ("This is the branch you are on"); Rename, Set Upstream, "Push main to origin/main"; Delete Branch… greyed with "You are on this branch. Switch to another branch first."; Copy.
  - remote "origin/topic": head "Remote branch origin/topic"; Switch | Merge, Rebase | "Delete topic from origin…" (red) | Copy. "origin/main": the delete entry is greyed with "main is origin's default branch."
  - tag "v1.1": head "Tag v1.1"; Merge, Rebase | Push v1.1 to origin, Delete Tag… (red) | Copy Tag Name; no Switch.
  - each time one menu only, the label's commit became the selected row, Escape closed it.
- Outline: hover adds a 2 px halo round the label, and the label keeps it while its menu is open; visible in light and dark (C4.1-hover-light.png, C4.1-menuopen-light.png, C4.1-menuopen-dark.png). The menu opens at the pointer, so it covers the right half of its own label.
- FAIL, fixed (59dd7a1): with no details pane open, a right-click (or a plain click) on a row in the lower 40 % of the list opened the details pane on top of that row: the clicked commit and its outlined label were hidden behind the pane, the list did not scroll (row at y 638, list ended at 527). Now the row is brought into view when the pane opens (C4.1-fixed-label-row-in-view.png). No unit test (needs layout).
- Known issue 5 touches this: the 220 px menu cuts "Merge experiment into mai…" and "Rebase main onto experim…". Known issue 4 (see-through menu) is visible too.

## C4.2 PASS
- Label "feature" (merged, no upstream) > Delete Branch…: dialog `Delete branch "feature"?` / `All its commits are in "main", so nothing is lost. The branch on a remote, if there is one, is not touched.`, buttons Delete Branch, Cancel (focused) (C4.2-delete-merged-dialog.png). Enter closed it, branch still there (shell); Escape the same. Delete Branch clicked: toast "Deleted branch feature (was 3f6dd02)", the label gone from the graph without a manual reload (C4.2-after-delete.png), not in the branch picker opened right after (C4.2-picker-after-delete.png), gone in the shell.

## C4.3 PASS
- Label "experiment" (2 commits not in main): first dialog `2 commits on "experiment" are not in "main": you are asked once more before they are lost. …`; Delete Branch: branch still there, second dialog `Delete "experiment" and lose 2 commits?` / `… Deleting the branch leaves them on no branch. Its last commit is f1dc680, should you need it back.` with red "Delete Anyway" and Cancel (C4.3-second-dialog.png). Enter: kept. Escape: kept. Delete Anyway: toast "Deleted branch experiment (was f1dc680)", label gone, branch gone in the shell.

## C4.4 PASS
- Label "fix" > Rename Branch…: strip "Rename branch fix to:" with "fix" in the box, all of it selected, focus in the box, Rename disabled (C4.4-rename-strip.png). Enter with the unchanged name did nothing. Typed "fix-login-timeout" (replaced the selection), Rename enabled, Enter: toast "Renamed fix to fix-login-timeout. It still tracks origin/fix; the branch on origin keeps its name.", graph shows [fix-login-timeout][origin/fix] at once; shell: tracks origin/fix.
- Current branch with 1 uncommitted change: main > Rename Branch… > "trunk": panel branch button "trunk", status bar "trunk*", graph label "trunk", `git status`: `## trunk...origin/main`, the change untouched (C4.4-renamed-current.png). Renamed back to main the same way.
- "bad name": error toast `"bad name" is not a valid name`; "topic" (taken): `A branch named "topic" already exists.`; nothing renamed. Escape closes the strip.
- Note: after a refused name the strip closes, so the name has to be typed again from the menu.

## C4.5 PASS
- Label "Casey" > Rename Branch… > "casey": Rename enabled for the case-only change, toast "Renamed Casey to casey", label "casey" in the graph; shell `git branch` lists "casey" and .git/refs/heads has `casey` (C4.5-case-rename.png).

## C4.6 PASS for what CDP can show; the native context menu NOT CHECKED
- Branch picker (panel branch button): the "⋯" button is in every branch row, opacity 0, and 1 on the highlighted row and on the hovered row (C4.6-picker-hover.png, C4.6-shiftF10-menu.png shows both).
- Shift+F10 on the highlighted row "casey": row menu Rename Branch… (highlighted), Set Upstream…, Push casey to origin, Delete Branch… (red) | Copy Branch Name, placed under the row's "⋯"; the picker stays open behind it. Down / Up move the highlight (the separator is skipped), Enter on Copy Branch Name ran it (toast "Copied the branch name", picker closed). Escape closed only the menu: picker still open with "casey" highlighted; a second Escape closed the picker.
- Right-click on "remote: origin/fix" (the last row): menu "Delete fix from origin…" | Copy Branch Name only, inside the window (C4.6-bottom-row-menu.png). The picker list is at most 577 px tall in this 816 px window, so a menu from the bottom row cannot reach the window edge here; not tried in a smaller window. "⋯" on "current: main": Delete Branch… greyed with "You are on this branch. Switch to another branch first."; the branch was not switched.
- NOT CHECKED: whether WebView2's own context menu appears on top after a real Shift+F10. A CDP key press does not produce the `contextmenu` event the real key does, so this can only be seen with a real keyboard. The code cancels that event (`onContextMenu` in CommandPalette.tsx).

## C4.7 PASS
- Row menu of "casey" > Rename Branch…: the picker reopens with the placeholder `New name for "casey"…`, "casey" in the box, all selected, focus in the box, one line `Type a new name for "casey"` (C4.7-new-name-picker.png). Typing "casey renamed here": the only row is `Rename "casey" to "casey-renamed-here"`. "main": the list says `A branch named "main" already exists.` and Enter does nothing. "casey two" + Enter: toast "Renamed casey to casey-two", shell agrees.

## C4.8 PASS (one fix, 5c88b53)
- br1, label "up" (no upstream; origin/up exists) > Set Upstream…: prompt `Which remote branch should "up" track?`, "origin/up" first (same name), then the other remote branches, no local ones (C4.8-upstream-list.png). Picked origin/up: toast "up now tracks origin/up"; shell `[origin/up: ahead 2]`.
- Opened again: first row `Stop tracking "origin/up"`, then "tracking: origin/up" (C4.8-upstream-tracking.png). Stop tracking: toast "up no longer tracks a remote branch", origin/up still there.
- Status line, on "up" (switched with the label menu): "up isn't on the remote yet." + Publish Branch; after Set Upstream… (picker row menu) > origin/up: "2 commits to push to origin/up." + Push (C4.8-status-tracking.png); after Stop tracking: Publish Branch again.
- nb (remote configured, nothing pushed), label "feature" > Set Upstream…: note "No remote branches yet" and the single row `Push "feature" to origin and track it` (C4.8-no-remote-branches.png); Enter: toast "Pushed feature to origin; it now tracks origin/feature"; the bare repo has `feature`.
- FAIL, fixed (5c88b53; hazard in all pickers): after "Set Upstream…" was clicked in the picker's row menu, the new list opened under the resting pointer and the row under the pointer became the highlighted one (5th row, "origin/only-remote") instead of the first; Enter then set the upstream to a branch I had not looked at (first try: "up now tracks origin/gone"). Cause: `onMouseEnter={() => setActive(i)}` on palette rows fires when a list appears under a pointer that has not moved. Every list opened by a mouse click (row menu, Git menu, label menu when the pointer is over the list area) has this; destructive ones still ask, Set Upstream and Switch do not. Fix: a row is highlighted by the pointer only when the pointer moves (`onMouseMove`; the browser sends over / enter but no move when a list appears under a resting pointer: measured live). New scenario UI-005.8, one component test in branchPicker.test.tsx. Re-checked live: the same clicks now leave the first row ("Stop tracking …") highlighted, and moving the pointer still highlights rows (C4.8-fixed-first-row-active.png).
- Wording seen: "up isn't on the remote yet." although origin/up exists (the branch only has no upstream).

## C4.14 PASS
- nr (no remote), graph label "feature": the entry reads "Push feature…" (title "This repository has no remote yet: add one first") and is enabled; choosing it: info toast "This repository has no remote yet. Add one in Source Control.", the Repository section opens on the Add Remote form with the focus in "Repository name" (C4.14-push-add-remote.png); no list, no git (`git remote -v` empty afterwards). Set Upstream… on the same label and "Push v1…" on the tag label: same toast, same form. Nothing in the form was pressed.

## C4.9 PASS
- br1, on main, label "topic" (tracks origin/topic, 2 to push) > "Push topic to origin/topic": while it ran the panel showed "Pushing topic…" beside the branch and the status bar "main · Pushing topic…" (read from the DOM by a store subscriber on the next frame; too short for a screenshot); toast "Pushed topic to origin"; the row reads [topic][origin/topic] on "topic: three" (C4.9-pushed-topic.png); bare repo's topic = ced002d; still on main. A second push: info "topic is already up to date on origin".

## C4.10 PASS (one fix, ded6f92)
- Label "rej" (origin/rej has a colleague's commit) > Push: dialog "origin did not accept rej" / `origin/rej has commits that "rej" does not have. Switch to "rej" and pull, then push again.` + git's lines (no hint lines), buttons "Switch to rej", Close (focused). Enter closed it, still on main, remote unchanged. Switch to rej: on rej, Source Control shows "Diverged from origin/rej: 1 commit to push, 1 to pull. Pull first, then push." with Pull (Merge) / Pull (Rebase) (C4.10-switched-to-rej.png).
- FAIL, fixed (ded6f92): git's message contains the remote's path with no spaces; it ran out of the dialog on the right (C4.10-rejected-dialog-crop.png). Dialog text and toasts now break long tokens (C4.10-rejected-dialog-fixed.png). This is also the toast overflow run A listed under small issues. CSS only.

## C4.11 PASS
- Label "origin/gone" > "Delete gone from origin…": dialog `Delete "gone" from origin?` / `This deletes the branch "gone" in the remote repository origin (<path of the bare repo>), for everyone who uses it. Your local branches are kept.`, red "Delete from origin", Cancel focused (C4.11-delete-remote-dialog.png). Enter: kept. Confirmed: "Deleting origin/gone…" in panel and status bar (subscriber), toast "Deleted gone from origin (was 09665f6)", label gone from the graph, the bare repo has no `gone`, local branch gone kept.
- Switched to the tracking branch "gone": status line "origin/gone no longer exists on the remote." + "Push to Recreate It" (C4.11-push-to-recreate.png).
- "origin/only-remote" (3 commits in no local branch): the dialog adds "3 commits are only on origin/only-remote (as of the last fetch). They are lost unless someone else has them." (cancelled). "origin/main": entry greyed, "main is origin's default branch."

## C4.12 PASS
- A branch pushed as origin/stale2, then deleted in the bare repo behind Quarry's back; label still in the graph. Delete stale2 from origin… > Delete from origin: info toast "stale2 was already gone from origin", label gone, no error (C4.12-already-gone.png).
- Note: the first stale label of the fixture had already been pruned by the panel's own remote check when the folder was opened.

## C4.13 PASS (one fix, 0f14552)
- Label "v1.1" > Delete Tag…: dialog `Delete tag "v1.1"?` / "Removes the tag from this computer. The commit 09502e9 and its branch are not changed. If the tag was pushed, the remote keeps its copy.", Cancel focused; Enter kept it; Delete Tag: toast "Deleted tag v1.1 (was 09502e9)", label gone.
- Label "v2.0" (annotated) > "Push v2.0 to origin": no question, toast "Pushed tag v2.0 to origin", bare repo has v2.0 (and not the other local tags). Again: info "v2.0 is already on origin".
- Label "moved" (origin has it on another commit) > Push: error toast "origin already has a tag moved on another commit. Quarry does not overwrite tags on a remote." + git's "! [rejected] moved -> moved (already exists)"; remote's tag still on 9648ad3 (C4.13-moved-tag-refused.png).
- Git › Branches and Tags › Delete Tag…: picker "Delete which tag?" listing v2.0, moved, v1.0 only; picked v1.0: the same dialog; deleted locally, the bare repo still has v1.0. Push Tag…: "Push which tag to origin?"; v2.0: "already on origin". The other five entries open "Delete which branch?" (no main, no remote branches), "Delete which branch on the remote?" (remote only), "Rename which branch?" / "Set the upstream of which branch?" / "Push which branch?" (local, "current: main" first); Escape closes each with nothing done.
- FAIL, fixed: the Branches and Tags submenu opened level with its entry near the bottom of the (too tall) Git menu and ran to y 914 in the 816 px window: Push Branch… was cut, Delete Remote Branch…, Delete Tag… and Push Tag… were below the window and could not be clicked (C4.13-git-menu-branches-tags.png). Fix: a submenu is moved up as far as needed (`submenuShift` in MenuBar.tsx, scenario UI-003.9, 3 unit tests); all seven entries are now inside the window (C4.13-git-menu-branches-tags-fixed.png). Edit History and Claude submenus gain the same. Known issue 1 itself (the top-level Git menu is taller than the window: Fetch is the last entry fully visible) is unchanged.

## C4.15 PASS
- A plain folder with no repository open: Git › Branches and Tags is itself greyed, and all seven entries inside are greyed (C4.15-no-repo-menu.png). The palette then lists only 5 Git commands (the seven are hidden, as every unavailable command is); running each of the seven ids directly (internal `runCommand`) did nothing: no picker, no dialog, no toast.
- With br1 open, palette "Git: ": Rename Branch…, Delete Branch…, Set Upstream…, Push Branch…, Delete Remote Branch…, Delete Tag…, Push Tag… are all listed (C4.15-palette-with-repo.png).

## C4.16 PASS
- Commit "main: newest" selected; right-click in the details pane's Refs line on "v2.0", "origin/main", "main": the same "Tag v2.0" / "Remote branch origin/main" / "Branch main" menus as in the row, one menu each (C4.16-details-label-menu.png). Copy Tag Name from there: toast "Copied the tag name".
- Small: the label in the Refs line gets no outline while its menu is open (the row's label does); from the code, `RefBadge` in the details pane is not given `open`.

## C4.17 PASS for a repository Quarry knows; a gap found for one it no longer knows (open)
- Folder br1 open (Source Control on br1/main), plus a file of the second repository "oth" open in a tab so Quarry knows both; the graph tab of oth in front (opened earlier with oth's folder). In that tab: label "oth-merged" > Delete Branch… (dialog names oth's "main") > Delete Branch; "oth-side" > Rename Branch… > "oth-renamed"; tag "oth-tag" > Push; "oth-renamed" > Push oth-renamed to origin. Shell: oth has lost oth-merged, has oth-renamed tracking origin/oth-renamed, oth's bare remote has oth-renamed and oth-tag; br1's refs and br1's bare remote are untouched; Source Control stayed on br1 (C4.17-oth-after.png).
- OPEN: before the oth file was opened (graph tab of oth left open, then the br1 folder opened: Quarry then knows only br1), every entry of oth's label menus except Copy was greyed with the title "The open folder is not in a git repository" (not true: the open folder is br1), while the commit menu of the same tab still offered Switch to oth-side, Cherry-pick, Reset, Create Branch (C4.17-unknown-repo-menu.png). Cause: `repo = useGit.repos[root]` is undefined for a graph tab whose repository is not under the open folder or an open file. Needs a decision: keep the tab's repository status loaded, or say "Open a file or folder of this repository to act on it".
- Seen: a tag deleted locally that exists on the remote (v1.0) was back after the next automatic remote check (`fetch` follows tags). The dialog does say "the remote keeps its copy", but nothing says the tag will return by itself.

## C5.1 PASS
- cmp, Current branch. Click "base", Ctrl+click "new logo": both rows highlighted, the second with a dashed outline (class `compare`); the details pane is replaced by the comparison pane "336aa85 ↔ 629e995" with Swap Sides, both commits with message and labels, "629e995 is 5 commits ahead of 336aa85.", "5 files changed, 8 insertions(+), 10 deletions(-)" and logo.png M, new.ts A, old.ts D (struck through), helpers.ts src R (tooltip "Renamed (from src/util.ts)"), store.ts M (C5.1-two-commits.png; dark: C5.1-dark.png, highlight and dashed outline both clear).
- Ending it: Escape (list focused) leaves "base" selected with its ordinary details; Down the same (base is the last row); a plain click on another row selects only that row. A third Ctrl+click replaced the second commit (never more than 2 rows highlighted); Ctrl+click on the second again took it out.

## C5.2 PASS
- Clicked the newer "feature: step 4", Ctrl+clicked the older "change store". Timeline from a DOM observer: the pane first reads "7159df3 ↔ afd54fd" with "Loading…" and no rows, and 440 ms later, in one step with the counts and the file list, "afd54fd ↔ 7159df3" / "7159df3 is 8 commits ahead of afd54fd." There is exactly one change of the heading and it comes together with the content, so it reads as "loaded" rather than as a flicker; acceptable in my view. (440 ms for git's answer on a 12-commit repo is the dev build.)

## C5.3 PASS
- Swap Sides: heading "7159df3 ↔ afd54fd", feat.ts D, new.ts D, old.ts A, "util.ts src R" with "Renamed (from src/helpers.ts)", summary "9 insertions(+), 19 deletions(-)" (exchanged) (C5.3-swapped.png).
- Click util.ts: Compare tab "helpers.ts @ 7159df3 ↔ util.ts @ afd54fd", both sides read-only, 1 change (the edited line only) (C5.3-swapped-file.png). Back on the graph tab the two commits are still selected and the pane is as left. The next file (new.ts) replaced the same preview tab. logo.png: no tab, info toast "This file is binary."

## C5.5 PASS
- cmp on feature: 1 staged (app.ts), 1 unstaged (store.ts), 3 untracked. Right-click "new logo" (629e995) > Compare with Working Tree: pane "629e995 ↔ Working tree", second side "Working tree / Your tracked files as they are on disk, staged or not", "Your files are on 7159df3, 4 commits ahead of 629e995.", "3 files changed…", note "3 untracked files are not compared.", list app.ts M, feat.ts A, store.ts M; no Swap Sides; only the row of 629e995 highlighted (C5.5-working-tree.png). `git status -s` before and after the comparison identical.
- Opened notes.md in a tab, typed, Ctrl+S; back on the graph tab the list had notes.md M and "4 files changed" without any reload (C5.5-after-save.png).

## C5.6 PASS
- store.ts (not open in a tab) clicked in the pane: tab "store.ts @ 629e995 ↔ store.ts", left tagged read-only, right not; typed into the right side: "edited" tag, tab title with *, a Save button; Ctrl+S: toast "Saved", the text is in the file on disk (C5.6-editable-saved.png).
- app.ts open in a tab with unsaved typing, then clicked in the pane: "app.ts @ 629e995 ↔ app.ts (unsaved)", both sides tagged read-only, the unsaved text shown on the right, nothing written to disk (C5.6-unsaved-readonly.png).

## C5.7 PASS
- On feature, no graph tab open. Git › Compare with Branch…: picker "Compare with a branch…" listing main, "current: feature", "remote: origin/main"; "does-not-exist": "No matches", Enter does nothing, no tab. Picked main: the graph tab opened with the pane "0bac1cd main ↔ 7159df3 feature", "7159df3 has 4 commits that 0bac1cd does not; 0bac1cd has 2 that 7159df3 does not.", feat.ts A, store.ts M (uncommitted changes not in the list; the "Uncommitted changes (6)" row still on top) (C5.7-compare-with-branch.png). main is not in the Current branch scope: its side has "Show in Graph", which answers "That commit is not on this branch. Switch to All branches to see it."
- From a commit's menu ("add new.ts" > Compare with Branch… > current: feature): "8201d9f ↔ 7159df3 feature", "7159df3 is 7 commits ahead of 8201d9f."
- Picking the current branch from the Git menu: "No differences: feature is the commit you are on." (the heading then reads "7159df3 feature ↔ 7159df3 feature").
- Escape in the picker: closed, no tab change, the comparison showing was left as it was.
- Detached HEAD (made in a shell): the picker lists main, feature, origin/main; main: "0bac1cd main ↔ 7159df3 HEAD" (C5.7-detached.png). Small: COMMITCMP-005.11 says the side carries the label "HEAD"; the heading does, the side's own line showed only the "feature" label.

## C5.4 PASS
- big (700 commits on main). Scrolled (real wheel) until page 3 was loaded ("701 commits"), clicked "commit 60", Ctrl+clicked "commit 55": pane "82bd515 ↔ 6f55900", "6f55900 is 5 commits ahead of 82bd515.", log-main.txt M. Clicked the file: Compare tab "log-main.txt @ 82bd515 ↔ log-main.txt @ 6f55900". Back on the graph tab: the pane is unchanged; the graph has reloaded from the first page ("600+ commits"), neither row is highlighted and each side has a "Show in Graph" button (C5.4-unloaded-sides.png). Show in Graph: pages load to "701 commits" and both rows are highlighted and in view again, the buttons gone (C5.4-after-show-in-graph.png).
- For the owner (by design per COMMITCMP-001.10 / BRANCH-001.11, but it is felt): coming back to a graph tab always reloads it from page 1, so a place further down is lost; the list lands on the last rows of page 1 (scroll 7442 px each time). With the two commits on page 2 (commit 340 / 335) they were loaded again by the scroll-triggered next page but were out of view just below.

## C5.8 PASS
- big, no graph tab open, Git › Compare with Branch… > old-release (the root commit, 700 rows down): the graph tab opened with only the first page ("300+ commits") and the pane was there at once (250 ms after the pick): "d3021aa old-release ↔ af0536f main", "af0536f is 700 commits ahead of d3021aa.", 15 files; the old-release side has "Show in Graph" (C5.8-far-branch.png). Show in Graph: loaded to "701 commits", scrolled to the last row, "old-release root" highlighted with the dashed outline (C5.8-after-show.png).

## C5.9 PASS
- mrg (merge stopped on store.ts, started in a shell): graph shows the warning strip with Abort and "Uncommitted changes (2)". Two commits compared (base ↔ main: line 3): normal pane. base > Compare with Working Tree: extra.ts A, other.ts M, store.ts "!" (C5.9-merge-working-tree.png). Click on store.ts: the file itself opens as a text tab with the bar "Conflict 1 of 1 · Accept Current · Accept Incoming · Accept Both · Compare · Explain", no Compare tab (C5.9-conflicted-file.png). `git status -sb` identical before and after, still "merge", no dialog.
- rbs (rebase stopped at 2 of 3, started in a shell): two commits compared, a file opened in a Compare tab; afterwards still "rebase", step 2 of 3, `UU store.ts`, msgnum / end unchanged.
- Small: the tooltip of the "!" row still says "Click to compare the two versions" although the click opens the file.

## C5.10 PASS (on a generated repository, not on git.git)
- wide: one commit changes 6000 files. Click the older commit, Ctrl+click the newer: the pane shows "Loading…" for about 520 ms (DOM observer; C5.10-loading.png), then "6000 files changed, 12000 insertions(+), 6000 deletions(-)". Only 16-23 rows are in the DOM for a list 144,000 px high. 25 real wheel steps over the list: 328 frames, median 10 ms, 95th percentile 14 ms, longest 18 ms, none over 50 ms (C5.10-scrolled.png); the last row (file5999.txt) is reachable.
- Not done on git.git: the fixture is a treeless clone (`--filter=tree:0`), so a diff of two far-apart commits there would download trees one by one from GitHub.

## C5.11 PASS (one thing for the owner)
- Folder br1 open (Source Control on br1), a file of oth open, oth's graph tab in front. Right-click a commit there > Compare with Branch…: the picker lists oth's branches ("current: main", oth-renamed, remote: origin/oth-renamed, remote: origin/main); picking oth-renamed compares inside oth's graph ("1f93f9c ↔ 5b4a021 oth-renamed") (C5.11-other-repo-picker.png). Source Control stayed on br1.
- For the owner: with oth's graph tab in front, Git › Compare with Branch… (menu bar) lists br1's branches, the Source Control repository, not those of the graph being looked at. Consistent with "the menu acts on the Source Control repository", but easy to misread.

## C7.1 PASS
- dirty (1 staged, 1 modified, 1 new file): first row "Uncommitted changes (3)" in italics with a hollow dot in the first lane and a dashed line down to the commit with the filled "main" label; Author / Date / Id empty; no strip under the toolbar; the heading says "3 commits" (the row is not counted) (C7.1-dirty-row.png).
- Clean: br1, nb, nr, oth and big after its commit all showed the newest commit as the first row, no "Uncommitted changes" row.

## C7.2 PASS
- up2 (origin/main 2 commits ahead, 1 changed file), Current branch: "Uncommitted changes (1)" on top; "incoming two" [origin/main] and "incoming one" in the second lane; the dashed line runs down the first lane past both and ends at the dot of "three" [main]; from there the line is solid (C7.2-incoming.png; the SVG has `gl-0 dashed` segments in rows 1-4 only).

## C7.4 PASS except the double-click (open, a wider pattern)
- dirty, row selected: pane headed "Uncommitted changes on main", "Based on 21de91e", "Staged Changes (1)" store.ts M, "Changes (2)" app.css M, notes.txt U: same groups and letters as Source Control beside it; no message / author / parent / copy button; no "Open Source Control" button because the panel was showing (C7.4-uncommitted-details.png).
- Click app.css: Compare tab "app.css (HEAD) ↔ app.css" with a Stage Change / Discard Change bar and the two selected-lines buttons (C7.4-modified-file-compare.png). Click notes.txt (new): the file itself opens. "Based on 21de91e": selects that commit and shows its ordinary details.
- Conflicted file during a stopped cherry-pick: see the end of this file (C7.4b).
- FAIL (open): double-click on a file. At a normal double-click speed (70-250 ms between the clicks) only the Compare tab of the first click opens: it comes to the front after the first click, the graph is hidden, and the second click never reaches the row. With an unnaturally fast double click (15 ms) the file opens, but so do two identical "store.ts (HEAD) ↔ store.ts (staged)" tabs, and a Compare tab ends in front. The same holds for the file list of an ordinary commit (0.1.7 code: "double-click to open the file as it is now") and, from the code, for the comparison pane (COMMITCMP-003.9): in the graph a row's single click replaces the view the row lives in. Source Control rows are not affected (the panel stays). Needs a decision: delay the single click by the double-click time, or drop the double-click promise from the tooltips and stories (GRAPH-015.6, COMMITCMP-003.9).

## C7.5 PASS
- big, scrolled 200 rows down (scrollTop 5200) with "commit 495" selected. A file changed on disk from a shell (stands in for a save: a save in a tab would have meant leaving the graph tab), Stage from the panel row, Discard from the panel row (dialog, Discard): after each the list was still at 5200 with "commit 495" selected and 301 rows loaded (no reload), and the first row read (3), then (2) (C7.5-scrolled-after-changes.png).
- Row selected, pane open ("Staged Changes (2)"), message typed, "Commit 2 Staged" clicked: toast "Committed cf67b77", the row is gone, the pane closed, the first row is the new commit (C7.5-after-commit.png).

## C7.6 PASS
- Right-click on the row: it is selected, no menu. Ctrl+click on it with a commit selected: selected alone, no comparison pane. Keys with the list focused: Up from the first commit selects the row, Down goes back, Home selects the row.
- Find "uncommitted": "0 in 3 loaded", toolbar still "3 commits", the row dimmed like the commits, Enter does not step onto it (C7.6-find-uncommitted.png).

## C7.3 PASS (own fixture; git.git see C7.9)
- mid, All branches: branch "long" (451 commits, newest) is listed first, the commit I am on ("Merge branch 'side'" [main]) is row 452, one changed file. An in-page script scrolled the list in steps and read every row's lane drawing: rows 1 to 451 each have the dashed segment over the full row height in lane 1, no row has an arrow (cut) element, the dashed line ends at the middle of row 452 (the filled HEAD dot) and the line is solid below it; 453 rows checked, none missing (C7.3-top.png, C7.3-at-head.png). Lines are cut after 40 rows elsewhere, so the 451-row dashed line is the uncut exception the story asks for.

## C7.7 PASS
- empty (no commits, 5 new files): the list shows "Uncommitted changes (5)" with a hollow dot and no line below it, then "No commits yet."; heading "0 commits". Selected: "Uncommitted changes on main", "Based on: nothing yet (no commits)", Changes (5) all U (C7.7-empty-repo.png).

## C7.10 PASS
- dates (root 09:00, main 10:00 and 12:00, feature 11:00, merge 13:00). Branch order: merge, 11:00 feature, 12:00, 10:00, 09:00 (C7.10-branch-order.png). "11:00 feature" selected, Date order clicked: merge, 12:00 main, 11:00 feature (second lane), 10:00, 09:00; main stays in the first lane; the selected commit is still selected and in view with its details (C7.10-date-order.png). Reload the graph: Date order still on, same order, same selection. Clicked again: back to branch order.
- Fallback (mid): Current branch (122 commits) with Date order on, then All branches (573): branch order, the button disabled and not pressed, one info toast "Date order is off: this history has more than 300 commits." (C7.10-fallback.png); back on Current branch the button is enabled and off.
- Disabled tooltip: `title` = "Only for histories of 300 commits or fewer: in larger ones date order spreads the branches over many more lanes." on both the button and its wrapper; the disabled button keeps `pointer-events: auto`, so known issue 2 should not apply. Not looked at on screen (no real pointer).

## C7.11 PASS
- c300 (exactly 300 commits): heading "300 commits", Date order enabled (C7.11-c300.png). c301: "300+ commits", Date order disabled with the tooltip text above (C7.11-c301.png).

## C7.8 PASS (window not resized: see the last point)
- big, Find "commit 3" > Search All History: "111 commits in the whole history match…", list 242 px, a 5 px divider under it with the up-down cursor (`ns-resize`) and the title "Drag to resize the results; double-click for the default height" (C7.8-results.png).
- Real drags of the divider: 150 px down: results 392 px, commit list 150 px shorter (C7.8-dragged-down-150.png). As far up as it goes: stops at 80 px (heading + one result) (C7.8-min-80.png). As far down as it goes: stops at 487 px with the commit list at 156 px = 6 rows (C7.8-max.png).
- Dragged to 370, clicked a result: details open, the results are still 370 px, the clicked result is in view (C7.8-picked-after-drag.png). Show Fewer: 100 px; Show More: 370 again. Double-click on the divider: back to the default (242 px, no inline height); the next picked result shrinks the list to 100 px as before any drag.
- 2 results ("commit 70"): the list is 80 px and a 250 px drag down leaves it at 80: no empty space (C7.8-two-results.png). A search with no result: no divider.
- The details pane's own divider still works (pane 200 → 120 px with an 80 px drag) while results are showing.
- Smaller window: NOT done with the real window (it is maximised; CDP's device-metrics override has no effect in this WebView2). Instead the graph's area was made 300 px shorter by opening the bottom panel through the store (internal): the 362 px results shrank to 187 px so the commit list kept 156 px, and went back to 362 px when the panel closed (C7.8-smaller-area.png).
- For the owner: with the results at 370 px and a result picked, the commit list keeps its 156 px and the details pane is what gives way: it was 112 px high in this 816 px window, its Refs line cut off (C7.8-picked-after-drag.png). Nothing guarantees the details pane a minimum.

## C7.9 PASS (git.git, treeless clone, opened as a graph tab only)
- How it was opened: `openGraph(root)` refuses a repository Quarry does not know, so the tab was added through the store (internal `addDoc` with `kind: "graph"`); the folder and Source Control stayed on the throwaway repo "big"; no folder of git.git was opened, no status, no fetch. The Speed Up offer showed ("git needed 0.6 s for the last page…") and was NOT accepted; nothing was written into the clone.
- Current branch, first page: lane column 186 px, no scroll bar. All branches: the column is 198 px, the Commit column starts at the same x for every row (593), a scroll bar 198 x 12 px sits under the heading's left part with the title "More branch lines to the side: drag, or hold Shift and turn the wheel over the lines"; widest row 44 lanes (522 px) (C7.9-gitgit-all-top.png).
- Pages arriving: a DOM observer during a reload and during loading down to "43200+ commits": the drawing width went 486 → 522 px while the column stayed 198 px and the lane scroll stayed 0: nothing jumped.
- Shift+wheel over the lanes (real wheel events with Shift): the lanes moved (0 → 90 px → 324 px = the end), the list's vertical position (7800) and the text columns did not move.
- Fades: at the left end only the right edge is faded (class `lanes-right`), in the middle both, at the right end only the left (C7.9-crop-left.png, C7.9-crop-mid.png, C7.9-crop-right.png: looked at, the fades are on the right sides and the 15 px lane spacing keeps every lane apart).
- Scroll-bar thumb: a real drag of the thumb inside the 24 px heading moved the lanes (324 → 166 → 0 px); the thumb is about 75 px wide and 4-5 px thick in the screenshots: usable, but a thin target.
- Selecting a commit in lane 41 by clicking its author text (lanes at 0): the column scrolled to 300 px and the dot is inside the column (C7.9-selected-high-lane.png).
- C7.3 on git.git: not applicable this way: without opening the clone as a folder there is no status and so no uncommitted row (and as a folder a no-checkout clone would list every file as deleted). C7.3 was checked on the "mid" fixture.

## C7.4b PASS (conflicted file during a stopped cherry-pick)
- dirty, cherry-pick stopped in a shell with app.css in conflict, keep.txt modified, x.txt new: the graph shows the warning strip "The cherry-pick stopped part-way: 1 file has conflicts…" with Abort and "Uncommitted changes (3)"; the row's pane lists "Merge Changes (1)" app.css "!" and "Changes (2)" keep.txt M, x.txt U (C7.4b-cherry-pick-row.png). Click on app.css: the file itself opens with the bar "Conflict 1 of 1 · Accept Current · Accept Incoming · Accept Both · Compare · Explain" (C7.4b-conflict-file.png); the cherry-pick is still stopped, `git status` unchanged.

# Bugs fixed (each its own commit in C:\coding_projects\Quarry, branch main, not pushed)
1. 59dd7a1 "Fix: a commit picked in the lower part of the graph ended up behind the details pane" (C4.1). GraphView.tsx: the row is revealed when the details / comparison pane opens. No unit test (needs layout). Re-checked live.
2. ded6f92 "Fix: a long path in a dialog or notification ran past its right edge" (C4.10). app.css only (`overflow-wrap: anywhere` on dialog text and toast text). Re-checked live.
3. 0f14552 "Fix: a submenu opened low in a tall menu ran past the bottom of the window" (C4.13). MenuBar.tsx `submenuShift` + layout effect; scenario UI-003.9; 3 unit tests in ui.test.ts. Re-checked live (Branches and Tags: all seven entries inside the window).
4. 5c88b53 "Fix: a list that opened under the resting pointer highlighted the row under it instead of the first" (C4.8). CommandPalette.tsx; scenario UI-005.8; one component test. Re-checked live.
After each: `npx tsc --noEmit`, `pnpm test` (74 files, 1309 tests at the end), `pnpm specs` 0 problems. No Rust changed. docs/, CLAUDE.md and GIT-ROADMAP.md not touched.

# Open (not fixed)
1. Double-click on a file in the graph's file lists (uncommitted row, a commit's files, the comparison pane) does not open the file at a normal double-click speed: the first click's Compare tab takes the front. A very fast double click on the uncommitted row's file opens the file plus two identical Compare tabs (C7.4). Needs a decision (delay the single click, or drop the double-click promise). Stories: GRAPH-015.6, COMMITCMP-003.9, and the 0.1.7 commit file list.
2. A graph tab whose repository Quarry no longer knows (tab left open, another folder opened, no file of that repository open): every label-menu entry except Copy is greyed with "The open folder is not in a git repository" (untrue), while the commit menu of the same tab still offers Switch / Cherry-pick / Reset (C4.17).
3. The details pane has no minimum height: with the search results dragged to 370 px and a result picked it was 112 px high, its content cut (C7.8).
4. Returning to a graph tab reloads it from page 1: the place in the list is lost (C5.4). By design per the stories, noted because it is felt on long histories.
5. Git menu bar > Compare with Branch… acts on the Source Control repository even while another repository's graph tab is in front (C5.11).
6. A locally deleted tag that exists on the remote comes back with the next automatic remote check (C4.17 note); the dialog only says the remote keeps its copy.
7. Small: no outline on a details-pane label while its menu is open (C4.16); the label menu opens over the right half of its own label (C4.1); the "!" row's tooltip in the comparison pane says "Click to compare" although it opens the file (C5.9); Compare with Branch on a detached HEAD shows "HEAD" in the heading but not on the side's own line (C5.7); "up isn't on the remote yet." for a branch that only has no upstream (C4.8); after a refused name the rename strip closes (C4.4); the heading "7159df3 feature ↔ 7159df3 feature" when a branch is compared with itself (C5.7).
8. Known issues that touch these features: issue 1 (the top-level Git menu is still taller than the window; its submenus are now reachable), issue 4 (see-through menus, pickers and dialogs: graph rows read clearly through the branch picker, C4.6-shiftF10-menu.png), issue 5 (220 px graph menu cuts "Merge experiment into mai…", "Rebase main onto experim…"), issue 3 (first click lost while a panel floats: seen again after every folder open; Source Control was pinned to avoid it), issue 7 ("Merge main into main…" greyed on the own-branch label).

# Not verified through the real UI
- Folders and files were opened with `__shi.openFolder` / `openPath`; tabs closed with `runCommand('file.closeAll')` / `closeDocument`; graph tabs opened with `runCommand('git.graph')`; the git.git graph tab added through the store; the theme switched through the store; `git.refresh` through `runCommand` after shell changes; the floating Explorer hidden through the store after each folder open; the bottom panel opened through the store for the "smaller window" part of C7.8.
- C7.3: the row-by-row reading of the dashed line was an in-page script that scrolled the list. C7.5: the "save" was a file change from a shell. C5.9 / C7.4b / C5.7 detached HEAD: the stopped merge, rebase, cherry-pick and the detached HEAD were made in a shell.
- C4.6: the native WebView2 context menu after a real Shift+F10 cannot be observed over CDP.
- C7.8: the real window was not resized. C5.10 was done on a generated 6000-file repository, not on git.git. rust-lang/rust was not cloned.
- Busy labels ("Pushing topic…", "Deleting origin/gone…") were read from the DOM by a store subscriber, not photographed.
- Tooltips: `title` attributes only; nothing was looked at with the real pointer and no OS screen capture was made.
- Not done at all: BRANCH-001.10 / 006.10 / 007.12 / 009.9 (entries greyed while git is busy), BRANCH-003.5 / .6 / .8 / .11 / .12 / .13, BRANCH-005.9, BRANCH-006.3 / .4 / .9 / .12, BRANCH-007.8 / .10, BRANCH-008.5 / .6, BRANCH-009.4 / .8, COMMITCMP-001.9 / .10 (fetch reload), 002.6 / .9 / .11 / .12, 003.4, 004.5 / .6 / .9 / .13, 005.4, 006.2 / .6, GRAPH-015.13, GRAPH-016.7 (restart), GRAPH-018.3 / .4 / .8 / .11.

# Incidents
- None on the owner's side: no real pointer move, no OS screen capture, no file or folder of C:\coding_projects\Quarry opened in the app, nothing killed. Twice a key press (Enter / Escape) was sent after a click had been swallowed by the floating Explorer; both times nothing was open to receive it (checked: no dialog, no palette).
- The Add Remote form (with its "Create and Push" to GitHub button) was on screen in the no-remote repositories; nothing in it was clicked and no Enter was sent while it had focus.

# End state
- Dev app closed with its own close button (nothing killed); no quarry.exe, no msedgewebview2 with the live-C\wv profile, ports 1420 / 9333 free.
- %APPDATA%\com.quarry.app: session.json, settings.json, .window-state.json and search-history.json restored from live-C\backup and verified by SHA-256 (92024e90…, 16c4dbe3…, a62f4c6c…, 1f6f36dd…). During the run a scratch session (no folder, empty recent lists) and autoUpdateCheck=false were in place.
- C:\coding_projects\Quarry: clean tree, four "Fix:" commits on main after b2f96d0, nothing pushed.
