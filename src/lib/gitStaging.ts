/**
 * Partial staging (specs/git-staging.md): stage, unstage or discard one change, or the selected
 * lines, of a Source Control comparison (a Compare tab opened from Changes / Staged Changes; its
 * session carries `git`). These actions are the only entry points: the change bars, the toolbar
 * buttons and the six `git.*Change` / `git.*Lines` commands all come here, so the guards (busy,
 * swapped sides, save first, the Discard question, the stale check) hold on every route.
 * Line-range logic is in gitHunks.ts; the patch is built and applied in Rust (git/staging.rs).
 */
import { getChunks, getOriginalDoc } from "@codemirror/merge";
import type { EditorView } from "@codemirror/view";
import { choose } from "./dialogs";
import { compareTitle, diffOf, diffViews, loadSide, openCompare, patchDiff, saveDiff, sideText, useDiff, type DiffGit, type DiffSession, type Source } from "./diff";
import { discard, onGitAction, refreshGit, repoOf, stage, unstage, useGit } from "./git";
import { git, type GitFile, type GitStatus } from "./gitApi";
import { discardText, hunkAt, hunksOf, picksForSelection, textHash, type Pick } from "./gitHunks";
import { gitErrorText } from "./gitStatus";
import { fs } from "./ipc";
import { useStore } from "./store";

/** Start of the Rust error for "the index or the file is not what the comparison shows". */
export const STALE = "quarry-stale";

export type ApplyAction = "stage" | "unstage" | "discard";
export type ApplyScope = "change" | "lines";

const key = (p: string) => p.toLowerCase();
const nameOf = (p: string) => p.slice(p.lastIndexOf("\\") + 1);
const toast = (m: string, kind: "info" | "success" | "error" | "warning" = "info", ms?: number) => useStore.getState().toast(m, kind, ms);
const openTab = (path: string) => useStore.getState().docs.find((d) => d.kind === "text" && d.path && key(d.path) === key(path));

export const staleMessage = (name: string) => `${name} changed since this comparison was loaded. It was reloaded: check the change and try again.`;

// ---------- what a Source Control comparison shows ----------

/**
 * The two sides of a file's comparison as git and the disk have them now. Staged: HEAD ↔ index.
 * Otherwise index ↔ working copy (the open tab, else the file), the left labelled "(staged)" when
 * something of the file is staged, "(HEAD)" when not.
 */
export async function changeSources(g: DiffGit, f: GitFile | undefined): Promise<{ left: Source; right: Source; git: DiffGit }> {
  const show = (rev: string, path = g.path) => git.show(path, rev).catch(() => null);
  const name = nameOf(g.path);
  const text = (label: string, t: string | undefined): Source => ({ kind: "text", label: `${name} (${label})`, text: t ?? "" });
  if (g.staged) {
    const origPath = f?.origPath ?? undefined;
    const [a, b] = await Promise.all([show("HEAD", origPath ?? g.path), show(":")]);
    // A staged deletion has no staged text: only the whole file can be unstaged.
    return { left: text("HEAD", a?.text), right: text("staged", b?.text), git: { root: g.root, path: g.path, staged: true, origPath, whole: b === null && a !== null } };
  }
  const somethingStaged = !!f && !f.untracked && f.index !== ".";
  const base = await show(":");
  const tab = openTab(g.path);
  const exists = tab ? true : await fs.exists(g.path).catch(() => false);
  const right: Source = tab ? { kind: "tab", docId: tab.id } : exists ? { kind: "file", path: g.path } : text("deleted", "");
  return { left: text(somethingStaged ? "staged" : "HEAD", base?.text), right, git: { root: g.root, path: g.path, staged: false, base: somethingStaged ? "staged" : "HEAD", whole: !exists } };
}

/** The Source Control panel's comparison of a changed file (`openChange` in git.ts): an open one
 *  for the same file and section is shown again, brought up to date. */
export async function openChangeCompare(f: GitFile, staged: boolean) {
  const open = Object.entries(useDiff.getState().sessions).find(([, s]) => s.git && s.git.staged === staged && key(s.git.path) === key(f.path));
  if (open) {
    useStore.getState().setActive(open[0]);
    if (!open[1].left.dirty && !open[1].right.dirty) await reloadChange(open[0]);
    return;
  }
  const root = repoOf(f.path)?.root;
  const src = await changeSources({ root: root ?? "", path: f.path, staged }, f);
  await openCompare(src.left, src.right, { git: root ? src.git : undefined });
}

/** Latest reload per tab (an older one that finishes later is dropped). */
const reloads = new Map<string, number>();

/**
 * Read both sides of a Source Control comparison again, from git and the disk / the tab. The view
 * is only rebuilt when something changed. False when it could not be read.
 */
export async function reloadChange(docId: string, opts: { announce?: boolean } = {}): Promise<boolean> {
  const s = diffOf(docId);
  if (!s?.git) return false;
  const seq = (reloads.get(docId) ?? 0) + 1;
  reloads.set(docId, seq);
  try {
    const st: GitStatus | null = await git.status(s.git.root).catch(() => null);
    const src = await changeSources(s.git, st?.files.find((x) => key(x.path) === key(s.git!.path)));
    let [left, right] = await Promise.all([loadSide(src.left), loadSide(src.right)]);
    const cur = diffOf(docId);
    if (!cur?.git || reloads.get(docId) !== seq) return false;
    if (cur.swapped) [left, right] = [right, left];
    const same = (["left", "right"] as const).every((w) => {
      const [now, was] = [w === "left" ? left : right, cur[w]];
      return !was.dirty && now.text === was.text && now.label === was.label && now.editable === was.editable;
    });
    patchDiff(docId, (c) => ({ left, right, git: src.git, ...(same ? {} : { version: c.version + 1 }) }));
    useStore.getState().updateDoc(docId, { name: compareTitle(left, right), dirty: false });
    if (opts.announce) toast(left.text === right.text ? "Reloaded: the two are identical." : "Reloaded", "info", 2000);
    return true;
  } catch (e) {
    if (opts.announce) toast(`Can't reload: ${e instanceof Error ? e.message : String(e)}`, "error");
    return false;
  } finally {
    if (reloads.get(docId) === seq) reloads.delete(docId);
  }
}

/**
 * Bring every Source Control comparison (of `only`'s file, or all) up to date with the index.
 * A comparison with unsaved edits is left alone.
 */
export async function refreshChangeTabs(only?: { root: string; path: string }) {
  const ids = Object.entries(useDiff.getState().sessions)
    .filter(([, s]) => s.git && !s.left.dirty && !s.right.dirty && (!only || (key(s.git.root) === key(only.root) && key(s.git.path) === key(only.path))))
    .map(([id]) => id);
  await Promise.all(ids.map((id) => reloadChange(id)));
}

// Staging, unstaging, discarding or committing from the panel (any git action) refreshes them.
onGitAction(() => void refreshChangeTabs());

// ---------- what the cursor and the selection point at ----------

interface Live {
  s: DiffSession;
  g: DiffGit;
  view: EditorView;
  hunks: Pick[];
}

/** The comparison's changes as they are in its editors now (null: not a Source Control
 *  comparison, sides swapped, or the editors are not built yet). */
function live(docId: string | null | undefined): Live | null {
  if (!docId) return null;
  const s = diffOf(docId);
  const views = diffViews.get(docId);
  const view = views?.right;
  if (!s?.git || s.swapped || !view) return null;
  const got = getChunks(view.state);
  if (!got) return null;
  // Side by side: the left editor's text; inline: the original kept by the single editor.
  const a = views.left?.state.doc ?? getOriginalDoc(view.state);
  return { s, g: s.git, view, hunks: hunksOf(got.chunks, a, view.state.doc) };
}

function cursorChange(l: Live): number {
  const { state } = l.view;
  const head = state.selection.main.head;
  // The same rule as the toolbar's "Change 2 of 5", then the whole line of removed lines.
  const got = getChunks(state);
  const i = got ? got.chunks.findIndex((c) => head >= c.fromB && head <= Math.max(c.fromB, c.toB)) : -1;
  return i >= 0 ? i : hunkAt(l.hunks, state.doc.lineAt(head).number, state.doc.lines);
}

function selectionPicks(l: Live): Pick[] {
  if (l.g.whole) return [];
  const { state } = l.view;
  const sel = state.selection.main;
  const from = state.doc.lineAt(sel.from);
  let to = state.doc.lineAt(sel.to);
  // A selection that ends at the start of a line does not include that line.
  if (!sel.empty && sel.to === to.from && to.number > from.number) to = state.doc.line(to.number - 1);
  return picksForSelection(l.hunks, from.number, to.number, state.doc.lines);
}

/** Index of the change the cursor of the comparison's right side is in (-1: none). */
export function changeAtCursor(docId: string | null | undefined): number {
  const l = live(docId);
  return l ? cursorChange(l) : -1;
}

/** What the right side's selection (a bare cursor: its line) would take from the changes. */
export function selectedLines(docId: string | null | undefined): Pick[] {
  const l = live(docId);
  return l ? selectionPicks(l) : [];
}

/** Which actions a comparison offers: Unstage in a staged one, Stage and Discard otherwise. */
export const fits = (g: DiffGit, action: ApplyAction) => (action === "unstage") === g.staged;

/** A partial-staging action is running (from its first click to the refreshed comparison). */
let applying = false;

/**
 * Can `action` run on this tab now? The one rule behind the buttons' and the commands' enabled
 * state: a Source Control comparison of the right kind, sides not swapped, git idle, and the
 * cursor in a change (`change`) or a selection that touches one (`lines`).
 */
export function canApply(docId: string | null | undefined, action: ApplyAction, scope: ApplyScope): boolean {
  const l = live(docId);
  if (!l || !fits(l.g, action) || applying || useGit.getState().busy) return false;
  return scope === "change" ? cursorChange(l) >= 0 : selectionPicks(l).length > 0;
}

// ---------- the actions ----------

const BUSY: Record<ApplyAction, string> = { stage: "Staging…", unstage: "Unstaging…", discard: "Discarding…" };

/** Stage / unstage / discard one change: the one at `index`, else the one at the cursor. */
export async function applyChange(docId: string, action: ApplyAction, index?: number): Promise<boolean> {
  const l = live(docId);
  if (!l || !fits(l.g, action) || applying || useGit.getState().busy) return false;
  const hunk = l.hunks[index ?? cursorChange(l)];
  if (!hunk) return false;
  if (l.g.whole) return wholeFile(l.g, action);
  return applyPicks(docId, action, [hunk], "change");
}

/** Stage / unstage / discard what the right side's selection covers. */
export async function applySelection(docId: string, action: ApplyAction): Promise<boolean> {
  const l = live(docId);
  if (!l || !fits(l.g, action) || applying || useGit.getState().busy) return false;
  const picks = selectionPicks(l);
  if (!picks.length) return false;
  return applyPicks(docId, action, picks, "lines");
}

export const stageHunk = (docId: string, index?: number) => applyChange(docId, "stage", index);
export const unstageHunk = (docId: string, index?: number) => applyChange(docId, "unstage", index);
export const discardHunk = (docId: string, index?: number) => applyChange(docId, "discard", index);
export const stageLines = (docId: string) => applySelection(docId, "stage");
export const unstageLines = (docId: string) => applySelection(docId, "unstage");
export const discardLines = (docId: string) => applySelection(docId, "discard");

/** A deleted file has one change, the whole file: do what its row's Stage / Unstage / Discard do
 *  (Discard asks the file-level question). */
async function wholeFile(g: DiffGit, action: ApplyAction): Promise<boolean> {
  applying = true;
  try {
    if (action === "stage") return (await stage(g.root, [g.path])) !== undefined;
    if (action === "unstage") return (await unstage(g.root, [g.path])) !== undefined;
    const st = await git.status(g.root).catch(() => null);
    const f = st?.files.find((x) => key(x.path) === key(g.path));
    if (!f) return false;
    await discard(g.root, [f]);
    return true;
  } finally {
    applying = false;
  }
}

async function applyPicks(docId: string, action: ApplyAction, picks: Pick[], scope: ApplyScope): Promise<boolean> {
  applying = true;
  try {
    return await applyGuarded(docId, action, picks, scope);
  } finally {
    applying = false;
  }
}

async function applyGuarded(docId: string, action: ApplyAction, picks: Pick[], scope: ApplyScope): Promise<boolean> {
  const s = diffOf(docId);
  const g = s?.git;
  if (!s || !g) return false;
  const name = nameOf(g.path);
  const stale = async () => {
    await reloadChange(docId);
    toast(staleMessage(name), "warning", 8000);
    return false;
  };

  // Stage and Discard work on the file on disk: what the comparison shows must be what gets
  // saved. Unstage never reads the working file, so it saves nothing.
  let save: "tab" | "side" | null = null;
  const tab = action === "unstage" ? undefined : openTab(g.path);
  if (action !== "unstage") {
    const src = s.right.source;
    if (tab) {
      const { editor } = await import("../editor/manager");
      const shown = src.kind === "tab" && src.docId === tab.id;
      if (shown && editor.textOf(tab.id) !== sideText(docId, "right")) return stale(); // typed more since
      if (!shown && tab.dirty) {
        // The comparison shows the file on disk, and the tab holds other, unsaved text.
        if (s.right.dirty) {
          toast(`${name} has unsaved changes in its tab and in this comparison. Save one of them first.`, "warning", 7000);
          return false;
        }
        return stale();
      }
      if (tab.dirty) save = "tab";
    }
    if (!save && s.right.dirty) save = "side";
  }

  if (action === "discard") {
    const base = g.base === "staged" ? "the staged version" : "the last commit";
    const ok = await choose(
      scope === "change" ? "Discard this change?" : "Discard the selected lines?",
      discardText(picks, name, base) + (save ? `\n\n${name} has unsaved changes; they are saved first.` : ""),
      [
        { label: scope === "change" ? "Discard Change" : "Discard Lines", kind: "danger", value: true },
        { label: "Cancel", cancel: true, default: true, value: false },
      ],
      false,
    );
    if (!ok) return false;
  }

  if (save === "tab" && tab) {
    const { saveDocument } = await import("./actions");
    if (!(await saveDocument(tab.id))) return false;
    // Saving can change the text (trimmed spaces, a formatter): then the lines may have moved.
    const { editor } = await import("../editor/manager");
    if (editor.textOf(tab.id) !== sideText(docId, "right")) return stale();
  } else if (save === "side") {
    if (!(await saveDiff(docId))) return false;
  }

  const expect = { left: textHash(sideText(docId, "left")), right: textHash(sideText(docId, "right")), encoding: action === "unstage" ? null : s.right.encoding || null };
  let error: string | null = null;
  useGit.setState({ busy: BUSY[action] });
  try {
    await git.applyLines(g.root, g.path, action, picks, expect, g.staged ? g.origPath : undefined);
  } catch (e) {
    error = String(e);
  } finally {
    useGit.setState({ busy: null });
    refreshGit(0);
  }
  if (error !== null) {
    if (error.includes(STALE)) return stale();
    toast(gitErrorText(error), "error", 12000);
    await reloadChange(docId);
    return false;
  }
  // The file's tab (clean: it was saved above) shows the restored lines, without a question.
  if (action === "discard" && tab) {
    const { revertDocument } = await import("./actions");
    await revertDocument(tab.id, { confirm: false, silent: true });
  }
  // This comparison and the file's other one (Changes ↔ Staged Changes) follow the index.
  await refreshChangeTabs({ root: g.root, path: g.path });
  return true;
}
