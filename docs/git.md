# Git

Quarry works with git repositories through the `git` command line (Git for Windows), so it uses your own git configuration, hooks and credentials. If git isn't on PATH, the Source Control panel says so.

A repository is picked up when the open folder, or any open file, is inside one. Status refreshes by itself after saves, file changes in the open folder, git actions, and when the Quarry window gets focus. **Git › Refresh Git Status** forces it (for example after `git init` in a terminal).

## In the editor

- **Change markers.** A thin bar in the gutter, next to the line numbers, marks lines that differ from the last commit (HEAD): green for added lines, blue for changed lines, and a red wedge where lines were deleted. The markers follow your typing; they compare the text on screen, saved or not.
- **Peek and revert.** Click a marker to see the committed text of that change. The peek has **↑ / ↓** to move between changes, **Revert** to put the committed lines back (one undo step), and **✕** or **Escape** to close it.
- **Keyboard.** **Alt+F5** / **Shift+Alt+F5** go to the next / previous change and open its peek. **Git › Show Change at Cursor** and **Git › Revert Change at Cursor** act on the change under the cursor.
- **Line blame.** **Git › Show Line Blame** shows who last changed the cursor line, when, and the commit summary, at the end of the line; hover it for the commit id, e-mail and date. Lines you have changed show *not committed yet*. Blame follows unsaved edits (it is asked again a moment after you stop typing). The same command hides it.
- **Compare with Last Commit** (Git menu, tab right-click menu) opens a [Compare](compare.md) tab with the HEAD version on the left and your tab, editable, on the right.

## Source Control panel

Open it from the rail (branch icon), **Git › Show Source Control** or **Ctrl+Shift+G**.

- **Branch.** The button at the top shows the current branch (or the commit, when HEAD is detached). Click it to switch branches; see below. A badge shows a merge, rebase, cherry-pick or revert in progress.
- **Commit.** Type the message and click **Commit** or press **Ctrl+Enter**. The button says what it takes: **Commit 3 Staged**, or with nothing staged **Commit All (14 files)**, which asks before staging every change. The changed files are listed right under it, and a small line below the button shows who the commit is made as. **Amend** replaces the last commit; with the message box empty it keeps the old message. Unsaved changes in open tabs are not part of a commit; Quarry warns when there are some.
- **Merge Changes / Staged Changes / Changes.** Files with conflicts, files staged for the next commit, and files changed but not staged (including new, untracked files). A file staged and then changed again is in both lists. The letter on the right is the change: **M** modified, **A** added, **D** deleted, **R** renamed, **U** untracked, **!** conflict.
  - Click a file to see its change in a Compare tab: in Staged Changes HEAD against what is staged, in Changes what is staged (or HEAD) against the working copy. New files just open. Double-click to open the file itself.
  - Hover a row (or a section heading, for all its files) for **Stage (+)**, **Unstage (−)**, **Discard** and **Open file**. Discard asks first; it restores the staged / committed version, and an untracked file goes to the Recycle Bin. Staging a conflicted file marks it resolved.
- **Sync with the remote.** Beside the branch (below it in a narrow panel), a status line says where you stand. It keeps uncommitted work and commits apart: **14 uncommitted changes. Your commits match origin/main.** means nothing is waiting to be pushed, but those changes exist only on this computer until you commit and push them. The green tick, **Everything is committed and matches origin/main**, appears only when there is nothing left to commit, push or pull. Otherwise: **N commits to pull** (Pull), **N commits to push** (Push), **Diverged** (both: **Pull (Merge)** joins the histories with a merge commit, **Pull (Rebase)** replays your commits on top of the remote's; push after either), **not on the remote yet** (Publish Branch), **no longer exists on the remote** (Push to Recreate It), or, when the remote repository itself is gone (deleted, renamed, or not visible to your account), **Create It on GitHub** / **Change URL**. To keep this true, the panel fetches the branch's remote by itself when it opens and when Quarry gets focus, at most once a minute (the ↻ button checks now). That fetch only updates git's copy of the remote's branches, never your files or branches, and it never asks you to sign in: if it can't reach the remote or needs a sign-in, the line says so and **Fetch** tries in the open.
- **Fetch, Pull, Push** are the cloud, ↓ and ↑ buttons in the panel header (also in the Git menu). Push publishes a branch that has no upstream yet to `origin` (or the only remote). Sign-in prompts come from Git Credential Manager in their own window; SSH keys that need a passphrase must be loaded in an agent (Quarry can't show an SSH prompt).
- **Repository: your identity and remotes.** At the bottom of the panel, the **Repository** section is closed by default and shows a one-line summary (who you commit as, the remote and whether it is private). Click it to open; it opens by itself when something is missing (no name / email, no remote) or being changed. *Your identity* shows **Commits as** (git's `user.name` / `user.email`, saved in every commit) and, when GitHub is involved, **GitHub**: the account Git Credential Manager is signed in to, which new repositories are created under. GitHub links your commits to that account when the *Commits as* email is one of its emails. With several accounts signed in, pick one there (Quarry remembers it); the person icon signs in to another account in GCM's window, and **Sign in** appears when there is none. *Remote* lists each remote with its URL; a GitHub remote also shows **Private** or **Public** (read from GitHub with your stored sign-in, never asking you to sign in; without a sign-in only public repositories can be seen, and an unknown one shows no badge). The "already exists" offer and the message after creating a repository say which it is too. The pencil changes them; the arrow opens the remote's page on GitHub (or GitLab, Bitbucket…).
  - When git has no name or email yet, a form asks for them first. They are saved for all your repositories, or with **Only this repository** for this one alone (a save for all repositories also drops this repository's own values).
  - When the repository has no remote, a form offers a choice, **Create a new repository on GitHub**: a repository name (the folder's name to start with) and **Private**, then **Create and Push** makes the repository on your GitHub account, adds it as `origin` and publishes the current branch there. It uses the GitHub sign-in Git already keeps for pushing (Git Credential Manager opens its sign-in window if there is none); the sign-in never leaves Quarry's Rust side except to GitHub. If your account already has a repository with that name, Quarry says whether it is empty and offers to use it (**Use It and Push**) instead; one that already has commits only takes the push when they are part of this repository's history, and nothing on GitHub is overwritten. **Use an existing repository's URL** adds a repository you already have instead. Push, Pull and Fetch point you to this form instead of failing; **Git › Add Remote…** adds another remote later.
  - **Changing a remote** points it at another URL, or at a new repository created on GitHub (for example to carry the project on in a new repository). The old repository is left as it is; **Save and Push** (or **Create and Push**) publishes your branch to the new one and tracks it.
- **More than one repository** (the folder and a file from elsewhere): a picker at the top chooses which one the panel shows. It follows the open folder by default.

## Branches

**Git › Switch Branch…**, the panel's branch button or the branch in the status bar open a list of branches: local ones first, then remote ones (marked *remote*), the current one marked *current*. Pick one to switch to it; a remote branch is checked out as a new local branch tracking it. Type a name that doesn't exist and pick **Create branch "…" from here** to create it from the current commit and switch to it. Git refuses a switch that would overwrite uncommitted changes; the message says which files.

## Commits

Under the changes, **Commits** lists the branch's commits, newest first (30 at a time; **Show more** loads older ones). It is how you see what a commit you just made contains.

- A commit your remote doesn't have yet is shown in bold with an up arrow and **not pushed**; the section header counts them (**2 to push**). Commits already on the remote have a tick. A branch with no remote branch shows neither.
- Click a commit to list the files it changed, with the same letters as the changes list (**A** added, **M** modified, **D** deleted, **R** renamed). Click it again to close it.
- Click a file there to open a [Compare tab](compare.md) of what that commit changed in it; double-click opens the file as it is now.
- Hover a commit for its full id, author and date.

The header also counts commits **to pull**, and its graph button opens the commit graph (below). This list stays a quick checklist of the current branch; a merge commit shows what it changed against its first parent.

## Commit graph

**Git › Show Commit Graph** (or the graph button on the Commits section) opens the repository's history in a full-width tab, so nothing is squeezed into the side panel.

- **The graph.** Each commit is a dot on its branch's line; lines fork where a branch starts and join where it is merged. Commits are listed branch by branch (a merged branch's commits sit together under the merge), not strictly by date. A branch's own line stays in its lane, and a lane is reused as soon as its branch ends. Columns show the message, author, date and short id.
- **Long lines are cut short.** A line that would run more than 40 rows to reach its commit (a branch that forked from something old) ends in a small down arrow, and the commit it leads to shows an up arrow where it comes back in. This is what keeps a busy history readable: on the Git project's own repository it takes the graph from about 130 lanes to about 10. Select the commit at either end to follow the line: its **Parent** link jumps down to the other end, and **Continues** in the details lists the commits whose cut lines lead to it.
- **Labels.** The branch you are on is a filled label; other local branches are outlined, remote branches (`origin/main`) dashed, tags tinted. Where `main` and `origin/main` sit on different commits, the ones between them are what you have to push or pull.
- **Current branch / All branches.** *Current branch* shows your branch and the remote branch it tracks (so incoming commits appear too). *All branches* shows every branch and tag.
- **Find** (Ctrl+F) searches the commits loaded so far by message, author, email, id or branch name, and says how many that is (**6 in 1200 loaded**): matches stay bright, **Enter** / **Shift+Enter** step through them. **Search All History** (also **Ctrl+Enter**, or **Enter** when nothing loaded matches) asks git to search every commit by message, author or id and lists up to 200 results, newest first. Click a result for its details; double-click it, or use **Show in Graph**, to load the graph back to that commit and jump there.
- **Details.** Click a commit (or move with the arrow keys) to see it in the pane below: the full id (with a copy button), the whole message, author and date, its parents (click one to jump to it), and the files it changed with a summary of lines added and removed. Click a file to open a [Compare tab](compare.md) of what the commit changed in it; clicking the next file reuses that tab (double-click its tab to keep it). Drag the pane's top edge to resize it.
- **Loading.** Commits load 300 at a time as you scroll, in the background; the rest of Quarry, including the Source Control panel, never waits for the graph. Only the rows on screen are drawn.
- **Very large histories.** Without git's *commit-graph* file (an index of the history that `git gc` writes), git has to walk the whole history for every page: about 0.5 s a page on an 86,000-commit repository and 1.8 s on a 350,000-commit one. Quarry then loads bigger pages, and offers **Speed Up**, which has git write that file once (about 2 s on the larger one; it lives inside `.git` and changes nothing else). Pages then take about 0.1 s and 0.3 s. Quarry never writes it without you pressing the button.
- **What's in progress.** A strip under the toolbar says when you have uncommitted changes (they are not in the graph), and when a cherry-pick, revert, merge or rebase has stopped part-way, with **Abort** right there.

Right-click a commit for the actions:

| Action | What it does |
| --- | --- |
| Copy Commit Id / Copy Message | To the clipboard. |
| Switch to *branch* | For each branch label on that commit. A remote branch gets a local branch that tracks it. |
| Create Branch Here… | A new branch starting at that commit, and switches to it. |
| Create Tag Here… | A tag on that commit. |
| Check Out This Commit… | Your files become that commit, on no branch ("detached"). Switch back with the branch button. |
| Cherry-pick onto *branch*… | Copies that commit's changes onto your branch as a new commit. |
| Revert This Commit… | Adds a commit that undoes it; history is kept. |
| Reset *branch* to Here (Soft / Mixed / Hard)… | Moves your branch back to that commit. **Soft** keeps the later changes staged, **Mixed** keeps them in your files unstaged, **Hard** discards them along with uncommitted changes to tracked files. |

Everything that moves your branch or files asks first and says what will happen. A cherry-pick or revert that hits a conflict stops part-way: Source Control shows the operation (**Cherry-picking**) with the conflicted files under **Merge Changes**. The graph tab shows the same thing in a strip at its top. Resolve and commit them, or press **Abort** (in the strip, or beside the branch in Source Control) to go back to how things were. Abort also works for a merge or rebase that stopped. 

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

While any file is still in conflict, the Commit button is disabled and reads **Resolve 1 Conflict First**. The message box is filled in with the message git prepared (the picked commit's own message, or "Merge branch …"), unless you had already typed one. Marking a file resolved (**+** under Merge Changes) checks it first: if it still contains git's `<<<<<<<` / `>>>>>>>` conflict lines, Quarry asks before staging it.

Not in the graph: dropping a commit from the middle of a branch and interactive rebase.

## File history

**Git › Show File History** (or **Show File History** on a tab's right-click menu) lists the commits that changed the active file, newest first, following renames. It appears at the bottom of the Source Control panel. Click a commit to see what it changed in the file; the compare button on its row compares that version with the current file. **Show more** loads older commits.

## Explorer and status bar

Changed files in the Explorer are coloured and carry their letter (M, A, U, …); a folder holding changes gets a dot. The status bar shows the branch of the active file's repository (with `*` when there are changes, and ↓ / ↑ counts); click it to switch branches.
