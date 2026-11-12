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
import { git, type GitBranch, type GitCommitAction, type GitCommitFile, type GitFile, type GitLogEntry, type GitIdentity, type GitRemoteOp, type GitStatus, type GithubRepo } from "./gitApi";
import { newDocId, useStore, type Doc } from "./store";
import { fs } from "./ipc";
import { isMissingRepo, KIND_RANK, kindOf, type GitKind } from "./gitStatus";

export { isMissingRepo, KIND_LABEL, KIND_LETTER, kindOf, type GitKind } from "./gitStatus";
import { choose } from "./dialogs";

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
}

export const useGit = create<GitState>(() => ({
  available: null,
  repos: {},
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
  return (s.current && s.repos[s.current]) || Object.values(s.repos)[0] || null;
}

// ---------- status ----------

/** Folders known not to be in a repository (so they aren't asked again). */
const notRepo = new Set<string>();

function interesting(): string[] {
  const s = useStore.getState();
  const out: string[] = [];
  if (s.folder) out.push(s.folder);
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
  const want = interesting();
  // Known repositories still in view, plus a lookup for each place not under one yet.
  const roots = Object.values(useGit.getState().repos)
    .map((r) => r.root)
    .filter((root) => want.some((p) => under(p, root) || under(root, p)));
  const lookups = want.filter((p) => !roots.some((r) => under(p, r)) && !notRepo.has(key(p)));
  const results = await Promise.all([...roots, ...new Set(lookups)].map((p) => git.status(p).then((st) => ({ p, st })).catch(() => ({ p, st: null }))));
  const repos: Record<string, GitStatus> = {};
  for (const { p, st } of results) {
    if (st) repos[key(st.root)] = st;
    else notRepo.add(key(p));
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
  const folderRepo = folder ? Object.keys(repos).find((k) => under(folder, repos[k].root)) : undefined;
  const current = cur && repos[cur] ? cur : folderRepo || Object.keys(repos)[0] || null;
  useGit.setState({ repos, files, dirs, current });
  void syncBases();
}

/** Forget the "not a repository" answers (a folder may have become one: git init, clone). */
export function rescanGit() {
  notRepo.clear();
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
  const unsub = useStore.subscribe((s, prev) => {
    if (s.folder !== prev.folder) {
      // The panel follows the newly opened folder's repository.
      useGit.setState({ current: null });
      rescanGit();
    }
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
    toast(String(e).replace(/^Error: /, ""), "error", 12000);
    return undefined;
  } finally {
    useGit.setState({ busy: null });
    refreshGit(0);
  }
}

export const stage = (root: string, paths: string[]) => run("Staging…", () => git.stage(root, paths));
export const unstage = (root: string, paths: string[]) => run("Unstaging…", () => git.unstage(root, paths));

export async function discard(root: string, files: GitFile[]): Promise<void> {
  if (!files.length) return;
  const untracked = files.filter((f) => f.untracked).length;
  const name = files.length === 1 ? files[0].path.slice(files[0].path.lastIndexOf("\\") + 1) : `${files.length} files`;
  const msg =
    untracked === files.length
      ? `${name} ${files.length === 1 ? "is" : "are"} not tracked by git and will be moved to the Recycle Bin.`
      : `Your changes to ${name} will be lost${untracked ? ` (${untracked} untracked file${untracked === 1 ? "" : "s"} go to the Recycle Bin)` : ""}. Open tabs reload the committed text.`;
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
  toast(opts.replace ? `Remote ${n} now points to ${u}.` : `Added remote ${n}.`, "success", 3000);
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

/** Open the branch picker (palette mode "branch"). */
export async function pickBranch() {
  const repo = currentRepo();
  if (!repo) {
    toast("The open folder is not in a git repository.", "info");
    return;
  }
  useGit.setState({ branches: null });
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
  if (kind === "untracked" || (kind === "added" && !staged)) {
    void openPath(f.path);
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
  await openCompare({ kind: "text", label: `${name} @ ${entry.short}^`, text: a?.text ?? "" }, { kind: "text", label: `${name} @ ${entry.short}`, text: b?.text ?? "" });
}

// ---------- commit graph ----------

/** Open the commit graph of a repository (the current one) in a tab; an open one is reused. */
export function openGraph(root?: string) {
  const repo = root ? useGit.getState().repos[key(root)] : currentRepo();
  if (!repo) {
    toast("The open folder is not in a git repository.", "info");
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
  const ok = await askDialog(`Abort the ${operation}?`, `Everything goes back to how it was before the ${operation} started. Conflict resolutions made so far are discarded.`, `Abort ${operation[0].toUpperCase()}${operation.slice(1)}`);
  if (!ok) return;
  const out = await run("Aborting…", () => git.abort(root));
  if (out === undefined) return;
  toast(`Aborted the ${out}.`, "info", 3000);
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
