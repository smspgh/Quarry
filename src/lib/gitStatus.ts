/** Pure helpers over `git status` entries (gitApi.ts): what a file's change is, and how the Source Control panel groups them. */
import type { GitFile, GitStatus } from "./gitApi";

export type GitKind = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflict";

export const KIND_LETTER: Record<GitKind, string> = { modified: "M", added: "A", deleted: "D", renamed: "R", untracked: "U", conflict: "!" };
export const KIND_LABEL: Record<GitKind, string> = { modified: "Modified", added: "Added", deleted: "Deleted", renamed: "Renamed", untracked: "Untracked", conflict: "Conflict" };
/** Which change a folder shows when it holds several kinds. */
export const KIND_RANK: Record<GitKind, number> = { conflict: 5, modified: 3, renamed: 2, added: 2, deleted: 1, untracked: 1 };

/** The change of a file as a whole (staged and not). */
export function kindOf(f: GitFile): GitKind {
  if (f.conflicted) return "conflict";
  if (f.untracked) return "untracked";
  if (f.index === "D" || f.worktree === "D") return "deleted";
  if (f.index === "R" || f.index === "C") return "renamed";
  if (f.index === "A" && (f.worktree === "." || f.worktree === "M")) return "added";
  return "modified";
}

export type Group = "conflict" | "staged" | "changes";

const nameOf = (p: string) => p.slice(p.lastIndexOf("\\") + 1);

/** Split a repository's files into Merge Changes / Staged Changes / Changes (a file can be in both of the last two). */
export function groupFiles(files: GitFile[]): Record<Group, GitFile[]> {
  const out: Record<Group, GitFile[]> = { conflict: [], staged: [], changes: [] };
  for (const f of files) {
    if (f.conflicted) out.conflict.push(f);
    else {
      if (!f.untracked && f.index !== ".") out.staged.push(f);
      if (f.untracked || f.worktree !== ".") out.changes.push(f);
    }
  }
  const byName = (a: GitFile, b: GitFile) => nameOf(a.path).localeCompare(nameOf(b.path)) || a.path.localeCompare(b.path);
  for (const g of Object.values(out)) g.sort(byName);
  return out;
}

/** What a row shows: the staged side's change in Staged Changes, the work tree's in Changes. */
export function rowKind(f: GitFile, group: Group): GitKind {
  if (group === "conflict") return "conflict";
  if (group === "staged") return f.index === "A" ? "added" : f.index === "D" ? "deleted" : f.index === "R" || f.index === "C" ? "renamed" : "modified";
  if (f.untracked) return "untracked";
  return f.worktree === "D" ? "deleted" : "modified";
}

/** The web page of a GitHub / GitLab / Bitbucket style remote URL (https or scp-like ssh), or null. */
export function remoteWebUrl(url: string): string | null {
  const u = url.trim();
  let m = /^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?\/?$/i.exec(u);
  if (!m) m = /^(?:ssh:\/\/)?[^@/]+@([^:/]+)[:/](.+?)(?:\.git)?\/?$/i.exec(u);
  return m ? `https://${m[1]}/${m[2]}` : null;
}

/** A remote URL with any password or token taken out, for showing. */
export function displayUrl(url: string): string {
  return url.replace(/^(https?:\/\/)[^@/]+@/i, "$1");
}

/** A GitHub repository name from a folder name (GitHub allows letters, digits, '-', '_' and '.'). */
export function repoNameFor(folder: string): string {
  const base = folder.replace(/[\\/]+$/, "");
  const name = base.slice(Math.max(base.lastIndexOf("\\"), base.lastIndexOf("/")) + 1);
  return name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "repository";
}

/** git's answer when the remote repository isn't there (deleted, renamed, or not visible to this account). */
export function isMissingRepo(error: string | null | undefined): boolean {
  return !!error && /repository .*not found|not found.*repository|does not appear to be a git repository|does not exist/i.test(error);
}

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "ok": nothing to do anywhere; "local": only uncommitted work; "todo": push or pull; "warn": diverged. */
export type SyncKind = "ok" | "local" | "todo" | "warn";

/**
 * The Source Control status line for a branch that has an upstream: uncommitted work and the
 * commits to push / pull are told apart, so "matches the remote" is never read as "all saved".
 */
export function syncLine(changes: number, ahead: number, behind: number, upstream: string, rewritten: string | null = null): { kind: SyncKind; text: string } {
  const local = changes ? count(changes, "uncommitted change") : "";
  // `rewritten` (the branch's name): Quarry rewrote commits that were already pushed (MERGE-009).
  // The upstream's commits are the old ones: a pull would bring them back, so Force Push is advised.
  if (rewritten && behind) {
    return { kind: "warn", text: `${local ? local + ". " : ""}${rewritten} was rewritten: ${upstream} still has the ${behind === 1 ? "old commit" : `${behind} old commits`}. Force Push replaces ${behind === 1 ? "it" : "them"} with yours.` };
  }
  if (ahead && behind) {
    return { kind: "warn", text: `${local ? local + ". " : ""}Diverged from ${upstream}: ${count(ahead, "commit")} to push, ${behind} to pull. Pull first, then push.` };
  }
  if (behind) return { kind: "todo", text: `${local ? local + ", " : ""}${count(behind, "commit")} to pull from ${upstream}.` };
  if (ahead) return { kind: "todo", text: `${local ? local + ", " : ""}${count(ahead, "commit")} to push to ${upstream}.` };
  if (changes) return { kind: "local", text: `${local}. Your commits match ${upstream}.` };
  return { kind: "ok", text: `Everything is committed and matches ${upstream}.` };
}

/**
 * Does the text still hold one of git's conflict marker lines? Either end counts, so a block that
 * was only half cleaned up (the `>>>>>>>` line left behind) is caught too. A lone `=======` is not
 * taken as one: it is also how a heading is underlined.
 */
export function hasConflictMarkers(text: string): boolean {
  return /^<{7}( |\r?$)/m.test(text) || /^>{7}( |\r?$)/m.test(text);
}

/** The Commit button: what it will take (or what is in the way). */
export function commitLabel(staged: number, total: number, amend: boolean, conflicts = 0, operation: string | null = null): string {
  if (conflicts) return `Resolve ${conflicts} Conflict${conflicts === 1 ? "" : "s"} First`;
  // A rebase or `git am` is not finished by committing: each commit / patch keeps its own message.
  const cont = operation ? operationWords(operation).continueLabel : null;
  if (cont) return cont;
  if (amend) return "Amend Last Commit";
  // A merge whose resolution left every file as it was still has to be committed to end it.
  if (operation === "merge" && !total) return "Commit Merge";
  if (staged) return `Commit ${staged} Staged`;
  return total ? `Commit All (${count(total, "file")})` : "Commit All";
}

/** How a stopped operation (`GitStatus.operation`) is named on buttons, in dialogs and notifications. */
export interface OperationWords {
  /** Badge beside the branch: "Rebasing", "Applying patches". */
  badge: string;
  /** In a sentence: "the rebase", "the patch series". */
  noun: string;
  /** What each step is: "commit", or "patch" for `git am`. */
  item: string;
  /** The main button when the operation is continued instead of committed (rebase, am); null otherwise. */
  continueLabel: string | null;
  /** Abort's confirm button. */
  abortLabel: string;
  /** Message box placeholder while the main button continues (rebase, am). */
  placeholder: string | null;
  /** Note on each conflict bar saying which side is which, or "". */
  sidesNote: string;
}

const OPERATIONS: Record<string, OperationWords> = {
  merge: { badge: "Merging", noun: "the merge", item: "commit", continueLabel: null, abortLabel: "Abort Merge", placeholder: null, sidesNote: "" },
  rebase: {
    badge: "Rebasing",
    noun: "the rebase",
    item: "commit",
    continueLabel: "Continue Rebase",
    abortLabel: "Abort Rebase",
    placeholder: "A rebase keeps each commit's own message: resolve the conflicts, then Continue Rebase",
    sidesNote: "Rebasing: Current is the branch you are rebasing onto, Incoming is your own commit.",
  },
  am: {
    badge: "Applying patches",
    noun: "the patch series",
    item: "patch",
    continueLabel: "Continue Applying Patches",
    abortLabel: "Abort Applying Patches",
    placeholder: "Each patch keeps its own message: resolve the conflicts, then Continue Applying Patches",
    sidesNote: "Applying patches: Current is your branch, Incoming is the patch.",
  },
  "cherry-pick": { badge: "Cherry-picking", noun: "the cherry-pick", item: "commit", continueLabel: null, abortLabel: "Abort Cherry-pick", placeholder: null, sidesNote: "" },
  revert: { badge: "Reverting", noun: "the revert", item: "commit", continueLabel: null, abortLabel: "Abort Revert", placeholder: null, sidesNote: "" },
};

/** Wording for a stopped operation; an unknown one is named by git's word for it. */
export function operationWords(operation: string): OperationWords {
  return OPERATIONS[operation] ?? { badge: operation, noun: `the ${operation}`, item: "commit", continueLabel: null, abortLabel: `Abort ${(operation[0] ?? "").toUpperCase()}${operation.slice(1)}`, placeholder: null, sidesNote: "" };
}

/**
 * "Finish or abort the rebase first": why something cannot start while an operation is stopped
 * (merge / rebase entries, Stash, Edit History). No full stop: add one for a notification.
 */
export function finishFirst(operation: string): string {
  return `Finish or abort ${operationWords(operation).noun} first`;
}

/** The notification after Continue / Skip (`still` = the operation stopped again) or Abort. */
export function operationDone(operation: string, how: "continue" | "skip" | "abort", still = false): string {
  const w = operationWords(operation);
  if (how === "abort") return `Aborted ${w.noun}.`;
  if (!still) return `${w.noun[0].toUpperCase()}${w.noun.slice(1)} is finished.`;
  return `${how === "skip" ? `Skipped that ${w.item}` : "Continued"}: ${w.noun} is on its next ${w.item}.`;
}

/** Kind (colour / letter) of a file in a commit, from git's status letter there. */
export function commitFileKind(status: string): GitKind {
  if (status === "?") return "untracked"; // an untracked file held by a stash
  return status === "A" ? "added" : status === "D" ? "deleted" : status === "R" || status === "C" ? "renamed" : "modified";
}

/**
 * What to show when git fails: its message without the `hint:` lines (they name command-line
 * steps Quarry has buttons for). An operation that stopped on a conflict gets a plain sentence
 * saying where to go, with git's CONFLICT lines kept.
 */
export function gitErrorText(raw: string): string {
  const lines = raw.replace(/^Error: /, "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^hint:/i.test(l));
  const conflicts = lines.filter((l) => /^CONFLICT /.test(l));
  if (conflicts.length) {
    const shown = conflicts.slice(0, 3).join("\n") + (conflicts.length > 3 ? `\n… and ${conflicts.length - 3} more` : "");
    return `Stopped on a conflict. Resolve the files under Merge Changes in Source Control and commit, or press Abort to go back.\n\n${shown}`;
  }
  return lines.join("\n");
}

/** Next / Previous Change: the index in `starts` (first line of each change, ascending) to go to
 *  from the cursor's `line`, wrapping around at either end; -1 when there are no changes. */
export function nextChangeIndex(starts: number[], line: number, dir: 1 | -1): number {
  if (!starts.length) return -1;
  let i = -1;
  if (dir === 1) i = starts.findIndex((n) => n > line);
  else for (let k = starts.length - 1; k >= 0 && i === -1; k--) if (starts[k] < line) i = k;
  return i === -1 ? (dir === 1 ? 0 : starts.length - 1) : i;
}

/** The status bar's branch item: its text and tooltip. */
export function statusBarBranch(repo: Pick<GitStatus, "root" | "branch" | "head" | "upstream" | "ahead" | "behind" | "files">, busy: string | null): { text: string; title: string } {
  const branch = repo.branch ?? (repo.head ? `${repo.head} (detached)` : "no commits");
  const sync = `${repo.behind ? ` ↓${repo.behind}` : ""}${repo.ahead ? ` ↑${repo.ahead}` : ""}`;
  const n = repo.files.length;
  return {
    text: `${branch}${n ? "*" : ""}${sync}${busy ? ` · ${busy}` : ""}`,
    title: `${repo.root}\nBranch ${branch}${repo.upstream ? `, tracking ${repo.upstream}` : ""}${sync ? ` (${repo.ahead} to push, ${repo.behind} to pull)` : ""}${n ? `\n${n} changed file${n === 1 ? "" : "s"}` : ""}\nClick to switch branch`,
  };
}
