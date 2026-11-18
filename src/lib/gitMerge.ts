/**
 * Starting a merge or a rebase, and Force Push (specs/git-merge-rebase.md): pure wording and rules.
 * Which target a graph commit stands for, how the menu entries read and why they are disabled,
 * what each confirmation dialog says, and the notifications. The actions are in git.ts
 * (`startMerge`, `startRebase`, `forcePush`), the git work in src-tauri/src/git/merge.rs.
 */
import type { Choice } from "./dialogs";
import type { GitCommitRef, GitForcePushPreview, GitMergeMode, GitMergePreview, GitStatus } from "./gitApi";
import { refLabels } from "./gitGraph";
import { finishFirst } from "./gitStatus";

export type StartKind = "merge" | "rebase";

/** What is merged / rebased onto. */
export interface StartTarget {
  /** What git is given: a full ref name, a branch / tag name, or a commit id. */
  ref: string;
  /** How it is shown: `feature`, `origin/topic`, `v1.2.0`, or a short commit id. */
  label: string;
  /** A branch or tag by name (false: a commit by its id). */
  named: boolean;
}

/** The parts of a repository's status these rules look at. */
export type StartRepo = Pick<GitStatus, "branch" | "head" | "operation" | "files">;

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * The target a graph commit stands for: with exactly one branch label (local or remote) other than
 * the current branch, that branch by name; otherwise the commit by its id.
 */
export function targetOf(commit: { sha: string; short: string; refs: string[] }, branch: string | null): StartTarget {
  const others = refLabels(commit.refs).filter((l) => (l.kind === "branch" && l.name !== branch) || l.kind === "remote");
  return others.length === 1 ? { ref: others[0].full, label: others[0].name, named: true } : { ref: commit.sha, label: commit.short, named: false };
}

/** The two menu entries for a target. `branch`: the current branch, null on a detached HEAD. */
export function entryLabels(target: StartTarget, branch: string | null): Record<StartKind, string> {
  return {
    merge: `Merge ${target.label} into ${branch ?? "Here"}…`,
    rebase: `Rebase ${branch ? `${branch} ` : ""}onto ${target.named ? target.label : "This"}…`,
  };
}

/**
 * Why a merge / rebase cannot start right now, or null. As a tooltip it has no full stop; a
 * notification adds one. Uncommitted changes are not in here: they do not grey anything out, the
 * start itself refuses with `dirtyRefusal`.
 */
export function startBlocked(repo: StartRepo | null | undefined, kind: StartKind, busy: string | null = null): string | null {
  if (!repo) return "The open folder is not in a git repository";
  if (busy) return "Another git action is running";
  if (repo.operation) return finishFirst(repo.operation);
  if (!repo.head) return "This repository has no commits yet";
  if (kind === "rebase" && !repo.branch) return "Switch to a branch first: a rebase moves a branch";
  return null;
}

/** Uncommitted changes to tracked files (untracked files do not block a merge or rebase). */
export function trackedChanges(repo: Pick<GitStatus, "files">): number {
  return repo.files.filter((f) => !f.untracked).length;
}

export interface StartEntry {
  kind: StartKind;
  label: string;
  /** Why it is greyed out (its tooltip then), or null. */
  disabled: string | null;
  /** Tooltip while enabled. */
  hint: string;
}

/**
 * The merge and rebase entries of a graph menu. `here`: the target is the commit ("commit") or the
 * branch ("branch") you are on, so there is nothing to merge or rebase onto.
 */
export function startEntries(target: StartTarget, repo: StartRepo | null | undefined, busy: string | null, here: "commit" | "branch" | null = null): StartEntry[] {
  const labels = entryLabels(target, repo?.branch ?? null);
  const self = here === "commit" ? "This is the commit you are on" : here === "branch" ? "This is the branch you are on" : null;
  const hints: Record<StartKind, string> = {
    merge: `Bring the commits of ${target.label} into ${repo?.branch ?? "the current commit"} (asks first)`,
    rebase: `Replay the commits of ${repo?.branch ?? "your branch"} on top of ${target.named ? target.label : "this commit"}; they get new ids (asks first)`,
  };
  return (["merge", "rebase"] as const).map((kind) => ({ kind, label: labels[kind], disabled: startBlocked(repo, kind, busy) ?? self, hint: hints[kind] }));
}

// ---------- dialogs ----------

/** Either there is nothing to do (said in a notification, git is not run), or a dialog to show. */
export type Plan<T> = { nothing: string } | { nothing?: undefined; title: string; text: string; choices: Choice<T | null>[] };

const CANCEL: Choice<null> = { label: "Cancel", cancel: true, default: true, value: null };

/** How many commits a dialog lists before "and N more". */
export const LISTED = 12;

/** `short  summary` lines, at most `LISTED`, then "and N more" (`total` may exceed `commits.length`). */
export function commitLines(commits: GitCommitRef[], total = commits.length): string {
  const shown = commits.slice(0, LISTED);
  const rest = Math.max(total, commits.length) - shown.length;
  return shown.map((c) => `${c.short}  ${c.summary}`).join("\n") + (rest > 0 ? `\nand ${rest} more` : "");
}

/** A sentence about the target for the dialog, by what it is. */
function targetNote(p: GitMergePreview, label: string, kind: StartKind): string {
  if (p.kind === "remote") return ` ${label} is used as it was last fetched: nothing is fetched and no local branch is created.`;
  if (p.kind === "tag") return ` The commit the tag points at (${p.short} "${p.summary}") is ${kind === "merge" ? "merged" : "the new base"}.`;
  if (p.kind === "commit") return ` ${p.short} is "${p.summary}".`;
  return "";
}

/**
 * The question before a merge. `label`: how the target is shown; `branch`: the current branch (null
 * on a detached HEAD). Cancel is always the default button. The value chosen is the merge mode.
 */
export function mergeConfirm(p: GitMergePreview, label: string, branch: string | null, dirty = 0): Plan<GitMergeMode> {
  const on = branch ?? "the current commit";
  if (p.behind === 0) return { nothing: `${branch ?? "The current commit"} already contains ${label}: nothing to merge.` };
  const title = `Merge ${label} into ${on}?`;
  const detached = branch ? "" : " You are not on a branch, so the result belongs to no branch until you create one.";
  const note = targetNote(p, label, "merge") + detached + dirtyNote(dirty);
  if (p.ahead === 0) {
    return {
      title,
      text: `${branch ? `${branch} has no commits of its own` : `There are no commits here that ${label} lacks`}, so ${branch ?? "you"} can simply move forward by ${count(p.behind, "commit")} (a fast-forward). Or a merge commit can record that ${label} was a separate branch.${note}\n\nNothing is rewritten either way.`,
      choices: [{ label: "Fast-forward", kind: "primary", value: "ff-only" }, { label: "Create a Merge Commit", value: "no-ff" }, CANCEL],
    };
  }
  const subject = p.behind === 1 ? `The commit of ${label} that ${on} does not have is` : `The ${p.behind} commits of ${label} that ${on} does not have are`;
  return {
    title,
    text: `${subject} brought into ${on} and joined with a merge commit. Nothing is rewritten: both histories stay as they are.${note}\n\nIf the changes conflict, the merge stops and Source Control shows the files to resolve.`,
    choices: [{ label: "Merge", kind: "primary", value: "no-ff" }, CANCEL],
  };
}

/**
 * With "Allow merging with uncommitted changes" on and changes present: what that means. git
 * refuses a merge that would change those files, and `merge --abort` may not restore them.
 */
export function dirtyNote(changes: number): string {
  if (!changes) return "";
  const them = changes === 1 ? "it" : "them";
  return `\n\n${changes === 1 ? "Your uncommitted change stays" : `Your ${changes} uncommitted changes stay`} as ${changes === 1 ? "it is" : "they are"}: git refuses the merge if it would change ${changes === 1 ? "that file" : "those files"}. If the merge stops on a conflict, Abort may not be able to bring ${them} back exactly; commit or stash ${them} first to be safe.`;
}

/** The notification after a merge that finished. */
export function mergeDone(mode: GitMergeMode, p: GitMergePreview, label: string, branch: string | null): string {
  if (mode === "ff-only") return `${branch ?? "The current commit"} moved forward to ${label} (${count(p.behind, "commit")})`;
  return `Merged ${label} into ${branch ?? "the current commit"}`;
}

/** What the rebase dialog's buttons stand for: replay the commits, or just move the branch forward. */
export type RebaseChoice = "rebase" | "ff";

/**
 * The question before a rebase of `branch` onto the target. With commits to replay that are
 * already on a remote branch it is the danger dialog instead of the ordinary one (never both).
 */
export function rebaseConfirm(p: GitMergePreview, label: string, branch: string): Plan<RebaseChoice> {
  if (p.behind === 0) return { nothing: `${branch} is already based on ${label}: nothing to rebase.` };
  const note = targetNote(p, label, "rebase");
  if (p.ahead === 0) {
    return {
      title: `Rebase ${branch} onto ${label}?`,
      text: `${branch} has no commits of its own to replay, so it simply moves forward by ${count(p.behind, "commit")} (a fast-forward). Nothing is rewritten.${note}`,
      choices: [{ label: "Fast-forward", kind: "primary", value: "ff" }, CANCEL],
    };
  }
  const merges = p.merges
    ? `\n\n${p.merges} of them ${p.merges === 1 ? "is a merge commit" : "are merge commits"}; a rebase does not keep ${p.merges === 1 ? "it" : "them"}: the changes ${p.merges === 1 ? "it" : "they"} brought in are replayed as ordinary commits.`
    : "";
  if (p.pushed > 0) {
    const where = p.pushedOn ?? "a remote branch";
    const which = p.pushed === p.ahead ? (p.ahead === 1 ? "The commit to replay is" : `All ${p.ahead} commits to replay are`) : `${p.pushed} of the ${p.ahead} commits to replay ${p.pushed === 1 ? "is" : "are"}`;
    return {
      title: "Rebase commits that are already pushed?",
      text:
        `${which} already on ${where}:\n\n${commitLines(p.pushedCommits, p.pushed)}\n\n` +
        `Rebasing gives ${p.pushed === 1 ? "it a new id" : "them new ids"}, so ${branch} and ${where} will no longer agree. A normal Push will be refused and Quarry will then offer Force Push; anyone who pulled ${p.pushed === 1 ? "it" : "them"} will have to repair their copy.${merges}\n\n` +
        `Merging ${label} into ${branch} instead rewrites nothing.${note}`,
      choices: [{ label: "Rebase Anyway", kind: "danger", value: "rebase" }, CANCEL],
    };
  }
  const subject = p.ahead === 1 ? `The commit of ${branch} that ${label} does not have is replayed on top of ${label} and gets a new id` : `The ${p.ahead} commits of ${branch} that ${label} does not have are replayed on top of ${label} one by one and get new ids`;
  return {
    title: `Rebase ${branch} onto ${label}?`,
    text: `${subject}.${note}${merges}\n\nIf one of them conflicts, the rebase stops and Source Control shows the files to resolve.`,
    choices: [{ label: "Rebase", kind: "primary", value: "rebase" }, CANCEL],
  };
}

/** The notification after a rebase that finished (`how` "ff": the branch only moved forward). */
export function rebaseDone(how: RebaseChoice, p: GitMergePreview, label: string, branch: string): string {
  if (how === "ff") return `${branch} moved forward to ${label} (${count(p.behind, "commit")})`;
  return `Rebased ${branch} onto ${label} (${count(p.ahead, "commit")} replayed)`;
}

const DIRTY_WHAT = { merge: "A merge", rebase: "A rebase", history: "A history edit" } as const;

/**
 * The refusal when tracked files have uncommitted changes: "Commit or discard your changes first".
 * Shared by merge, rebase and Edit History. The value chosen: true = show Source Control.
 */
export function dirtyRefusal(what: keyof typeof DIRTY_WHAT, changes: number): { title: string; text: string; choices: Choice<boolean>[] } {
  return {
    title: "Commit or discard your changes first",
    text: `There ${changes === 1 ? "is 1 uncommitted change" : `are ${changes} uncommitted changes`} to tracked files. ${DIRTY_WHAT[what]} is only started from a clean state, so that Abort can bring everything back exactly as it was.\n\nCommit or discard ${changes === 1 ? "it" : "them"} in Source Control, then try again.`,
    choices: [
      { label: "Show Source Control", value: true },
      { label: "Close", cancel: true, default: true, value: false },
    ],
  };
}

// ---------- force push ----------

/** Why Force Push cannot run (the command is greyed out), or null. */
export function forcePushBlocked(repo: Pick<GitStatus, "branch" | "upstream" | "upstreamGone" | "operation"> | null | undefined, busy: string | null = null): string | null {
  if (!repo) return "The open folder is not in a git repository";
  if (busy) return "Another git action is running";
  if (repo.operation) return finishFirst(repo.operation);
  if (!repo.branch) return "You are not on a branch";
  if (!repo.upstream || repo.upstreamGone) return `${repo.branch} has no remote branch to replace`;
  return null;
}

/** The danger dialog before a force push; nothing to do when the upstream has no commit the branch lacks. */
export function forcePushConfirm(p: GitForcePushPreview): Plan<true> {
  if (p.lost === 0) return { nothing: `${p.upstream} has nothing to replace: use Push.` };
  const one = p.lost === 1;
  return {
    title: `Replace ${p.upstream} with your ${p.branch}?`,
    text:
      `The ${one ? "commit that is" : `${p.lost} commits that are`} only on ${p.upstream} will be removed from it:\n\n${commitLines(p.commits, p.lost)}\n\n` +
      `Your ${p.branch}, as it is now, takes ${one ? "its" : "their"} place. Anyone who pulled ${one ? "it" : "them"} will have to repair their copy.\n\n` +
      `If ${p.upstream} has changed since it was last fetched, nothing is replaced and Quarry says so.`,
    choices: [{ label: "Force Push", kind: "danger", value: true }, CANCEL],
  };
}

export function forcePushDone(p: Pick<GitForcePushPreview, "branch" | "upstream">): string {
  return `Replaced ${p.upstream} with your ${p.branch}.`;
}

/**
 * Does the status line offer Force Push? `marker` is the branch Quarry rewrote pushed commits on
 * (in memory, per repository). It only counts while that branch is checked out and its upstream
 * still has commits the branch lacks.
 */
export function isRewritten(marker: string | null | undefined, repo: Pick<GitStatus, "branch" | "upstream" | "upstreamGone" | "behind">): boolean {
  return !!marker && marker === repo.branch && !!repo.upstream && !repo.upstreamGone && repo.behind > 0;
}
