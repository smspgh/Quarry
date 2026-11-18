/**
 * Branch and tag housekeeping, the actions (specs/git-branches.md): delete / rename a branch, set
 * or clear its upstream, push one branch, delete a branch on a remote, delete / push a tag.
 *
 * `refCommand` is what the seven commands run and `refAction` the one function behind every entry
 * point (graph label menu, picker row menu, Git menu, palette, a macro), so no route skips a
 * question. Wording and checks are pure, in gitBranches.ts; the git work is `ref_action` /
 * `push_ref` in src-tauri/src/git/refs.rs, which checks again.
 */
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { choose } from "./dialogs";
import { checkoutRef, currentRepo, pickBranch, refreshGit, remote, showAddRemote, useGit } from "./git";
import { git, type GitBranchInfo, type GitStatus } from "./gitApi";
import { defaultRemote, deleteQuestion, isNotMerged, NO_REMOTE, pushRejected, pushTarget, refDone, rejectedDialog, remoteDeleteQuestion, splitRemoteRef, tagDeleteQuestion, tagRejected, tagRejectedText, unmergedQuestion, type RefDone } from "./gitBranches";
import { gitErrorText, isMissingRepo } from "./gitStatus";
import { showPanel } from "./panels";
import { useStore } from "./store";

const toast = (m: string, kind: "info" | "success" | "error" | "warning" = "info", ms?: number) => useStore.getState().toast(m, kind, ms);
const key = (p: string) => p.toLowerCase();
const fail = (e: unknown) => toast(gitErrorText(String(e)), "error", 12000);
const done = (d: RefDone, kind: "success" | "info" = "success") => toast(refDone(d), kind, 4000);

/** Open graphs reload (a ref change does not show in the status they watch). */
const refsChanged = () => useGit.setState((g) => ({ refsTick: g.refsTick + 1 }));

type Ran<T> = { ok: true; value: T } | { ok: false; error: string };

/** Run a git action with a busy label; afterwards the status is refreshed and open graphs reload, whether it worked or not. */
async function busyRun<T>(label: string, fn: () => Promise<T>): Promise<Ran<T>> {
  useGit.setState({ busy: label });
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: String(e) };
  } finally {
    useGit.setState({ busy: null });
    refreshGit(0);
    refsChanged();
  }
}

/** The repository has no remote: nothing is run, Source Control opens on its Add Remote form. */
function noRemote(): false {
  showAddRemote();
  toast(NO_REMOTE, "info", 4000);
  return false;
}

/** Read a ref before asking about it; a ref that is gone is said, and open graphs reload without it. */
async function infoOf(root: string, kind: "branch" | "remote" | "tag", name: string): Promise<GitBranchInfo | null> {
  try {
    return await git.branchInfo(root, kind, name);
  } catch (e) {
    fail(e);
    refsChanged();
    return null;
  }
}

async function deleteBranch(root: string, name: string): Promise<boolean> {
  let info = await infoOf(root, "branch", name);
  if (!info) return false;
  if (info.current) {
    toast(`You are on ${name}. Switch to another branch first.`, "info", 5000);
    return false;
  }
  const first = deleteQuestion(info);
  if (!(await choose(first.title, first.text, first.choices, false))) return false;
  if (info.unmerged === 0) {
    // git's safe delete: it refuses when the branch gained commits while the question was open.
    const r = await busyRun(`Deleting ${name}…`, () => git.refAction(root, "branch-delete", name));
    if (r.ok) {
      done({ what: "branch-deleted", name, was: r.value });
      return true;
    }
    if (!isNotMerged(r.error)) {
      fail(r.error);
      return false;
    }
    info = await infoOf(root, "branch", name);
    if (!info) return false;
  }
  const second = unmergedQuestion(info);
  if (!(await choose(second.title, second.text, second.choices, false))) return false;
  // Forced only for the commit the question named.
  const tip = info.fullSha;
  const r = await busyRun(`Deleting ${name}…`, () => git.refAction(root, "branch-delete-force", name, tip));
  if (!r.ok) {
    fail(r.error);
    return false;
  }
  done({ what: "branch-deleted", name, was: r.value });
  return true;
}

async function renameBranch(root: string, repo: GitStatus, name: string, to: string): Promise<boolean> {
  const next = to.trim();
  if (!next || next === name) return false;
  const r = await busyRun(`Renaming ${name}…`, () => git.refAction(root, "branch-rename", name, next));
  if (!r.ok) {
    fail(r.error);
    return false;
  }
  done({ what: "renamed", name, to: next, upstream: r.value.trim(), remotes: repo.remotes.map((x) => x.name) });
  return true;
}

async function setUpstream(root: string, name: string, upstream: string | null): Promise<boolean> {
  if (upstream) {
    // Picking what it already tracks changes nothing and says nothing.
    const now = await git.refInfo(root).then((i) => i.upstreams[name] ?? null, () => null);
    if (now === upstream) return true;
  }
  const r = await busyRun("Setting the upstream…", () => (upstream ? git.refAction(root, "upstream-set", name, upstream) : git.refAction(root, "upstream-unset", name)));
  if (!r.ok) {
    fail(r.error);
    return false;
  }
  done({ what: "upstream", name, upstream });
  return true;
}

async function pushBranch(root: string, repo: GitStatus, name: string): Promise<boolean> {
  const remotes = repo.remotes.map((x) => x.name);
  if (!remotes.length) return noRemote();
  const upstream = await git.refInfo(root).then((i) => i.upstreams[name] ?? null, () => null);
  const target = pushTarget(name, upstream, remotes);
  const r = await busyRun(`Pushing ${name}…`, () => git.pushRef(root, "branch", name));
  if (r.ok) {
    done({ what: "pushed", name, result: r.value }, r.value.upToDate && !r.value.tracking ? "info" : "success");
    return true;
  }
  if (pushRejected(r.error)) {
    // Never forced: say what happened and offer the way out.
    const current = (useGit.getState().repos[key(root)] ?? repo).branch === name;
    // After Quarry rewrote pushed commits a pull would bring the old ones back (MERGE-009): the way out is Force Push.
    if (current && useGit.getState().rewrotePushed[key(root)] === name) {
      toast(`${gitErrorText(r.error)}\n\n${name} was rewritten after it was pushed: use Git › Force Push (Replace Remote Branch)… instead of pulling.`, "error", 12000);
      return false;
    }
    const d = rejectedDialog(target.remote ?? "The remote", name, target.branch ?? name, current, gitErrorText(r.error));
    if (await choose(d.title, d.text, d.choices, false)) {
      if (current) void remote(root, "pull");
      else if (await checkoutRef(root, name)) showPanel("git");
    }
    return false;
  }
  // A remote repository that is not there: the panel shows its warning with Create / Change URL (GIT-016).
  if (isMissingRepo(r.error)) useGit.setState((g) => ({ remoteCheck: { ...g.remoteCheck, [key(root)]: { at: Date.now(), checking: false, error: r.error } } }));
  fail(r.error);
  return false;
}

async function deleteRemoteBranch(root: string, repo: GitStatus, name: string): Promise<boolean> {
  const at = splitRemoteRef(name, repo.remotes.map((x) => x.name));
  const info = await infoOf(root, "remote", name);
  if (!info) return false;
  if (!at) {
    toast(`"${name}" is not a branch on a remote of this repository.`, "error", 6000);
    return false;
  }
  if (info.defaultBranch) {
    toast(`${at.branch} is ${at.remote}'s default branch.`, "info", 5000);
    return false;
  }
  const q = remoteDeleteQuestion(at.remote, at.branch, repo.remotes.find((x) => x.name === at.remote)?.url, info.unmerged);
  if (!(await choose(q.title, q.text, q.choices, false))) return false;
  const r = await busyRun(`Deleting ${name}…`, () => git.pushRef(root, "delete", name));
  if (!r.ok) {
    fail(r.error);
    return false;
  }
  done({ what: "remote-deleted", result: r.value }, r.value.gone ? "info" : "success");
  return true;
}

async function deleteTag(root: string, name: string): Promise<boolean> {
  const info = await infoOf(root, "tag", name);
  if (!info) return false;
  const q = tagDeleteQuestion(name, info.sha);
  if (!(await choose(q.title, q.text, q.choices, false))) return false;
  const r = await busyRun(`Deleting ${name}…`, () => git.refAction(root, "tag-delete", name));
  if (!r.ok) {
    fail(r.error);
    return false;
  }
  done({ what: "tag-deleted", name, was: r.value });
  return true;
}

async function pushTag(root: string, repo: GitStatus, name: string): Promise<boolean> {
  const to = defaultRemote(repo.remotes.map((x) => x.name));
  if (!to) return noRemote();
  const r = await busyRun(`Pushing ${name}…`, () => git.pushRef(root, "tag", name));
  if (r.ok) {
    done({ what: "tag-pushed", name, result: r.value }, r.value.upToDate ? "info" : "success");
    return true;
  }
  if (tagRejected(r.error)) toast(tagRejectedText(to, name, gitErrorText(r.error)), "error", 12000);
  else fail(r.error);
  return false;
}

export type RefActionKind = "branch-delete" | "branch-rename" | "upstream-set" | "upstream-unset" | "branch-push" | "remote-branch-delete" | "tag-delete" | "tag-push";

/**
 * Run a housekeeping action on a ref of the repository at `root`: asks where the spec asks (every
 * delete; twice for a branch with commits found nowhere else), runs, says what happened, refreshes
 * the status and reloads open graphs. `arg`: the new name (rename) or the remote branch
 * (upstream-set). True when it was done.
 */
export async function refAction(root: string, kind: RefActionKind, name: string, arg?: string): Promise<boolean> {
  const g = useGit.getState();
  const repo = g.repos[key(root)];
  if (!repo || !name) return false;
  if (g.busy) {
    toast("Another git action is running.", "info", 3000);
    return false;
  }
  switch (kind) {
    case "branch-delete":
      return deleteBranch(root, name);
    case "branch-rename":
      return renameBranch(root, repo, name, arg ?? "");
    case "upstream-set":
      return arg ? setUpstream(root, name, arg) : false;
    case "upstream-unset":
      return setUpstream(root, name, null);
    case "branch-push":
      return pushBranch(root, repo, name);
    case "remote-branch-delete":
      return deleteRemoteBranch(root, repo, name);
    case "tag-delete":
      return deleteTag(root, name);
    case "tag-push":
      return pushTag(root, repo, name);
  }
}

// ---------- the commands ----------

export type RefCommandId = "git.deleteBranch" | "git.renameBranch" | "git.setUpstream" | "git.pushBranch" | "git.deleteRemoteBranch" | "git.deleteTag" | "git.pushTag";

export interface RefArgs {
  /** The branch or tag (`origin/topic` for a remote branch); without it the picker asks. */
  name?: string;
  /** The repository, when it is not the current one (an action started in a graph tab). */
  root?: string;
  /** `git.renameBranch`: the new name; without it the picker asks. */
  to?: string;
  /** `git.setUpstream`: the remote branch to track, or null to stop tracking; without it the picker asks. */
  upstream?: string | null;
}

/** A command's argument: `{ name, root, to, upstream }`, or just the name. Pure. */
export function refArgs(args: unknown): RefArgs {
  if (typeof args === "string") return args.trim() ? { name: args.trim() } : {};
  if (!args || typeof args !== "object") return {};
  const a = args as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  return { name: text(a.name), root: text(a.root), to: text(a.to), upstream: a.upstream === null ? null : text(a.upstream) };
}

/** The repository a housekeeping command acts on: the one named by `{ root }`, else the current one. */
export function refRepo(args?: unknown): GitStatus | null {
  const root = refArgs(args).root;
  return root ? (useGit.getState().repos[key(root)] ?? null) : currentRepo();
}

/**
 * What the seven commands run. With a target the action starts (through `refAction`); without one
 * the branch picker opens to choose it, and the picked row runs the same command with the name.
 * Returns false when there is no repository (the command then does nothing).
 */
export function refCommand(id: RefCommandId, args?: unknown): boolean {
  const a = refArgs(args);
  const repo = refRepo(args);
  if (!repo) return false;
  const root = repo.root;
  const from = a.root ? { root } : {};
  const remotes = repo.remotes.map((x) => x.name);
  const pick = (purpose: Parameters<typeof pickBranch>[0], extra: { target?: string; remote?: string | null } = {}) => void pickBranch(purpose, { command: id, ...from, ...extra });
  switch (id) {
    case "git.deleteBranch":
      if (a.name) void refAction(root, "branch-delete", a.name);
      else pick("delete-branch");
      return true;
    case "git.renameBranch":
      if (!a.name) pick("local-branch");
      else if (a.to === undefined) pick("new-name", { target: a.name });
      else void refAction(root, "branch-rename", a.name, a.to);
      return true;
    case "git.setUpstream":
      if (!remotes.length) noRemote();
      else if (!a.name) pick("local-branch");
      else if (a.upstream === undefined) pick("upstream", { target: a.name });
      else void refAction(root, a.upstream === null ? "upstream-unset" : "upstream-set", a.name, a.upstream ?? undefined);
      return true;
    case "git.pushBranch":
      if (!remotes.length) noRemote();
      else if (a.name) void refAction(root, "branch-push", a.name);
      else pick("local-branch");
      return true;
    case "git.deleteRemoteBranch":
      if (a.name) void refAction(root, "remote-branch-delete", a.name);
      else pick("remote-branch");
      return true;
    case "git.deleteTag":
      if (a.name) void refAction(root, "tag-delete", a.name);
      else pick("tag");
      return true;
    case "git.pushTag":
      if (!remotes.length) noRemote();
      else if (a.name) void refAction(root, "tag-push", a.name);
      else pick("tag", { remote: defaultRemote(remotes) });
      return true;
  }
}

/** Copy Branch Name / Copy Tag Name. */
export function copyRefName(name: string, tag = false) {
  void writeText(name).then(() => toast(tag ? "Copied the tag name" : "Copied the branch name", "success", 1500), () => {});
}
