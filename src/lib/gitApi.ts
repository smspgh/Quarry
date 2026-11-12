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
};
