/**
 * Stash wording and rules (pure, unit-tested): how a stash is named, when Stash Changes / Apply /
 * Pop may run, what the notifications and dialogs say, and the words for a stash that came back
 * with conflicts. The git work is in src-tauri/src/git.rs (`stash_*`), the actions in lib/git.ts.
 */
import type { GitFile, GitStatus } from "./gitApi";
import { finishFirst } from "./gitStatus";

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** What a stash is called, and the branch it was made on (null: made on no branch, or unknown). */
export interface StashTitle {
  title: string;
  branch: string | null;
}

/**
 * git's stash subject → what Quarry shows. "On main: WIP parser" is "WIP parser" made on main; a
 * stash without a message, "WIP on main: 1a2b3c4 Fix tab order", is "WIP at 1a2b3c4 Fix tab order".
 */
export function stashTitle(subject: string): StashTitle {
  const branch = (b: string) => (b === "(no branch)" ? null : b);
  const wip = /^WIP on ([^:]+): ([\s\S]*)$/.exec(subject);
  if (wip) return { title: `WIP at ${wip[2]}`, branch: branch(wip[1]) };
  const on = /^On ([^:]+): ([\s\S]*)$/.exec(subject);
  if (on) return { title: on[2], branch: branch(on[1]) };
  return { title: subject, branch: null };
}

/** The line under a stash's title: "main · 2 hours ago". `age` comes from `relativeTime`. */
export function stashWhere(branch: string | null, age: string): string {
  return `${branch ?? "no branch"} · ${age}`;
}

/** The files a stash would take: changes to tracked files (always) and untracked files (optional). */
export function stashCounts(files: GitFile[]): { tracked: number; untracked: number } {
  const untracked = files.filter((f) => f.untracked).length;
  return { tracked: files.length - untracked, untracked };
}

/**
 * Why Stash Changes ("stash") or Apply / Pop cannot run now, or null when it can. A sentence
 * without its full stop (a tooltip); a notification adds one. Dropping and looking are never blocked.
 */
export function stashBlocked(repo: Pick<GitStatus, "head" | "operation" | "files">, what: "stash" | "apply" | "pop"): string | null {
  if (!repo.head) return what === "stash" ? "Make a first commit before stashing" : "This repository has no commits yet";
  if (repo.operation) return finishFirst(repo.operation);
  if (repo.files.some((f) => f.conflicted)) return "Resolve the conflicts first";
  if (what === "stash" && repo.files.length === 0) return "There are no uncommitted changes to stash";
  return null;
}

/** The notification after a stash action worked. `message`: what the user typed (stash only); `files`: how many were stashed. */
export function stashDone(what: "stash" | "apply" | "pop" | "drop", title: string, files = 0): string {
  switch (what) {
    case "stash":
      return `Stashed ${count(files, "file")}${title.trim() ? `: ${title.trim()}` : ""}`;
    case "apply":
      return `Applied stash: ${title}. It is still in the list.`;
    case "pop":
      return `Popped stash: ${title}`;
    case "drop":
      return `Dropped stash: ${title}`;
  }
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length > 4) return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * What to show when git refuses an apply / pop: its "would be overwritten" and "already exists"
 * output becomes a sentence that names the files and says what to do; anything else is git's
 * message without the `hint:` lines. (A stash that comes back with conflicts is not an error and
 * never gets here.)
 */
export function stashErrorText(raw: string, what: "apply" | "pop"): string {
  const lines = raw.replace(/^Error: /, "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^hint:/i.test(l));
  if (lines.some((l) => /no longer exists/i.test(l))) return "That stash no longer exists.";
  const show = (rel: string) => rel.replace(/\//g, "\\");
  const exists = lines.map((l) => /^(.+) already exists, no checkout$/.exec(l)?.[1]).filter((n): n is string => !!n);
  if (exists.length) {
    const one = exists.length === 1;
    return `${listNames(exists.map(show))} ${one ? "is" : "are"} already in the folder, and this stash holds ${one ? "an untracked file with that name" : "untracked files with those names"}. Move or delete ${one ? "it" : "them"}, then ${what} again.`;
  }
  const at = lines.findIndex((l) => /would be overwritten/i.test(l));
  if (at >= 0) {
    const files: string[] = [];
    for (const l of lines.slice(at + 1)) {
      if (/^(Please |Aborting|error:|fatal:|The stash entry)/i.test(l)) break;
      files.push(show(l));
    }
    if (files.length) return `${listNames(files)} ${files.length === 1 ? "has" : "have"} uncommitted changes that this stash would overwrite. Commit or stash them first, then ${what} again.`;
  }
  return lines.join("\n");
}

/** The question before a stash is dropped. `age`: "2 hours ago"; `files`: how many it holds (null: unknown). */
export function dropConfirm(stash: StashTitle, age: string, files: number | null): { title: string; text: string; drop: string; cancel: string } {
  const made = `made ${stash.branch ? `on ${stash.branch} ` : ""}${age}`;
  return {
    title: "Drop this stash?",
    text: `"${stash.title}" (${files === null ? "" : `${count(files, "file")}, `}${made}) will be deleted. Its changes are not in your files or in any commit, and Quarry cannot bring it back.`,
    drop: "Drop Stash",
    cancel: "Cancel",
  };
}

/** Files are in conflict and no merge / rebase / pick is in progress: a stash came back with conflicts. */
export function isStashConflict(repo: Pick<GitStatus, "operation" | "files">): boolean {
  return !repo.operation && repo.files.some((f) => f.conflicted);
}

/** Wording for a stash that came back with conflicts. Nothing here mentions Abort: git has none for it. */
export const STASH_CONFLICT = {
  /** Badge beside the branch, where a stopped operation's badge shows. */
  badge: "Stash conflicts",
  badgeTitle: "A stash came back with conflicts: resolve the files under Merge Changes (Current on a row keeps that file as it was). The stash is kept in the Stashes list.",
  /** Mark on the stash's row. */
  rowMark: "applied with conflicts",
  /** Note on each conflict bar, and in the row buttons' tooltips. */
  sidesNote: "Stash: Current is your files as they are now, Incoming is the stash.",
  /** In the "No conflicts left in <file>" dialog, for the last file of a pop. */
  lastFilePop: "It is the last file: after this, Quarry offers to drop the stash.",
  /** The same, when no drop will be offered (an apply, or after a restart). */
  lastFile: "It is the last file: after this the stash's changes are in your files (nothing is committed for you).",
  /** The Commit button's tooltip while files are in conflict. */
  commitTitle: "Open each file under Merge Changes, fix the conflict, save, and mark it resolved with +. Nothing is committed for you.",
} as const;

/** Tooltips of the Current / Incoming buttons on a Merge Changes row. */
export function stashSideTitle(side: "ours" | "theirs"): string {
  return `${side === "ours" ? "Resolve by keeping the whole file as it is now, without the stash's changes to it" : "Resolve by taking the stash's version of the whole file (deletes it if the stash deleted it)"}. ${STASH_CONFLICT.sidesNote}`;
}

/** The warning after an apply / pop left `conflicts` conflicted files. */
export function stashConflictWarning(title: string, pop: boolean, conflicts: number): string {
  return `Stash ${title} conflicts with your files in ${count(conflicts, "file")}. Resolve ${conflicts === 1 ? "it" : "them"} under Merge Changes. ${pop ? "The stash is kept until you drop it." : "The stash stays in the list."}`;
}

/** The graph tab's strip. */
export function stashConflictStrip(conflicts: number): string {
  return `A stash was applied with conflicts: ${conflicts} file${conflicts === 1 ? " has" : "s have"} conflicts. Resolve ${conflicts === 1 ? "it" : "them"} in Source Control.`;
}

/** The offer once the last conflicted file of a pop is resolved (Keep Stash is the default). */
export function dropOffer(title: string): { title: string; text: string; drop: string; keep: string } {
  return {
    title: "Conflicts resolved: drop the stash?",
    text: `The changes of "${title}" are now in your files. The stash itself is still in the list: drop it if you no longer need it.`,
    drop: "Drop Stash",
    keep: "Keep Stash",
  };
}
