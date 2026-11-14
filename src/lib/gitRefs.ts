/**
 * Refs as things to act on (pure): the right-click menu of a branch / tag label in the commit
 * graph, and what the one branch picker (palette mode "branch") lists and runs for each purpose.
 * Created with the merge and rebase entries (specs/git-merge-rebase.md); the branch and tag
 * housekeeping (specs/git-branches.md) adds its entries and purposes here.
 */
import type { GitBranch } from "./gitApi";
import type { RefLabel } from "./gitGraph";
import { startEntries, type StartRepo } from "./gitMerge";

// ---------- the graph's ref-label menu ----------

export interface RefMenuCtx {
  /** The repository's status (null while unknown). */
  repo: StartRepo | null | undefined;
  /** A git action in progress (`useGit().busy`). */
  busy: string | null;
}

export interface RefMenuEntry {
  /** What the entry does; the view maps it to an action ("merge", "rebase", …). */
  id: string;
  label: string;
  /** Why it is greyed out (its tooltip then), or null. */
  disabled: string | null;
  /** Tooltip while enabled. */
  title?: string;
  danger?: boolean;
  /** Starts a new group (a separator is drawn above it). */
  group?: boolean;
}

export interface RefMenu {
  /** "Branch feature", "Remote branch origin/topic", "Tag v1.2.0". */
  heading: string;
  kind: "branch" | "remote" | "tag";
  /** Short name (`feature`, `origin/topic`, `v1.2.0`) and full ref name. */
  name: string;
  full: string;
  /** The branch that is checked out. */
  current: boolean;
  entries: RefMenuEntry[];
}

/**
 * The menu of a ref label, or null for a label that has none (the detached "HEAD" label, a stash:
 * a right-click there opens the row's own menu).
 */
export function refMenu(label: RefLabel, ctx: RefMenuCtx): RefMenu | null {
  if (label.kind === "head" && label.name === "HEAD") return null;
  const kind = label.kind === "head" ? "branch" : label.kind;
  if (kind !== "branch" && kind !== "remote" && kind !== "tag") return null;
  const current = label.kind === "head";
  const heading = `${kind === "branch" ? "Branch" : kind === "remote" ? "Remote branch" : "Tag"} ${label.name}`;
  const target = { ref: label.full, label: label.name, named: true };
  const entries: RefMenuEntry[] = startEntries(target, ctx.repo, ctx.busy, current ? "branch" : null).map((e) => ({ id: e.kind, label: e.label, disabled: e.disabled, title: e.hint }));
  return { heading, kind, name: label.name, full: label.full, current, entries };
}

// ---------- the branch picker ----------

/** Why the branch picker is open. Later features add their purposes here. */
export type BranchPurpose = "switch" | "merge" | "rebase" | "compare";

export interface BranchPick {
  /** The input's placeholder. */
  prompt: string;
  /** The command a picked row runs, with the row's name as its argument. */
  command: string;
  /** A typed name that matches no row offers "Create branch" (only when switching). */
  create: boolean;
}

/** Prompt and command of the picker for a purpose. `branch`: the current branch (null: detached). */
export function branchPick(purpose: BranchPurpose, branch: string | null): BranchPick {
  if (purpose === "merge") return { prompt: `Merge which branch into ${branch ?? "the current commit"}?`, command: "git.mergeRef", create: false };
  if (purpose === "rebase") return { prompt: `Rebase ${branch ?? "the current branch"} onto which branch?`, command: "git.rebaseOnto", create: false };
  // Compare with Branch… (COMMITCMP-005): every branch, the current one included.
  if (purpose === "compare") return { prompt: "Compare with a branch…", command: "git.compareBranchPick", create: false };
  return { prompt: "Switch to a branch, or type a name to create one…", command: "git.checkoutTo", create: true };
}

/** The rows a purpose lists, in the order git gave them (local first, then remote, each newest first). */
export function pickList(purpose: BranchPurpose, branches: GitBranch[]): GitBranch[] {
  return purpose === "switch" || purpose === "compare" ? branches : branches.filter((b) => !b.current);
}
