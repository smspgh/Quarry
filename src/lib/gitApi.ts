// Typed wrappers for the git commands in src-tauri/src/git.rs. Paths are absolute Windows paths
// (the same form as the rest of the app); `rel` values are repo-relative with `/` separators.
// Errors reject with git's stderr (trimmed).
import { invoke } from "@tauri-apps/api/core";

export interface GitFile {
  path: string;
  /** The old path of a rename or copy. */
  origPath: string | null;
  /** Porcelain status letter of the index (X): "M" | "A" | "D" | "R" | "C" | "T" | "U" | "?" | "." (unchanged). */
  index: string;
  /** Porcelain status letter of the work tree (Y). */
  worktree: string;
  conflicted: boolean;
  untracked: boolean;
}

export type GitOperation = "merge" | "rebase" | "am" | "cherry-pick" | "revert";

export interface GitStatus {
  root: string;
  /** null when HEAD is detached. */
  branch: string | null;
  /** Short sha (7 characters) of HEAD; null before the first commit. */
  head: string | null;
  upstream: string | null;
  /** The upstream is set but its remote branch is gone (deleted on the remote, or the remote was
   *  replaced); ahead / behind mean nothing then. */
  upstreamGone: boolean;
  ahead: number;
  behind: number;
  operation: GitOperation | null;
  /** The message git prepared for the commit that finishes the operation (a pick's original message, "Merge branch …"). */
  operationMessage: string | null;
  /** A rebase's progress: [the commit being replayed, how many there are]. */
  operationStep: [number, number] | null;
  files: GitFile[];
  remotes: GitRemote[];
  /** Stash: id of the newest stash (what `refs/stash` points at; null with none) and how many
   *  there are. Together they change whenever a stash is made, popped or dropped. */
  stash?: string | null;
  stashCount?: number;
}

/** A stash: uncommitted work put aside (STASH-004). */
export interface GitStash {
  /** The stash's commit id: every action names the stash by it, never by `stash@{n}`. */
  sha: string;
  short: string;
  /** The commit it was made on. */
  base: string;
  author: string;
  email: string;
  /** When it was made, unix seconds. */
  time: number;
  /** git's subject: "On main: <message>", or "WIP on main: 1a2b3c4 <last commit>" (see `stashTitle`). */
  subject: string;
  /** It holds untracked files. */
  untracked: boolean;
}

export interface GitIdentity {
  name: string | null;
  email: string | null;
  /** Where each value comes from: "local" (this repository), "global", "system"… */
  nameScope: string | null;
  emailScope: string | null;
}

export interface GithubRepo {
  /** `owner/name`. */
  fullName: string;
  cloneUrl: string;
  htmlUrl: string;
  /** The account already had a repository with this name (nothing was created). */
  existed: boolean;
  /** It has no commits yet (always true for a new one). */
  empty: boolean;
  private: boolean;
}

export interface GitRemote {
  name: string;
  /** The fetch URL. */
  url: string;
}

export interface GitBlob {
  text: string;
  binary: boolean;
  encoding: string;
}

export interface GitCommitResult {
  sha: string;
  summary: string;
}

export interface GitBranch {
  /** `main` for a local branch, `origin/main` for a remote one. */
  name: string;
  remote: boolean;
  current: boolean;
  upstream: string | null;
  sha: string;
  /** Tip commit time, unix seconds. */
  time: number;
  summary: string;
}

export interface GitCommitInfo {
  sha: string;
  short: string;
  author: string;
  email: string;
  /** Unix seconds. */
  time: number;
  summary: string;
  /** Not committed yet (all-zero sha). */
  uncommitted: boolean;
}

export interface GitBlame {
  commits: GitCommitInfo[];
  /** One entry per line (line n at index n - 1): an index into `commits`. */
  lines: number[];
}

export interface GitLogEntry {
  sha: string;
  short: string;
  author: string;
  email: string;
  /** Author time, unix seconds. */
  time: number;
  summary: string;
  /** The file's repo-relative path at this commit (follows renames); "" for a repository log. */
  rel: string;
  root: string;
}

/** A file a commit changed (against its first parent). */
export interface GitCommitFile {
  /** Where the file is (or would be) in the work tree. */
  path: string;
  /** Repo-relative path at this commit. */
  rel: string;
  /** git's status letter: A, M, D, R, C, T ("?" for an untracked file held by a stash). */
  status: string;
  /** The path before the commit (rename / copy). */
  origRel: string | null;
}

/** A commit in the graph tab. */
export interface GitGraphCommit {
  sha: string;
  short: string;
  parents: string[];
  author: string;
  email: string;
  /** Author time, unix seconds. */
  time: number;
  /** Full ref names pointing here: "HEAD", "refs/heads/main", "refs/remotes/origin/main", "refs/tags/v1". */
  refs: string[];
  summary: string;
  /** A stash row (All branches): its only parent is the commit it was made on, `summary` is git's
   *  stash subject and `refs` is ["refs/stash"]. */
  stash?: boolean;
}

export interface GitCommitDetail {
  sha: string;
  parents: string[];
  author: string;
  email: string;
  time: number;
  committer: string;
  committerEmail: string;
  commitTime: number;
  /** Subject and body. */
  message: string;
  /** "3 files changed, 10 insertions(+), 2 deletions(-)", or "". */
  stat: string;
  files: GitCommitFile[];
}

/** What the graph can do to a commit ("branch" / "branch-switch" / "tag" take a name). */
export type GitCommitAction = "checkout" | "branch" | "branch-switch" | "tag" | "cherry-pick" | "revert" | "reset-soft" | "reset-mixed" | "reset-hard";

/** "check": the panel's background fetch of the branch's remote (never prompts). "pull-merge" /
 *  "pull-rebase": a pull that says how to join diverged branches. */
export type GitRemoteOp = "fetch" | "check" | "pull" | "pull-merge" | "pull-rebase" | "push" | "push-force";

// ----- Start a merge or rebase, force push (specs/git-merge-rebase.md) -----

/** A commit named in a dialog. */
export interface GitCommitRef {
  sha: string;
  short: string;
  summary: string;
}

/** What a merge of / rebase onto a branch, tag or commit would do (read before asking). */
export interface GitMergePreview {
  /** What git is given: the full ref name (`refs/heads/feature`) or the commit id. */
  target: string;
  kind: "branch" | "remote" | "tag" | "commit";
  /** The commit the target points at. */
  sha: string;
  short: string;
  summary: string;
  /** Commits the current branch has that the target lacks (a rebase replays these). */
  ahead: number;
  /** Commits the target has that the current branch lacks (a merge brings these in). */
  behind: number;
  /** How many of `ahead` are merge commits (a rebase does not keep them). */
  merges: number;
  /** How many of `ahead` are already on a remote branch (any, as last fetched), which branch, and the commits (newest first, at most 50). */
  pushed: number;
  pushedOn: string | null;
  pushedCommits: GitCommitRef[];
}

/** "ff-only": move the branch forward or refuse; "no-ff": always a merge commit; "auto": git's default. */
export type GitMergeMode = "auto" | "ff-only" | "no-ff";

/** What Force Push would replace: the commits only the upstream has (as last fetched; at most 50 listed). */
export interface GitForcePushPreview {
  branch: string;
  upstream: string;
  lost: number;
  commits: GitCommitRef[];
}
// ----- end -----

// ----- Compare commits (specs/git-compare-commits.md) -----
/** What differs between two commits, or between a commit and the working tree (`right` null). */
export interface GitCompare {
  left: GitGraphCommit;
  right: GitGraphCommit | null;
  /** Working tree: short id of the commit the files are on. */
  head: string | null;
  /** Letters read left to right (A = only in the right side); "U" = a conflicted file (working tree). */
  files: GitCommitFile[];
  insertions: number;
  deletions: number;
  /** Commits the right side (the current commit, for the working tree) has that the left lacks, and
   *  the other way round; `behind === 0` means the left commit is an ancestor of the right. */
  ahead: number;
  behind: number;
  /** Working tree: untracked files, which are not compared. */
  untracked: number;
}

// ----- Branch and tag housekeeping (specs/git-branches.md) -----

/** A tag, for the Delete Tag… / Push Tag… lists (newest first). */
export interface GitTag {
  name: string;
  /** Short id of the commit it points at. */
  sha: string;
  time: number;
  summary: string;
}

/** What the ref menus need besides the status. */
export interface GitRefInfo {
  /** Local branch → its upstream as configured (`origin/main`). */
  upstreams: Record<string, string>;
  /** Remote → its default branch (what `origin/HEAD` points to here). */
  defaults: Record<string, string>;
}

/** A ref about to be deleted, read right before the question is asked. */
export interface GitBranchInfo {
  name: string;
  /** Short and full id of the commit it points at. */
  sha: string;
  fullSha: string;
  /** A local branch: it is the one checked out. */
  current: boolean;
  /** A local branch: its upstream, when that remote branch still exists. */
  upstream: string | null;
  /** A local branch: what "merged" is measured against (the upstream, else the current branch;
   *  null on a detached HEAD, then `baseSha` is that commit). */
  base: string | null;
  baseSha: string | null;
  /** A local branch: commits not in `base`. A remote branch: commits in no local branch. */
  unmerged: number;
  /** A remote branch: it is its remote's default branch. */
  defaultBranch: boolean;
}

/** Local ref changes; the deletes resolve with the short id the ref was on, a rename with the
 *  upstream the branch still tracks ("" for none). */
export type GitRefAction = "branch-delete" | "branch-delete-force" | "branch-rename" | "upstream-set" | "upstream-unset" | "tag-delete";

/** What a push of one branch or tag, or the delete of a remote branch, did. */
export interface GitPushRef {
  remote: string;
  /** The branch on the remote (it can differ from the local name), or the tag. */
  branch: string;
  upToDate: boolean;
  /** The branch had no upstream and now tracks this. */
  tracking: string | null;
  /** A deleted remote branch: the short id it was on. */
  was: string | null;
  /** A delete: it was already gone on the remote. */
  gone: boolean;
}
// ----- end -----

export const git = {
  /** `git version ...`, or null when git cannot be run. */
  available: () => invoke<string | null>("git_available"),
  /** Status of the work tree containing `path` (any file or folder); null when it is not in one. */
  status: (path: string) => invoke<GitStatus | null>("git_status", { path }),
  /** `path`'s contents at `rev` ("HEAD", a sha, or "" for the index), decoded like opening the file;
   *  `rel` overrides the repo-relative path (a history entry from before a rename). null when the file
   *  is not there at that revision. */
  show: (path: string, rev: string, rel?: string) => invoke<GitBlob | null>("git_show", { path, rev, rel: rel ?? null }),
  stage: (root: string, paths: string[]) => invoke<void>("git_stage", { root, paths }),
  unstage: (root: string, paths: string[]) => invoke<void>("git_unstage", { root, paths }),
  /** Tracked files go back to their staged version; untracked files go to the Recycle Bin. */
  discard: (root: string, paths: string[]) => invoke<void>("git_discard", { root, paths }),
  /** Partial staging (specs/git-staging.md): stage / unstage / discard line ranges of one file.
   *  `expect` = hashes (`textHash`) of the two texts the comparison shows and the encoding its
   *  right side was read with; when git or the disk no longer match, nothing is changed and the
   *  error starts with `STALE`. `orig`: the path in HEAD of a staged rename. */
  applyLines: (root: string, path: string, mode: "stage" | "unstage" | "discard", picks: { oldStart: number; oldCount: number; newStart: number; newCount: number }[], expect: { left: string; right: string; encoding: string | null }, orig?: string) =>
    invoke<void>("git_apply_lines", { root, path, mode, picks, expect, orig: orig ?? null }),
  commit: (root: string, message: string, amend = false) => invoke<GitCommitResult>("git_commit", { root, message, amend }),
  /** Local branches first, then remote ones; each newest first. */
  branches: (root: string) => invoke<GitBranch[]>("git_branches", { root }),
  /** Switch branch; `create` makes a new one. A remote name (`origin/foo`) switches to local `foo`,
   *  creating it as a tracking branch if needed. */
  checkout: (root: string, name: string, create = false) => invoke<void>("git_checkout", { root, name, create }),
  /** Returns git's output. Push sets an upstream (origin, else the first remote) when there is none. */
  remote: (root: string, op: GitRemoteOp) => invoke<string>("git_remote", { root, op }),
  addRemote: (root: string, name: string, url: string) => invoke<void>("git_add_remote", { root, name, url }),
  /** Point a remote at another URL; its old remote-tracking branches are dropped (the next push publishes there). */
  setRemoteUrl: (root: string, name: string, url: string) => invoke<void>("git_set_remote_url", { root, name, url }),
  identity: (root: string) => invoke<GitIdentity>("git_identity", { root }),
  /** `global` sets it for every repository (and drops this one's own values). */
  setIdentity: (root: string, name: string, email: string, global: boolean) => invoke<void>("git_set_identity", { root, name, email, global }),
  /** Create a repository on a GitHub account Git is signed in to (Git Credential Manager's sign-in);
   *  `account` picks one when there are several. A taken name returns that repository (`existed`). */
  githubCreate: (root: string, name: string, isPrivate: boolean, account: string | null) => invoke<GithubRepo>("github_create_repo", { root, name, private: isPrivate, account }),
  /** A github.com remote's repository (visibility), read with `account`'s stored sign-in or none;
   *  never opens a sign-in window. null for other hosts or one that can't be seen. */
  githubRepo: (root: string, url: string, account: string | null) => invoke<GithubRepo | null>("github_repo", { root, url, account }),
  /** GitHub accounts Git Credential Manager is signed in to (no window); fails without GCM. */
  githubAccounts: (root: string) => invoke<string[]>("github_accounts_list", { root }),
  /** Sign in to (another) GitHub account in GCM's window; the accounts after. */
  githubSignIn: (root: string) => invoke<string[]>("github_sign_in", { root }),
  /** Blame of `path`; with `contents` (the unsaved buffer) it matches what is on screen. `encoding` is
   *  the document's (default UTF-8); `eol` ("CRLF" | "LF" | "CR") the line ending to save with, else
   *  that of the file on disk. null for untracked files or outside a repository. */
  blame: (path: string, contents?: string, encoding?: string, eol?: string) =>
    invoke<GitBlame | null>("git_blame", { path, contents: contents ?? null, encoding: encoding ?? null, eol: eol ?? null }),
  /** History of a file (following renames) or of a folder (the repository root: every commit). */
  log: (path: string, skip = 0, limit = 100) => invoke<GitLogEntry[]>("git_log", { path, skip, limit }),
  /** The files a commit changed. */
  commitFiles: (root: string, sha: string) => invoke<GitCommitFile[]>("git_commit_files", { root, sha }),
  /** One page of the commit graph (children before parents). `all`: every branch and tag, else the
   *  current branch and its upstream. */
  graph: (root: string, all: boolean, skip: number, limit: number) => invoke<GitGraphCommit[]>("git_graph", { root, all, skip, limit }),
  /** Search the whole history (message, author, or an id), newest first. */
  graphSearch: (root: string, all: boolean, query: string, limit = 200) => invoke<GitGraphCommit[]>("git_graph_search", { root, all, query, limit }),
  /** Has git's commit-graph file been written (pages of a large history are then fast)? */
  graphIndexed: (root: string) => invoke<boolean>("git_graph_indexed", { root }),
  /** Write git's commit-graph file (`git commit-graph write --reachable`). */
  graphIndex: (root: string) => invoke<void>("git_graph_index", { root }),
  commitDetail: (root: string, sha: string) => invoke<GitCommitDetail>("git_commit_detail", { root, sha }),
  commitAction: (root: string, action: GitCommitAction, sha: string, name?: string) => invoke<string>("git_commit_action", { root, action, sha, name: name ?? null }),
  /** Resolve a conflicted file by taking one whole side ("ours": your branch; "theirs": what comes in).
   *  Resolves with "kept", or "deleted" when that side had deleted the file. */
  resolveSide: (root: string, path: string, side: "ours" | "theirs") => invoke<"kept" | "deleted">("git_resolve_side", { root, path, side }),
  /** Carry on with the operation in progress ("continue"), or leave out the commit it stopped on ("skip"). */
  continueOp: (root: string, how: "continue" | "skip") => invoke<string>("git_continue", { root, how }),
  /** Abandon the merge / rebase / cherry-pick / revert in progress; resolves with its name. */
  abort: (root: string) => invoke<string>("git_abort", { root }),
  /** Ids of the current branch's commits its upstream does not have yet (none without an upstream). */
  unpushed: (root: string) => invoke<string[]>("git_unpushed", { root }),
  // Start a merge or rebase, force push (specs/git-merge-rebase.md). `target`: a branch, remote branch or tag name, or a commit id.
  mergePreview: (root: string, target: string) => invoke<GitMergePreview>("git_merge_preview", { root, target }),
  /** `merge --no-edit`; rejects with git's output when it stops on a conflict (the merge is then in progress). */
  merge: (root: string, target: string, mode: GitMergeMode) => invoke<string>("git_merge", { root, target, mode }),
  /** Plain `rebase <target>` of the current branch; rejects with git's output when it stops on a conflict. */
  rebase: (root: string, target: string) => invoke<string>("git_rebase", { root, target }),
  forcePushPreview: (root: string) => invoke<GitForcePushPreview>("git_force_push_preview", { root }),
  // ---- stash ----
  /** Every stash, newest first. */
  stashList: (root: string) => invoke<GitStash[]>("git_stash_list", { root }),
  /** Put the uncommitted changes aside (`untracked`: the untracked files too; never ignored ones).
   *  Resolves with the new stash's id; rejects when there was nothing to stash. */
  stashPush: (root: string, message: string, untracked: boolean) => invoke<string>("git_stash_push", { root, message, untracked }),
  /** The files a stash holds, against the commit it was made on; untracked ones have status "?". */
  stashFiles: (root: string, sha: string) => invoke<GitCommitFile[]>("git_stash_files", { root, sha }),
  /** Apply, pop or drop the stash with this commit id. "conflicts": an apply / pop left conflicted
   *  files (the stash is kept, also for a pop). Rejects when the id is no longer a stash. */
  stashOp: (root: string, sha: string, op: "apply" | "pop" | "drop") => invoke<"ok" | "conflicts">("git_stash_op", { root, sha, op }),
  // ---- compare commits ----
  /** The files that differ between two commits (`git diff A B`, renames detected), or between `left`
   *  and the working tree when `right` is left out. A side is a commit id, "HEAD" or a branch name.
   *  Read-only: nothing is checked out, staged or written inside `.git`. */
  diffFiles: (root: string, left: string, right?: string) => invoke<GitCompare>("git_diff_files", { root, left, right: right ?? null }),
  // ---- branch and tag housekeeping (specs/git-branches.md) ----
  /** Tags, newest first. */
  tags: (root: string) => invoke<GitTag[]>("git_tags", { root }),
  refInfo: (root: string) => invoke<GitRefInfo>("git_ref_info", { root }),
  /** `kind`: "branch" (local), "remote" (`origin/topic`) or "tag". Rejects when the ref is not there. */
  branchInfo: (root: string, kind: "branch" | "remote" | "tag", name: string) => invoke<GitBranchInfo>("git_branch_info", { root, kind, name }),
  /** "branch-delete" rejects with `NOT_MERGED` (gitBranches.ts) when git's safe delete refuses;
   *  "branch-delete-force" takes the full commit id the question was about as `arg`. */
  refAction: (root: string, action: GitRefAction, name: string, arg: string | null = null) => invoke<string>("git_ref_action", { root, action, name, arg }),
  /** Push one branch ("branch") or one tag ("tag"), or delete a remote branch ("delete", `name` =
   *  `origin/topic`). Never forces. */
  pushRef: (root: string, kind: "branch" | "tag" | "delete", name: string) => invoke<GitPushRef>("git_push_ref", { root, kind, name }),
  // ---- Claude git helpers (specs/git-claude.md): what a request is built from; nothing is changed ----
  /** What a commit made now would hold, per file, with the first lines of the last 10 commit
   *  messages. "staged": the index; "all": every change plus untracked files that are not ignored
   *  (nothing staged); "amend": the last commit together with the index. */
  commitDiff: (root: string, scope: "staged" | "all" | "amend") => invoke<{ files: import("./gitAi").DiffFile[]; subjects: string[] }>("git_commit_diff", { root, scope }),
  /** The commits `to` has that `from` does not, oldest first, with the true count (the list is
   *  empty when that is over `limit`). `from` "" = everything up to `to`. */
  rangeLog: (root: string, from: string, to: string, limit: number) => invoke<{ count: number; commits: import("./gitAi").RangeCommit[] }>("git_range_log", { root, from, to, limit }),
  /** What that range changed, per file (`git diff from...to`). */
  rangeDiff: (root: string, from: string, to: string) => invoke<import("./gitAi").DiffFile[]>("git_range_diff", { root, from, to }),
  /** The remote's default branch as last fetched (`origin/main`), or null. */
  defaultBranch: (root: string) => invoke<string | null>("git_default_branch", { root }),
};

/** One-off Claude Code requests of the git helpers (src-tauri/src/claude.rs `claude_oneshot`). */
export const claude = {
  /** One prompt (on stdin), one answer: no tools, no conversation, outside the repository. `id` names the request for `cancel`. */
  oneshot: (args: { id: number; exe: string; model: string; prompt: string; timeoutSecs: number }) => invoke<import("./gitAi").OneshotResult>("claude_oneshot", { args }),
  cancel: (id: number) => invoke<void>("claude_oneshot_cancel", { id }),
};
