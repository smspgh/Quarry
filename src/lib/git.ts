/**
 * Git integration: which open folder / documents are in a repository and their status (for the
 * Explorer, the status bar and the Source Control panel), the HEAD text behind the editor's change
 * markers, line blame, and the actions (stage, commit, branches, pull / push, history). The git
 * work itself is Rust (src-tauri/src/git.rs, wrappers in gitApi.ts); see editor/git.ts for the
 * editor side.
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
import { fs } from "./ipc";
import { displayUrl, gitErrorText, hasConflictMarkers, isMissingRepo, KIND_RANK, kindOf, operationDone, operationWords, type GitKind } from "./gitStatus";

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
  }
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
  const open = useStore.getState().docs.find((d) => d.kind === "text" && d.dirty && d.path && key(d.path) === key(f.path));
  if (open) {
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
  const out = await run("Resolving…", () => git.resolveSide(root, f.path, side));
  if (out === undefined) return;
  const which = side === "ours" ? "current" : "incoming";
  toast(out === "deleted" ? `${name}: deleted (the ${which} side had deleted it).` : `${name}: took the ${which} version.`, "success", 3500);
  const st = useStore.getState();
  const doc = st.docs.find((d) => d.kind === "text" && d.path && key(d.path) === key(f.path));
  if (doc) {
    const { revertDocument, closeDocument } = await import("./actions");
    if (out === "deleted") {
      st.updateDoc(doc.id, { dirty: false });
      await closeDocument(doc.id);
    } else await revertDocument(doc.id, { confirm: false, silent: true });
  }
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
  const { askDialog, checkExternalChanges } = await import("./actions");
  if (how === "skip") {
    const w = operationWords(operation);
    const ok = await askDialog(`Skip this ${w.item}?`, `The ${w.item} ${w.noun} stopped on is left out: its changes will not be on the branch. ${w.noun[0].toUpperCase()}${w.noun.slice(1)} then carries on with the rest.`, `Skip ${w.item[0].toUpperCase()}${w.item.slice(1)}`);
    if (!ok) return;
  }
  const out = await run(how === "skip" ? "Skipping…" : "Continuing…", () => git.continueOp(root, how));
  void checkExternalChanges();
  if (out === undefined) return;
  // Status is refreshed by run(); a rebase that is still going shows its next step there.
  const still = await git.status(root).catch(() => null);
  toast(operationDone(out || operation, how, !!still?.operation), "success", 3500);
  rewriteContinued(root, still); // a rebase of pushed commits that finished this way (MERGE-009)
}

/** The last conflict of a document was just resolved in the editor: offer to finish the file. */
async function conflictsCleared(view: EditorView) {
  const st = useStore.getState();
  const doc = st.docs.find((d) => d.kind === "text" && editor.viewOf(d.id) === view) ?? st.docs.find((d) => d.id === st.activeId);
  if (!doc?.path) return;
  const repo = repoOf(doc.path);
  const file = repo?.files.find((f) => f.conflicted && key(f.path) === key(doc.path!));
  if (!repo || !file) return;
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
  const untracked = files.filter((f) => f.untracked).length;
  const name = files.length === 1 ? files[0].path.slice(files[0].path.lastIndexOf("\\") + 1) : `${files.length} files`;
  const msg =
    untracked === files.length
      ? `${name} ${files.length === 1 ? "is" : "are"} not tracked by git and will be moved to the Recycle Bin.`
      : `Your changes to ${name} will be lost${untracked ? ` (${untracked} untracked file${untracked === 1 ? " goes" : "s go"} to the Recycle Bin)` : ""}. Open tabs reload the committed text.`;
  const ok = await choose("Discard changes?", msg, [
    { label: "Discard", kind: "danger", value: true },
    { label: "Cancel", cancel: true, default: true, value: false },
  ], false);
  if (!ok) return;
  await run("Discarding…", () => git.discard(root, files.map((f) => f.path)));
  const { checkExternalChanges } = await import("./actions");
  void checkExternalChanges();
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
    if (!changed.length) {
      toast("There is nothing to commit.", "info");
      return false;
    }
    const all = await choose("Nothing is staged", `Stage all ${changed.length} changed file${changed.length === 1 ? "" : "s"} and commit them?`, [
      { label: "Stage All and Commit", kind: "primary", default: true, value: true },
      { label: "Cancel", cancel: true, value: false },
    ], false);
    if (!all) return false;
    if ((await stage(root, changed.map((f) => f.path))) === undefined) return false;
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
  const out = await run(label, () =>
    git.remote(root, op).catch((e) => {
      failure = String(e);
      throw e;
    }),
  );
  if (isMissingRepo(failure)) markChecked(root, failure);
  if (out === undefined) return;
  if (op === "fetch") markChecked(root, null);
  const last = out.trim().split(/\r?\n/).filter(Boolean).pop();
  toast(op === "fetch" ? "Fetched." : pull ? (last && /up to date/i.test(last) ? "Already up to date." : "Pulled.") : "Pushed.", "success", 3000);
  if (pull) {
    const { checkExternalChanges } = await import("./actions");
    void checkExternalChanges();
  }
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
 * default), or "merge" / "rebase", which are refused here when they cannot start.
 */
export async function pickBranch(purpose: BranchPurpose = "switch") {
  const repo = currentRepo();
  if (!repo) {
    toast("The open folder is not in a git repository.", "info");
    return;
  }
  if (purpose !== "switch") {
    const blocked = startBlocked(repo, purpose, useGit.getState().busy);
    if (blocked) {
      toast(`${blocked}.`, "info", 4000);
      return;
    }
  }
  useGit.setState({ branches: null, branchPick: purpose });
  useStore.getState().set({ palette: "branch" });
  const list = await git.branches(repo.root).catch((e) => {
    toast(String(e), "error");
    return [] as GitBranch[];
  });
  useGit.setState({ branches: list });
}

export async function checkout(name: string, create = false) {
  const repo = currentRepo();
  if (!repo) return;
  const ok = await run(create ? `Creating ${name}…` : `Switching to ${name}…`, () => git.checkout(repo.root, name, create));
  if (ok === undefined) return;
  toast(create ? `Created and switched to ${name}` : `Switched to ${name}`, "success", 2500);
  const { checkExternalChanges } = await import("./actions");
  void checkExternalChanges();
}

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
  const { openCompare } = await import("./diff");
  const { openPath } = await import("./actions");
  const kind = kindOf(f);
  // A conflicted file has no single "before" to compare with: open the file itself, where git's
  // conflict markers show both sides to choose from.
  if (kind === "untracked" || (kind === "added" && !staged) || kind === "conflict") {
    if (kind !== "conflict" || (await fs.exists(f.path))) void openPath(f.path);
    else toast(`${nameOf(f.path)} was deleted on one side and is not in the folder. Mark it resolved with + to keep it deleted${repoOf(f.path)?.operation ? ", or abort" : ""}.`, "info", 7000);
    return;
  }
  const show = (rev: string, path = f.path) => git.show(path, rev).catch(() => null);
  const name = nameOf(f.path);
  if (staged) {
    const [a, b] = await Promise.all([f.origPath ? show("HEAD", f.origPath) : show("HEAD"), show(":")]);
    await openCompare({ kind: "text", label: `${name} (HEAD)`, text: a?.text ?? "" }, { kind: "text", label: `${name} (staged)`, text: b?.text ?? "" });
    return;
  }
  const base = f.index !== "." ? await show(":") : await show("HEAD");
  const left = { kind: "text" as const, label: `${name} (${f.index !== "." ? "staged" : "HEAD"})`, text: base?.text ?? "" };
  const doc = useStore.getState().docs.find((d) => d.kind === "text" && d.path && key(d.path) === key(f.path));
  if (kind === "deleted" && !(await fs.exists(f.path))) await openCompare(left, { kind: "text", label: `${name} (deleted)`, text: "" });
  else if (doc) await openCompare(left, { kind: "tab", docId: doc.id });
  else await openCompare(left, { kind: "file", path: f.path });
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

/** Run a graph action on a commit. True when it worked (open files are then re-checked against disk). */
export async function commitAction(root: string, action: GitCommitAction, sha: string, name?: string): Promise<boolean> {
  const out = await run(ACTION_LABEL[action], () => git.commitAction(root, action, sha, name));
  if (out === undefined) return false;
  if (action !== "branch" && action !== "tag") {
    const { checkExternalChanges } = await import("./actions");
    void checkExternalChanges();
  }
  return true;
}

/** Abandon the operation in progress (a stopped merge, rebase, cherry-pick or revert), after asking. */
export async function abortOperation(root: string, operation: string) {
  const { askDialog, checkExternalChanges } = await import("./actions");
  const w = operationWords(operation);
  const ok = await askDialog(`Abort ${w.noun}?`, `Everything goes back to how it was before ${w.noun} started. Conflict resolutions made so far are discarded.`, w.abortLabel);
  if (!ok) return;
  const out = await run("Aborting…", () => git.abort(root));
  if (out === undefined) return;
  toast(operationDone(out || operation, "abort"), "info", 3000);
  pendingRewrite.delete(key(root)); // nothing was rewritten after all (MERGE-009)
  void checkExternalChanges();
}

/** Switch to a branch from the graph (a remote branch gets a local tracking branch). */
export async function checkoutRef(root: string, name: string): Promise<boolean> {
  const ok = (await run(`Switching to ${name}…`, () => git.checkout(root, name).then(() => true))) === true;
  if (ok) {
    const { checkExternalChanges } = await import("./actions");
    void checkExternalChanges();
  }
  return ok;
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
  if (dirty) {
    const d = dirtyRefusal(kind, dirty);
    if (await choose(d.title, d.text, d.choices, false)) showPanel("git");
    return null;
  }
  return st;
}

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
async function runStart(root: string, label: string, fn: () => Promise<string>): Promise<"done" | "stopped" | "failed"> {
  const out = await run(label, fn);
  const { checkExternalChanges } = await import("./actions");
  void checkExternalChanges();
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
  const plan = mergeConfirm(p, t.label, st.branch);
  if (plan.nothing !== undefined) {
    toast(plan.nothing, "info", 4000);
    return false;
  }
  const mode = await choose(plan.title, plan.text, plan.choices, null);
  if (!mode) return false;
  if ((await runStart(root, "Merging…", () => git.merge(root, p.target, mode))) !== "done") return false;
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
  const how = await choose(plan.title, plan.text, plan.choices, null);
  if (!how) return false;
  // Pushed commits get new ids (or the branch was already rewritten and not force pushed yet).
  const rewrites = how === "rebase" && (p.pushed > 0 || useGit.getState().rewrotePushed[key(root)] === branch);
  const result = await runStart(root, "Rebasing…", () => (how === "ff" ? git.merge(root, p.target, "ff-only") : git.rebase(root, p.target)));
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
 * run on a fresh status. True when a stash was made. (The unsaved-tabs question of SAFE-003.6 is
 * not asked here yet: the files are taken as they are on disk.)
 */
export async function stashChanges(root: string, message: string, untracked: boolean): Promise<boolean> {
  if (useGit.getState().busy) return false;
  const st = await git.status(root).catch(() => null);
  const why = st ? stashBlocked(st, "stash") : "Git could not read the repository";
  if (!st || why) {
    toast(`${why}.`, "info", 4000);
    return false;
  }
  const n = stashCounts(st.files);
  const files = n.tracked + (untracked ? n.untracked : 0);
  if (!files) {
    toast("Only untracked files have changed: tick the box to stash them.", "info", 4000);
    return false;
  }
  const sha = await run("Stashing…", () => git.stashPush(root, message, untracked));
  if (sha === undefined) return false;
  useGit.setState({ stashForm: false });
  toast(stashDone("stash", message, files), "success", 4000);
  await loadStashes(root);
  const { checkExternalChanges } = await import("./actions");
  void checkExternalChanges();
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
    await loadStashes(root);
  }
}

/**
 * Apply, pop or drop a stash, named by its commit id (so a list that went stale cannot hit another
 * one). Drop asks first, with Cancel as the default; apply and pop are refused while an operation
 * is stopped or files are in conflict (checked on a fresh status). An apply / pop that conflicts
 * is not an error: the files go to Merge Changes and the stash is remembered in `stashPending`.
 * (The unsaved-tabs question of SAFE-003.7 is not asked here yet.) True when git ran.
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
  const out = await stashRun(what === "pop" ? "Popping stash…" : "Applying stash…", root, stash.sha, what);
  const { checkExternalChanges } = await import("./actions");
  void checkExternalChanges();
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
