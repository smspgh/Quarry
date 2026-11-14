/**
 * Compare tabs (`kind: "diff"`): two texts side by side (or inline) in components/DiffView.tsx,
 * built on @codemirror/merge. A side is a file (editable and savable, in its own encoding and line
 * endings), or a read-only snapshot: a tab's unsaved text, the clipboard. Not kept in the session.
 */
import type { EditorView } from "@codemirror/view";
import { create } from "zustand";
import { choose } from "./dialogs";
import { fs } from "./ipc";
import { newDocId, useStore, type Doc } from "./store";

export interface Side {
  label: string;
  /** Full path, shown as the side's tooltip; null for snapshots. */
  path: string | null;
  text: string;
  editable: boolean;
  /** How the file is written back (from when it was read). */
  encoding: string;
  bom: boolean;
  eol: "LF" | "CRLF" | "CR";
  /** Edited since loaded / saved. */
  dirty: boolean;
  /** Where the text came from, so Reload can read it again. */
  source: Source;
  /** The file's modification time when it was read or saved (file sides): Save checks it. */
  modifiedMs?: number;
}

export interface DiffSession {
  left: Side;
  right: Side;
  /** Side by side, or one editor with removed lines shown inline. */
  inline: boolean;
  /** Fold long unchanged stretches. */
  collapse: boolean;
  /** Bumped when the texts are replaced (reload, swap), so the view rebuilds. */
  version: number;
  /** A Source Control comparison (opened from Changes / Staged Changes): its left side is the
   *  index or HEAD, so single changes and lines can be staged, unstaged or discarded. */
  git?: DiffGit;
  /** The sides were swapped: the partial-staging controls are hidden until swapped back. */
  swapped?: boolean;
}

/** What a Source Control comparison compares (specs/git-staging.md; actions in lib/gitStaging.ts). */
export interface DiffGit {
  root: string;
  path: string;
  /** Opened from Staged Changes: HEAD ↔ staged (Unstage). Else staged / HEAD ↔ working copy (Stage, Discard). */
  staged: boolean;
  /** What the left side is when not `staged`: the staged text, or HEAD when nothing is staged. */
  base?: "staged" | "HEAD";
  /** The file's path in HEAD when it is a staged rename. */
  origPath?: string;
  /** Only the whole file can be acted on (it was deleted): the change buttons do what the row's do. */
  whole?: boolean;
}

export const useDiff = create<{ sessions: Record<string, DiffSession> }>(() => ({ sessions: {} }));

/** The editors of each Compare tab (DiffView). While a side is edited its text lives only in its
 *  editor; `Side.text` is the text as loaded, brought up to date by sideText() when it is needed. */
export const diffViews = new Map<string, { left?: EditorView; right?: EditorView }>();

/** A side's current text: from its editor when it has one. */
export function sideText(docId: string, which: "left" | "right"): string {
  return diffViews.get(docId)?.[which]?.state.doc.toString() ?? diffOf(docId)?.[which].text ?? "";
}

export const diffOf = (docId: string) => useDiff.getState().sessions[docId];

export function patchDiff(docId: string, f: (s: DiffSession) => Partial<DiffSession>) {
  useDiff.setState((st) => {
    const s = st.sessions[docId];
    return s ? { sessions: { ...st.sessions, [docId]: { ...s, ...f(s) } } } : st;
  });
}

export type Source =
  | { kind: "file"; path: string }
  /** An open text tab's current (possibly unsaved) text. */
  | { kind: "tab"; docId: string }
  | { kind: "text"; label: string; text: string };

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

/** Line endings to `\n` (what the editors hold) and the style the text had (pure). */
export function splitEol(text: string): { text: string; eol: "LF" | "CRLF" | "CR" } {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const cr = (text.match(/\r(?!\n)/g) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
  const eol = crlf >= lf && crlf >= cr && crlf > 0 ? "CRLF" : cr > lf ? "CR" : "LF";
  return { text: text.replace(/\r\n?/g, "\n"), eol };
}

export const joinEol = (text: string, eol: "LF" | "CRLF" | "CR") => (eol === "LF" ? text : text.replace(/\n/g, eol === "CRLF" ? "\r\n" : "\r"));

/** Tab title: `a.ts ↔ b.ts`, or `a.ts (src ↔ old)` when the names match (pure). */
export function compareTitle(a: Side, b: Side): string {
  if (a.path && b.path && baseName(a.path).toLowerCase() === baseName(b.path).toLowerCase()) {
    const dir = (p: string) => baseName(p.slice(0, Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"))));
    const da = dir(a.path);
    const db = dir(b.path);
    return da && db && da !== db ? `${baseName(a.path)} (${da} ↔ ${db})` : `${baseName(a.path)} ↔ ${b.label}`;
  }
  return `${a.label} ↔ ${b.label}`;
}

/** Two files with the same name are labelled with their folders too (`old\\stats.ts`). */
export function distinctLabels(a: Side, b: Side): [Side, Side] {
  if (a.label !== b.label || !a.path || !b.path) return [a, b];
  const parent = (p: string) => baseName(p.slice(0, Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"))));
  const pa = parent(a.path);
  const pb = parent(b.path);
  if (!pa || !pb || pa === pb) return [a, b];
  return [{ ...a, label: `${pa}\\${a.label}` }, { ...b, label: `${pb}\\${b.label}` }];
}

async function load(src: Source): Promise<Side> {
  if (src.kind === "text") return { label: src.label, path: null, text: src.text.replace(/\r\n?/g, "\n"), editable: false, encoding: "UTF-8", bom: false, eol: "LF", dirty: false, source: src };
  if (src.kind === "tab") {
    const { editor } = await import("../editor/manager");
    const doc = useStore.getState().docs.find((d) => d.id === src.docId);
    if (!doc || doc.kind !== "text") throw new Error("only text tabs can be compared");
    return { label: doc.dirty ? `${doc.name} (unsaved)` : doc.name, path: doc.path, text: editor.textOf(doc.id), editable: false, encoding: doc.encoding, bom: doc.bom, eol: doc.eol, dirty: false, source: src };
  }
  const st = await fs.stat(src.path);
  if (st.isDir) throw new Error(`${src.path} is a folder`);
  const limit = useStore.getState().settings.largeFileThresholdMb * 1024 * 1024;
  if (st.size >= limit) throw new Error(`${baseName(src.path)} is too large to compare (${Math.round(st.size / 1048576)} MB; the limit is the large-file threshold in Settings)`);
  const f = await fs.readText(src.path);
  if (f.looksBinary) throw new Error(`${baseName(src.path)} looks like a binary file`);
  const { text } = splitEol(f.content);
  return { label: baseName(src.path), path: src.path, text, editable: !st.readonly, encoding: f.encoding, bom: f.hasBom, eol: f.eol, dirty: false, source: src, modifiedMs: f.modifiedMs };
}

/** Read one side (for lib/gitStaging.ts, which re-reads the sides of a Source Control comparison). */
export const loadSide = (src: Source): Promise<Side> => load(src);

/** Open a Compare tab for two sources (left = older / original, right = newer). */
export async function openCompare(a: Source, b: Source, opts: { preview?: boolean; git?: DiffGit } = {}): Promise<Doc | null> {
  const store = useStore.getState();
  let left: Side;
  let right: Side;
  try {
    [left, right] = await Promise.all([load(a), load(b)]);
    [left, right] = distinctLabels(left, right);
  } catch (e) {
    store.toast(`Can't compare: ${e instanceof Error ? e.message : String(e)}`, "error");
    return null;
  }
  const doc: Doc = {
    id: newDocId(),
    kind: "diff",
    path: null,
    name: compareTitle(left, right),
    dirty: false,
    encoding: "",
    bom: false,
    eol: "LF",
    language: "Compare",
    readonly: false,
    modifiedMs: 0,
    preview: opts.preview || undefined,
  };
  // A preview Compare tab is replaced by the next one (clicking through a commit's files), unless
  // it was kept with a double-click on its tab or edited.
  const oldPreview = opts.preview ? store.docs.find((d) => d.kind === "diff" && d.preview && !d.dirty) : undefined;
  useDiff.setState((st) => ({ sessions: { ...st.sessions, [doc.id]: { left, right, inline: false, collapse: true, version: 0, git: opts.git } } }));
  store.addDoc(doc, true);
  if (oldPreview) {
    disposeDiff(oldPreview.id);
    useStore.getState().removeDoc(oldPreview.id);
  }
  if (left.text === right.text) store.toast("The two are identical.", "info", 3000);
  return doc;
}

/** A side was edited (DiffView reports it; the text stays in the editor, see diffViews). */
export function markSideEdited(docId: string, which: "left" | "right") {
  if (diffOf(docId)?.[which].dirty) return;
  patchDiff(docId, (s) => ({ [which]: { ...s[which], dirty: true } }));
  syncDirty(docId);
}

/** Copy the edited sides' text from their editors into the session (before the editors are rebuilt). */
export function captureSideTexts(docId: string) {
  const s = diffOf(docId);
  if (!s) return;
  const left = s.left.dirty ? sideText(docId, "left") : s.left.text;
  const right = s.right.dirty ? sideText(docId, "right") : s.right.text;
  if (left !== s.left.text || right !== s.right.text) patchDiff(docId, (cur) => ({ left: { ...cur.left, text: left }, right: { ...cur.right, text: right } }));
}

function syncDirty(docId: string) {
  const s = diffOf(docId);
  if (!s) return;
  const dirty = s.left.dirty || s.right.dirty;
  const store = useStore.getState();
  if (store.docs.find((d) => d.id === docId)?.dirty !== dirty) store.updateDoc(docId, { dirty });
}

/** Save the edited side(s) back to their files (`only`: that side alone). False when something failed. */
export async function saveDiff(docId: string, only?: "left" | "right"): Promise<boolean> {
  const s = diffOf(docId);
  if (!s) return false;
  let ok = true;
  for (const which of ["left", "right"] as const) {
    const side = s[which];
    if (!side.dirty || !side.path || !side.editable || (only && which !== only)) continue;
    try {
      // Like a normal save: don't silently overwrite a change made since the file was read.
      const now = await fs.stat(side.path).catch(() => null);
      if (now && side.modifiedMs && now.modifiedMs > side.modifiedMs) {
        const overwrite = await choose(
          `${side.label} changed on disk`,
          "The file was modified since it was loaded into this comparison. Overwrite it with the text here?",
          [
            { label: "Overwrite", kind: "danger", value: true },
            { label: "Cancel", cancel: true, default: true, value: false },
          ],
          false,
        );
        if (!overwrite) {
          ok = false;
          continue;
        }
      }
      const text = sideText(docId, which);
      const written = await fs.writeText(side.path, joinEol(text, side.eol), { encoding: side.encoding, bom: side.bom });
      patchDiff(docId, (cur) => ({ [which]: { ...cur[which], text, dirty: false, modifiedMs: written.modifiedMs } }));
    } catch (e) {
      ok = false;
      useStore.getState().toast(`Could not save ${side.label}: ${e}`, "error");
    }
  }
  syncDirty(docId);
  if (ok) useStore.getState().toast("Saved", "success", 1500);
  if (ok) void import("./actions").then((a) => a.checkExternalChanges());
  return ok;
}

/** Read every side again: files from disk, tab snapshots from the tab (the Reload button is
 *  disabled while there are edits). A tab that was closed keeps its last snapshot. */
export async function reloadDiff(docId: string) {
  const s = diffOf(docId);
  if (!s) return;
  // A Source Control comparison reads its git side again too (the index may have changed).
  if (s.git) return void (await (await import("./gitStaging")).reloadChange(docId, { announce: true }));
  await readAgain(docId, true);
}

/** The same without a notice (the changes-on-disk check, after a git operation): true when read. */
export const refreshDiff = (docId: string): Promise<boolean> => readAgain(docId, false);

async function readAgain(docId: string, announce: boolean): Promise<boolean> {
  const s = diffOf(docId);
  if (!s) return false;
  const again = async (side: Side): Promise<Side> => {
    if (side.source.kind === "tab" && !useStore.getState().docs.some((d) => d.id === (side.source as { docId: string }).docId)) return side;
    const next = await load(side.source);
    // Keep the labels distinctLabels() gave (folder prefixes).
    return { ...next, label: side.source.kind === "file" ? side.label : next.label };
  };
  try {
    const [left, right] = await Promise.all([again(s.left), again(s.right)]);
    patchDiff(docId, (cur) => ({ left, right, version: cur.version + 1 }));
    syncDirty(docId);
    if (announce) useStore.getState().toast(left.text === right.text ? "Reloaded: the two are identical." : "Reloaded", "info", 2000);
    return true;
  } catch (e) {
    if (announce) useStore.getState().toast(`Can't reload: ${e instanceof Error ? e.message : String(e)}`, "error");
    return false;
  }
}

export function swapDiff(docId: string) {
  patchDiff(docId, (s) => ({ left: s.right, right: s.left, version: s.version + 1, swapped: !s.swapped }));
  const s = diffOf(docId);
  if (s) useStore.getState().updateDoc(docId, { name: compareTitle(s.left, s.right) });
}

export function disposeDiff(docId: string) {
  diffViews.delete(docId);
  useDiff.setState((st) => {
    const { [docId]: _gone, ...sessions } = st.sessions;
    return { sessions };
  });
}

// ---------- "Select for Compare", then "Compare with Selected" ----------

let candidate: string | null = null;

export const compareCandidate = () => candidate;

export function selectForCompare(path: string) {
  candidate = path;
  useStore.getState().toast(`${baseName(path)} is selected for compare. Right-click another file and choose Compare with Selected.`, "info", 4000);
}

export function compareWithSelected(path: string) {
  if (!candidate) return;
  void openCompare({ kind: "file", path: candidate }, { kind: "file", path });
}
