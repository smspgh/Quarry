/**
 * Git integration: which open folder / documents are in a repository and their status (for the
 * Explorer, the status bar and the Source Control panel), the HEAD text behind the editor's change
 * markers, line blame, and the actions (stage, commit, branches, pull / push, history). The git
 * work itself is Rust (src-tauri/src/git.rs and its submodules in src-tauri/src/git/, wrappers
 * in gitApi.ts); see editor/git.ts for the editor side.
 */
import { Text } from "@codemirror/state";
import { create } from "zustand";
import { editor } from "../editor/manager";
import { setBlame, setGitBase } from "../editor/git";
import { setConflictHooks } from "../editor/conflicts";
import type { ConflictBlock } from "./conflicts";
import type { EditorView } from "@codemirror/view";
import { git, type GitBranch, type GitCommitAction, type GitCommitFile, type GitFile, type GitLogEntry, type GitIdentity, type GitRemoteOp, type GitStatus, type GithubRepo } from "./gitApi";
import { newDocId, useStore, type Doc } from "./store";
import { markPickerStep } from "./macros";
import { fs } from "./ipc";
import { displayUrl, gitErrorText, hasConflictMarkers, isMissingRepo, KIND_RANK, kindOf, operationDone, operationStoppedAgain, operationWords, STOPPED_AGAIN, type GitKind } from "./gitStatus";

export { isMissingRepo, KIND_LABEL, KIND_LETTER, kindOf, type GitKind } from "./gitStatus";
import { choose } from "./dialogs";
import { showPanel } from "./panels";
// Start a merge or rebase, force push (specs/git-merge-rebase.md): the actions are at the end of this file.
import type { GitForcePushPreview, GitMergePreview } from "./gitApi";
import { dirtyRefusal, forcePushBlocked, forcePushConfirm, forcePushDone, isRewritten, mergeConfirm, mergeDone, rebaseConfirm, rebaseDone, startBlocked, trackedChanges, type StartKind, type StartTarget } from "./gitMerge";
import type { BranchPurpose } from "./gitRefs";
import type { GitStash } from "./gitApi";
import { dropConfirm, dropOffer, isStashConflict, STASH_CONFLICT, stashBlocked, stashConflictWarning, stashCounts, stashDone, stashErrorText, stashTitle } from "./gitStash";
import { relativeTime } from "../editor/git";
// Compare commits (specs/git-compare-commits.md): the actions are at the end of this file.
import { sideLabel } from "./gitCompare";
// Branch and tag housekeeping (specs/git-branches.md): the actions are in gitRefActions.ts.
import type { GitRefInfo, GitTag } from "./gitApi";
import type { BranchPickFor } from "./gitBranches";
// Edit History (specs/git-history-edit.md): the actions are at the end of this file.
import type { GitHistoryCommit, GitHistoryRange } from "./gitApi";
// Unsaved tabs and file-rewriting operations (specs/git-safety.md): `guard` / `rewrite` below.
import { discardText, localName, lostEditsSentence, type RiskTab, type SafetyOp } from "./gitSafety";
import { guardUnsaved, noTabs, riskTabs, riskTabsOf, withTabs, type Guarded } from "./gitTabs";
import { allPushed, defaultBase, editAllowed, historyConfirm, historyDone, MAX_PLAN, MOVED, movedText, planTodo, rangeEditContext, singlePlan, tooMany, type EditAction, type HistoryInfo, type HistoryKind, type PlanRow, type PlanTodo } from "./historyEdit";

export interface FileHistory {
  path: string;
  entries: GitLogEntry[];
  more: boolean;
  loading: boolean;
}

interface GitState {
  /** git can run (null until checked). */
  available: boolean | null;
  /** Status per repository, keyed by lower-case root. */
  repos: Record<string, GitStatus>;
  /** Why git could not read a place in view that is not under a known repository (for example
   *  "dubious ownership"). Not cached: the next refresh asks again. */
  statusErrors: { path: string; error: string }[];
  /** The repository the Source Control panel shows (lower-case root). */
  current: string | null;
  /** Lower-case path → status of changed files (all repositories). */
  files: Record<string, GitFile>;
  /** Lower-case folder → the strongest change inside it (Explorer folder colours). */
  dirs: Record<string, GitKind>;
  /** A pull / push / fetch / commit / checkout in progress, shown in the panel and status bar. */
  busy: string | null;
  /** Show who last changed the cursor line, at its end. */
  blameOn: boolean;
  /** File History section of the Source Control panel. */
  history: FileHistory | null;
  /** Branches for the branch picker (loaded when it opens). */
  branches: GitBranch[] | null;
  /** The Source Control panel shows its Add Remote form (also shown while a repository has none). */
  addingRemote: boolean;
  /** Who commits are made as in the panel's repository (`loadIdentity`). */
  identity: (GitIdentity & { root: string }) | null;
  /** GitHub accounts Git Credential Manager knows, and the one new repositories go to; null until
   *  loaded or without GCM (`loadGithub`). */
  github: { accounts: string[]; chosen: string | null } | null;
  /** GitHub repositories of remote URLs (for the Private / Public badge); null = can't be seen. */
  remoteInfo: Record<string, GithubRepo | null>;
  /** Background checks of each repository's remote (lower-case root): when it last ran, whether one
   *  is running, and why the last one failed. */
  remoteCheck: Record<string, { at: number; checking: boolean; error: string | null }>;
  /** The remote whose Change form is open in the panel, and which choice it starts on. */
  editRemote: { name: string; how: "github" | "url" } | null;
  /** Why the branch picker is open (`pickBranch(purpose)`): sets its prompt, rows and the command a row runs. */
  branchPick: BranchPurpose;
  /** Branches on which Quarry rewrote commits that were already pushed (lower-case root → branch);
   *  the status line then offers Force Push. In memory only; pruned by `pruneRewritten`. */
  rewrotePushed: Record<string, string>;
  // ---- stash ----
  /** Stashes per repository (lower-case root), newest first; reloaded when the status's stash id / count changes. */
  stashes: Record<string, GitStash[]>;
  /** The Stashes section shows its Stash Changes form. */
  stashForm: boolean;
  /** Bumped by Show Stashes: the section opens and focuses its first row. */
  stashReveal: number;
  /** A stash that came back with conflicts (git records nothing for it, so Quarry remembers it here,
   *  in memory only): its row is marked, and for a pop the drop is offered once the files are resolved. */
  stashPending: { root: string; sha: string; title: string; pop: boolean } | null;
  // ---- branch and tag housekeeping (specs/git-branches.md) ----
  /** What the picker was opened for beside its purpose: the command a row runs, the branch it is about. */
  branchPickFor: BranchPickFor | null;
  /** Bumped each time the picker is opened (it may reopen for a second question without closing). */
  branchPickSeq: number;
  /** Tags for the picker's `tag` purpose (loaded when it opens). */
  tags: GitTag[] | null;
  /** Per repository (lower-case root): each branch's upstream and each remote's default branch, for the ref menus. */
  refInfo: Record<string, GitRefInfo>;
  /** Bumped after every branch / tag action: open graphs reload (refs do not change the status). */
  refsTick: number;
  // ---- Edit History (specs/git-history-edit.md) ----
  /** The Edit History list a graph tab shows in place of its rows (`openHistoryEdit`): the commits
   *  it opened with. `seq` changes with every opening. In memory only. */
  historyEdit: { root: string; range: GitHistoryRange; seq: number } | null;
  /** The message of the commit Undo Last Commit just took back: the commit box takes it when it is empty. */
  undone: { root: string; message: string } | null;
}

export const useGit = create<GitState>(() => ({
  available: null,
  repos: {},
  statusErrors: [],
  current: null,
  files: {},
  dirs: {},
  busy: null,
  blameOn: false,
  history: null,
  branches: null,
  addingRemote: false,
  identity: null,
  github: null,
  remoteInfo: {},
  remoteCheck: {},
  editRemote: null,
  branchPick: "switch",
  rewrotePushed: {},
  // stash
  stashes: {},
  stashForm: false,
  stashReveal: 0,
  stashPending: null,
  // branch and tag housekeeping
  branchPickFor: null,
  branchPickSeq: 0,
  tags: null,
  refInfo: {},
  refsTick: 0,
  // Edit History
  historyEdit: null,
  undone: null,
}));

const key = (p: string) => p.toLowerCase();
const parentOf = (p: string) => {
  const i = p.lastIndexOf("\\");
  return i > 0 ? p.slice(0, i) : p;
};
const under = (path: string, root: string) => {
  const p = key(path);
  const r = key(root);
  return p === r || p.startsWith(r.endsWith("\\") ? r : r + "\\");
};

/** Status of one file (null when unchanged or not in a repository). */
export function fileStatus(path: string | null | undefined): GitFile | null {
  return path ? (useGit.getState().files[key(path)] ?? null) : null;
}

/** The repository a path belongs to (of those known), deepest first. */
export function repoOf(path: string | null | undefined): GitStatus | null {
  if (!path) return null;
  let best: GitStatus | null = null;
  for (const r of Object.values(useGit.getState().repos)) if (under(path, r.root) && (!best || r.root.length > best.root.length)) best = r;
  return best;
}

/** The repository the Source Control panel and status bar show. */
export function currentRepo(s: GitState = useGit.getState()): GitStatus | null {
  if (s.current) return s.repos[s.current] ?? null;
  // Nothing chosen: with a folder open that is not in a repository, show none (not some open
  // file's repository); with no folder open, the first repository known.
  return useStore.getState().folder ? null : Object.values(s.repos)[0] ?? null;
}

// ---------- status ----------

/** Folders known not to be in a repository (so they aren't asked again). */
const notRepo = new Set<string>();

/** A newly opened folder whose repository the panel switches to once a refresh has looked at that
 *  folder (a refresh already running when the folder changed has not). */
let followFolder: string | null = null;
/** A folder chosen with Set as Source Control Context: kept in view until another folder opens. */
let contextPlace: string | null = null;

function interesting(): string[] {
  const s = useStore.getState();
  const out: string[] = [];
  if (s.folder) out.push(s.folder);
  if (contextPlace) out.push(contextPlace);
  for (const d of s.docs) if (d.path && (d.kind === "text" || d.kind === "big")) out.push(parentOf(d.path));
  // An open graph tab keeps its repository known (its menus need the status), whatever folder is open.
  for (const d of s.docs) if (d.kind === "graph" && d.graph?.root) out.push(d.graph.root);
  return out;
}

let refreshTimer = 0;
let refreshing: Promise<void> | null = null;
let again = false;

/** Re-read the status of every repository in view (debounced). */
export function refreshGit(delay = 250) {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    if (refreshing) {
      again = true;
      return;
    }
    refreshing = doRefresh().finally(() => {
      refreshing = null;
      if (again) {
        again = false;
        refreshGit(0);
      }
    });
  }, delay);
}

async function doRefresh() {
  const g = useGit.getState();
  if (g.available === null) useGit.setState({ available: (await git.available().catch(() => null)) !== null });
  if (!useGit.getState().available) return;
  const startFolder = useStore.getState().folder;
  const want = interesting();
  // Known repositories still in view, plus a lookup for each place not under one yet.
  const roots = Object.values(useGit.getState().repos)
    .map((r) => r.root)
    .filter((root) => want.some((p) => under(p, root) || under(root, p)));
  const lookups = want.filter((p) => !roots.some((r) => under(p, r)) && !notRepo.has(key(p)));
  const prev = useGit.getState().repos;
  const results = await Promise.all(
    [...roots, ...new Set(lookups)].map((p) =>
      git
        .status(p)
        .then((st) => ({ p, st, error: null as string | null }))
        .catch((e) => ({ p, st: null, error: String(e) })),
    ),
  );
  const repos: Record<string, GitStatus> = {};
  const statusErrors: GitState["statusErrors"] = [];
  for (const { p, st, error } of results) {
    if (st) repos[key(st.root)] = st;
    else if (error === null) notRepo.add(key(p)); // git answered: not a repository
    // git failed (dubious ownership, a lock, ...): keep a known repository's last status, and
    // report a new place instead of remembering it as "not a repository".
    else if (prev[key(p)]) repos[key(p)] = prev[key(p)];
    else statusErrors.push({ path: p, error });
  }
  const files: Record<string, GitFile> = {};
  const dirs: Record<string, GitKind> = {};
  for (const r of Object.values(repos)) {
    for (const f of r.files) {
      files[key(f.path)] = f;
      const kind = kindOf(f);
      // Every folder from the file's up to the repository root.
      let d = parentOf(f.path);
      while (under(d, r.root)) {
        const k = key(d);
        if (!dirs[k] || KIND_RANK[kind] > KIND_RANK[dirs[k]]) dirs[k] = kind;
        const up = parentOf(d);
        if (k === key(r.root) || up === d) break;
        d = up;
      }
    }
  }
  const cur = useGit.getState().current;
  const folder = useStore.getState().folder;
  let current: string | null;
  if (followFolder !== null) {
    // The open folder changed: show its repository (or none), never the previous folder's.
    current = folder === startFolder && followFolder === folder ? (repoKeyOf(repos, folder) ?? null) : null;
    if (folder === startFolder && followFolder === folder) followFolder = null;
  } else if (cur && repos[cur]) current = cur;
  else current = folder ? (repoKeyOf(repos, folder) ?? null) : (Object.keys(repos)[0] ?? null);
  useGit.setState({ repos, statusErrors, files, dirs, current });
  stashAfterRefresh(repos);
  void syncBases();
}

/** Key of the deepest repository in `repos` holding `path`. Pure. */
function repoKeyOf(repos: Record<string, GitStatus>, path: string): string | undefined {
  let best: string | undefined;
  for (const [k, r] of Object.entries(repos)) if (under(path, r.root) && (!best || r.root.length > repos[best].root.length)) best = k;
  return best;
}

/** The open folder changed: the Source Control panel moves to its repository (or to none). */
export function followOpenFolder(folder: string | null) {
  followFolder = folder;
  contextPlace = null;
  useGit.setState({ current: null });
  rescanGit();
}

/** Make the repository holding `path` (a folder) the one Source Control shows, and open the panel. */
export async function setSourceControlContext(path: string) {
  if (useGit.getState().available === false) {
    toast("Git was not found. Install Git for Windows and make sure git is on PATH.", "error", 6000);
    return;
  }
  let st: GitStatus | null;
  try {
    st = await git.status(path);
  } catch (e) {
    toast(`Git could not read ${path}:
${gitErrorText(String(e))}`, "error", 8000);
    return;
  }
  if (!st) {
    toast(`${nameOf(path)} is not in a git repository.`, "info");
    return;
  }
  const status = st;
  contextPlace = path;
  followFolder = null;
  const k = key(status.root);
  useGit.setState((g) => ({ repos: { ...g.repos, [k]: status }, current: k }));
  showPanel("git");
  refreshGit(0);
}

/** Forget the "not a repository" answers (a folder may have become one: git init, clone), and
 *  look for git again if it wasn't found (it may have been installed since). */
export function rescanGit() {
  notRepo.clear();
  if (useGit.getState().available === false) useGit.setState({ available: null });
  refreshGit(0);
}

// ---------- change markers ----------

/** HEAD sha each document's markers were computed against (so they are refetched after a commit). */
const baseHead = new Map<string, string>();

async function syncBases() {
  const s = useStore.getState();
  for (const d of s.docs) if (d.kind === "text") void syncBase(d);
}

async function syncBase(d: Doc) {
  const repo = repoOf(d.path);
  const f = fileStatus(d.path);
  const want = repo?.head && !f?.untracked && !(f && f.index === "A") ? `${repo.head}` : "";
  if ((baseHead.get(d.id) ?? "") === want) return;
  baseHead.set(d.id, want);
  if (!want || !d.path) {
    editor.effectsTo(d.id, [setGitBase.of(null)]);
    return;
  }
  const blob = await git.show(d.path, "HEAD").catch(() => null);
  if (baseHead.get(d.id) !== want) return; // superseded
  const base = blob && !blob.binary ? Text.of(blob.text.split(/\r\n?|\n/)) : null;
  editor.effectsTo(d.id, [setGitBase.of(base)]);
}

// ---------- blame ----------

let blameTimer = 0;
let blameSeq = 0;

function blameSoon(delay = 600) {
  window.clearTimeout(blameTimer);
  if (!useGit.getState().blameOn) return;
  blameTimer = window.setTimeout(() => void blameNow(), delay);
}

async function blameNow() {
  const s = useStore.getState();
  const doc = s.docs.find((d) => d.id === editor.currentDocId);
  if (!doc?.path || !repoOf(doc.path) || fileStatus(doc.path)?.untracked) return;
  const seq = ++blameSeq;
  const text = editor.textOf(doc.id);
  const blame = await git.blame(doc.path, text, doc.encoding, doc.eol).catch(() => null);
  if (seq !== blameSeq || editor.textOf(doc.id) !== text) return;
  editor.effectsTo(doc.id, [setBlame.of(blame)]);
}

export function toggleBlame() {
  const on = !useGit.getState().blameOn;
  useGit.setState({ blameOn: on });
  if (on) blameSoon(0);
  else for (const d of useStore.getState().docs) if (d.kind === "text") editor.effectsTo(d.id, [setBlame.of(null)]);
}

// ---------- start-up ----------

export function installGit(): () => void {
  refreshGit(0);
  setConflictHooks({
    cleared: (view) => void conflictsCleared(view),
    compare: (view, block, n) => void compareSides(view, block, n),
    // In a rebase the sides are the reverse of what people expect: say which is which.
    note: () => {
      const repo = currentRepo();
      const op = repo?.operation;
      // Stash: conflicts with no operation in progress come from a stash that was applied or popped.
      if (repo && isStashConflict(repo)) return STASH_CONFLICT.sidesNote;
      return op ? operationWords(op).sidesNote : "";
    },
  });
  const unsub = useStore.subscribe((s, prev) => {
    if (s.folder !== prev.folder) followOpenFolder(s.folder); // the panel follows the newly opened folder
    else if (s.docs !== prev.docs) {
      // A save (dirty → clean), a new tab, a closed tab.
      const saved = s.docs.some((d) => !d.dirty && prev.docs.find((p) => p.id === d.id)?.dirty);
      if (saved || s.docs.length !== prev.docs.length || s.docs.some((d, i) => d.path !== prev.docs[i]?.path)) refreshGit();
      for (const p of prev.docs) if (!s.docs.some((d) => d.id === p.id)) baseHead.delete(p.id);
      if (saved) blameSoon(0);
    }
    if (s.activeId !== prev.activeId || s.split !== prev.split) blameSoon(0);
  });
  const offEdit = editor.onDocUpdate((id, u) => {
    if (u.docChanged && id === editor.currentDocId) blameSoon(1500);
  });
  const onFocus = () => refreshGit(0);
  window.addEventListener("focus", onFocus);
  let unChanged: (() => void) | null = null;
  void fs.onChanged(() => refreshGit(400)).then((u) => (unChanged = u));
  return () => {
    unsub();
    offEdit();
    window.removeEventListener("focus", onFocus);
    unChanged?.();
  };
}

// ---------- actions ----------

const toast = (m: string, kind: "info" | "success" | "error" | "warning" = "info", ms?: number) => useStore.getState().toast(m, kind, ms);

/** Run a git action with a busy label; errors become a toast. True when it worked. */
async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  useGit.setState({ busy: label });
  try {
    return await fn();
  } catch (e) {
    toast(gitErrorText(String(e)), "error", 12000);
    return undefined;
  } finally {
    useGit.setState({ busy: null });
    refreshGit(0);
    afterAction?.(); // partial staging: open Source Control comparisons follow the index
  }
}

// Partial staging (lib/gitStaging.ts, specs/git-staging.md) registers here to refresh its
// comparisons after every git action, without git.ts importing it.
let afterAction: (() => void) | null = null;
export function onGitAction(fn: () => void) {
  afterAction = fn;
}

// ---------- open tabs and operations that rewrite files (specs/git-safety.md) ----------
// Every action below that can rewrite files in the folder goes through these two, inside the
// action function, so no button, menu, palette row, shortcut or macro can get around them:
// `guard` asks about the repository's unsaved tabs before git runs (Save All / Continue Without
// Saving / Cancel; null = do not run), `rewrite` runs the git call and afterwards brings every
// open tab in line with the disk, also when git stopped on a conflict or failed.

const repoRoots = () => Object.values(useGit.getState().repos).map((r) => r.root);
const guard = (root: string, op: SafetyOp): Promise<Guarded | null> => guardUnsaved(root, op, repoRoots());
const rewrite = <T>(g: Guarded, label: string, fn: () => Promise<T>): Promise<T | undefined> => withTabs(g, () => run(label, fn));

/** The repository's files with unsaved edits in open tabs (for a confirmation that names them). */
export const unsavedTabs = (root: string): Promise<RiskTab[]> => riskTabs(root, repoRoots());

/**
 * The unsaved-tabs question for an operation that only starts from a clean state (merge, rebase,
 * history edits that replay commits), asked after its clean-state check and before its own
 * confirmation. Save All turns the edits into uncommitted changes, so the clean-state check runs
 * again and refuses with "Commit or discard your changes first"; Continue Without Saving goes on.
 */
async function cleanGuard(root: string, op: SafetyOp, refusal: Parameters<typeof dirtyRefusal>[0]): Promise<Guarded | null> {
  const g = await guard(root, op);
  if (!g || !g.saved || mergeWithChanges(refusal)) return g;
  const st = await git.status(root).catch(() => null);
  const dirty = st ? trackedChanges(st) : 0;
  if (!dirty) return g;
  refreshGit(0);
  const d = dirtyRefusal(refusal, dirty);
  if (await choose(d.title, d.text, d.choices, false)) showPanel("git");
  return null;
}

export const stage = (root: string, paths: string[]) => run("Staging…", () => git.stage(root, paths));
/**
 * Mark conflicted files as resolved (stage them). A file that still contains git's conflict
 * markers is almost certainly not resolved: ask before staging those.
 */
export async function resolveConflicts(root: string, paths: string[]) {
  // What gets staged is the file on disk: save open tabs of these files first.
  for (const p of paths) {
    const open = useStore.getState().docs.find((d) => d.kind === "text" && d.dirty && d.path && key(d.path) === key(p));
    if (open) {
      const { saveDocument } = await import("./actions");
      if (!(await saveDocument(open.id))) return;
    }
  }
  const marked: string[] = [];
  for (const p of paths) {
    try {
      if (hasConflictMarkers((await fs.readText(p)).content)) marked.push(p);
    } catch {
      /* deleted on one side, binary, or too large to read as text: nothing to check */
    }
  }
  if (marked.length) {
    const names = marked.slice(0, 5).map(nameOf).join(", ") + (marked.length > 5 ? `, and ${marked.length - 5} more` : "");
    const ok = await choose(
      "Conflict markers are still in the file",
      `${names} still ${marked.length === 1 ? "contains" : "contain"} the <<<<<<< / ======= / >>>>>>> lines git puts around a conflict. Marking ${marked.length === 1 ? "it" : "them"} resolved would commit those lines as they are.`,
      [
        { label: "Mark Resolved Anyway", kind: "danger", value: true },
        { label: "Cancel", cancel: true, default: true, value: false },
      ],
      false,
    );
    if (!ok) return;
  }
  await stage(root, paths);
}

/**
 * Resolve a conflicted file by taking one side whole: "ours" is the branch you are on (Current),
 * "theirs" what is being merged or picked in (Incoming). An open tab of it is reloaded.
 */
export async function takeSide(root: string, f: GitFile, side: "ours" | "theirs") {
  const name = nameOf(f.path);
  // A text tab, a large-file tab or the edited file side of a Compare tab.
  const open = await riskTabsOf([f.path], root);
  if (open.length) {
    const ok = await choose(
      `Replace your edits to ${name}?`,
      `${name} has unsaved changes in its tab. Taking ${side === "ours" ? "the current" : "the incoming"} version replaces the file and discards them.`,
      [
        { label: "Replace", kind: "danger", value: true },
        { label: "Cancel", cancel: true, default: true, value: false },
      ],
      false,
    );
    if (!ok) return;
  }
  // Confirming was the answer: the file's tabs reload without a second question, and close when
  // the side taken had deleted the file.
  const g = noTabs(root, { kind: "take-side" }, open);
  const out = await rewrite(g, "Resolving…", () =>
    git.resolveSide(root, f.path, side).then((r) => {
      if (r === "deleted") g.closeGone.push(f.path);
      return r;
    }),
  );
  if (out === undefined) return;
  const which = side === "ours" ? "current" : "incoming";
  toast(out === "deleted" ? `${name}: deleted (the ${which} side had deleted it).` : `${name}: took the ${which} version.`, "success", 3500);
}

/** The conflict bar's Compare: the two sides of one conflict in a (reused) Compare tab. */
async function compareSides(view: EditorView, block: ConflictBlock, n: number) {
  const st = useStore.getState();
  const doc = st.docs.find((d) => d.kind === "text" && editor.viewOf(d.id) === view) ?? st.docs.find((d) => d.id === st.activeId);
  const name = doc ? doc.name : "conflict";
  const text = (from: number, to: number) => {
    const lines: string[] = [];
    for (let l = from; l < to; l++) lines.push(view.state.doc.line(l + 1).text);
    return lines.join("\n");
  };
  const { openCompare } = await import("./diff");
  await openCompare(
    { kind: "text", label: `${name} · conflict ${n} · current`, text: text(block.start + 1, block.base ?? block.mid) },
    { kind: "text", label: `${name} · conflict ${n} · incoming`, text: text(block.mid + 1, block.end) },
    { preview: true },
  );
}

/**
 * Carry on with a stopped operation once its conflicts are resolved, or skip the commit it
 * stopped on. A rebase may stop again on its next commit; the message then says so.
 */
export async function continueOperation(root: string, operation: string, how: "continue" | "skip") {
  const { askDialog } = await import("./actions");
  const w = operationWords(operation);
  if (how === "skip") {
    const ok = await askDialog(`Skip this ${w.item}?`, `The ${w.item} ${w.noun} stopped on is left out: its changes will not be on the branch. ${w.noun[0].toUpperCase()}${w.noun.slice(1)} then carries on with the rest.`, `Skip ${w.item[0].toUpperCase()}${w.item.slice(1)}`);
    if (!ok) return;
  }
  // Its own confirmation first, the unsaved-tabs question second (SAFE-003.9).
  const g = await guard(root, { kind: "continue", noun: w.noun });
  if (!g) return;
  const out = await rewrite(g, how === "skip" ? "Skipping…" : "Continuing…", () => git.continueOp(root, how));
  if (out === undefined) return;
  if (out.endsWith(STOPPED_AGAIN)) {
    // It went on and stopped on a conflict in the next step: say so, and show where to resolve it.
    toast(operationStoppedAgain(out.slice(0, -STOPPED_AGAIN.length) || operation, how), "info", 5000);
    showPanel("git");
    return;
  }
  // Status is refreshed by run(); a rebase that is still going shows its next step there.
  const still = await git.status(root).catch(() => null);
  toast(operationDone(out || operation, how, !!still?.operation), "success", 3500);
  rewriteContinued(root, still); // a rebase of pushed commits that finished this way (MERGE-009)
}

/** The last conflict of a document was just resolved in the editor: offer to finish the file. */
export async function conflictsCleared(view: EditorView) {
  const st = useStore.getState();
  const doc = st.docs.find((d) => d.kind === "text" && editor.viewOf(d.id) === view) ?? st.docs.find((d) => d.id === st.activeId);
  if (!doc?.path) return;
  const known = repoOf(doc.path);
  const listed = (r: GitStatus | null) => !!r?.files.some((f) => f.conflicted && key(f.path) === key(doc.path!));
  if (!known || !listed(known)) return;
  // The markers also go when the tab reloads after an Abort or after taking one side of the whole
  // file, and the reload comes before the status in the store is refreshed: ask git itself, so the
  // offer is only made for a file that is still in conflict.
  const repo = await git.status(known.root).catch(() => known);
  if (!repo || !listed(repo)) return;
  const name = nameOf(doc.path);
  const left = repo.files.filter((f) => f.conflicted).length - 1;
  const ok = await choose(
    `No conflicts left in ${name}`,
    `Save ${name} and mark it resolved?${left > 0 ? ` ${left} other file${left === 1 ? " still has" : "s still have"} conflicts.` : repo.operation && operationWords(repo.operation).continueLabel ? ` It is the last file: after this, ${operationWords(repo.operation).continueLabel} carries on.` : repo.operation ? " It is the last file: after this you can commit to finish." : ` ${stashLastFile(repo.root)}`}\n\nYou can keep editing instead, and mark it resolved later with + under Merge Changes.`,
    [
      { label: "Save and Mark Resolved", kind: "primary", default: true, value: true },
      { label: "Keep Editing", cancel: true, value: false },
    ],
    false,
  );
  if (ok) await resolveConflicts(repo.root, [doc.path]);
}

export const unstage = (root: string, paths: string[]) => run("Unstaging…", () => git.unstage(root, paths));

export async function discard(root: string, files: GitFile[]): Promise<void> {
  if (!files.length) return;
  const untracked = files.filter((f) => f.untracked);
  const name = files.length === 1 ? files[0].path.slice(files[0].path.lastIndexOf("\\") + 1) : `${files.length} files`;
  // Unsaved edits in the tabs of these files go too: the one question says so (SAFE-004).
  const open = await riskTabsOf(files.map((f) => f.path), root);
  const ok = await choose("Discard changes?", discardText(name, files.length, untracked.length, open), [
    { label: "Discard", kind: "danger", value: true },
    { label: "Cancel", cancel: true, default: true, value: false },
  ], false);
  if (!ok) return;
  // Confirming was the answer: those tabs reload without a "changed on disk" question, and the
  // tab of an untracked file that went to the Recycle Bin closes.
  const g = noTabs(root, { kind: "discard" }, open);
  g.closeGone = untracked.map((f) => f.path);
  await rewrite(g, "Discarding…", () => git.discard(root, files.map((f) => f.path)));
}

/** Commit what is staged (or, after asking, every change when nothing is). */
export async function commit(root: string, message: string, amend = false): Promise<boolean> {
  const repo = useGit.getState().repos[key(root)];
  if (!message.trim() && !amend) {
    toast("Write a commit message first.", "info");
    return false;
  }
  // Never with conflicts left: git refuses anyway, and its message is less clear than this one.
  const conflicts = repo?.files.filter((f) => f.conflicted).length ?? 0;
  if (conflicts) {
    toast(`${conflicts} file${conflicts === 1 ? " still has" : "s still have"} conflicts. Resolve ${conflicts === 1 ? "it" : "them"} under Merge Changes (then mark ${conflicts === 1 ? "it" : "each"} resolved with +)${repo?.operation ? ", or abort" : ""}.`, "warning", 7000);
    return false;
  }
  const staged = repo?.files.filter((f) => !f.untracked && f.index !== "." && !f.conflicted) ?? [];
  if (!amend && staged.length === 0) {
    const changed = repo?.files.filter((f) => !f.conflicted) ?? [];
    // A merge whose resolution left the files as they were still needs its commit: git says "All
    // conflicts fixed but you are still merging", and Abort would throw the resolution away.
    if (!changed.length && repo?.operation !== "merge") {
      toast("There is nothing to commit.", "info");
      return false;
    }
    if (changed.length) {
      const all = await choose("Nothing is staged", `Stage all ${changed.length} changed file${changed.length === 1 ? "" : "s"} and commit them?`, [
        { label: "Stage All and Commit", kind: "primary", default: true, value: true },
        { label: "Cancel", cancel: true, value: false },
      ], false);
      if (!all) return false;
      if ((await stage(root, changed.map((f) => f.path))) === undefined) return false;
    }
  }
  const dirty = useStore.getState().docs.filter((d) => d.dirty && d.path && under(d.path, root));
  if (dirty.length) toast(`${dirty.length} open file${dirty.length === 1 ? " has" : "s have"} unsaved changes that are not in this commit.`, "warning", 6000);
  const r = await run(amend ? "Amending…" : "Committing…", () => git.commit(root, message, amend));
  if (r) toast(`Committed ${r.sha}: ${r.summary}`, "success", 4000);
  return !!r;
}

export async function remote(root: string, op: GitRemoteOp) {
  if (!useGit.getState().repos[key(root)]?.remotes.length) {
    // Nothing to talk to yet: the panel's Add Remote form explains and offers Add and Push.
    showAddRemote();
    toast("This repository has no remote yet. Add one in Source Control.", "info", 4000);
    return;
  }
  const pull = op.startsWith("pull");
  const label = op === "fetch" ? "Fetching…" : pull ? "Pulling…" : "Pushing…";
  let failure: string | null = null;
  // A pull can rewrite any file: it always asks when the repository has unsaved tabs, and the
  // tabs are checked afterwards whether it worked, stopped on a conflict or failed.
  const g = pull ? await guard(root, { kind: "pull" }) : null;
  if (pull && !g) return;
  const call = () =>
    git.remote(root, op).catch((e) => {
      failure = String(e);
      throw e;
    });
  const out = g ? await rewrite(g, label, call) : await run(label, call);
  if (isMissingRepo(failure)) markChecked(root, failure);
  if (out === undefined) return;
  if (op === "fetch") markChecked(root, null);
  const last = out.trim().split(/\r?\n/).filter(Boolean).pop();
  toast(op === "fetch" ? "Fetched." : pull ? (last && /up to date/i.test(last) ? "Already up to date." : "Pulled.") : "Pushed.", "success", 3000);
}

function markChecked(root: string, error: string | null) {
  useGit.setState((g) => ({ remoteCheck: { ...g.remoteCheck, [key(root)]: { at: Date.now(), checking: false, error } } }));
}

/** How often the panel re-checks the remote by itself (on opening, or when Quarry gets focus). */
const CHECK_EVERY = 60_000;

/**
 * Fetch the branch's remote in the background so ahead / behind are the remote's real state, not
 * the last fetch's. Only remote-tracking branches change; it never opens a sign-in window or waits
 * on an SSH passphrase (a failure is shown in the panel, with Fetch to try in the open).
 */
export async function checkRemote(root: string, force = false) {
  const g = useGit.getState();
  const c = g.remoteCheck[key(root)];
  if (!g.repos[key(root)]?.remotes.length || g.busy || c?.checking || (!force && c && Date.now() - c.at < CHECK_EVERY)) return;
  useGit.setState((s) => ({ remoteCheck: { ...s.remoteCheck, [key(root)]: { at: c?.at ?? 0, checking: true, error: null } } }));
  let error: string | null = null;
  try {
    await git.remote(root, "check");
  } catch (e) {
    const lines = String(e).replace(/^Error: /, "").split(/\r?\n/).map((l) => l.replace(/^(fatal|error): /, "").trim()).filter(Boolean);
    error = lines[0] ?? "the remote could not be reached";
  }
  markChecked(root, error);
  refreshGit(0);
}

/** Show the Source Control panel's Add Remote form. */
export function showAddRemote() {
  useGit.setState({ addingRemote: true });
  void import("./panels").then((m) => m.showPanel("git"));
}

/** Note a repository's remote now (the status refresh comes later), so Push sees it at once. */
function noteRemote(root: string, name: string, url: string) {
  const st = useGit.getState().repos[key(root)];
  if (!st) return;
  const remotes = [...st.remotes.filter((r) => r.name !== name), { name, url }];
  useGit.setState((g) => ({ repos: { ...g.repos, [key(root)]: { ...st, remotes } } }));
}

/**
 * Add a remote (`replace` false) or point an existing one at another URL (true), then with `push`
 * publish the current branch there. False when it failed.
 */
export async function saveRemote(root: string, name: string, url: string, opts: { replace: boolean; push: boolean }): Promise<boolean> {
  const [n, u] = [name.trim(), url.trim()];
  const ok = await run(opts.replace ? "Changing remote…" : "Adding remote…", () => (opts.replace ? git.setRemoteUrl(root, n, u) : git.addRemote(root, n, u)).then(() => true));
  if (!ok) return false;
  useGit.setState({ addingRemote: false });
  noteRemote(root, n, u);
  toast(opts.replace ? `Remote ${n} now points to ${displayUrl(u)}.` : `Added remote ${n}.`, "success", 3000);
  // What the last check said was about the old URL.
  markChecked(root, null);
  if (opts.push) await remote(root, "push");
  void checkRemote(root, true);
  return true;
}

/**
 * Create a repository on the signed-in GitHub account and use it as remote `name` (added, or with
 * `replace` the existing one repointed), then with `push` publish the current branch there.
 */
export async function createOnGithub(root: string, repoName: string, isPrivate: boolean, name: string, opts: { replace: boolean; push: boolean }): Promise<boolean> {
  toast("Creating the repository on GitHub… Git Credential Manager may ask you to sign in.", "info", 4000);
  const made = await run("Creating on GitHub…", () => git.githubCreate(root, repoName, isPrivate, useGit.getState().github?.chosen ?? null));
  if (!made) return false;
  if (made.existed) {
    // The name is taken on the account: offer that repository rather than stopping there.
    const push = opts.push ? " and push this branch to it" : "";
    const vis = made.private ? "private" : "public";
    const state = made.empty
      ? `It is ${vis} and empty.`
      : `It is ${vis} and already has commits. If they aren't part of this repository's history, git refuses the push; nothing on GitHub is overwritten.`;
    const use = await choose("Repository already exists", `Your GitHub account already has ${made.fullName}. ${state}

Use it as ${name.trim()}${push}?`, [
      { label: opts.push ? "Use It and Push" : "Use It", kind: "primary", default: true, value: true },
      { label: "Cancel", cancel: true, value: false },
    ], false);
    if (!use) return false;
  } else toast(`Created ${made.fullName} (${made.private ? "private" : "public"}) on GitHub.`, "success", 4000);
  useGit.setState((g) => ({ remoteInfo: { ...g.remoteInfo, [made.cloneUrl]: made } }));
  return saveRemote(root, name, made.cloneUrl, opts);
}

const GITHUB_KEY = "quarry.githubAccount";

function setGithub(accounts: string[], prefer?: string | null) {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(GITHUB_KEY);
  } catch {
    // no storage: the first account
  }
  const chosen = [prefer, useGit.getState().github?.chosen, saved].find((a) => a && accounts.includes(a)) ?? accounts[0] ?? null;
  useGit.setState({ github: { accounts, chosen } });
}

/** Read the GitHub accounts Git Credential Manager is signed in to (stays null without GCM). */
export async function loadGithub(root: string) {
  const accounts = await git.githubAccounts(root).catch(() => null);
  if (accounts) setGithub(accounts);
}

/** URL + account pairs already looked up (each is asked once; a new account asks again). */
const remoteLookups = new Set<string>();

/** Look up a GitHub remote's repository (for its Private / Public badge). */
export async function loadRemoteInfo(root: string, url: string) {
  const account = useGit.getState().github?.chosen ?? null;
  const k = `${account ?? ""}|${url}`;
  if (remoteLookups.has(k) || useGit.getState().remoteInfo[url]) return;
  remoteLookups.add(k);
  const info = await git.githubRepo(root, url, account).catch(() => null);
  if (info) useGit.setState((g) => ({ remoteInfo: { ...g.remoteInfo, [url]: info } }));
}

/** Pick the account new GitHub repositories go to (remembered on this computer). */
export function chooseGithub(account: string) {
  try {
    localStorage.setItem(GITHUB_KEY, account);
  } catch {
    // kept for this session only
  }
  const g = useGit.getState().github;
  if (g) useGit.setState({ github: { ...g, chosen: account } });
}

/** Sign in to a GitHub account in Git Credential Manager's window; the new account is chosen. */
export async function githubSignIn(root: string) {
  const before = useGit.getState().github?.accounts ?? [];
  const accounts = await run("Signing in to GitHub…", () => git.githubSignIn(root));
  if (!accounts) return;
  const added = accounts.find((a) => !before.includes(a));
  setGithub(accounts, added);
  if (added) chooseGithub(added);
  toast(added ? `Signed in to GitHub as ${added}.` : "No new GitHub account was added.", added ? "success" : "info", 3000);
}

/** Load who commits are made as in a repository (shown in the Source Control panel). */
export async function loadIdentity(root: string) {
  const id = await git.identity(root).catch(() => null);
  if (id) useGit.setState({ identity: { root, ...id } });
}

export async function saveIdentity(root: string, name: string, email: string, global: boolean): Promise<boolean> {
  const ok = await run("Saving…", () => git.setIdentity(root, name, email, global).then(() => true));
  if (ok) await loadIdentity(root);
  return !!ok;
}

/**
 * Open the branch picker (palette mode "branch"). The purpose sets its prompt, which rows it lists
 * and the command a picked row runs (`branchPick` / `pickList` in gitRefs.ts): "switch" (the
 * default), or "merge" / "rebase", which are refused here when they cannot start. "compare"
 * (COMMITCMP-005) only reads; its `pickFor` is the graph commit the picked branch is compared with
 * (and its repository), else the current commit. The housekeeping purposes (specs/git-branches.md)
 * take a `BranchPickFor`: the command a picked row runs and what it is about.
 * Only a merge or rebase start is checked here (`startBlocked`): no other purpose starts an operation.
 */
export async function pickBranch(purpose: BranchPurpose = "switch", pickFor: BranchPickFor | CompareFrom | null = null) {
  // "compare" takes the graph commit to compare with; housekeeping takes its `BranchPickFor`.
  const from = purpose === "compare" && pickFor && "sha" in pickFor ? pickFor : null;
  const forRefs = pickFor && "command" in pickFor ? pickFor : null;
  // Either may act on a graph tab's repository rather than the current one.
  const root = from?.root ?? forRefs?.root;
  const repo = (root && useGit.getState().repos[key(root)]) || currentRepo();
  if (!repo) {
    toast("The open folder is not in a git repository.", "info");
    return;
  }
  compareFrom = from;
  if (purpose === "merge" || purpose === "rebase") {
    const blocked = startBlocked(repo, purpose, useGit.getState().busy);
    if (blocked) {
      toast(`${blocked}.`, "info", 4000);
      return;
    }
  }
  markPickerStep();
  useGit.setState((g) => ({ branches: null, branchPick: purpose, branchPickFor: forRefs, branchPickSeq: g.branchPickSeq + 1, tags: null }));
  useStore.getState().set({ palette: "branch" });
  if (purpose === "tag") void git.tags(repo.root).then((tags) => useGit.setState({ tags }), (e) => { toast(String(e), "error"); useGit.setState({ tags: [] }); });
  if (purpose === "switch") void loadRefInfo(repo.root); // the row menu's push targets and default branches
  const list = await git.branches(repo.root).catch((e) => {
    toast(String(e), "error");
    return [] as GitBranch[];
  });
  useGit.setState({ branches: list });
}

/** Read what the ref menus need besides the status (each branch's upstream, each remote's default branch). */
export async function loadRefInfo(root: string) {
  const info = await git.refInfo(root).catch(() => null);
  if (info) useGit.setState((g) => ({ refInfo: { ...g.refInfo, [key(root)]: info } }));
}

export async function checkout(name: string, create = false) {
  const repo = currentRepo();
  if (!repo) return;
  // A new branch from the current commit changes no file: nothing to ask, nothing to reload.
  const g = create ? null : await guard(repo.root, switchOp(repo, name));
  if (!create && !g) return;
  const call = () => git.checkout(repo.root, name, create);
  const ok = g ? await rewrite(g, `Switching to ${name}…`, call) : await run(`Creating ${name}…`, call);
  if (ok === undefined) return;
  toast(create ? `Created and switched to ${name}` : `Switched to ${name}`, "success", 2500);
}

/** Switching to a branch (a remote branch is switched to under its local name). */
const switchOp = (repo: GitStatus | undefined, name: string): SafetyOp => ({ kind: "switch", name: localName(name, repo?.remotes.map((r) => r.name) ?? []) });

// ---------- comparing ----------

const nameOf = (p: string) => p.slice(p.lastIndexOf("\\") + 1);

/** Compare a file's committed (HEAD) text with the open tab or the file on disk. */
export async function compareWithHead(path: string) {
  const { openCompare } = await import("./diff");
  const blob = await git.show(path, "HEAD").catch((e) => {
    toast(String(e), "error");
    return null;
  });
  if (blob === null) {
    toast(`${nameOf(path)} is not in the last commit.`, "info");
    return;
  }
  if (blob.binary) {
    toast(`${nameOf(path)} is a binary file.`, "info");
    return;
  }
  const doc = useStore.getState().docs.find((d) => d.kind === "text" && d.path && key(d.path) === key(path));
  const head = { kind: "text" as const, label: `${nameOf(path)} (HEAD)`, text: blob.text };
  if (doc) await openCompare(head, { kind: "tab", docId: doc.id });
  else if (await fs.exists(path)) await openCompare(head, { kind: "file", path });
  else await openCompare(head, { kind: "text", label: `${nameOf(path)} (deleted)`, text: "" });
}

/** The Source Control panel's diff of a changed file: staged = HEAD vs index, else index (or HEAD) vs working copy. */
export async function openChange(f: GitFile, staged: boolean) {
  const { openPath } = await import("./actions");
  const kind = kindOf(f);
  // A conflicted file has no single "before" to compare with: open the file itself, where git's
  // conflict markers show both sides to choose from. An untracked file has nothing to compare with.
  // (A staged new file that was edited again compares its staged text with the working copy.)
  if (kind === "untracked" || kind === "conflict") {
    if (kind !== "conflict" || (await fs.exists(f.path))) void openPath(f.path);
    else toast(`${nameOf(f.path)} was deleted on one side and is not in the folder. Mark it resolved with + to keep it deleted${repoOf(f.path)?.operation ? ", or abort" : ""}.`, "info", 7000);
    return;
  }
  // The comparison carries what it compares, so single changes and lines can be staged,
  // unstaged or discarded in it (lib/gitStaging.ts).
  const { openChangeCompare } = await import("./gitStaging");
  await openChangeCompare(f, staged);
}

// ---------- history ----------

const PAGE = 100;

export async function showHistory(path: string) {
  useGit.setState({ history: { path, entries: [], more: false, loading: true } });
  const { showPanel } = await import("./panels");
  showPanel("git");
  const entries = await git.log(path, 0, PAGE).catch((e) => {
    toast(String(e), "error");
    return [] as GitLogEntry[];
  });
  if (useGit.getState().history?.path !== path) return;
  useGit.setState({ history: { path, entries, more: entries.length === PAGE, loading: false } });
}

export async function moreHistory() {
  const h = useGit.getState().history;
  if (!h || h.loading || !h.more) return;
  useGit.setState({ history: { ...h, loading: true } });
  const next = await git.log(h.path, h.entries.length, PAGE).catch(() => [] as GitLogEntry[]);
  const cur = useGit.getState().history;
  if (cur?.path !== h.path) return;
  useGit.setState({ history: { ...cur, entries: [...cur.entries, ...next], more: next.length === PAGE, loading: false } });
}

/** What a commit changed in the file: its parent's text vs its own. */
export async function openCommitChange(h: FileHistory, i: number) {
  const e = h.entries[i];
  if (!e || !e.rel) return;
  const { openCompare } = await import("./diff");
  const prevRel = h.entries[i + 1]?.rel ?? e.rel;
  const [a, b] = await Promise.all([git.show(h.path, `${e.sha}^`, prevRel).catch(() => null), git.show(h.path, e.sha, e.rel).catch(() => null)]);
  if (b?.binary || a?.binary) {
    toast("This file is binary.", "info");
    return;
  }
  const name = nameOf(e.rel.replace(/\//g, "\\"));
  await openCompare({ kind: "text", label: `${name} @ ${e.short}^`, text: a?.text ?? "" }, { kind: "text", label: `${name} @ ${e.short}`, text: b?.text ?? "" });
}

/** What a commit changed in one of its files (Commits section): the parent's text vs the commit's. */
export async function openCommitFile(entry: GitLogEntry, f: GitCommitFile) {
  const { openCompare } = await import("./diff");
  const [a, b] = await Promise.all([
    f.status === "A" ? null : git.show(f.path, `${entry.sha}^`, f.origRel ?? f.rel).catch(() => null),
    f.status === "D" ? null : git.show(f.path, entry.sha, f.rel).catch(() => null),
  ]);
  if (a?.binary || b?.binary) {
    toast("This file is binary.", "info");
    return;
  }
  const name = nameOf(f.rel.replace(/\//g, "\\"));
  await openCompare({ kind: "text", label: `${name} @ ${entry.short}^`, text: a?.text ?? "" }, { kind: "text", label: `${name} @ ${entry.short}`, text: b?.text ?? "" }, { preview: true });
}

// ---------- commit graph ----------

/** Open the commit graph of a repository (the current one) in a tab; an open one is reused. */
export function openGraph(root?: string) {
  const repo = root ? useGit.getState().repos[key(root)] : currentRepo();
  if (!repo) {
    toast("Open a folder in a git repository", "info");
    return;
  }
  const st = useStore.getState();
  const open = st.docs.find((d) => d.kind === "graph" && d.graph && key(d.graph.root) === key(repo.root));
  if (open) {
    st.setActive(open.id);
    return;
  }
  st.addDoc(
    { id: newDocId(), kind: "graph", path: null, name: `Graph · ${nameOf(repo.root)}`, dirty: false, encoding: "", bom: false, eol: "CRLF", language: "Git Graph", readonly: true, modifiedMs: 0, graph: { root: repo.root } },
    true,
  );
}

const ACTION_LABEL: Record<GitCommitAction, string> = {
  checkout: "Checking out…",
  branch: "Creating branch…",
  "branch-switch": "Creating branch…",
  tag: "Creating tag…",
  "cherry-pick": "Cherry-picking…",
  revert: "Reverting…",
  "reset-soft": "Resetting…",
  "reset-mixed": "Resetting…",
  "reset-hard": "Resetting…",
};

/** What a graph action is to open tabs: it asks, says it in its own confirmation, or leaves the files alone. */
function actionOp(action: GitCommitAction, sha: string, name?: string): SafetyOp {
  const short = sha.slice(0, 7);
  switch (action) {
    case "checkout":
      return { kind: "checkout", name: short };
    case "branch-switch":
      return { kind: "switch", name: name ?? short };
    case "cherry-pick":
    case "revert":
      return { kind: action, name: short };
    default:
      return { kind: action };
  }
}

/**
 * Run a graph action on a commit (the graph asked its own confirmation first). Check-out,
 * create-branch-and-switch, cherry-pick and revert then ask about unsaved tabs; a hard reset's
 * confirmation named them (`unsavedTabs`), so they reload where the reset rewrote the file. Open
 * tabs are checked against the disk afterwards, also when a pick or revert stopped on a conflict.
 * True when it worked.
 */
export async function commitAction(root: string, action: GitCommitAction, sha: string, name?: string): Promise<boolean> {
  const op = actionOp(action, sha, name);
  if (action === "branch" || action === "tag") return (await run(ACTION_LABEL[action], () => git.commitAction(root, action, sha, name))) !== undefined;
  const g = action === "reset-hard" ? noTabs(root, op, await unsavedTabs(root)) : await guard(root, op);
  if (!g) return false;
  return (await rewrite(g, ACTION_LABEL[action], () => git.commitAction(root, action, sha, name))) !== undefined;
}

/** Abandon the operation in progress (a stopped merge, rebase, cherry-pick or revert), after asking. */
export async function abortOperation(root: string, operation: string) {
  const { askDialog } = await import("./actions");
  const w = operationWords(operation);
  // Unsaved edits go too where the abort rewrites the file: the one question says so (SAFE-004.6).
  const open = await unsavedTabs(root);
  const lost = lostEditsSentence("abort", open);
  const ok = await askDialog(`Abort ${w.noun}?`, `Everything goes back to how it was before ${w.noun} started. Conflict resolutions made so far are discarded.${lost ? ` ${lost}` : ""}`, w.abortLabel);
  if (!ok) return;
  const out = await rewrite(noTabs(root, { kind: "abort", noun: w.noun }, open), "Aborting…", () => git.abort(root));
  if (out === undefined) return;
  toast(operationDone(out || operation, "abort"), "info", 3000);
  pendingRewrite.delete(key(root)); // nothing was rewritten after all (MERGE-009)
}

/** Switch to a branch from the graph (a remote branch gets a local tracking branch). */
export async function checkoutRef(root: string, name: string): Promise<boolean> {
  const g = await guard(root, switchOp(useGit.getState().repos[key(root)], name));
  if (!g) return false;
  return (await rewrite(g, `Switching to ${name}…`, () => git.checkout(root, name).then(() => true))) === true;
}

/** A commit's version of the file vs the working copy. */
export async function compareCommitWithCurrent(h: FileHistory, i: number) {
  const e = h.entries[i];
  if (!e || !e.rel) return;
  const { openCompare } = await import("./diff");
  const b = await git.show(h.path, e.sha, e.rel).catch(() => null);
  const name = nameOf(h.path);
  const doc = useStore.getState().docs.find((d) => d.kind === "text" && d.path && key(d.path) === key(h.path));
  const left = { kind: "text" as const, label: `${name} @ ${e.short}`, text: b?.text ?? "" };
  if (doc) await openCompare(left, { kind: "tab", docId: doc.id });
  else await openCompare(left, { kind: "file", path: h.path });
}

// ---------- start a merge or rebase, force push (specs/git-merge-rebase.md) ----------

/** Rebases of pushed commits that stopped on a conflict (lower-case root → branch): once they
 *  finish through Continue, the branch counts as rewritten; an Abort forgets them. */
const pendingRewrite = new Map<string, string>();

/** The branch was rewritten and its upstream still has the old commits: the status line offers Force Push. */
function markRewritten(root: string, st: GitStatus | null, branch: string) {
  if (!st || !isRewritten(branch, st)) return;
  useGit.setState((g) => ({ repos: { ...g.repos, [key(root)]: st }, rewrotePushed: { ...g.rewrotePushed, [key(root)]: branch } }));
}

function rewriteContinued(root: string, st: GitStatus | null) {
  const branch = pendingRewrite.get(key(root));
  if (!branch || st?.operation) return; // not one of these, or it stopped again
  pendingRewrite.delete(key(root));
  markRewritten(root, st, branch);
}

/** Drop the "rewritten" marks that no longer hold: another branch is checked out, or the upstream
 *  has no commits left that the branch lacks (force pushed, pulled, or the upstream is gone). */
function pruneRewritten(g: GitState) {
  let next: Record<string, string> | null = null;
  for (const [k, branch] of Object.entries(g.rewrotePushed)) {
    const repo = g.repos[k];
    if (repo && isRewritten(branch, repo)) continue;
    next ??= { ...g.rewrotePushed };
    delete next[k];
  }
  if (next) useGit.setState({ rewrotePushed: next });
}
useGit.subscribe(pruneRewritten);

/**
 * The checks every way of starting a merge or rebase goes through (graph menus, panel, Git menu,
 * palette, the hidden commands in a macro), on a fresh status: nothing running or stopped, a branch
 * for a rebase, and no uncommitted changes to tracked files. Null when it may not start (said in a
 * notification or the "Commit or discard your changes first" dialog).
 */
async function startCheck(root: string, kind: StartKind): Promise<GitStatus | null> {
  const st = await git.status(root).catch(() => null);
  const blocked = startBlocked(st, kind, useGit.getState().busy);
  if (blocked || !st) {
    toast(`${blocked}.`, "info", 4000);
    return null;
  }
  const dirty = trackedChanges(st);
  if (dirty && !mergeWithChanges(kind)) {
    const d = dirtyRefusal(kind, dirty);
    if (await choose(d.title, d.text, d.choices, false)) showPanel("git");
    return null;
  }
  return st;
}

/** Settings › Git "Allow merging with uncommitted changes" (merge only; a rebase always needs a clean state). */
const mergeWithChanges = (kind: StartKind | "history") => kind === "merge" && useStore.getState().settings.gitMergeWithChanges;

async function startPreview(root: string, ref: string): Promise<GitMergePreview | null> {
  try {
    return await git.mergePreview(root, ref);
  } catch (e) {
    toast(gitErrorText(String(e)), "error", 8000);
    return null;
  }
}

/**
 * Run the merge / rebase. "stopped": it stopped on a conflict, which is finished or aborted in
 * Source Control (shown now); "failed": git refused and nothing is in progress.
 */
async function runStart(root: string, g: Guarded, label: string, fn: () => Promise<string>): Promise<"done" | "stopped" | "failed"> {
  const out = await rewrite(g, label, fn);
  if (out !== undefined) return "done";
  const now = await git.status(root).catch(() => null);
  if (!now?.operation) return "failed";
  useGit.setState((g) => ({ repos: { ...g.repos, [key(root)]: now } }));
  showPanel("git");
  return "stopped";
}

const asTarget = (t: StartTarget | string): StartTarget => (typeof t === "string" ? { ref: t, label: t, named: true } : t);

/** Merge a branch, tag or commit into the current branch, after asking. True when it finished. */
export async function startMerge(root: string, target: StartTarget | string): Promise<boolean> {
  const t = asTarget(target);
  const st = await startCheck(root, "merge");
  const p = st && (await startPreview(root, t.ref));
  if (!st || !p) return false;
  const allowDirty = mergeWithChanges("merge");
  const plan = mergeConfirm(p, t.label, st.branch, allowDirty ? trackedChanges(st) : 0);
  if (plan.nothing !== undefined) {
    toast(plan.nothing, "info", 4000);
    return false;
  }
  // Unsaved tabs before the confirmation: a Save All makes the tree dirty, which refuses the merge.
  const g = await cleanGuard(root, { kind: "merge", name: t.label, branch: st.branch }, "merge");
  if (!g) return false;
  const mode = await choose(plan.title, plan.text, plan.choices, null);
  if (!mode) return false;
  if ((await runStart(root, g, "Merging…", () => git.merge(root, p.target, mode, allowDirty))) !== "done") return false;
  toast(mergeDone(mode, p, t.label, st.branch), "success", 4000);
  return true;
}

/**
 * Rebase the current branch onto a branch, tag or commit, after asking (a danger dialog when
 * commits to replay are already pushed). True when it finished.
 */
export async function startRebase(root: string, target: StartTarget | string): Promise<boolean> {
  const t = asTarget(target);
  const st = await startCheck(root, "rebase");
  const p = st && (await startPreview(root, t.ref));
  if (!st?.branch || !p) return false;
  const branch = st.branch;
  const plan = rebaseConfirm(p, t.label, branch);
  if (plan.nothing !== undefined) {
    toast(plan.nothing, "info", 4000);
    return false;
  }
  const g = await cleanGuard(root, { kind: "rebase", name: t.label, branch }, "rebase");
  if (!g) return false;
  const how = await choose(plan.title, plan.text, plan.choices, null);
  if (!how) return false;
  // Pushed commits get new ids (or the branch was already rewritten and not force pushed yet).
  const rewrites = how === "rebase" && (p.pushed > 0 || useGit.getState().rewrotePushed[key(root)] === branch);
  const result = await runStart(root, g, "Rebasing…", () => (how === "ff" ? git.merge(root, p.target, "ff-only") : git.rebase(root, p.target)));
  if (result === "stopped" && rewrites) pendingRewrite.set(key(root), branch);
  if (result !== "done") return false;
  toast(rebaseDone(how, p, t.label, branch), "success", 4000);
  if (rewrites) markRewritten(root, await git.status(root).catch(() => null), branch);
  return true;
}

/**
 * Replace the current branch's upstream with the branch (`push --force-with-lease`), after a
 * danger dialog that lists the commits the remote loses. Never forces anything else.
 */
export async function forcePush(root: string): Promise<boolean> {
  const st = await git.status(root).catch(() => null);
  const blocked = forcePushBlocked(st, useGit.getState().busy);
  if (blocked || !st) {
    toast(`${blocked}.`, "info", 4000);
    return false;
  }
  let p: GitForcePushPreview;
  try {
    p = await git.forcePushPreview(root);
  } catch (e) {
    toast(gitErrorText(String(e)), "error", 8000);
    return false;
  }
  const plan = forcePushConfirm(p);
  if (plan.nothing !== undefined) {
    toast(plan.nothing, "info", 4000);
    return false;
  }
  if (!(await choose(plan.title, plan.text, plan.choices, null))) return false;
  if ((await run("Pushing…", () => git.remote(root, "push-force"))) === undefined) return false;
  useGit.setState((g) => ({ rewrotePushed: Object.fromEntries(Object.entries(g.rewrotePushed).filter(([k]) => k !== key(root))) }));
  markChecked(root, null);
  toast(forcePushDone(p), "success", 4000);
  return true;
}

// ---------- stash ----------

/** The stash id / count each repository's list was last loaded for. */
const stashStamp = new Map<string, string>();

/** Read a repository's stashes into `useGit.stashes`. */
export async function loadStashes(root: string) {
  const list = await git.stashList(root).catch(() => null);
  if (list) useGit.setState((g) => ({ stashes: { ...g.stashes, [key(root)]: list } }));
  else stashStamp.delete(key(root)); // the next status refresh asks again
}

/** After every status refresh: reload the lists that changed (also a stash made in a terminal),
 *  and see whether a stash that came back with conflicts is resolved now. */
function stashAfterRefresh(repos: Record<string, GitStatus>) {
  for (const [k, r] of Object.entries(repos)) {
    const stamp = `${r.stash ?? ""}|${r.stashCount ?? 0}`;
    if (stashStamp.get(k) === stamp) continue;
    stashStamp.set(k, stamp);
    void loadStashes(r.root);
  }
  const p = useGit.getState().stashPending;
  const repo = p ? repos[key(p.root)] : null;
  if (repo && !repo.files.some((f) => f.conflicted)) void settleStash();
}

let settling = false;

/**
 * The files of the stash that came back with conflicts look resolved: forget it, and for a pop
 * offer to drop the stash (git kept it). Keep Stash is the default; nothing is asked when the
 * stash was dropped in the meantime.
 */
async function settleStash() {
  const p = useGit.getState().stashPending;
  if (!p || settling) return;
  settling = true;
  try {
    // The status that got us here may be older than the apply / pop itself: ask git again.
    const st = await git.status(p.root).catch(() => null);
    if (!st || st.files.some((f) => f.conflicted) || useGit.getState().stashPending !== p) return;
    useGit.setState({ stashPending: null });
    if (!p.pop) return;
    const list = await git.stashList(p.root).catch(() => [] as GitStash[]);
    if (!list.some((s) => s.sha === p.sha)) return;
    const w = dropOffer(p.title);
    const drop = await choose(
      w.title,
      w.text,
      [
        { label: w.drop, kind: "danger", value: true },
        { label: w.keep, cancel: true, default: true, value: false },
      ],
      false,
    );
    if (!drop) return;
    if ((await stashRun("Dropping stash…", p.root, p.sha, "drop")) !== null) toast(stashDone("drop", p.title), "success", 3000);
  } finally {
    settling = false;
  }
}

/** The "last file" sentence of the No-conflicts-left dialog when the conflicts came from a stash. */
function stashLastFile(root: string): string {
  const p = useGit.getState().stashPending;
  return p?.pop && key(p.root) === key(root) ? STASH_CONFLICT.lastFilePop : STASH_CONFLICT.lastFile;
}

/** Open Source Control with the Stash Changes form (nothing is stashed until its Stash button). */
export function showStashForm() {
  const repo = currentRepo();
  if (!repo) {
    toast("The open folder is not in a git repository.", "info");
    return;
  }
  const why = stashBlocked(repo, "stash");
  if (why) {
    toast(`${why}.`, "info", 4000);
    return;
  }
  useGit.setState({ stashForm: true });
  showPanel("git");
}

/** Open Source Control with the Stashes section open and the focus on its first row. */
export function showStashes() {
  if (!currentRepo()) {
    toast("The open folder is not in a git repository.", "info");
    return;
  }
  showPanel("git");
  useGit.setState((g) => ({ stashReveal: g.stashReveal + 1 }));
}

/**
 * Stash the uncommitted changes of `root` (with `untracked`, the untracked files too). The guards
 * run on a fresh status; then, with unsaved tabs in the repository, the unsaved-tabs question
 * (a stash takes the files as they are on disk: Save All puts the edits in the stash, Continue
 * Without Saving leaves them in their tabs). True when a stash was made.
 */
export async function stashChanges(root: string, message: string, untracked: boolean): Promise<boolean> {
  if (useGit.getState().busy) return false;
  const st = await git.status(root).catch(() => null);
  const why = st ? stashBlocked(st, "stash") : "Git could not read the repository";
  if (!st || why) {
    toast(`${why}.`, "info", 4000);
    return false;
  }
  const count = (s: GitStatus) => {
    const n = stashCounts(s.files);
    return n.tracked + (untracked ? n.untracked : 0);
  };
  let files = count(st);
  if (!files) {
    toast("Only untracked files have changed: tick the box to stash them.", "info", 4000);
    return false;
  }
  const g = await guard(root, { kind: "stash" });
  if (!g) return false;
  // Saved files are changes now: count them in.
  if (g.saved) files = await git.status(root).then((now) => (now ? count(now) : files), () => files);
  const sha = await rewrite(g, "Stashing…", () => git.stashPush(root, message, untracked));
  if (sha === undefined) return false;
  useGit.setState({ stashForm: false });
  toast(stashDone("stash", message, files), "success", 4000);
  await loadStashes(root);
  return true;
}

/** Run one stash operation with a busy label; a refusal becomes a toast and null. The list is reloaded either way. */
async function stashRun(label: string, root: string, sha: string, op: "apply" | "pop" | "drop"): Promise<"ok" | "conflicts" | null> {
  useGit.setState({ busy: label });
  try {
    return await git.stashOp(root, sha, op);
  } catch (e) {
    toast(op === "drop" ? gitErrorText(String(e)) : stashErrorText(String(e), op), "error", 12000);
    return null;
  } finally {
    useGit.setState({ busy: null });
    refreshGit(0);
    afterAction?.();
    await loadStashes(root);
  }
}

/**
 * Apply, pop or drop a stash, named by its commit id (so a list that went stale cannot hit another
 * one). Drop asks first, with Cancel as the default; apply and pop are refused while an operation
 * is stopped or files are in conflict (checked on a fresh status). An apply / pop that conflicts
 * is not an error: the files go to Merge Changes and the stash is remembered in `stashPending`.
 * Apply and pop ask about the repository's unsaved tabs first, whether or not the stash touches
 * their files; open tabs are checked against the disk afterwards. True when git ran.
 */
export async function stashAction(root: string, stash: Pick<GitStash, "sha" | "subject" | "time">, what: "apply" | "pop" | "drop"): Promise<boolean> {
  if (useGit.getState().busy) return false;
  const t = stashTitle(stash.subject);
  if (what === "drop") {
    const files = await git.stashFiles(root, stash.sha).then(
      (l) => l.length,
      () => null,
    );
    const w = dropConfirm(t, relativeTime(stash.time), files);
    const ok = await choose(
      w.title,
      w.text,
      [
        { label: w.drop, kind: "danger", value: true },
        { label: w.cancel, cancel: true, default: true, value: false },
      ],
      false,
    );
    if (!ok) return false;
    if ((await stashRun("Dropping stash…", root, stash.sha, "drop")) === null) return false;
    if (useGit.getState().stashPending?.sha === stash.sha) useGit.setState({ stashPending: null });
    toast(stashDone("drop", t.title), "success", 3000);
    return true;
  }
  const st = await git.status(root).catch(() => null);
  const why = st ? stashBlocked(st, what) : "Git could not read the repository";
  if (why) {
    toast(`${why}.`, "info", 4000);
    return false;
  }
  const g = await guard(root, { kind: "stash-apply" });
  if (!g) return false;
  const out = await withTabs(g, () => stashRun(what === "pop" ? "Popping stash…" : "Applying stash…", root, stash.sha, what));
  if (out === null) return false;
  if (out === "conflicts") {
    const after = await git.status(root).catch(() => null);
    const conflicts = after?.files.filter((f) => f.conflicted).length ?? 0;
    if (conflicts) {
      useGit.setState({ stashPending: { root, sha: stash.sha, title: t.title, pop: what === "pop" } });
      toast(stashConflictWarning(t.title, what === "pop", conflicts), "warning", 12000);
      showPanel("git");
      return true;
    }
  }
  toast(stashDone(what, t.title), "success", 4000);
  return true;
}

/** Apply / pop / drop the newest stash of the current repository (the Git menu and the palette). */
export async function stashLatest(what: "apply" | "pop" | "drop") {
  const repo = currentRepo();
  if (!repo) {
    toast("The open folder is not in a git repository.", "info");
    return;
  }
  const why = what === "drop" ? null : stashBlocked(repo, what);
  if (why) {
    toast(`${why}.`, "info", 4000);
    return;
  }
  const list = await git.stashList(repo.root).catch(() => [] as GitStash[]);
  useGit.setState((g) => ({ stashes: { ...g.stashes, [key(repo.root)]: list } }));
  if (!list.length) {
    toast("There are no stashes.", "info");
    return;
  }
  await stashAction(repo.root, list[0], what);
}

/** What a stash changed in one of its files: the commit it was made on vs the stash (both read-only). */
export async function openStashFile(stash: Pick<GitStash, "sha" | "short" | "base">, f: GitCommitFile) {
  const { openCompare } = await import("./diff");
  const added = f.status === "A" || f.status === "?";
  const [a, b] = await Promise.all([
    added ? null : git.show(f.path, stash.base, f.origRel ?? f.rel).catch(() => null),
    // An untracked file is kept in the stash's third parent, not in the stash commit itself.
    f.status === "D" ? null : git.show(f.path, f.status === "?" ? `${stash.sha}^3` : stash.sha, f.rel).catch(() => null),
  ]);
  if (a?.binary || b?.binary) {
    toast("This file is binary.", "info");
    return;
  }
  const name = nameOf(f.rel.replace(/\//g, "\\"));
  await openCompare({ kind: "text", label: `${name} @ ${stash.base.slice(0, 7)}`, text: a?.text ?? "" }, { kind: "text", label: `${name} @ stash ${stash.short}`, text: b?.text ?? "" }, { preview: true });
}

// ---------- compare commits (specs/git-compare-commits.md) ----------
// Everything here only reads: no checkout, no staging, no commit action.

/** Compare with Branch… asked from a graph commit: the repository and commit the picked branch is
 *  compared with. null: the current commit of the current repository (Git menu, palette). */
/** The graph commit (and its repository) a Compare with Branch… was asked from (`pickBranch("compare", from)`). */
export interface CompareFrom {
  root: string;
  sha: string;
}
let compareFrom: CompareFrom | null = null;

/**
 * Compare a branch (picked by name) with the commit Compare with Branch… was asked from, or with
 * the current commit (HEAD; uncommitted changes are not part of it). Opens the repository's graph
 * tab, or brings it to the front, and hands it the two commits.
 */
/** The left side's name when Compare with Branch… starts where the branch split off. */
export const splitName = (branch: string) => `where ${branch} split off`;

export async function compareWithBranch(name: string): Promise<boolean> {
  const from = compareFrom;
  compareFrom = null;
  const repo = (from && useGit.getState().repos[key(from.root)]) || currentRepo();
  if (!repo) {
    toast("Open a folder in a git repository", "info");
    return false;
  }
  const start = from?.sha ?? "HEAD";
  const startName = from && from.sha !== "HEAD" ? undefined : (repo.branch ?? "HEAD");
  // Settings › Git: the two tips as they are, or what the branch changed since it split off.
  let left = start;
  let leftName = startName;
  if (useStore.getState().settings.gitCompareBranch === "split") {
    const base = await git.mergeBase(repo.root, start, name).catch(() => null);
    if (base) {
      left = base;
      leftName = splitName(name);
    } else toast(`${name} and ${startName ?? "this commit"} share no history: comparing the two tips.`, "info", 5000);
  }
  const result = await git.diffFiles(repo.root, left, name).catch((e) => {
    toast(gitErrorText(String(e)), "error");
    return null;
  });
  if (!result?.right) return false;
  openGraph(repo.root);
  useStore.getState().set({ graphCompare: { root: repo.root, first: result.left.sha, second: result.right.sha, names: { first: leftName, second: name }, result } });
  return true;
}

/**
 * A file of the comparison pane in a Compare tab (a preview tab, like a commit's files): its text
 * at the left commit against the right commit (both read-only), or, with `right` null, against
 * the working tree as in Compare with Last Commit: the open tab's text (a read-only snapshot),
 * else the file on disk (editable). A conflicted file opens itself, with its conflict bars.
 */
export async function openCompareFile(left: { sha: string; short: string }, right: { sha: string; short: string } | null, f: GitCommitFile) {
  const { openCompare } = await import("./diff");
  if (!right && f.status === "U" && (await fs.exists(f.path))) {
    const { openPath } = await import("./actions");
    void openPath(f.path);
    return;
  }
  const [a, b] = await Promise.all([
    f.status === "A" ? null : git.show(f.path, left.sha, f.origRel ?? f.rel).catch(() => null),
    !right || f.status === "D" ? null : git.show(f.path, right.sha, f.rel).catch(() => null),
  ]);
  if (a?.binary || b?.binary) {
    toast("This file is binary.", "info");
    return;
  }
  const old = { kind: "text" as const, label: sideLabel(f.origRel ?? f.rel, left.short), text: a?.text ?? "" };
  if (right) {
    await openCompare(old, { kind: "text", label: sideLabel(f.rel, right.short), text: b?.text ?? "" }, { preview: true });
    return;
  }
  const doc = useStore.getState().docs.find((d) => d.kind === "text" && d.path && key(d.path) === key(f.path));
  if (doc) await openCompare(old, { kind: "tab", docId: doc.id }, { preview: true });
  else if (await fs.exists(f.path)) await openCompare(old, { kind: "file", path: f.path }, { preview: true });
  else await openCompare(old, { kind: "text", label: `${nameOf(f.path)} (deleted)`, text: "" }, { preview: true });
}

// ---------- Edit History (specs/git-history-edit.md) ----------
// Undo Last Commit, Reword, Drop, Squash into Parent and the Edit History list. Every way in
// (graph menu, Git › Edit History, palette, the list's Run) goes through `historyGuard` on a fresh
// status and a fresh range, then a dialog from pure `historyConfirm` (Cancel is always the
// default); Rust `history_rewrite` checks again, against the tip the dialog named.

const full = (reason: string) => (/[.!?…]$/.test(reason) ? reason : `${reason}.`);

/**
 * The checks before a history edit, on what git says now: nothing running or stopped, on a branch,
 * the commit still editable (`check`), and for an edit that replays commits no uncommitted changes
 * to tracked files. `from`: the oldest commit of the range to read ("HEAD": the tip alone). Null
 * when it may not run (said in a notification or the "Commit or discard your changes first" dialog).
 */
async function historyGuard(root: string, from: string, check: (range: GitHistoryRange) => string | null, replay: (range: GitHistoryRange) => boolean): Promise<{ st: GitStatus; range: GitHistoryRange; branch: string } | null> {
  if (useGit.getState().busy) {
    toast("Another git action is running.", "info", 4000);
    return null;
  }
  let st: GitStatus | null;
  let range: GitHistoryRange;
  try {
    st = await git.status(root);
    if (!st) throw new Error("The open folder is not in a git repository");
    range = await git.historyRange(root, from);
  } catch (e) {
    toast(gitErrorText(String(e)), "error", 8000);
    return null;
  }
  // More commits than are read at once: the oldest one listed is then not the commit asked about.
  const reason = check(range) ?? (range.total > range.commits.length ? `There are ${range.total} commits from that one to the tip, and at most ${range.commits.length} are rewritten at a time: pick a more recent commit` : null);
  if (reason || !range.branch) {
    toast(full(reason ?? "You are not on a branch. Switch to a branch to edit its history."), "info", 6000);
    return null;
  }
  if (replay(range)) {
    const dirty = trackedChanges(st);
    if (dirty) {
      const d = dirtyRefusal("history", dirty);
      if (await choose(d.title, d.text, d.choices, false)) showPanel("git");
      return null;
    }
  }
  return { st, range, branch: range.branch };
}

/** Why the oldest commit of `range` cannot be edited this way, or null. */
const rangeReason = (action: EditAction) => (range: GitHistoryRange): string | null => {
  const commit = range.commits[range.commits.length - 1];
  // Not on the branch (the range is then empty), detached, or stopped: the context says which.
  return editAllowed(action, commit ?? { parents: [""] }, rangeEditContext(range, null));
};

/**
 * Run a confirmed history edit. "moved": the branch was not where the dialog said (nothing was
 * rewritten); "stopped": a commit conflicted, the rebase is finished or aborted in Source Control
 * (shown now); "failed": git refused and nothing is in progress.
 */
async function historyRun(root: string, g: Guarded, label: string, branch: string, list: boolean, fn: () => Promise<string>): Promise<"done" | "stopped" | "failed" | "moved"> {
  let moved = false;
  const result = await runStart(root, g, label, async () => {
    try {
      return await fn();
    } catch (e) {
      if (!String(e).includes(MOVED)) throw e;
      moved = true;
      return "";
    }
  });
  if (!moved) return result;
  toast(movedText(branch, list), "error", 8000);
  return "moved";
}

/** After the run: the notification, and the Force Push offer when pushed commits were rewritten (HISTORY-011). */
async function historyFinish(root: string, branch: string, result: "done" | "stopped" | "failed" | "moved", pushed: boolean, on: string | null, done: (stale: { upstream: string | null; on: string | null } | null) => string) {
  if (result === "stopped" && pushed) pendingRewrite.set(key(root), branch); // counts once Continue finishes it (MERGE-009)
  if (result !== "done") return;
  const now = await git.status(root).catch(() => null);
  toast(done(pushed ? { upstream: now?.upstream && !now.upstreamGone ? now.upstream : null, on } : null), "success", pushed ? 9000 : 5000);
  if (pushed) markRewritten(root, now, branch);
}

const shortId = (sha: string) => sha.slice(0, 7);

/** Take the last commit back and keep its changes staged, after asking. True when it was undone. */
export async function undoLastCommit(root: string): Promise<boolean> {
  const g = await historyGuard(root, "HEAD", rangeReason("undo"), () => false);
  const tip = g?.range.commits[0];
  if (!g || !tip) return false;
  const { range, branch } = g;
  const d = historyConfirm("undo", { branch, tip: tip.short, commit: tip, lines: [], below: range.base, pushedOn: tip.pushed ? (range.pushedOn ?? "a remote branch") : null });
  if (!(await choose(d.title, d.text, d.choices, false))) return false;
  // A soft reset: the files are not touched, so nothing is asked about unsaved tabs.
  const result = await historyRun(root, noTabs(root, { kind: "undo" }), "Undoing…", branch, false, () => git.historyRewrite(root, "undo", range.tip));
  if (result === "done") useGit.setState({ undone: { root, message: tip.message } });
  await historyFinish(root, branch, result, d.pushed, range.pushedOn, (stale) => historyDone("undo", { branch, was: tip.short }, stale));
  return result === "done";
}

/** The parent to read a squash's range from; null (said why) when the commit cannot be squashed. */
async function squashFrom(root: string, sha: string): Promise<string | null> {
  try {
    const r = await git.historyRange(root, sha);
    const c = r.commits[r.commits.length - 1];
    const reason = rangeReason("squash")(r);
    if (!reason && c?.parents.length === 1) return c.parents[0];
    toast(full(reason ?? "This is the first commit: it has no parent."), "info", 6000);
  } catch (e) {
    toast(gitErrorText(String(e)), "error", 8000);
  }
  return null;
}

/** For a range whose bottom row is the parent and the row above it the commit to fold in. */
const squashReason = (range: GitHistoryRange): string | null => {
  const n = range.commits.length;
  const [child, parent] = [range.commits[n - 2], range.commits[n - 1]];
  if (!child || !parent) return rangeReason("squash")(range);
  return editAllowed("squash", child, rangeEditContext({ ...range, commits: range.commits.slice(0, -1) }, null, parent));
};

/**
 * What the message strip of Reword / Squash into Parent starts with, read fresh: the commit, and
 * for a squash its parent. Null when the edit cannot run (said the same way as when it is submitted,
 * uncommitted changes included), so the strip only opens for an edit that can go ahead.
 */
export async function loadEditCommit(root: string, sha: string, kind: "reword" | "squash"): Promise<{ commit: GitHistoryCommit; parent: GitHistoryCommit | null } | null> {
  const from = kind === "squash" ? await squashFrom(root, sha) : sha;
  if (!from) return null;
  const g = await historyGuard(root, from, kind === "squash" ? squashReason : rangeReason("reword"), (r) => kind === "squash" || r.commits.length > 1);
  if (!g) return null;
  const n = g.range.commits.length;
  return kind === "squash" ? { commit: g.range.commits[n - 2], parent: g.range.commits[n - 1] } : { commit: g.range.commits[n - 1], parent: null };
}

/** The dialog's facts for a plan over `range`. */
function planInfo(range: GitHistoryRange, branch: string, todo: PlanTodo, extra: Partial<HistoryInfo> = {}): HistoryInfo {
  const below = todo.base ? (range.commits.find((c) => c.sha === todo.base) ?? (range.base?.sha === todo.base ? range.base : { short: shortId(todo.base) })) : null;
  return { branch, tip: shortId(range.tip), lines: todo.lines, below, pushedOn: range.pushedOn, ...extra };
}

/** Confirm and run a plan built over a fresh range. */
async function planRun(root: string, g: { range: GitHistoryRange; branch: string }, kind: HistoryKind, rows: PlanRow[], label: string, extra: Partial<HistoryInfo>, list = false): Promise<"done" | "stopped" | "failed" | "moved" | "cancelled"> {
  const { range, branch } = g;
  const todo = planTodo(rows, range.commits, range.base?.sha ?? null);
  if (!todo) {
    toast("Nothing would change.", "info", 3000);
    return "cancelled";
  }
  // Replaying commits rewrites files: unsaved tabs are asked about before the confirmation, and a
  // Save All leads to the clean-state refusal (SAFE-003.5, SAFE-003.12).
  const tabs = await cleanGuard(root, { kind: "history" }, "history");
  if (!tabs) return "cancelled";
  const d = historyConfirm(kind, planInfo(range, branch, todo, extra));
  if (!(await choose(d.title, d.text, d.choices, false))) return "cancelled";
  const result = await historyRun(root, tabs, label, branch, list, () => git.historyRewrite(root, "plan", range.tip, todo.base, todo.steps));
  const info = { branch, was: shortId(range.tip), commit: extra.commit, parent: extra.parent, count: todo.lines.length };
  await historyFinish(root, branch, result, d.pushed, range.pushedOn, (stale) => historyDone(kind, info, stale));
  return result;
}

/**
 * Give a commit of the current branch a new message, after asking. The tip is amended (staged
 * changes stay staged); an older commit is replayed with the commits after it. False when nothing
 * ran or git failed (cancelled, refused, failed, moved: the strip keeps the text).
 */
export async function rewordCommit(root: string, sha: string, message: string): Promise<boolean> {
  const g = await historyGuard(root, sha, rangeReason("reword"), (r) => r.commits.length > 1);
  const commit = g?.range.commits[g.range.commits.length - 1];
  if (!g || !commit) return false;
  const { range, branch } = g;
  const text = message.replace(/\r/g, "").trim();
  if (!text || text === commit.message.trim()) {
    toast(text ? "The message is unchanged." : "A commit needs a message.", "info", 3000);
    return false;
  }
  if (range.commits.length > 1) return ran(await planRun(root, g, "reword", singlePlan("reword", range.commits, text), "Rewording…", { commit }));
  const d = historyConfirm("reword", { branch, tip: commit.short, commit, lines: [{ commit, what: "reworded", detail: text.split("\n")[0] }], below: range.base, pushedOn: range.pushedOn });
  if (!(await choose(d.title, d.text, d.choices, false))) return false;
  // Amending the tip's message leaves the files alone: no unsaved-tabs question.
  const result = await historyRun(root, noTabs(root, { kind: "reword-tip" }), "Rewording…", branch, false, () => git.historyRewrite(root, "reword", range.tip, null, [], text));
  await historyFinish(root, branch, result, d.pushed, range.pushedOn, (stale) => historyDone("reword", { branch, was: commit.short }, stale));
  return ran(result);
}

/** The edit went ahead (finished, or stopped on a conflict): the message strip may close. */
const ran = (result: string) => result === "done" || result === "stopped";

/** Remove a commit of the current branch and replay the ones after it, after asking. */
export async function dropCommit(root: string, sha: string): Promise<boolean> {
  const g = await historyGuard(root, sha, rangeReason("drop"), () => true);
  const commit = g?.range.commits[g.range.commits.length - 1];
  if (!g || !commit) return false;
  return (await planRun(root, g, "drop", singlePlan("drop", g.range.commits), "Dropping…", { commit })) === "done";
}

/** Fold a commit into its parent with the message given, after asking. False when nothing ran. */
export async function squashCommit(root: string, sha: string, message: string): Promise<boolean> {
  const from = await squashFrom(root, sha);
  const g = from && (await historyGuard(root, from, squashReason, () => true));
  if (!g) return false;
  const n = g.range.commits.length;
  const [commit, parent] = [g.range.commits[n - 2], g.range.commits[n - 1]];
  if (!commit || commit.sha !== sha || !message.trim()) return false;
  return ran(await planRun(root, g, "squash", singlePlan("squash", g.range.commits, message), "Squashing…", { commit, parent }));
}

/**
 * Open the Edit History list in the repository's graph tab: the commits from `fromSha` up to the
 * tip, or without one the commits not pushed yet. Nothing is changed until the list is run.
 */
export async function openHistoryEdit(root: string, fromSha?: string): Promise<boolean> {
  let from = fromSha ?? null;
  if (!from) {
    // The commits no remote has, from the tip down (stopping at a merge commit).
    try {
      const st = await git.status(root);
      const blocked = st ? editAllowed("list", { parents: [""] }, { branch: st.branch, operation: st.operation, busy: useGit.getState().busy, onBranch: true, mergeAfter: null, parentMerge: false }) : "The open folder is not in a git repository";
      if (blocked || !st) {
        toast(full(blocked ?? ""), "info", 6000);
        return false;
      }
      const unpushed = await git.historyRange(root, null);
      from = defaultBase(unpushed);
      if (!from) {
        toast(unpushed.total === 0 ? allPushed(st.branch ?? "the branch") : `The last commit on ${st.branch} is a merge commit: there is nothing after it to edit here.`, "info", 9000);
        return false;
      }
    } catch (e) {
      toast(gitErrorText(String(e)), "error", 8000);
      return false;
    }
  }
  const g = await historyGuard(root, from, (r) => rangeReason("list")(r) ?? (r.total > MAX_PLAN ? tooMany(r.total) : null), () => true);
  if (!g) return false;
  openGraph(root);
  useGit.setState((s) => ({ historyEdit: { root, range: g.range, seq: (s.historyEdit?.seq ?? 0) + 1 } }));
  return true;
}

/** Close the Edit History list of a repository (Cancel, a finished or stopped run). */
export function closeHistoryEdit(root: string) {
  if (key(useGit.getState().historyEdit?.root ?? "") === key(root)) useGit.setState({ historyEdit: null });
}

/**
 * Run the plan of the Edit History list, after the same checks and confirmation as every history
 * edit. "done" / "stopped": the list closes; "moved": the branch changed since the list opened
 * (the list reloads); "cancelled" / "failed": the list keeps its choices.
 */
export async function runHistoryEdit(root: string, opened: GitHistoryRange, rows: PlanRow[]): Promise<"done" | "stopped" | "failed" | "moved" | "cancelled"> {
  const bottom = opened.commits[opened.commits.length - 1];
  if (!bottom) return "cancelled";
  const g = await historyGuard(root, bottom.sha, rangeReason("list"), () => true);
  if (!g) return "cancelled";
  const branch = g.branch;
  if (g.range.tip !== opened.tip) {
    toast(movedText(branch, true), "error", 8000);
    return "moved";
  }
  // What is pushed is read now, not when the list opened (a fetch or push may have happened since).
  const pushed = new Map(g.range.commits.map((c) => [c.sha, c.pushed]));
  const fresh = rows.map((r) => ({ ...r, commit: { ...r.commit, pushed: pushed.get(r.commit.sha) ?? r.commit.pushed } }));
  return planRun(root, { range: g.range, branch }, "plan", fresh, "Rewriting history…", {}, true);
}
