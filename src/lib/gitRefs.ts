/**
 * Refs as things to act on (pure): the right-click menu of a branch / tag label in the commit
 * graph, and what the one branch picker (palette mode "branch") lists and runs for each purpose.
 * Created with the merge and rebase entries (specs/git-merge-rebase.md); the branch and tag
 * housekeeping (specs/git-branches.md) adds its entries and purposes here.
 */
import type { GitBranch } from "./gitApi";
import type { RefLabel } from "./gitGraph";
import { startEntries, type StartRepo } from "./gitMerge";
// Branch and tag housekeeping (specs/git-branches.md).
import { defaultRemote, housekeepingPrompt, isHousekeeping, ON_THIS_BRANCH, pushLabel, pushTarget, splitRemoteRef, type BranchPickFor, type HousekeepingPurpose } from "./gitBranches";

// ---------- the graph's ref-label menu ----------

export interface RefMenuCtx {
  /** The repository's status (null while unknown). */
  repo: StartRepo | null | undefined;
  /** A git action in progress (`useGit().busy`). */
  busy: string | null;
  // Housekeeping entries (specs/git-branches.md); left out, a menu has the merge / rebase entries only.
  /** The repository's remote names, in git's order. */
  remotes?: string[];
  /** Local branch → its upstream (`origin/main`). */
  upstreams?: Record<string, string | null | undefined>;
  /** Remote → its default branch. */
  defaults?: Record<string, string>;
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
  // The branch you are on has no merge / rebase entries ("Merge main into main…" means nothing).
  const entries: RefMenuEntry[] = current ? [] : startEntries(target, ctx.repo, ctx.busy).map((e) => ({ id: e.kind, label: e.label, disabled: e.disabled, title: e.hint }));
  if (ctx.remotes) return { heading, kind, name: label.name, full: label.full, current, entries: withHousekeeping(kind, label.name, current, entries, ctx) };
  return { heading, kind, name: label.name, full: label.full, current, entries };
}

// ---------- housekeeping entries (specs/git-branches.md) ----------

/** The command behind a housekeeping entry; "switch", "copy", "merge" and "rebase" are the view's own. */
export const REF_COMMANDS: Record<string, string> = {
  rename: "git.renameBranch",
  upstream: "git.setUpstream",
  push: "git.pushBranch",
  delete: "git.deleteBranch",
  "delete-remote": "git.deleteRemoteBranch",
  "push-tag": "git.pushTag",
  "delete-tag": "git.deleteTag",
};

/**
 * The full label menu: Switch to … (not on the current branch, not on a tag); the merge and rebase
 * entries; the housekeeping entries for the kind of ref; Copy … Name. While a git action runs (or
 * the repository is unknown) everything but Copy is greyed out.
 */
function withHousekeeping(kind: RefMenu["kind"], name: string, current: boolean, start: RefMenuEntry[], ctx: RefMenuCtx): RefMenuEntry[] {
  const remotes = ctx.remotes ?? [];
  const blocked = !ctx.repo ? "Reading this repository's status…" : ctx.busy ? "Another git action is running" : null;
  const entry = (id: string, label: string, title: string, disabled: string | null = null, danger = false): RefMenuEntry => ({ id, label, title, disabled: blocked ?? disabled, ...(danger ? { danger } : {}) });
  const out: RefMenuEntry[] = [];
  if (!current && kind !== "tag") out.push(entry("switch", `Switch to ${name}`, kind === "remote" ? "Check out a local branch that tracks it" : "Check out this branch"));
  start.forEach((e, i) => out.push(i === 0 && out.length ? { ...e, group: true } : e));
  const first = out.length;
  if (kind === "branch") {
    const to = pushTarget(name, ctx.upstreams?.[name], remotes);
    out.push(entry("rename", "Rename Branch…", "Give the branch another name; the branch on a remote keeps its name"));
    out.push(entry("upstream", "Set Upstream…", "Choose the remote branch it follows, or stop following one"));
    out.push(entry("push", pushLabel(name, to.to), to.remote ? (to.tracked ? "Push its commits without switching to it (never forced)" : `Publish it on ${to.remote} and track it there`) : "This repository has no remote yet: add one first"));
    out.push(entry("delete", "Delete Branch…", "Delete the local branch (asks first); a branch on a remote is not touched", current ? ON_THIS_BRANCH : null, true));
  } else if (kind === "remote") {
    const at = splitRemoteRef(name, remotes);
    const isDefault = !!at && ctx.defaults?.[at.remote] === at.branch;
    out.push(entry("delete-remote", at ? `Delete ${at.branch} from ${at.remote}…` : "Delete from the Remote…", "Delete the branch in the remote repository, for everyone (asks first); local branches are kept", at && isDefault ? `${at.branch} is ${at.remote}'s default branch.` : null, true));
  } else {
    const to = defaultRemote(remotes);
    out.push(entry("push-tag", pushLabel(name, to), to ? "Push this one tag (never forced)" : "This repository has no remote yet: add one first"));
    out.push(entry("delete-tag", "Delete Tag…", "Delete the tag on this computer (asks first); the remote keeps its copy", null, true));
  }
  out[first] = { ...out[first], group: true };
  out.push({ id: "copy", label: kind === "tag" ? "Copy Tag Name" : "Copy Branch Name", disabled: null, group: true });
  return out;
}

/**
 * The row menu of the branch picker (purpose "switch"): the housekeeping and Copy entries of the
 * label menu for that branch; Enter and click on the row do the switching, so Switch, merge and
 * rebase are left out.
 */
export function rowMenu(branch: Pick<GitBranch, "name" | "remote" | "current">, ctx: RefMenuCtx): RefMenuEntry[] {
  const full = `${branch.remote ? "refs/remotes/" : "refs/heads/"}${branch.name}`;
  const m = refMenu({ kind: branch.remote ? "remote" : branch.current ? "head" : "branch", name: branch.name, full }, { ...ctx, remotes: ctx.remotes ?? [] });
  const rows = (m?.entries ?? []).filter((e) => e.id !== "switch" && e.id !== "merge" && e.id !== "rebase");
  return rows.map((e, i) => (i === 0 ? { ...e, group: false } : e));
}

// ---------- the branch picker ----------

/** Why the branch picker is open. Later features add their purposes here. */
export type BranchPurpose = "switch" | "merge" | "rebase" | "compare" | HousekeepingPurpose;

export interface BranchPick {
  /** The input's placeholder. */
  prompt: string;
  /** The command a picked row runs, with the row's name as its argument. */
  command: string;
  /** A typed name that matches no row offers "Create branch" (only when switching). */
  create: boolean;
}

/** Prompt and command of the picker for a purpose. `branch`: the current branch (null: detached). */
export function branchPick(purpose: BranchPurpose, branch: string | null, pick: BranchPickFor | null = null): BranchPick {
  // Housekeeping (specs/git-branches.md): the command comes with the purpose (`pickBranch(purpose, for)`).
  if (isHousekeeping(purpose)) return { prompt: housekeepingPrompt(purpose, pick), command: pick?.command ?? "", create: false };
  if (purpose === "merge") return { prompt: `Merge which branch into ${branch ?? "the current commit"}?`, command: "git.mergeRef", create: false };
  if (purpose === "rebase") return { prompt: `Rebase ${branch ?? "the current branch"} onto which branch?`, command: "git.rebaseOnto", create: false };
  // Compare with Branch… (COMMITCMP-005): every branch, the current one included.
  if (purpose === "compare") return { prompt: "Compare with a branch…", command: "git.compareBranchPick", create: false };
  return { prompt: "Switch to a branch, or type a name to create one…", command: "git.checkoutTo", create: true };
}

/** The rows a purpose lists, in the order git gave them (local first, then remote, each newest first). */
export function pickList(purpose: BranchPurpose, branches: GitBranch[]): GitBranch[] {
  // The housekeeping lists: `housekeepingRows` (gitBranches.ts) builds their rows, tags included.
  if (purpose === "delete-branch") return branches.filter((b) => !b.remote && !b.current);
  if (purpose === "local-branch") return [...branches.filter((b) => !b.remote && b.current), ...branches.filter((b) => !b.remote && !b.current)];
  if (purpose === "remote-branch" || purpose === "upstream") return branches.filter((b) => b.remote);
  if (purpose === "tag" || purpose === "new-name") return [];
  return purpose === "switch" || purpose === "compare" ? branches : branches.filter((b) => !b.current);
}
