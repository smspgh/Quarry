# Git

Quarry works with git repositories through the `git` command line (Git for Windows), so it uses your own git configuration, hooks and credentials. If git isn't on PATH, the Source Control panel says so.

A repository is picked up when the open folder, or any open file, is inside one. Status refreshes by itself after saves, file changes in the open folder, git actions, and when the Quarry window gets focus. **Git › Refresh Git Status** forces it (for example after `git init` in a terminal).

## In the editor

- **Change markers.** A thin bar in the gutter, next to the line numbers, marks lines that differ from the last commit (HEAD): green for added lines, blue for changed lines, and a red wedge where lines were deleted. The markers follow your typing; they compare the text on screen, saved or not.
- **Peek and revert.** Click a marker to see the committed text of that change. The peek has **↑ / ↓** to move between changes, **Revert** to put the committed lines back (one undo step), and **✕** or **Escape** to close it.
- **Keyboard.** **Alt+F5** / **Shift+Alt+F5** go to the next / previous change and open its peek. **Git › Show Change at Cursor** and **Git › Revert Change at Cursor** act on the change under the cursor.
- **Line blame.** **Git › Show Line Blame** shows who last changed the cursor line, when, and the commit summary, at the end of the line; hover it for the commit id, e-mail and date. Lines you have changed show *not committed yet*. Blame follows unsaved edits (it is asked again a moment after you stop typing). The same command hides it.
- **Compare with Last Commit** (Git menu, tab right-click menu) opens a [Compare](compare.md) tab with the HEAD version on the left and your tab's current text (unsaved edits included) on the right. Both sides are read-only; when the file isn't open in a tab, the right side is the file on disk and can be edited and saved.

## Source Control panel

Open it from the rail (branch icon), **Git › Show Source Control** or **Ctrl+Shift+G**.

- **Branch.** The button at the top shows the current branch (or the commit, when HEAD is detached). Click it to switch branches; see below. A badge shows a merge, rebase, cherry-pick or revert in progress, or **Stash conflicts** when a stash came back with conflicts.
- **Commit.** Type the message and click **Commit** or press **Ctrl+Enter**. The button says what it takes: **Commit 3 Staged**, or with nothing staged **Commit All (14 files)**, which asks before staging every change. The changed files are listed right under it, and a small line below the button shows who the commit is made as. **Amend** replaces the last commit; with the message box empty it keeps the old message. Unsaved changes in open tabs are not part of a commit; Quarry warns when there are some.
- **Merge Changes / Staged Changes / Changes.** Files with conflicts, files staged for the next commit, and files changed but not staged (including new, untracked files). A file staged and then changed again is in both lists. The letter on the right is the change: **M** modified, **A** added, **D** deleted, **R** renamed, **U** untracked, **!** conflict.
  - Click a file to see its change in a Compare tab: in Staged Changes HEAD against what is staged, in Changes what is staged (or HEAD) against the working copy. New, untracked files just open. Double-click to open the file itself. Clicking a file whose comparison is already open shows that tab again.
  - **Stage part of a file.** In that Compare tab every change has a small bar above it:
    - From **Changes**: **Stage Change** and **Discard Change**. From **Staged Changes**: **Unstage Change**. The file is then listed in both sections, and the Commit button counts it.
    - For part of a change, select lines in the right side (or just put the cursor on a line) and use **Stage Selected Lines** / **Discard Selected Lines** / **Unstage Selected Lines** in the toolbar. Added lines are taken one by one. In a block changed line for line, each selected line is taken with the line it replaced. When a block was replaced by a different number of lines, the selected lines replace the whole old block. Removed lines come along only when the selection covers the line before and the line after the place they were removed from.
    - **Discard always asks first**, names the lines, and Cancel is the default. The lines go back to the staged version if something of the file is staged, otherwise to the last commit. Stage and Unstage don't ask: they lose nothing.
    - **Unsaved edits are saved first** when you stage or discard (the file's tab, or the side you edited in the comparison); the Discard question says so. If the save fails or you cancel it, nothing is staged. Unstage never saves anything.
    - **Nothing is applied to an outdated picture.** If the file or the index changed since the comparison was loaded (a `git add` in a terminal, another program rewriting the file, more typing in the file's tab), nothing is staged, unstaged, discarded or saved: the comparison reloads and says so. Check the change and try again.
    - The comparison follows along: after any staging action (here or in the panel) or a commit it shows the new state, and stays where you were reading. One with unsaved edits is left alone.
    - Line endings, the encoding, a byte order mark and a missing final newline are kept exactly; only the lines you chose change.
    - Also in **Git › Stage Part of a File** and the command palette: **Stage Change at Cursor** (**Ctrl+K S**), **Unstage Change at Cursor** (**Ctrl+K U**), **Stage Selected Lines** (**Ctrl+K L**), **Unstage Selected Lines** (**Ctrl+K N**), and the two Discard commands, which have no shortcut on purpose. With **F7** you can review a file change by change and stage as you go.
    - Not offered: for untracked and conflicted files (they open as files), in other comparisons (Compare with Last Commit, a commit's files, file history), while the sides are swapped, and for files git treats as binary, which includes UTF-16 text. A deleted file has one change, the whole file: its buttons do what the row's do.
  - Hover a row (or a section heading, for all its files) for **Stage (+)**, **Unstage (−)**, **Discard** and **Open file**. Discard asks first; it restores the staged / committed version, and an untracked file goes to the Recycle Bin. Staging a conflicted file marks it resolved.
- **Sync with the remote.** Beside the branch (below it in a narrow panel), a status line says where you stand. It keeps uncommitted work and commits apart: **14 uncommitted changes. Your commits match origin/main.** means nothing is waiting to be pushed, but those changes exist only on this computer until you commit and push them. The green tick, **Everything is committed and matches origin/main**, appears only when there is nothing left to commit, push or pull. Otherwise: **N commits to pull** (Pull), **N commits to push** (Push), **Diverged** (both: **Pull (Merge)** joins the histories with a merge commit, **Pull (Rebase)** replays your commits on top of the remote's; push after either), **not on the remote yet** (Publish Branch), **no longer exists on the remote** (Push to Recreate It), or, when the remote repository itself is gone (deleted, renamed, or not visible to your account), **Create It on GitHub** / **Change URL**. To keep this true, the panel fetches the branch's remote by itself when it opens and when Quarry gets focus, at most once a minute (the ↻ button checks now). That fetch only updates git's copy of the remote's branches, never your files or branches, and it never asks you to sign in: if it can't reach the remote or needs a sign-in, the line says so and **Fetch** tries in the open.
- **Fetch, Pull, Push** are the cloud, ↓ and ↑ buttons in the panel header (also in the Git menu). Push publishes a branch that has no upstream yet to `origin` (or the only remote). Sign-in prompts come from Git Credential Manager in their own window; SSH keys that need a passphrase must be loaded in an agent (Quarry can't show an SSH prompt).
- **Repository: your identity and remotes.** At the bottom of the panel, the **Repository** section is closed by default and shows a one-line summary (who you commit as, the remote and whether it is private). Click it to open; it opens by itself when something is missing (no name / email, no remote) or being changed. *Your identity* shows **Commits as** (git's `user.name` / `user.email`, saved in every commit) and, when GitHub is involved, **GitHub**: the account Git Credential Manager is signed in to, which new repositories are created under. GitHub links your commits to that account when the *Commits as* email is one of its emails. With several accounts signed in, pick one there (Quarry remembers it); the person icon signs in to another account in GCM's window, and **Sign in** appears when there is none. *Remote* lists each remote with its URL; a GitHub remote also shows **Private** or **Public** (read from GitHub with your stored sign-in, never asking you to sign in; without a sign-in only public repositories can be seen, and an unknown one shows no badge). The "already exists" offer and the message after creating a repository say which it is too. The pencil changes them; the arrow opens the remote's page on GitHub (or GitLab, Bitbucket…).
  - When git has no name or email yet, a form asks for them first. They are saved for all your repositories, or with **Only this repository** for this one alone (a save for all repositories also drops this repository's own values).
  - When the repository has no remote, a form offers a choice, **Create a new repository on GitHub**: a repository name (the folder's name to start with) and **Private**, then **Create and Push** makes the repository on your GitHub account, adds it as `origin` and publishes the current branch there. It uses the GitHub sign-in Git already keeps for pushing (Git Credential Manager opens its sign-in window if there is none); the sign-in never leaves Quarry's Rust side except to GitHub. If your account already has a repository with that name, Quarry says whether it is empty and offers to use it (**Use It and Push**) instead; one that already has commits only takes the push when they are part of this repository's history, and nothing on GitHub is overwritten. **Use an existing repository's URL** adds a repository you already have instead. Push, Pull and Fetch point you to this form instead of failing; **Git › Add Remote…** adds another remote later.
  - **Changing a remote** points it at another URL, or at a new repository created on GitHub (for example to carry the project on in a new repository). The old repository is left as it is; **Save and Push** (or **Create and Push**) publishes your branch to the new one and tracks it.
- **Which repository the panel shows.** The folder's name and full path sit on their own line under the panel's buttons, so a long name is never cut off. The panel shows the open folder's repository; opening another folder switches it to that folder's repository, or, when the new folder is not in one, to *The open folder is not in a git repository*, never back to the previous folder's.
- **Set as Source Control Context.** Right-click any folder in the Explorer and choose **Set as Source Control Context** to show the repository that folder belongs to (for example a repository nested inside the open folder); the Source Control panel opens on it. **Set Folder as Source Control Context** in the command palette does the same for the open folder. It lasts until you open another folder. A folder that is not in a repository gets a message and changes nothing.
- **More than one repository** (the folder and a file from elsewhere): a picker at the top chooses which one the panel shows. When the open folder is not in a repository, the picker reads *Show a repository…* and lists the other repositories known.

## Branches

**Git › Switch Branch…**, the panel's branch button or the branch in the status bar open a list of branches: local ones first, then remote ones (marked *remote*), the current one marked *current*. Pick one to switch to it; a remote branch is checked out as a new local branch tracking it. Type a name that doesn't exist and pick **Create branch "…" from here** to create it from the current commit and switch to it. Git refuses a switch that would overwrite uncommitted changes; the message says which files.

### Tidying up branches and tags

Delete or rename a branch, choose what it tracks, push a branch you are not on, delete a branch on the remote, delete or push a tag. Every one of these is reachable three ways, and each way asks the same questions:

- **In the commit graph**, right-click a **branch or tag label**. The label's menu (headed **Branch feature**, **Remote branch origin/topic** or **Tag v1.2.0**) has **Switch to …**, the merge and rebase entries, then the actions for that kind of label, then **Copy Branch Name** / **Copy Tag Name**. A right-click beside the labels still opens the commit's menu.
- **In the branch list** (Switch Branch…), each row has a **⋯** button; a right-click on the row or **Shift+F10** opens the same menu. **Up** / **Down** and **Enter** work in it, **Escape** goes back to the list. Enter and a click on the row still switch branch.
- **Git › Branches and Tags** (and the command palette): **Rename Branch…**, **Delete Branch…**, **Set Upstream…**, **Push Branch…**, **Delete Remote Branch…**, **Delete Tag…**, **Push Tag…**. Each first opens a list of just the branches or tags it can act on.

| Action | What happens |
| --- | --- |
| Delete Branch… | Always asks, and **Cancel** is the default button (Enter does not delete). When every commit of the branch is in its upstream (or, with no upstream, in the branch you are on) the dialog says nothing is lost. Otherwise a second, red dialog says how many commits would be left on no branch and gives the id of the last one, in case you need it back. The branch you are on cannot be deleted. The branch on the remote is never touched. |
| Rename Branch… | In the graph a strip asks for the new name; in the branch list you type it (spaces become hyphens). The branch keeps its commit and what it tracks; the branch on the remote keeps its old name, and the notification says so. A name that is taken is never overwritten. |
| Set Upstream… | Lists the remote branches, the one with the same name first; the one it tracks now is marked *tracking*, and **Stop tracking** clears it. Nothing is fetched or pushed. With a remote that has no branches yet, the one row pushes the branch and tracks it. |
| Push *branch* to *remote* | Pushes that branch without switching to it. It goes to the branch it tracks; a branch that tracks nothing goes to `origin` (or the first remote) and tracks it from then on. The entry always names where it goes. Nothing is ever forced: if the remote has commits the branch lacks, a dialog says so and offers **Switch to *branch*** (or **Pull**, on the branch you are on). |
| Delete *branch* from *remote*… | Deletes the branch in the remote repository, for everyone. The red dialog names the remote and its address, and says how many commits exist only there (as of the last fetch). Your local branches are kept. A remote's default branch (what `origin/HEAD` points to) cannot be deleted from Quarry. A branch someone already deleted just loses its stale label. |
| Delete Tag… | Asks once, then removes the tag from this computer only. If it was pushed, the remote keeps its copy. |
| Push *tag* to *remote* | Pushes that one tag (never all tags) to `origin` or the first remote. A tag the remote already has on another commit is not overwritten. |

With no remote configured, the push and Set Upstream entries lead to the Add Remote form instead. While another git action is running, everything except Copy is greyed out.

## Merge and rebase

**Merge** brings another branch's commits into the branch you are on; nothing is rewritten. **Rebase** replays your branch's own commits on top of another branch, so they get new ids. Both can be started from four places, and all of them ask first:

- **Git › Merge Branch…** and **Git › Rebase onto Branch…** (also in the command palette) open the branch list without the branch you are on: local branches first, then remote ones. Pick one.
- The **Merge or Rebase** button right after the branch button in Source Control offers the same two.
- In the commit graph, right-click a commit: **Merge … into *branch*…** and **Rebase *branch* onto …** sit under Cherry-pick and Revert. A commit that carries exactly one other branch label stands for that branch (the entries then name it); otherwise the commit is used by its id.
- In the commit graph, right-click a **branch or tag label** (in a row, or under Refs in the details): a menu for that label opens, headed **Branch feature**, **Remote branch origin/topic** or **Tag v1.2.0**, with the same two entries by name (among the label's other actions, see [Tidying up branches and tags](#tidying-up-branches-and-tags)). The label of the branch you are on has them greyed out.

A remote branch is used as it was last fetched: nothing is fetched and no local branch is created.

**The merge dialog** says how many commits come in. When your branch has commits of its own there is one outcome, a merge commit, and one **Merge** button. When it has none, you choose: **Fast-forward** just moves your branch forward, **Create a Merge Commit** records that the other branch was separate. The message ("Merge branch 'feature'") is git's own; you are not asked for one. When your branch already contains the other one, Quarry says so and does nothing.

**The rebase dialog** says how many of your commits are replayed. When one of them is a merge commit it says that a rebase does not keep it. With no commits of your own a rebase is just a fast-forward, and is offered as one. When the branch is already based on the other, Quarry says so and does nothing.

**Cancel is the default button** of all these dialogs: Enter and Escape both cancel.

**When they refuse to start:**

- *Uncommitted changes to tracked files*: the dialog **Commit or discard your changes first** opens (with **Show Source Control**). A merge or rebase only starts from a clean state, so that **Abort** always brings back exactly what was there. Untracked files do not block. Nothing is stashed for you.
- *A merge, rebase, cherry-pick or revert is stopped*: finish or abort it first. The entries are greyed out and say so.
- *Detached HEAD*: merge works ("into the current commit"); rebase is off, because it moves a branch.
- *Another git action is running*: one at a time.

**A conflict** stops the merge or rebase part-way and opens Source Control: the files are under **Merge Changes**, and **Abort** (and for a rebase **Skip** and **Continue Rebase**) work as described under *Resolving a conflict* and *Rebase* below.

### Rebasing commits that are already pushed

When some of the commits a rebase would replay are already on a remote branch (any remote branch, as last fetched), the ordinary dialog is replaced by a warning, **Rebase commits that are already pushed?** It lists those commits, says that the branch and its remote will no longer agree and that anyone who pulled them will have to repair their copy, and suggests a merge instead. **Rebase Anyway** runs it; the rebase itself pushes nothing.

Afterwards the status line in Source Control reads **main was rewritten: origin/main still has the 3 old commits. Force Push replaces them with yours.** and its only button is **Force Push…** (a Pull would bring the old commits back, so it is not offered).

**Force Push** (**Git › Force Push (Replace Remote Branch)…**, also in the palette) replaces the branch on the remote with yours. It asks again, in a dialog that lists the commits the remote will lose, with Cancel as the default. It only ever touches the current branch's own remote branch, and it is refused when that remote branch has changed since Quarry last fetched it (someone else pushed): fetch, look at their commits, then decide. The plain **Push** never forces.

Quarry remembers that it rewrote a branch only until you force push, switch branch or restart; after that the status line is the ordinary one, and Force Push is still in the Git menu.

## Stash

A stash puts your uncommitted changes aside, so the files are clean again, and keeps them to bring back later. The **Stashes** section sits under the changes and above Commits, once the repository has a commit.

- **Stash Changes…** (on the section heading, in **Git › Stash**, or from the command palette) opens a small form: an optional message, then **Stash** (or **Enter**; **Escape** cancels). A stash takes every staged and unstaged change to tracked files. **Include untracked files** is ticked each time and adds the new files git does not track yet; untick it to leave them where they are. Ignored files are never stashed. Open tabs of the stashed files reload the committed text. Without a message the stash is named after the commit it was made on: **WIP at 1a2b3c4 Fix tab order**.
- **The list** shows every stash, newest first, with the branch it was made on and its age; the heading counts them. A stash made in a terminal appears when Quarry gets focus. Click a stash to see the files it holds (the same letters as the changes list; **U** for an untracked file); click a file for a read-only [Compare tab](compare.md) of the commit the stash was made on against the stash; double-click opens the file as it is now.
- **Apply** brings the stash's changes back into your files and keeps the stash, so it can be used again (for example on another branch). **Pop** does the same and removes the stash from the list; it does not ask, because nothing is lost. Either way the changes come back unstaged, under Changes. They are added to whatever you have changed since, but git refuses when a file the stash changes has uncommitted changes of its own, or when an untracked file of the stash already exists in the folder: Quarry names the files, changes nothing and keeps the stash.
- **Drop** deletes a stash. It asks first and says what is lost (the stash's name, how many files, where and when it was made); **Cancel** is the default, so Enter does not drop. The **Delete** key on a focused stash does the same. There is no way to drop every stash at once.
- **Git › Stash** and the command palette have **Stash Changes…**, **Apply Latest Stash**, **Pop Latest Stash**, **Drop Latest Stash…** and **Show Stashes**, with the same checks as the buttons.
- **When it is off.** Stash Changes, Apply and Pop are not available while a merge, rebase, cherry-pick, revert or patch series is stopped part-way, or while a file is in conflict; the button's tooltip (or a notification, from the menu) says which. Looking at a stash and dropping one always work.

### A stash that conflicts when it comes back

If the files have changed since the stash was made, in the same lines, applying or popping it leaves conflicts. That is not an error and nothing is lost:

- The conflicted files go to **Merge Changes** and are resolved like any other conflict (see *Resolving a conflict* below); the changes that applied cleanly are already in your files, staged. A **Stash conflicts** badge shows beside the branch, and the graph tab shows a warning strip.
- **Current** is your files as they are now, **Incoming** is the stash. The conflict bars and the row buttons say so. **Current** on a file's row keeps that file as it was before the stash came back.
- **The stash is kept**, also after a Pop (git does not remove a stash that conflicted); its row says **applied with conflicts**. When the last file of a Pop is resolved, Quarry offers to drop the stash: **Keep Stash** is the default. After an Apply nothing is offered, and nothing is ever committed for you.
- There is no Abort for this: git has none, and the general way back could discard other work. If Quarry was restarted in between, the files are still under Merge Changes and the stash is still in the list; drop it yourself when you are done.

## Commits

Under the changes and the stashes, **Commits** lists the branch's commits, newest first (30 at a time; **Show more** loads older ones). It is how you see what a commit you just made contains.

- A commit your remote doesn't have yet is shown in bold with an up arrow and **not pushed**; the section header counts them (**2 to push**). Commits already on the remote have a tick. A branch with no remote branch shows neither.
- Click a commit to list the files it changed, with the same letters as the changes list (**A** added, **M** modified, **D** deleted, **R** renamed). Click it again to close it.
- Click a file there to open a [Compare tab](compare.md) of what that commit changed in it; double-click opens the file as it is now.
- Hover a commit for its full id, author and date.

The header also counts commits **to pull**, and its graph button opens the commit graph (below). This list stays a quick checklist of the current branch; a merge commit shows what it changed against its first parent.

## Commit graph

**Git › Show Commit Graph** (or the graph button on the Commits section) opens the repository's history in a full-width tab, so nothing is squeezed into the side panel. The command is always in the menu and the command palette; with no repository open it says **Open a folder in a git repository** and opens nothing.

- **The graph.** Each commit is a dot on its branch's line; lines fork where a branch starts and join where it is merged. Commits are listed branch by branch (a merged branch's commits sit together under the merge), not strictly by date. A branch's own line stays in its lane, and a lane is reused as soon as its branch ends. Columns show the message, author, date and short id.
- **Long lines are cut short.** A line that would run more than 40 rows to reach its commit (a branch that forked from something old) ends in a small down arrow, and the commit it leads to shows an up arrow where it comes back in. This is what keeps a busy history readable: on the Git project's own repository it takes the graph from about 130 lanes to about 10. Select the commit at either end to follow the line: its **Parent** link jumps down to the other end, and **Continues** in the details lists the commits whose cut lines lead to it.
- **Uncommitted changes.** Work you have not committed is the first row of the graph: **Uncommitted changes (4)**, with a hollow dot and a dashed line down to the commit you are on, wherever that is in the list (the line is never cut). Select it to see the changed files under **Merge Changes**, **Staged Changes** and **Changes**, as in Source Control: click a file for the same comparison Source Control opens (with its Stage / Unstage / Discard controls), double-click to open the file; **Based on** jumps to the commit the changes sit on. The row follows your work as you save, stage and discard, without reloading the graph, and goes away when nothing is left. It is not a commit: it has no right-click menu, Find and the commit counts leave it out, and it cannot be Ctrl+clicked for a comparison (use **Compare with Working Tree** on a commit).
- **Wide graphs.** The lane column shows at most 16 lanes. When more branches are open at once, every line still has its own place: the column scrolls sideways, with **Shift + mouse wheel** over the lines or with the scroll bar under the column heading. A faded edge means more lines are hidden on that side, and selecting a commit scrolls its dot into view.
- **Date order.** In a history of 300 commits or fewer the **Date order** button lists the commits newest first across branches (by the author date the Date column shows; a commit never appears above one made on top of it) instead of branch by branch. It is off by default, per graph tab and not remembered. In larger histories it is disabled, because there it spreads the branches over many more lanes; if the history shown grows past 300 commits (a fetch, or switching to All branches) the graph goes back to branch order and says so.
- **Search results height.** Drag the edge under the Search All History results to give them more or less room (at least one result stays, the commit list keeps six rows, and the list is never taller than its results). A height you dragged is kept for the tab and no longer shrinks when you pick a result; double-click the edge to go back to the default.
- **Labels.** The branch you are on is a filled label; other local branches are outlined, remote branches (`origin/main`) dashed, tags tinted. Where `main` and `origin/main` sit on different commits, the ones between them are what you have to push or pull.
- **Current branch / All branches.** *Current branch* shows your branch and the remote branch it tracks (so incoming commits appear too). *All branches* shows every branch and tag, and your stashes: each stash is one row with a **stash** label and a hollow dot, directly above the commit it was made on. Click it for the files it holds; right-click it for **Apply Stash**, **Pop Stash**, **Drop Stash…** and **Copy Message** (a stash row has none of the commit actions). Find matches a stash among the loaded rows; Search All History covers commits only.
- **Find** (Ctrl+F) searches the commits loaded so far by message, author, email, id or branch name, and says how many that is (**6 in 1200 loaded**): matches stay bright, **Enter** / **Shift+Enter** step through them. **Search All History** (also **Ctrl+Enter**, or **Enter** when nothing loaded matches) asks git to search every commit by message, author, branch / tag name or id and lists up to 200 results, newest first. Click a result for its details; double-click it, or use **Show in Graph**, to load the graph back to that commit and jump there.
- **Details.** Click a commit (or move with the arrow keys) to see it in the pane below: the full id (with a copy button), the whole message, author and date, its parents (click one to jump to it), and the files it changed with a summary of lines added and removed. Click a file to open a [Compare tab](compare.md) of what the commit changed in it; clicking the next file reuses that tab (double-click its tab to keep it). Drag the pane's top edge to resize it.
- **Loading.** Commits load 300 at a time as you scroll, in the background; the rest of Quarry, including the Source Control panel, never waits for the graph. Only the rows on screen are drawn.
- **Very large histories.** Without git's *commit-graph* file (an index of the history that `git gc` writes), git has to walk the whole history for every page: about 0.5 s a page on an 86,000-commit repository and 1.8 s on a 350,000-commit one. Quarry then loads bigger pages, and offers **Speed Up**, which has git write that file once (about 2 s on the larger one; it lives inside `.git` and changes nothing else). Pages then take about 0.1 s and 0.3 s. Quarry never writes it without you pressing the button.
- **What's in progress.** A strip under the toolbar says when a cherry-pick, revert, merge, rebase or patch series has stopped part-way, with **Abort** right there (uncommitted changes are the first row of the graph, see above). Conflicts left by a stash that was applied or popped get a warning strip too, without Abort (see *Stash*).

Right-click a commit for the actions:

| Action | What it does |
| --- | --- |
| Copy Commit Id / Copy Message | To the clipboard. |
| Switch to *branch* | For each branch label on that commit. A remote branch gets a local branch that tracks it. |
| Create Branch Here… | A new branch starting at that commit, and switches to it. |
| Create Branch Here (Don't Switch)… | A new branch starting at that commit; you stay on the branch you are on. |
| Create Tag Here… | A tag on that commit. |
| Check Out This Commit… | Your files become that commit, on no branch ("detached"). Switch back with the branch button. |
| Compare with *id* / Compare with Working Tree / Compare with Branch… | Lists the files that differ between that commit and the commit selected before, your files as they are now, or a branch you pick. Nothing is changed; see [Comparing commits](#comparing-commits). |
| Cherry-pick onto *branch*… | Copies that commit's changes onto your branch as a new commit. |
| Revert This Commit… | Adds a commit that undoes it; history is kept. |
| Merge … into *branch*… / Rebase *branch* onto This… | Start a merge or a rebase with that commit (or the one branch on it); see [Merge and rebase](#merge-and-rebase). Right-click a branch or tag label for the same two by name. |
| Reset *branch* to Here (Soft / Mixed / Hard)… | Moves your branch back to that commit. **Soft** keeps the later changes staged, **Mixed** keeps them in your files unstaged, **Hard** discards them along with uncommitted changes to tracked files. |

Everything that moves your branch or files asks first and says what will happen. A cherry-pick or revert that hits a conflict stops part-way: Source Control shows the operation (**Cherry-picking**) with the conflicted files under **Merge Changes**. The graph tab shows the same thing in a strip at its top. Resolve and commit them, or press **Abort** (in the strip, or beside the branch in Source Control) to go back to how things were. Abort also works for a merge or rebase that stopped. 

### Comparing commits

The graph can show what differs between any two points of the history. The details pane then becomes a **comparison pane**: both sides with their labels and first message line, a list of every file that differs, and a summary of lines added and removed. Comparing never changes anything: nothing is checked out, staged or fetched, and nothing inside `.git` is written, so it is safe with uncommitted work or in the middle of a stopped merge or rebase.

- **Two commits.** Click one commit, then **Ctrl+click** another (or right-click it › **Compare with *id***). Both rows are highlighted; the second has a dashed outline. Ctrl+click a third commit to replace the second; Ctrl+click one of the two to take it out. A plain click, an arrow key or **Escape** ends the comparison. Stash rows and Search All History results can't be picked this way (use **Show in Graph** on a result first).
- **A commit and your files.** Right-click a commit › **Compare with Working Tree**: that commit against your tracked files as they are on disk, staged or not. Untracked files are not compared (the pane says how many there are). The list follows your work: it is read again when you save or commit.
- **A commit and a branch.** **Git › Compare with Branch…** (also in the command palette) asks for a branch and compares its latest commit with the commit you are on; uncommitted changes are not part of it. **Compare with Branch…** in a commit's right-click menu compares the branch with that commit instead. The graph tab opens (or comes to the front) with the result, also when the branch's commit is far back in the history: its side then has a **Show in Graph** button.
- **Which side is which.** The older state is on the left. When one commit is an ancestor of the other it goes on the left, whatever order you picked them in; for two commits on different branches the first one you selected is on the left (a picked branch goes on the left unless it is ahead). **Swap Sides** flips them. The working tree is always on the right. A line under the two sides says how they relate, for example **18bc71d is 3 commits ahead of a1b2c3d**, or how many commits each has that the other lacks.
- **The list** is the direct difference between the two snapshots (what `git diff A B` shows), with the usual letters read from left to right: **A** only in the right side, **D** only in the left, **M** modified, **R** renamed (the tooltip names the old path). A conflicted file in the working tree shows **!**. Long lists are complete; only the rows on screen are drawn.
- **Opening a file.** Click a file (or press Enter on it) for a [Compare tab](compare.md) with `name @ id` on each side, both read-only. Against the working tree the right side is your open tab's text (read-only), or the file on disk, which you can edit and save. Clicking the next file reuses the tab; double-click the tab to keep it. Double-click a file in the list to open the file itself. Binary files are listed but not opened.

### Resolving a conflict

Click the file under **Merge Changes**: it opens in the editor with each conflict marked.

- **In the editor.** Your branch's side (*current*, under `<<<<<<<`) is tinted green and the side coming in (*incoming*, above `>>>>>>>`) blue. A bar above each conflict says **Conflict 1 of 2** and offers **Accept Current**, **Accept Incoming** and **Accept Both** (current first). Each is one undo step, so **Ctrl+Z** brings the conflict back. You can also just edit the text and delete the marker lines yourself.
- **From the keyboard / menu.** **Git › Conflicts** has Next / Previous Conflict (**Alt+F6** / **Shift+Alt+F6**), the three Accept commands for the conflict at the cursor, and **Accept All Current / Incoming in This File**.
- **When the last conflict in a file is gone**, Quarry offers **Save and Mark Resolved**; **Keep Editing** leaves that for later (the **+** on the file does the same, and saves the tab first).
- **The whole file at once.** **Current** and **Incoming** on the file's row under Merge Changes take that side's version of the entire file. This is also how to settle a file that one side deleted: the side that deleted it removes the file, the other keeps it.
- **See the two sides.** **Compare** on a conflict's bar opens its current and incoming text next to each other in a Compare tab.
- **Then commit.** With every file resolved, the Commit button comes back and the message box already holds the message git prepared.
- **Nothing left to commit?** If resolving left no changes (the commit's changes are already on your branch), the panel says so: **Skip** moves on without it, **Abort** goes back.

### Rebase

A rebase replays your commits one at a time on top of another branch, and can stop on a conflict at any of them (a **Pull (Rebase)** does this). Source Control then shows **Rebasing 2 of 5** beside the branch.

- Resolve the files as above. In a rebase the sides are the other way round from what you might expect: **Current** is the branch you are rebasing onto, **Incoming** is your own commit. The conflict bars and the row buttons say so.
- The message box is off, because each commit keeps its own message. The main button reads **Continue Rebase**: it carries on with the next commit, and stops again if that one conflicts too.
- **Skip** leaves out the commit it stopped on; **Abort** puts the branch back where it was before the rebase.

### Applying patches

Applying a patch series with `git am` works the same way when a patch does not apply cleanly: the badge reads **Applying patches 2 of 5**, **Current** is your branch and **Incoming** is the patch, the message box is off because each patch keeps its own message, and the main button reads **Continue Applying Patches**. **Skip** leaves out the patch it stopped on; **Abort** (confirm with **Abort Applying Patches**) puts the branch back where it was before the patch series.

While any file is still in conflict, the Commit button is disabled and reads **Resolve 1 Conflict First**. The message box is filled in with the message git prepared (the picked commit's own message, or "Merge branch …"), unless you had already typed one. Marking a file resolved (**+** under Merge Changes) checks it first: if it still contains git's `<<<<<<<` / `>>>>>>>` conflict lines, Quarry asks before staging it.

Starting a merge or a rebase is described under [Merge and rebase](#merge-and-rebase); changing commits that already exist under [Edit history](#edit-history).

## Edit history

Commits of the branch you are on can be changed from the commit graph. Right-click a commit; after the Reset entries the menu has:

- **Undo Last Commit…** (on the newest commit only; also **Git › Edit History › Undo Last Commit…** and the palette). The commit leaves the branch, its changes stay staged and your files are not touched. Its message goes back into the commit box when that is empty, so you can fix things and commit again. Other uncommitted changes are kept.
- **Reword Message…** opens a strip with the whole message. Change it and press **Reword** (Ctrl+Enter; Enter adds a line, Escape closes the strip).
- **Squash into Parent…** folds the commit into the one before it. The strip starts with both messages; edit it to the message the combined commit should have, then **Squash**.
- **Drop Commit…** removes the commit and its changes from the branch. The changes are not kept anywhere in your files.
- **Edit History from Here…** opens the list described below.

An entry that cannot run is greyed out and its tooltip says why: the commit is on another branch, you are not on a branch, it is a merge commit or a merge comes after it (Quarry does not rewrite across a merge), it is the first commit (which can be reworded but not dropped or squashed), or a merge / rebase is stopped part-way.

Every one of them asks first. The dialog lists each commit that gets a new id (the commit you edit and every commit after it), says where the branch is now so you can put it back with **Reset … to Here**, and has **Cancel** as its default button. No backup branch is made. Tags and other branches that pointed at a rewritten commit keep pointing at the old one, and nothing is pushed or fetched.

Anything that replays commits needs a clean working folder: with uncommitted changes to tracked files you get **Commit or discard your changes first** and nothing runs (untracked files do not count). Undo Last Commit and rewording the newest commit work with uncommitted changes.

No editor ever opens, whatever git's `core.editor` is, and the repository's commit hooks are not run for a reworded message.

### The Edit History list

**Edit History from Here…** replaces the graph's rows with a list of the commits from that one up to the newest, newest at the top, at most 100. **Git › Edit History › Edit History…** (also in the palette) opens it over the commits you have not pushed yet. Nothing happens to the repository until you press **Run**.

Each row has an action:

| Action | Key | What it does |
| --- | --- | --- |
| Pick | P | Keeps the commit |
| Reword | R | Keeps it with a new message, typed in a box under the row (Ctrl+Enter or a click elsewhere closes the box) |
| Squash | S | Folds it into the nearest kept commit below; that row gets a box with the joined messages to edit |
| Fixup | F | Folds it in the same way and throws its message away |
| Drop | D | Removes the commit and its changes |

Drag a row by its handle to move it, or press Alt+Up / Alt+Down. Up and Down move the selection, Ctrl+Enter is Run and Escape is Cancel. These keys only act while the list itself has the keyboard focus: in a message box they are text, and anywhere else in Quarry they mean what they always do.

A row that cannot work as marked says so (a squash with nothing below to fold into, an empty message) and **Run** stays off until it is fixed; it is also off while nothing would change. **Reset List** puts every row back. **Cancel** closes the list, after asking when you had made choices.

**Run** shows the plan first: one line per commit (new id, moved, reworded, folded into, dropped). Commits below the lowest change keep their ids. If the branch changed since the list was opened, nothing is rewritten and the list reloads.

### When a commit conflicts

If a commit no longer applies while it is replayed (for example after dropping a commit that later ones build on), the rewrite stops exactly like a [rebase](#rebase): Source Control opens with the badge **Rebasing 2 of 4**, the file under Merge Changes, and **Continue Rebase**, **Skip** and **Abort**. Messages you typed before the run are still applied to the commits that come after the stop. **Abort** puts the branch back exactly as it was.

### Commits that are already pushed

Quarry marks commits that are on a remote branch (as last fetched) as **pushed**. Editing them is allowed, but the question is a danger dialog, **Rewrite commits that are already pushed?**, which names them and the remote branch, with **Cancel** as the default. Anyone who pulled those commits will have to repair their copy; **Revert This Commit…** is the safe way to undo a pushed commit.

After such an edit the status line offers **Force Push…** instead of Pull, exactly as after [rebasing pushed commits](#rebasing-commits-that-are-already-pushed). The edit itself pushes nothing.

## Claude-assisted git

Three helpers ask Claude through your own [Claude Code](claude-code.md) installation. They exist only while **Settings › Claude Code › Claude Code** is on; with it off there is no trace of them.

| Helper | Where | What you get |
| --- | --- | --- |
| **Draft** a commit message | The **Draft** button beside the Commit button; **Git › Claude › Draft Commit Message with Claude** | A message in the message box, for you to edit. Nothing is committed. |
| **Explain** a conflict | The **Explain** button on a conflict's bar; **Git › Claude › Explain Conflict at Cursor with Claude** | A panel under that conflict with an explanation and, usually, a suggested resolution with **Apply Suggestion** / **Discard**. |
| **Summarise** a branch or a run of commits | **Git › Claude › Summarise Branch with Claude…**; the last entries of a commit's right-click menu in the graph | A new untitled Markdown tab. Nothing is written to disk. |

**What it costs.** Each click is one short request on the Claude Code login and plan you already have, counted against its usage limits like one message in a Claude tab. Quarry stores no API key and adds no charge. Nothing is ever sent without a click. The helpers use their own model, **Settings › Claude Code › Model for git helpers** (Haiku unless you change it), not the Model of the Claude tabs.

**What is sent.** The first time, each helper shows a dialog that says exactly what will leave your computer; **Send and Don't Ask Again** turns the question off (back on with **Settings › Claude Code › Ask before sending git content to Claude**).

| Helper | Sent to Claude |
| --- | --- |
| Draft | The diff of the staged files and the first lines of the last 10 commit messages. With nothing staged: the diff of **all** changed files, which includes the full text of new untracked files (the dialog counts and names them). Ignored files are never sent. With **Amend** ticked: the last commit together with what is staged. |
| Explain | Both sides of that one conflict (and its common-ancestor section, if shown), up to 30 lines above and below it, the file's name and git's labels of the two sides. The tab's text as it is now, not the file on disk. |
| Summarise | The id, author, date and full message of each commit in the range, and the diff of the files they changed. |

Claude Code is started for that one request with every tool switched off, no MCP servers, no project instructions, in an empty scratch folder outside your repository, and nothing is saved to its conversation history. Claude sees only the text above and cannot read or change anything.

**Size limits.** At most 120,000 characters of diff go in one request, 20,000 per file. Files go in smallest first; a longer file is cut after 20,000 characters, and what no longer fits is sent as a name with its added / removed line counts. Binary files are always sent by name only. When anything was cut, the dialog and a line under the commit box (or under the summary's heading) say so: "Large change: Claude saw only the start of 1 file (data\fixtures.json)." A conflict larger than 60,000 characters with its context is not sent, and a summary covers at most 300 commits.

### Drafting a commit message

**Draft** describes what the Commit button would commit: the staged files, or with nothing staged all changes. While Claude is drafting, the box reads "Claude is drafting a message…" and cannot be typed in, and the Commit button is off. The draft then appears in the box with the cursor in it: change it as you like and commit as usual. If the box already had text (including a message git prepared for a merge), Quarry asks before replacing it, and a failed or stopped draft leaves your text as it was. The draft is written from what is on disk, like the commit; unsaved tabs are mentioned in a warning. Draft is off during a rebase (each commit keeps its own message) and while files are in conflict.

### Explaining a conflict

The panel under the conflict is headed with the two sides ("Current (HEAD) · Incoming (feature)") and, during a rebase, patch series or a stash that conflicted, the same note as the conflict bar. Claude is told whose work each side is, so during a rebase it knows that Current is the branch you are rebasing onto and Incoming is your own commit.

**Apply Suggestion** replaces the whole conflict, markers included, with the suggested lines as one edit you can undo with Ctrl+Z. Nothing is saved, staged or marked resolved: after the file's last conflict the usual "Save and Mark Resolved" question follows. **Discard** (or Escape with the cursor in that conflict) closes the panel. The Accept buttons keep working and close it too. If you edit the conflict after the answer, the suggestion can no longer be applied; if you edit it while Claude is still reading, the request is stopped. A proposal that still contains conflict markers is not offered.

### Summarising

**Summarise Branch with Claude…** asks which branch to compare the current one with (the remote's default branch, or main, is listed first) and summarises the commits the branch has that the other does not. In the graph, a commit with a local branch label offers **Summarise <branch> with Claude…** (the branch is not checked out), and a commit below the checked-out one offers **Summarise from Here to <branch> with Claude** for that run of commits. The tab starts with a heading, the number of commits and range, and "Written by Claude from the commit messages and diffs. Check it before relying on it."; it is an ordinary untitled tab.

### While a request runs

One request runs at a time. The status bar shows "Claude: drafting a commit message… 12s" with a stop button; **Git › Claude › Stop Claude Request**, the Draft button itself, Escape in the message box and **Stop** in a conflict's panel stop it too. Stopping ends the Claude Code process at once and changes nothing. A commit message or a conflict gets 2 minutes, a summary 5. Closing the tab a conflict request belongs to, switching the panel to another repository, switching Claude Code off, or quitting Quarry also stops it.

If a request fails, Quarry says why and nothing is changed: Claude Code not found (with **Open Settings**), not signed in (with **Open Claude Code Terminal**, where you run `/login`), Claude Code's own reason such as a reached usage limit, or the exit code and last lines it printed.

## File history

**Git › Show File History** (or **Show File History** on a tab's right-click menu) lists the commits that changed the active file, newest first, following renames. It appears in the Source Control panel, below Commits and above the Repository section. Click a commit to see what it changed in the file; the compare button on its row compares that version with the current file. **Show more** loads older commits.

## Explorer and status bar

Changed files in the Explorer are coloured and carry their letter (M, A, U, …); a folder holding changes gets a dot. The status bar shows the branch of the active file's repository (with `*` when there are changes, and ↓ / ↑ counts); click it to switch branches.
