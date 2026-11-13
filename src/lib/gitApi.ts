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
  files: GitFile[];
  remotes: GitRemote[];
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
  /** git's status letter: A, M, D, R, C, T. */
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
export type GitRemoteOp = "fetch" | "check" | "pull" | "pull-merge" | "pull-rebase" | "push";

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
  /** Abandon the merge / rebase / cherry-pick / revert in progress; resolves with its name. */
  abort: (root: string) => invoke<string>("git_abort", { root }),
  /** Ids of the current branch's commits its upstream does not have yet (none without an upstream). */
  unpushed: (root: string) => invoke<string[]>("git_unpushed", { root }),
};
