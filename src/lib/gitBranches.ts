/**
 * Branch and tag housekeeping (pure; specs/git-branches.md): which remote a push goes to, the
 * questions asked before a delete, the notifications after an action, the rename check, and the
 * rows of the branch picker for the housekeeping purposes. The menu entries are in gitRefs.ts
 * (`refMenu`), the actions in gitRefActions.ts.
 */
import type { Choice } from "./dialogs";
import type { GitBranch, GitBranchInfo, GitPushRef, GitTag } from "./gitApi";
import { displayUrl, remoteWebUrl } from "./gitStatus";

/** What `git.refAction("branch-delete")` rejects with when the branch has commits found nowhere else. */
export const NOT_MERGED = "NOT_MERGED";
export const isNotMerged = (error: string) => error.replace(/^Error: /, "").trim() === NOT_MERGED;

export const NO_REMOTE = "This repository has no remote yet. Add one in Source Control.";
export const ON_THIS_BRANCH = "You are on this branch. Switch to another branch first.";

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const CANCEL: Choice<boolean> = { label: "Cancel", cancel: true, default: true, value: false };

// ---------- remotes ----------

/** `origin/feature/login` → `feature/login` on `origin`: the longest remote name that fits (the
 *  part before the first "/" when the remotes are not known). */
export function splitRemoteRef(name: string, remotes: string[]): { remote: string; branch: string } | null {
  const fits = remotes.filter((r) => name.startsWith(`${r}/`) && name.length > r.length + 1).sort((a, b) => b.length - a.length)[0];
  if (fits) return { remote: fits, branch: name.slice(fits.length + 1) };
  const i = name.indexOf("/");
  return !remotes.length && i > 0 && i < name.length - 1 ? { remote: name.slice(0, i), branch: name.slice(i + 1) } : null;
}

/** Where a push with no upstream goes: `origin`, else the first remote; null with none. */
export function defaultRemote(remotes: string[]): string | null {
  return remotes.includes("origin") ? "origin" : (remotes[0] ?? null);
}

export interface PushTarget {
  /** null: the repository has no remote (the entry then leads to the Add Remote form). */
  remote: string | null;
  /** What the entry names after "to": the upstream (`origin/review`), else the remote. */
  to: string | null;
  /** The remote branch the push updates (`origin/review`); null without a remote. */
  branch: string | null;
  /** The branch has an upstream on a remote (the push does not start tracking). */
  tracked: boolean;
}

/** Where pushing a local branch goes: its upstream, else `origin` (else the first remote). */
export function pushTarget(branch: string, upstream: string | null | undefined, remotes: string[]): PushTarget {
  const up = upstream ? splitRemoteRef(upstream, remotes) : null;
  if (upstream && up && remotes.includes(up.remote)) return { remote: up.remote, to: upstream, branch: upstream, tracked: true };
  const remote = defaultRemote(remotes);
  return { remote, to: remote, branch: remote ? `${remote}/${branch}` : null, tracked: false };
}

/** "Push feature to origin", "Push main to origin/main", "Push v1.2.0…" (no remote yet). */
export function pushLabel(name: string, to: string | null): string {
  return to ? `Push ${name} to ${to}` : `Push ${name}…`;
}

/** A remote's address for a question: `github.com/acme/app`, or the URL without any token. */
export function remotePlace(url: string | null | undefined): string {
  if (!url) return "";
  const web = remoteWebUrl(url);
  return web ? web.replace(/^https?:\/\//, "") : displayUrl(url);
}

// ---------- questions ----------

export interface Ask {
  title: string;
  text: string;
  choices: Choice<boolean>[];
}

/** What a branch's commits are compared with, in words: `"main"`, or the detached commit. */
function baseWords(info: Pick<GitBranchInfo, "base" | "baseSha">): string {
  return info.base ? `"${info.base}"` : `the commit you are on${info.baseSha ? ` (${info.baseSha})` : ""}`;
}

/** The first question before a local branch is deleted (always asked; Cancel is the default). */
export function deleteQuestion(info: Pick<GitBranchInfo, "name" | "base" | "baseSha" | "unmerged">): Ask {
  const base = baseWords(info);
  const kept = "The branch on a remote, if there is one, is not touched.";
  const text = info.unmerged === 0
    ? `All its commits are in ${base}, so nothing is lost. ${kept}`
    : `${count(info.unmerged, "commit")} on "${info.name}" ${info.unmerged === 1 ? "is" : "are"} not in ${base}: you are asked once more before ${info.unmerged === 1 ? "it is" : "they are"} lost. ${kept}`;
  return { title: `Delete branch "${info.name}"?`, text, choices: [{ label: "Delete Branch", value: true }, CANCEL] };
}

/** The second, danger question for a branch with commits that are in nothing else. */
export function unmergedQuestion(info: Pick<GitBranchInfo, "name" | "sha" | "base" | "baseSha" | "unmerged">): Ask {
  const n = info.unmerged;
  const back = `Its last commit is ${info.sha}, should you need it back.`;
  // git refused the safe delete but nothing is counted (an upstream it cannot compare with).
  if (n === 0) {
    return { title: `Delete "${info.name}" anyway?`, text: `git does not consider "${info.name}" merged into ${baseWords(info)}. Deleting the branch may leave commits on no branch. ${back}`, choices: [{ label: "Delete Anyway", kind: "danger", value: true }, CANCEL] };
  }
  return {
    title: `Delete "${info.name}" and lose ${count(n, "commit")}?`,
    text: `${count(n, "commit")} on "${info.name}" ${n === 1 ? "is" : "are"} not in ${baseWords(info)}. Deleting the branch leaves ${n === 1 ? "it" : "them"} on no branch. ${back}`,
    choices: [{ label: "Delete Anyway", kind: "danger", value: true }, CANCEL],
  };
}

/** The danger question before a branch is deleted on a remote: it names the remote and what is lost. */
export function remoteDeleteQuestion(remote: string, branch: string, url: string | null | undefined, onlyThere: number): Ask {
  const place = remotePlace(url);
  const lost = onlyThere > 0 ? `\n\n${count(onlyThere, "commit")} ${onlyThere === 1 ? "is" : "are"} only on ${remote}/${branch} (as of the last fetch). ${onlyThere === 1 ? "It is" : "They are"} lost unless someone else has ${onlyThere === 1 ? "it" : "them"}.` : "";
  return {
    title: `Delete "${branch}" from ${remote}?`,
    text: `This deletes the branch "${branch}" in the remote repository ${remote}${place ? ` (${place})` : ""}, for everyone who uses it. Your local branches are kept.${lost}`,
    choices: [{ label: `Delete from ${remote}`, kind: "danger", value: true }, CANCEL],
  };
}

export function tagDeleteQuestion(name: string, sha: string): Ask {
  return {
    title: `Delete tag "${name}"?`,
    text: `Removes the tag from this computer. The commit ${sha} and its branch are not changed. If the tag was pushed, the remote keeps its copy.`,
    choices: [{ label: "Delete Tag", value: true }, CANCEL],
  };
}

// ---------- results ----------

export type RefDone =
  | { what: "branch-deleted" | "tag-deleted"; name: string; was: string }
  | { what: "renamed"; name: string; to: string; upstream: string; remotes: string[] }
  | { what: "upstream"; name: string; upstream: string | null }
  | { what: "pushed" | "tag-pushed"; name: string; result: Pick<GitPushRef, "remote" | "upToDate" | "tracking"> }
  | { what: "remote-deleted"; result: Pick<GitPushRef, "remote" | "branch" | "was" | "gone"> };

/** The notification after an action that worked. */
export function refDone(d: RefDone): string {
  const was = (sha: string | null) => (sha ? ` (was ${sha})` : "");
  switch (d.what) {
    case "branch-deleted":
      return `Deleted branch ${d.name}${was(d.was)}`;
    case "tag-deleted":
      return `Deleted tag ${d.name}${was(d.was)}`;
    case "renamed": {
      if (!d.upstream) return `Renamed ${d.name} to ${d.to}`;
      const remote = splitRemoteRef(d.upstream, d.remotes)?.remote;
      return `Renamed ${d.name} to ${d.to}. It still tracks ${d.upstream}; the branch on ${remote ?? "the remote"} keeps its name.`;
    }
    case "upstream":
      return d.upstream ? `${d.name} now tracks ${d.upstream}` : `${d.name} no longer tracks a remote branch`;
    case "pushed":
      if (d.result.upToDate && !d.result.tracking) return `${d.name} is already up to date on ${d.result.remote}`;
      return `Pushed ${d.name} to ${d.result.remote}${d.result.tracking ? `; it now tracks ${d.result.tracking}` : ""}`;
    case "tag-pushed":
      return d.result.upToDate ? `${d.name} is already on ${d.result.remote}` : `Pushed tag ${d.name} to ${d.result.remote}`;
    case "remote-deleted":
      return d.result.gone ? `${d.result.branch} was already gone from ${d.result.remote}` : `Deleted ${d.result.branch} from ${d.result.remote}${was(d.result.was)}`;
  }
}

/** A push the remote refused because it has commits the branch lacks (never forced from here). */
export function pushRejected(error: string): boolean {
  return /\[rejected\]|non-fast-forward|fetch first/i.test(error) && !/already exists/i.test(error);
}

/** A tag push refused because the remote has that tag on another commit. */
export function tagRejected(error: string): boolean {
  return /\[rejected\]/.test(error) && /already exists/i.test(error);
}

export function tagRejectedText(remote: string, name: string, gitText: string): string {
  return `${remote} already has a tag ${name} on another commit. Quarry does not overwrite tags on a remote.\n\n${gitText}`;
}

/**
 * The dialog after a rejected branch push: what happened, and the way out as a button. The value
 * chosen is true for that button ("Switch to feature", or "Pull" on the branch I am on).
 */
export function rejectedDialog(remote: string, name: string, remoteBranch: string, current: boolean, gitText: string): Ask {
  const how = current ? "Pull, then push again." : `Switch to "${name}" and pull, then push again.`;
  return {
    title: `${remote} did not accept ${name}`,
    text: `${remoteBranch} has commits that "${name}" does not have. ${how}\n\n${gitText}`,
    choices: [{ label: current ? "Pull" : `Switch to ${name}`, value: true }, { label: "Close", cancel: true, default: true, value: false }],
  };
}

// ---------- rename ----------

export interface RenameCheck {
  /** The name that would be given (trimmed; with `hyphens`, spaces become hyphens). */
  name: string;
  /** It can be renamed to `name`. */
  ok: boolean;
  /** Why not, when there is something to say (nothing for an empty or unchanged name). */
  error: string | null;
}

/**
 * Check a new branch name before git is asked. `existing`: the local branch names. A change of
 * letter case only is allowed; any other existing name is taken (never overwritten).
 */
export function renameCheck(old: string, typed: string, existing: string[], hyphens = false): RenameCheck {
  const name = hyphens ? typed.trim().replace(/\s+/g, "-") : typed.trim();
  if (!name || name === old) return { name, ok: false, error: null };
  const taken = existing.find((b) => b !== old && b.toLowerCase() === name.toLowerCase());
  if (taken) return { name, ok: false, error: `A branch named "${taken}" already exists.` };
  return { name, ok: true, error: null };
}

// ---------- the branch picker's housekeeping purposes ----------

export type HousekeepingPurpose = "delete-branch" | "local-branch" | "remote-branch" | "tag" | "upstream" | "new-name";

const HOUSEKEEPING: readonly string[] = ["delete-branch", "local-branch", "remote-branch", "tag", "upstream", "new-name"];
export const isHousekeeping = (purpose: string): purpose is HousekeepingPurpose => HOUSEKEEPING.includes(purpose);

/** What the picker was opened for, beside its purpose (`pickBranch(purpose, for)`). */
export interface BranchPickFor {
  /** The command a picked row runs. */
  command: string;
  /** `upstream` / `new-name`: the local branch it is about. */
  target?: string;
  /** The repository, when it is not the current one (an action started in a graph tab). */
  root?: string;
  /** `tag` for a push: the remote it goes to (for the prompt). */
  remote?: string | null;
}

/** The picker's prompt for a housekeeping purpose. */
export function housekeepingPrompt(purpose: HousekeepingPurpose, pick: BranchPickFor | null): string {
  const target = pick?.target ?? "";
  switch (purpose) {
    case "delete-branch":
      return "Delete which branch?";
    case "local-branch":
      return pick?.command === "git.renameBranch" ? "Rename which branch?" : pick?.command === "git.setUpstream" ? "Set the upstream of which branch?" : "Push which branch?";
    case "remote-branch":
      return "Delete which branch on the remote?";
    case "tag":
      return pick?.command === "git.pushTag" ? `Push which tag${pick.remote ? ` to ${pick.remote}` : ""}?` : "Delete which tag?";
    case "upstream":
      return `Which remote branch should "${target}" track?`;
    case "new-name":
      return `New name for "${target}"…`;
  }
}

export interface PickRow {
  key: string;
  title: string;
  /** A label before the title ("current", "tracking"), or "". */
  category: string;
  command: string;
  arg: unknown;
  /** Shown whatever is typed (the row is an action, not a ref to find). */
  fixed?: boolean;
}

export interface PickRows {
  rows: PickRow[];
  /** What the list says when it has no rows. */
  empty: string;
  /** A line above the rows. */
  note?: string;
}

/**
 * The rows of the picker for a housekeeping purpose. `query` only matters for `new-name` (the
 * single row is the rename itself); the other lists are filtered by the palette.
 */
export function housekeepingRows(purpose: HousekeepingPurpose, pick: BranchPickFor | null, data: { branches: GitBranch[]; tags: GitTag[]; remotes: string[]; query: string }): PickRows {
  const command = pick?.command ?? "";
  const root = pick?.root ? { root: pick.root } : {};
  const named = (name: string, category = ""): PickRow => ({ key: name, title: name, category, command, arg: { name, ...root } });
  const local = data.branches.filter((b) => !b.remote);
  const remote = data.branches.filter((b) => b.remote);
  switch (purpose) {
    case "delete-branch":
      return { rows: local.filter((b) => !b.current).map((b) => named(b.name)), empty: "There is no other branch to delete" };
    case "local-branch":
      return { rows: [...local.filter((b) => b.current), ...local.filter((b) => !b.current)].map((b) => named(b.name, b.current ? "current" : "")), empty: "This repository has no branches yet" };
    case "remote-branch":
      return { rows: remote.map((b) => named(b.name)), empty: "This repository has no remote branches" };
    case "tag":
      return { rows: data.tags.map((t) => named(t.name)), empty: "This repository has no tags" };
    case "upstream": {
      const target = pick?.target ?? "";
      const tracking = local.find((b) => b.name === target)?.upstream ?? null;
      if (!remote.length) {
        const to = defaultRemote(data.remotes);
        const rows: PickRow[] = to ? [{ key: "push", title: `Push "${target}" to ${to} and track it`, category: "", command: "git.pushBranch", arg: { name: target, ...root }, fixed: true }] : [];
        if (tracking) rows.push({ key: "stop", title: `Stop tracking "${tracking}"`, category: "", command, arg: { name: target, upstream: null, ...root }, fixed: true });
        return { rows, empty: "No remote branches yet", note: "No remote branches yet" };
      }
      // The branch of the same name first, then git's order.
      const same = (b: GitBranch) => splitRemoteRef(b.name, data.remotes)?.branch === target;
      const rows: PickRow[] = [...remote.filter(same), ...remote.filter((b) => !same(b))].map((b) => ({ key: b.name, title: b.name, category: b.name === tracking ? "tracking" : "", command, arg: { name: target, upstream: b.name, ...root } }));
      if (tracking) rows.unshift({ key: "stop", title: `Stop tracking "${tracking}"`, category: "", command, arg: { name: target, upstream: null, ...root } });
      return { rows, empty: "No remote branches yet" };
    }
    case "new-name": {
      const target = pick?.target ?? "";
      const check = renameCheck(target, data.query, local.map((b) => b.name), true);
      if (!check.ok) return { rows: [], empty: check.error ?? `Type a new name for "${target}"` };
      return { rows: [{ key: "rename", title: `Rename "${target}" to "${check.name}"`, category: "", command, arg: { name: target, to: check.name, ...root }, fixed: true }], empty: "" };
    }
  }
}
