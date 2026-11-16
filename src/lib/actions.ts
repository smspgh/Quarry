/**
 * Document-level operations shared by menus, shortcuts, the palette and macros.
 */
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Text } from "@codemirror/state";
import { editor } from "../editor/manager";
import { detectLanguage } from "../editor/cmSetup";
import { bus } from "./bus";
import { claudeBusy, disposeClaude, openClaudeTab, stopAllClaude } from "./claude";
import { disposeTerminal, terminalPty } from "./terminal";
import { stopAllServers } from "./lsp";
import { disposeDiff, patchDiff, refreshDiff, saveDiff, useDiff } from "./diff";
import { keptNotice, missingNotice, reloadedNotice } from "./gitSafety";
import { clampBottomHeight, showPanel } from "./panels";
import { makeRoom, markUsed } from "./tabLimit";
import { popClosed, pushClosed, type ClosedTab } from "./closedTabs";
import { appData, big, fs, sys } from "./ipc";
import { activeDoc, newDocId, PANELS, useStore, type Doc, type SidebarPanel } from "./store";
import type { BigDocInfo, FileStat, Settings, TextFile } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { choose } from "./dialogs";

const SETTINGS_FILE = "settings.json";
const SESSION_FILE = "session.json";

function baseName(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i >= 0 ? path.slice(i + 1) : path;
}

export function dirName(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i >= 0 ? path.slice(0, i) : "";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Canonical spelling of a Windows path for comparisons: backslashes, no trailing separator
 * (except a drive root), lower-cased. Pure; does not touch the disk.
 */
export function normalizePath(path: string): string {
  // Rust's canonicalize() yields verbatim paths (`\\?\C:\…`); compare them as plain paths.
  let p = path.replace(/^\\\\\?\\(UNC\\)?/i, (_, unc) => (unc ? "\\\\" : "")).replace(/\//g, "\\");
  while (p.length > 3 && p.endsWith("\\")) p = p.slice(0, -1);
  if (/^[a-z]:$/i.test(p)) p += "\\";
  return p.toLowerCase();
}

export function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && normalizePath(a) === normalizePath(b);
}

// ---------- dirty tracking against the saved snapshot ----------

interface Snapshot {
  doc: Text;
  eol: Doc["eol"];
  encoding: string;
  bom: boolean;
}

/** Content + settings as last loaded/saved per document; lets undo back to the saved text clear `dirty`. */
const snapshots = new Map<string, Snapshot>();
const SNAPSHOT_COMPARE_MAX = 4 * 1024 * 1024;

function takeSnapshot(docId: string, written?: Text) {
  const text = written ?? editor.docOf(docId);
  const doc = useStore.getState().docs.find((d) => d.id === docId);
  if (!text || !doc) return;
  snapshots.set(docId, { doc: text, eol: doc.eol, encoding: doc.encoding, bom: doc.bom });
}

editor.onDocUpdate((docId, u) => {
  if (!u.docChanged) return;
  const snap = snapshots.get(docId);
  if (!snap) return;
  const cur = u.state.doc;
  if (cur.length !== snap.doc.length || cur.length > SNAPSHOT_COMPARE_MAX) return;
  if (!cur.eq(snap.doc)) return;
  const store = useStore.getState();
  const doc = store.docs.find((d) => d.id === docId);
  if (doc && doc.dirty && doc.eol === snap.eol && doc.encoding === snap.encoding && doc.bom === snap.bom) {
    store.updateDoc(docId, { dirty: false });
  }
});

/** Pure helper (testable): the lowest N not used by an open "Untitled-N" tab. */
export function nextUntitledNumber(names: string[]): number {
  const used = new Set(names.map((n) => /^Untitled-(\d+)$/.exec(n)?.[1]).filter(Boolean).map(Number));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

export async function newDocument(text = "", name?: string): Promise<Doc> {
  const s = useStore.getState();
  const id = newDocId();
  const doc: Doc = {
    id,
    kind: "text",
    path: null,
    name: name ?? `Untitled-${nextUntitledNumber(s.docs.map((d) => d.name))}`,
    dirty: text.length > 0,
    encoding: "UTF-8",
    bom: false,
    eol: s.settings.defaultEol,
    language: "Plain Text",
    readonly: false,
    modifiedMs: 0,
  };
  s.addDoc(doc, false);
  const lang = await editor.create(id, text, name ?? null);
  s.updateDoc(id, { language: lang });
  if (text.length === 0) takeSnapshot(id);
  s.setActive(id);
  return doc;
}

/**
 * Open a file in a tab (or show its tab). `preview`: an Explorer single click, which replaces the
 * previous preview tab when that has no unsaved changes. `noLimit`: skip the open-tab limit
 * (session restore, or a caller that already made room with `makeRoom`).
 */
export async function openPath(path: string, opts: { line?: number; col?: number; activate?: boolean; preview?: boolean; noLimit?: boolean } = {}): Promise<Doc | null> {
  const store = useStore.getState();
  const existing = store.docs.find((d) => samePath(d.path, path));
  const oldPreview = opts.preview ? store.docs.find((d) => d.preview && !d.dirty && !samePath(d.path, path)) : undefined;
  if (existing) {
    store.setActive(existing.id);
    if (opts.line && existing.kind === "text") requestAnimationFrame(() => editor.goTo(opts.line!, opts.col ?? 1));
    else if (opts.line && existing.kind === "big") bus.emitFor(existing.id, "big.goto", { line: opts.line });
    if (oldPreview) await closeDocument(oldPreview.id, false, false);
    return existing;
  }
  try {
    const stat = await fs.stat(path);
    if (stat.isDir) {
      await openFolder(path);
      return null;
    }
    if (oldPreview) await closeDocument(oldPreview.id, false, false);
    if (!opts.noLimit && (await makeRoom([baseName(stat.path)], (id) => closeDocument(id))) === 0) return null;
    pushRecent("recentFiles", stat.path);
    const threshold = store.settings.largeFileThresholdMb * 1024 * 1024;
    if (stat.size >= threshold) {
      const bigDoc = await openLarge(stat.path, stat.size);
      if (bigDoc && opts.preview) store.updateDoc(bigDoc.id, { preview: true });
      // The view mounts on the next render; the bus queues the jump until it subscribes.
      if (bigDoc && opts.line) bus.emitFor(bigDoc.id, "big.goto", { line: opts.line });
      return bigDoc;
    }

    const file = await fs.readText(stat.path);
    const id = newDocId();
    const doc: Doc = {
      id,
      kind: "text",
      path: file.path,
      name: baseName(file.path),
      dirty: false,
      encoding: file.encoding,
      bom: file.hasBom,
      eol: file.eol,
      language: "Plain Text",
      readonly: stat.readonly || file.looksBinary,
      modifiedMs: file.modifiedMs,
      size: stat.size,
      preview: opts.preview || undefined,
      decodeErrors: file.hadDecodeErrors || undefined,
    };
    store.addDoc(doc, false);
    markUsed(id);
    const lang = await editor.create(id, file.content, file.path);
    store.updateDoc(id, { language: lang });
    takeSnapshot(id);
    if (opts.activate !== false) {
      store.setActive(id);
      if (lang === "JSON") {
        const cur = useStore.getState();
        // Only a pinned JSON panel opens by itself; an unpinned one would cover the file just opened.
        if (cur.pinnedPanels.includes("json") && cur.pinnedHidden) store.set({ pinnedHidden: false });
      }
      if (opts.line) requestAnimationFrame(() => editor.goTo(opts.line!, opts.col ?? 1));
    }
    if (file.looksBinary) store.toast(`${doc.name} looks like a binary file; editing may corrupt it. Opened read-only.`, "warning", 8000);
    else if (file.hadDecodeErrors) store.toast(`Some bytes in ${doc.name} could not be decoded as ${file.encoding} (shown as \uFFFD). Saving would replace them; File › Reopen with Encoding reads it in another encoding.`, "warning", 10000);
    if (file.mixedEol && !file.looksBinary) store.toast(`${doc.name} has mixed line endings; saving will normalise them to ${file.eol}.`, "info", 6000);
    return doc;
  } catch (e) {
    store.toast(`Could not open file:\n${String(e)}`, "error");
    return null;
  }
}

/** Doc fields that follow from a (re)opened large file. UTF-16 files are shown decoded and read-only. */
function bigDocFields(info: BigDocInfo, modifiedMs: number): Partial<Doc> {
  const encoding = info.encoding ?? "UTF-8";
  // Doc.eol is CRLF | LF; CR-only files (big mode only) carry "CR" for the status bar.
  return { bigId: info.id, bigInfo: info, encoding, readonly: encoding !== "UTF-8", eol: info.eol as Doc["eol"], modifiedMs, size: info.size };
}

/** Index progress events may fire before the tab exists or after a reload: poll until indexed. */
function pollBigIndex(docId: string, bigId: number) {
  void (async () => {
    for (let i = 0; i < 100_000; i++) {
      const cur = useStore.getState().docs.find((d) => d.id === docId);
      if (!cur || cur.bigId !== bigId) return;
      try {
        const latest = await big.info(bigId);
        useStore.getState().updateDoc(docId, { bigInfo: latest });
        if (latest.indexed) return;
      } catch {
        return;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  })();
}

async function statMs(path: string): Promise<number> {
  try {
    return (await fs.stat(path)).modifiedMs;
  } catch {
    return 0;
  }
}

async function openLarge(path: string, size: number): Promise<Doc | null> {
  const store = useStore.getState();
  try {
    const info = await big.open(path);
    const id = newDocId();
    const doc: Doc = {
      id,
      kind: "big",
      path,
      name: baseName(path),
      dirty: false,
      encoding: "UTF-8",
      bom: false,
      eol: "LF",
      language: "Large File",
      readonly: false,
      modifiedMs: 0,
      size,
      ...bigDocFields(info, await statMs(path)),
    };
    store.addDoc(doc, true);
    if (doc.readonly) store.toast(`${doc.name} (${formatBytes(size)}) is ${doc.encoding}: opened read-only in large-file mode. Raise the large-file threshold to edit it.`, "warning", 8000);
    else store.toast(`${doc.name} (${formatBytes(size)}) opened in large-file mode.`, "info");
    if (info.eol === "CR") store.toast(`${doc.name} uses CR-only (classic Mac) line endings; they are kept when saving.`, "info", 5000);
    pollBigIndex(id, info.id);
    return doc;
  } catch (e) {
    store.toast(`Could not open large file:\n${String(e)}`, "error");
    return null;
  }
}

/**
 * Open several files, each in its own tab (Explorer › Open All Files). Asks once if they would go
 * over the open-tab limit, then shows the first one.
 */
export async function openFiles(paths: string[]) {
  const st = useStore.getState();
  const isOpen = (p: string) => st.docs.some((d) => samePath(d.path, p));
  const fresh = paths.filter((p, i) => !isOpen(p) && paths.findIndex((q) => samePath(q, p)) === i);
  // Files asked for that are already open are part of the request: never close them for room.
  const keep = new Set(st.docs.filter((d) => paths.some((p) => samePath(d.path, p))).map((d) => d.id));
  for (const id of keep) if (st.docs.find((d) => d.id === id)?.preview) st.updateDoc(id, { preview: false });
  const fit = await makeRoom(fresh.map(baseName), (id) => closeDocument(id), keep);
  const opened: Doc[] = [];
  for (const p of fresh.slice(0, fit)) {
    const d = await openPath(p, { activate: false, noLimit: true });
    if (d) opened.push(d);
  }
  const first = opened[0] ?? useStore.getState().docs.find((d) => paths.some((p) => samePath(d.path, p)));
  if (first) useStore.getState().setActive(first.id);
  if (fresh.length && opened.length) st.toast(`Opened ${opened.length} file${opened.length === 1 ? "" : "s"}${opened.length < fresh.length ? ` of ${fresh.length}` : ""}`, "success", 2000);
}

export async function openFileDialog() {
  const picked = await openDialog({ multiple: true, title: "Open File" });
  if (!picked) return;
  const list = Array.isArray(picked) ? picked : [picked];
  // Several files: one question about the open-tab limit for the whole batch.
  if (list.length > 1) await openFiles(list);
  else if (list.length === 1) await openPath(list[0]);
}

export async function openFolderDialog() {
  const picked = await openDialog({ directory: true, title: "Open Folder" });
  if (!picked || Array.isArray(picked)) return;
  await openFolder(picked);
}

/** Most expanded folders kept in the session (each is checked on disk when restored). */
export const SESSION_EXPANDED_MAX = 500;

/**
 * The session's expanded Explorer folders worth restoring for `folder`: strings inside it (any
 * depth), without duplicates (case-insensitive), at most SESSION_EXPANDED_MAX. The folder itself is
 * always expanded, so it is not listed. Pure; the caller drops paths that are gone.
 */
export function sessionExpanded(folder: string, saved: unknown): string[] {
  if (!Array.isArray(saved)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of saved) {
    if (typeof p !== "string" || !isInside(p, folder)) continue;
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= SESSION_EXPANDED_MAX) break;
  }
  return out;
}

/**
 * Open `path` in the Explorer, collapsed at its root. `show: false` (session restore) leaves the
 * panels as they are; `expanded` (session restore) are folders to expand again, kept only while
 * they still exist.
 */
export async function openFolder(path: string, { show = true, expanded = [] }: { show?: boolean; expanded?: string[] } = {}) {
  const store = useStore.getState();
  try {
    const st = await fs.stat(path);
    if (!st.isDir) throw new Error("not a folder");
  } catch (e) {
    store.toast(`Could not open folder ${path}:\n${String(e)}`, "error");
    store.set({ recentFolders: store.recentFolders.filter((p) => !samePath(p, path)) });
    saveSession();
    return;
  }
  const norm = await fs.normalize(path);
  const wanted = sessionExpanded(norm, expanded);
  const isDir = await Promise.all(wanted.map((p) => fs.stat(p).then((st) => st.isDir, () => false)));
  const kept = wanted.filter((_, i) => isDir[i]);
  store.set({ folder: norm, explorerExpanded: new Set([norm, ...kept]), fileListCache: null, ...(show ? { sidebarVisible: true, sidebarPanel: "explorer" as const, pinnedHidden: false } : {}) });
  pushRecent("recentFolders", norm);
  saveSession();
}

/** True when `path` is inside folder `dir` (any depth). */
export const isInside = (path: string, dir: string) => path.replace(/\//g, "\\").toLowerCase().startsWith(dir.replace(/\//g, "\\").toLowerCase().replace(/\\+$/, "") + "\\");

/**
 * Show a file in Quarry's Explorer panel: open the panel, expand the tree down to the file, select
 * it and give its row focus. A file outside the open folder opens its own folder in the Explorer.
 */
export async function showInExplorerPanel(path: string) {
  const store = useStore.getState();
  if (!store.folder || !isInside(path, store.folder)) {
    const dir = dirName(path);
    await openFolder(dir);
    if (useStore.getState().folder) store.toast(`Opened ${dir} in the Explorer`, "info", 2500);
  }
  showPanel("explorer");
  bus.emit("explorer.reveal", path);
}

/** Open Windows File Explorer at the file, selected. */
export async function showInWindowsExplorer(path: string) {
  try {
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(path);
  } catch (e) {
    useStore.getState().toast(String(e), "error");
  }
}

function pushRecent(key: "recentFiles" | "recentFolders", path: string) {
  const store = useStore.getState();
  const list = [path, ...store[key].filter((p) => !samePath(p, path))].slice(0, 15);
  store.set({ [key]: list } as never);
}

export async function saveDocument(docId?: string, saveAs = false): Promise<boolean> {
  const store = useStore.getState();
  const doc = docId ? store.docs.find((d) => d.id === docId) : activeDoc(store);
  if (!doc) return false;
  // A Compare tab saves its edited side(s) to their own files.
  if (doc.kind === "diff") return saveDiff(doc.id);
  let target = doc.path;
  if (!target || saveAs) {
    const picked = await saveDialog({ title: saveAs ? "Save As" : "Save", defaultPath: doc.path ?? doc.name });
    if (!picked) return false;
    target = picked;
  }
  // The same file can come back from the dialog with other case or slashes.
  const sameFile = samePath(target, doc.path);
  // Read-only covers binary files too: an Encoding / EOL pick marks them dirty, and writing the
  // decoded text back would corrupt them.
  if (doc.readonly && sameFile) {
    store.toast(`${doc.name} is read-only. Use Save As to write a copy.`, "info", 4000);
    return false;
  }
  // A large-file tab memory-maps its file, and Windows refuses to replace a mapped file.
  const mappedElsewhere = store.docs.find((d) => d.id !== doc.id && d.kind === "big" && samePath(d.path, target));
  if (mappedElsewhere) {
    store.toast(`${mappedElsewhere.name} is open in another tab in large-file mode. Close that tab before saving over it.`, "warning", 6000);
    return false;
  }
  if (doc.kind === "text" && sameFile && doc.decodeErrors) {
    const ok = await askDialog(
      `${doc.name} has bytes that could not be decoded`,
      `They are shown as \uFFFD, and saving writes that character in their place: the original bytes are lost. Use File › Reopen with Encoding to read the file in the right encoding, or Save As to write a copy.`,
      "Save anyway",
    );
    if (!ok) return false;
  }
  if ((doc.kind === "text" || doc.kind === "big") && sameFile && doc.modifiedMs) {
    try {
      const stat = await fs.stat(target);
      if (stat.modifiedMs > doc.modifiedMs) {
        const ok = await askDialog(`${doc.name} changed on disk`, "The file was modified by another program since you opened it. Overwrite it with your version?", "Overwrite");
        if (!ok) return false;
      }
    } catch {
      /* file gone: saving recreates it */
    }
  }
  saving.add(doc.id);
  try {
    if (doc.kind === "big") {
      const info = await big.save(doc.bigId!, sameFile ? undefined : target);
      store.updateDoc(doc.id, { dirty: false, path: info.path, name: baseName(info.path), bigInfo: info, modifiedMs: await statMs(info.path) });
    } else {
      // The exact text written: edits made while the write (or a prompt) is pending stay dirty.
      const written = editor.docOf(doc.id);
      const content = normalizeEol(written?.toString() ?? "", doc.eol);
      let encoding = doc.encoding;
      let bom = doc.bom;
      let stat: Awaited<ReturnType<typeof fs.writeText>>;
      try {
        stat = await fs.writeText(target, content, { encoding, bom });
      } catch (e) {
        const lossy = parseUnmappable(String(e));
        if (!lossy) throw e;
        const what =
          lossy.count === 1
            ? `"${lossy.first}" (line ${lossy.line}), which ${lossy.encoding} has no code for. Saving in ${lossy.encoding} would replace it`
            : `${lossy.count.toLocaleString()} characters that ${lossy.encoding} has no code for, the first is "${lossy.first}" on line ${lossy.line}. Saving in ${lossy.encoding} would replace them`;
        const ok = await askDialog(
          `${lossy.encoding} can't represent some characters`,
          `${doc.name} contains ${what}. Save as UTF-8 instead?`,
          "Save as UTF-8",
          "primary",
        );
        if (!ok) return false;
        encoding = "UTF-8";
        bom = false;
        stat = await fs.writeText(target, content, { encoding, bom });
        store.updateDoc(doc.id, { encoding, bom });
      }
      const nameChanged = stat.path !== doc.path;
      const now = editor.docOf(doc.id);
      const changedMeanwhile = !!written && !!now && !now.eq(written);
      store.updateDoc(doc.id, { dirty: changedMeanwhile, path: stat.path, name: stat.name, modifiedMs: stat.modifiedMs, readonly: false, size: stat.size, decodeErrors: undefined });
      if (written) takeSnapshot(doc.id, written);
      if (nameChanged) {
        const detected = await editor.setLanguage(doc.id, detectLanguage(stat.path).name);
        store.updateDoc(doc.id, { language: detected });
      }
    }
    pushRecent("recentFiles", target);
    store.toast(`Saved ${baseName(target)}`, "success", 1800);
    saveSession();
    return true;
  } catch (e) {
    store.toast(`Save failed:\n${String(e)}`, "error");
    return false;
  } finally {
    saving.delete(doc.id);
  }
}

/** Parses the Rust `UNMAPPABLE\t<count>\t<char>\t<line>\t<encoding>` save error. */
export function parseUnmappable(err: string): { count: number; first: string; line: number; encoding: string } | null {
  const i = err.indexOf("UNMAPPABLE\t");
  if (i < 0) return null;
  const [, count, first, line, encoding] = err.slice(i).split("\t");
  return { count: Number(count), first, line: Number(line), encoding };
}

function normalizeEol(text: string, eol: Doc["eol"]): string {
  const target = eol === "CRLF" ? "\r\n" : eol === "CR" ? "\r" : "\n";
  return text.replace(/\r\n|\r|\n/g, target);
}

export async function saveAll() {
  const docs = useStore.getState().docs.filter((d) => d.dirty);
  for (const d of docs) await saveDocument(d.id);
}

/**
 * Close a tab. `force` skips the unsaved-changes and something-running questions; `remember` = false
 * keeps it off the Reopen Closed Tab stack (a preview replaced by the next one).
 */
export async function closeDocument(docId?: string, force = false, remember = true): Promise<boolean> {
  const store = useStore.getState();
  const doc = docId ? store.docs.find((d) => d.id === docId) : activeDoc(store);
  if (!doc) return true;
  if (doc.dirty && !force) {
    const choice = await askSaveChanges(`Save changes to ${doc.name}?`);
    if (choice === "cancel") return false;
    if (choice === "save") {
      const ok = await saveDocument(doc.id);
      if (!ok) return false;
    }
  }
  if (doc.kind === "claude") {
    if (!force && claudeBusy(doc.id) && !(await askDialog(`Stop Claude Code in ${doc.name.replace(/^Claude · /, "")}?`, "Claude is still working in this tab. Closing it stops the current task; the conversation can be continued later from Claude Code.", "Close tab"))) return false;
    disposeClaude(doc.id);
  }
  if (doc.kind === "terminal") {
    // A one-off command (installing a language server) or an interactive CLI: closing kills it.
    if (!force && terminalPty(doc.id) !== null && !(await askDialog(`Stop ${doc.name}?`, "A program is still running in this tab. Closing the tab ends it and everything it started.", "Close tab"))) return false;
    disposeTerminal(doc.id);
  }
  if (doc.kind === "diff") disposeDiff(doc.id);
  if (doc.kind === "big" && doc.bigId !== undefined) big.close(doc.bigId).catch(() => {});
  if (remember) rememberClosed(doc);
  editor.dispose(doc.id);
  snapshots.delete(doc.id);
  missingWarned.delete(doc.id);
  store.removeDoc(doc.id);
  saveSession();
  return true;
}

// ---------- reopen closed tab ----------

let closedTabs: ClosedTab[] = [];

/** File-backed text and large-file tabs only: untitled, Claude, terminal, Compare and graph tabs are not reopened. */
function rememberClosed(doc: Doc) {
  if (!doc.path || (doc.kind !== "text" && doc.kind !== "big")) return;
  const entry: ClosedTab = { path: doc.path };
  const state = doc.kind === "text" ? editor.stateOf(doc.id) : undefined;
  if (state) {
    entry.cursor = state.selection.main.head;
    entry.scrollTop = editor.scrollTopOf(doc.id);
  }
  closedTabs = pushClosed(closedTabs, entry);
}

export function hasClosedTabs(): boolean {
  return closedTabs.length > 0;
}

/** Ctrl+Shift+T: reopen the most recently closed file tab that still exists and is not open again. */
export async function reopenClosedTab(): Promise<boolean> {
  const store = useStore.getState();
  const { entry, rest } = await popClosed(closedTabs, async (path) => {
    if (useStore.getState().docs.some((d) => samePath(d.path, path))) return false;
    try {
      return !(await fs.stat(path)).isDir;
    } catch {
      return false;
    }
  });
  closedTabs = rest;
  if (!entry) {
    store.toast("No closed tab to reopen", "info", 2000);
    return false;
  }
  const doc = await openPath(entry.path);
  if (!doc) return false;
  if (doc.kind === "text" && (entry.cursor !== undefined || entry.scrollTop !== undefined)) {
    // As in session restore: applied to the view if it already shows the document, else kept for it.
    editor.restoreViewState(doc.id, entry.cursor ?? 0, entry.scrollTop ?? 0);
  }
  return true;
}

/**
 * The one question Close All / Close Others asks about the tabs with unsaved changes. Pure so it can
 * be unit-tested.
 */
export function closeManyQuestion(names: string[]): { title: string; message: string; save: string } {
  const lost = "Your changes will be lost if you don't save them.";
  if (names.length === 1) return { title: `Save changes to ${names[0]}?`, message: lost, save: "Save" };
  const shown = names.slice(0, 8).join(", ") + (names.length > 8 ? ` and ${names.length - 8} more` : "");
  return { title: `Save changes to ${names.length} files?`, message: `${shown}. ${lost}`, save: "Save All" };
}

/**
 * Close several tabs as one step: one Save / Don't Save / Cancel for every tab with unsaved changes
 * and one confirmation for tabs with something running, both asked before anything closes, so a
 * Cancel (or a save that does not happen) leaves every tab open.
 */
async function closeMany(ids: string[]): Promise<boolean> {
  const docs = useStore.getState().docs.filter((d) => ids.includes(d.id));
  const dirty = docs.filter((d) => d.dirty);
  if (dirty.length > 0) {
    const q = closeManyQuestion(dirty.map((d) => d.name));
    const choice = await askSaveChanges(q.title, q.message, q.save);
    if (choice === "cancel") return false;
    if (choice === "save") {
      for (const d of dirty) if (!(await saveDocument(d.id))) return false;
    }
  }
  const running = docs.filter((d) => (d.kind === "claude" && claudeBusy(d.id)) || (d.kind === "terminal" && terminalPty(d.id) !== null));
  if (running.length > 0) {
    const title = running.length === 1 ? `Stop ${running[0].name.replace(/^Claude · /, "")}?` : `Stop ${running.length} running tabs?`;
    const message = running.length === 1 ? "Something is still running in this tab. Closing it stops it." : `${running.map((d) => d.name).join(", ")} still have something running. Closing them stops it.`;
    if (!(await askDialog(title, message, running.length === 1 ? "Close tab" : "Close tabs"))) return false;
  }
  for (const d of docs) await closeDocument(d.id, true);
  return true;
}

export async function closeAll(): Promise<boolean> {
  return closeMany(useStore.getState().docs.map((d) => d.id));
}

export async function closeOthers(keepId: string): Promise<boolean> {
  return closeMany(useStore.getState().docs.filter((d) => d.id !== keepId).map((d) => d.id));
}

export async function revertDocument(docId?: string, opts: { confirm?: boolean; silent?: boolean; encoding?: string } = {}) {
  const store = useStore.getState();
  const doc = docId ? store.docs.find((d) => d.id === docId) : activeDoc(store);
  if (!doc || !doc.path || doc.kind !== "text") return false;
  if (doc.dirty && opts.confirm !== false) {
    const ok = await askDialog(`Revert ${doc.name}?`, "Your unsaved changes will be replaced with the file on disk.", "Revert");
    if (!ok) return false;
  }
  try {
    const file = await fs.readText(doc.path, opts.encoding);
    applyDiskFile(doc.id, file);
    if (opts.encoding) store.toast(file.hadDecodeErrors ? `${doc.name} has bytes that are not valid ${file.encoding} (shown as \uFFFD).` : `Reopened ${doc.name} as ${file.encoding}`, file.hadDecodeErrors ? "warning" : "info", 4000);
    else if (!opts.silent) store.toast(`Reverted ${doc.name} to the version on disk`, "info", 2500);
    return true;
  } catch (e) {
    store.toast(`Could not revert ${doc.name}:
${String(e)}`, "error");
    return false;
  }
}

/** A text tab takes the file just read from disk: its text, encoding and line ends; it is clean after. */
function applyDiskFile(docId: string, file: TextFile) {
  editor.replaceAll(docId, file.content);
  useStore.getState().updateDoc(docId, { dirty: false, modifiedMs: file.modifiedMs, encoding: file.encoding, bom: file.hasBom, eol: file.eol, size: file.size, decodeErrors: file.hadDecodeErrors || undefined });
  takeSnapshot(docId);
}

/**
 * Reload a text tab whose file changed on disk. A file whose text, encoding and line ends are
 * what the tab already shows (rewritten by git with the same bytes, saved by Quarry itself) is not
 * reloaded and not reported: only its time is taken over. True: reloaded; "same": nothing to do.
 */
async function reloadText(docId: string, path: string): Promise<boolean | "same"> {
  try {
    const file = await fs.readText(path);
    const doc = useStore.getState().docs.find((d) => d.id === docId);
    if (!doc) return false;
    if (file.content === editor.textOf(docId) && file.encoding === doc.encoding && file.eol === doc.eol && file.hasBom === doc.bom) {
      useStore.getState().updateDoc(docId, { dirty: false, modifiedMs: file.modifiedMs, size: file.size });
      return "same";
    }
    applyDiskFile(docId, file);
    return true;
  } catch (e) {
    useStore.getState().toast(`Could not reload ${path.split(/[\\/]/).pop()}:
${String(e)}`, "error");
    return false;
  }
}

/** Two-button confirmation. The confirm action is the default (Enter), Cancel answers Escape. */
export function askDialog(title: string, message: string, confirmLabel: string, kind: "primary" | "danger" = "danger", cancelLabel = "Cancel"): Promise<boolean> {
  return choose(
    title,
    message,
    [
      { label: confirmLabel, kind, default: kind !== "danger", value: true },
      { label: cancelLabel, cancel: true, default: kind === "danger", value: false },
    ],
    false,
  );
}

/** Save / Don't Save / Cancel. */
function askSaveChanges(title: string, message = "Your changes will be lost if you don't save them.", saveLabel = "Save"): Promise<"save" | "discard" | "cancel"> {
  return choose<"save" | "discard" | "cancel">(
    title,
    message,
    [
      { label: saveLabel, kind: "primary", default: true, value: "save" },
      { label: "Don't Save", kind: "danger", value: "discard" },
      { label: "Cancel", cancel: true, value: "cancel" },
    ],
    "cancel",
  );
}

// ---------- external changes ----------

const missingWarned = new Set<string>();
/** Documents being written right now: the check must not take Quarry's own write for an outside change. */
const saving = new Set<string>();

/** No edits of the user's own: a text tab equals its saved snapshot, a large-file tab has no edited lines. */
function unedited(doc: Doc): boolean {
  if (doc.kind === "big") return !doc.bigInfo?.dirty;
  const snap = snapshots.get(doc.id);
  const now = editor.docOf(doc.id);
  return !!snap && !!now && now.eq(snap.doc) && doc.eol === snap.eol && doc.encoding === snap.encoding && doc.bom === snap.bom;
}

/** The tab is marked unsaved only because its file went missing (FILE-015.4) and was not edited since. */
export function missingOnly(docId: string): boolean {
  const doc = useStore.getState().docs.find((d) => d.id === docId);
  return !!doc && missingWarned.has(docId) && unedited(doc);
}

/** What a check did, by file name: reloaded from disk, found missing (first time), kept unsaved over a changed file. */
export interface CheckResult {
  reloaded: string[];
  missing: string[];
  kept: string[];
}

export interface CheckOptions {
  /** Only this tab (tab activation). */
  only?: string;
  /** No notices: the caller (a git action) words them from the result. */
  quiet?: boolean;
}

/**
 * Answers given before the file changes (a git operation): "keep" = Keep my version (Continue
 * Without Saving), "lose" = reload from disk (the confirmation of a discarding operation said
 * so). Keyed by normalised path; any check that meets such a tab uses the answer instead of asking.
 */
const answered = new Map<string, "keep" | "lose">();

/** Answer the "changed on disk" question ahead for these files. Returns the function that withdraws the answers. */
export function answerAhead(paths: string[], answer: "keep" | "lose"): () => void {
  const keys = paths.map(normalizePath);
  for (const k of keys) answered.set(k, answer);
  return () => {
    for (const k of keys) if (answered.get(k) === answer) answered.delete(k);
  };
}

let chain: Promise<unknown> = Promise.resolve();
/** A check of every tab that is waiting for its turn: further plain calls join it. */
let waiting: Promise<CheckResult> | null = null;

/**
 * Compare every file-backed text / large-file document, and every Compare tab with a file side,
 * with the disk. Clean ones whose file changed are reloaded (one notice, folded); unsaved ones ask
 * (unless answered ahead); missing files are flagged once. Called on window focus, on tab
 * activation and after every git action that can rewrite files. Checks run one after the other: a
 * call made while one is running (perhaps waiting on its question) is queued, never dropped.
 */
export function checkExternalChanges(arg?: string | CheckOptions): Promise<CheckResult> {
  const opts: CheckOptions = typeof arg === "string" ? { only: arg } : (arg ?? {});
  const plain = !opts.only && !opts.quiet;
  if (plain && waiting) return waiting;
  const run = chain.then(() => {
    if (plain) waiting = null;
    return doCheck(opts);
  });
  if (plain) waiting = run;
  chain = run.catch(() => {});
  return run;
}

async function doCheck(opts: CheckOptions): Promise<CheckResult> {
  const result: CheckResult = { reloaded: [], missing: [], kept: [] };
  const store = useStore.getState();
  const onlyDocId = opts.only;
  /** Text tabs reloaded in this pass: Compare tabs showing their text follow. */
  const reloadedDocs = new Set<string>();
  const counted = new Set<string>();
  const note = (list: keyof CheckResult, path: string, name: string) => {
    const k = `${list}|${normalizePath(path)}`;
    if (counted.has(k)) return;
    counted.add(k);
    result[list].push(name);
  };
  const docs = store.docs.filter((d) => (d.kind === "text" || d.kind === "big") && d.path && (!onlyDocId || d.id === onlyDocId));
  for (const doc of docs) {
    if (saving.has(doc.id)) continue;
    let stat: FileStat;
    try {
      stat = await fs.stat(doc.path!);
    } catch {
      if (!missingWarned.has(doc.id) && useStore.getState().docs.some((d) => d.id === doc.id)) {
        missingWarned.add(doc.id);
        note("missing", doc.path!, doc.name);
        store.updateDoc(doc.id, { dirty: true });
      }
      continue;
    }
    const cameBack = missingWarned.has(doc.id);
    if (doc.following) {
      missingWarned.delete(doc.id);
      continue; // follow mode picks up appended lines (and reloads a rotated file) itself
    }
    // The document as it is now (a save may have finished while earlier files were checked).
    const cur = useStore.getState().docs.find((d) => d.id === doc.id);
    if (!cur || saving.has(doc.id)) continue;
    const reloadFromDisk = async () => {
      const ok = await (doc.kind === "big" ? reloadBig(doc.id) : reloadText(doc.id, doc.path!));
      if (ok === true) reloadedDocs.add(doc.id);
      return ok;
    };
    // The file is back (a branch switch, a tool rewriting it). Going missing marked the tab
    // dirty; if it wasn't edited since, that flag means nothing: clear it, or reload if newer.
    const backUnedited = cameBack && unedited(cur);
    missingWarned.delete(doc.id);
    if (backUnedited) {
      if (cur.modifiedMs && stat.modifiedMs > cur.modifiedMs) {
        const ok = await reloadFromDisk();
        if (ok !== true) continue; // the same text came back (it is clean again), or the reload failed
        if (opts.quiet) note("reloaded", doc.path!, doc.name);
        else store.toast(`${doc.name} is back on disk and was reloaded.`, "info", 4000);
      } else store.updateDoc(doc.id, { dirty: false });
      continue;
    }
    if (!cur.modifiedMs || stat.modifiedMs <= cur.modifiedMs) continue;
    const ahead = answered.get(normalizePath(doc.path!));
    if (!cur.dirty || ahead === "lose") {
      if ((await reloadFromDisk()) === true) note("reloaded", doc.path!, doc.name);
    } else if (ahead === "keep") {
      store.updateDoc(doc.id, { modifiedMs: stat.modifiedMs }); // keep mine, answered before the operation ran
      note("kept", doc.path!, doc.name);
    } else {
      const reload = await askDialog(
        `${doc.name} changed on disk`,
        "The file was modified by another program and you also have unsaved changes here. Reload it from disk (losing your edits) or keep your version?",
        "Reload from disk",
        "danger",
        "Keep my version",
      );
      if (reload) {
        if ((await reloadFromDisk()) !== false) store.toast(`Reverted ${doc.name} to the version on disk`, "info", 2500);
      } else store.updateDoc(doc.id, { modifiedMs: stat.modifiedMs }); // keep mine: stop re-asking
    }
  }
  await checkCompareTabs(onlyDocId, reloadedDocs, note);
  if (!opts.quiet) {
    if (result.reloaded.length) store.toast(reloadedNotice(result.reloaded), "info", 4000);
    if (result.missing.length) store.toast(missingNotice(null, result.missing), "warning", 8000);
    if (result.kept.length) store.toast(keptNotice(result.kept), "warning", 8000);
  }
  return result;
}

/**
 * Compare tabs: a file side whose file changed on disk, or a side showing a tab that was just
 * reloaded, is read again when nothing in the comparison is edited (or the edits were given up
 * ahead). An edited side that was kept ahead is only noted: saving it then overwrites the file.
 */
async function checkCompareTabs(only: string | undefined, reloadedDocs: Set<string>, note: (list: keyof CheckResult, path: string, name: string) => void) {
  for (const [id, s] of Object.entries(useDiff.getState().sessions)) {
    if (only && id !== only) continue;
    let reload = false;
    let blocked = false;
    for (const which of ["left", "right"] as const) {
      const side = s[which];
      if (side.source.kind === "tab") {
        if (reloadedDocs.has(side.source.docId)) reload = true;
        continue;
      }
      if (side.source.kind !== "file" || !side.path) {
        if (side.dirty) blocked = true;
        continue;
      }
      const stat = await fs.stat(side.path).catch(() => null);
      const newer = !!stat && !!side.modifiedMs && stat.modifiedMs > side.modifiedMs;
      const name = side.path.split(/[\\/]/).pop() || side.path;
      if (!side.dirty) {
        if (newer) {
          reload = true;
        }
        continue;
      }
      const ahead = answered.get(normalizePath(side.path));
      if (ahead === "lose" && newer) {
        reload = true;
      } else {
        blocked = true;
        if (ahead === "keep" && newer && stat) {
          const modifiedMs = stat.modifiedMs;
          patchDiff(id, (cur) => ({ [which]: { ...cur[which], modifiedMs } }));
          note("kept", side.path, name);
        }
      }
    }
    if (!reload || blocked) continue;
    // A comparison just follows its file: no notice (its text tab, if open, has its own).
    await (s.git ? (await import("./gitStaging")).reloadChange(id) : refreshDiff(id));
  }
}

/** Re-open a large file from disk (after an external change), dropping in-memory edits. */
export async function reloadBig(docId: string): Promise<boolean> {
  const store = useStore.getState();
  const doc = store.docs.find((d) => d.id === docId);
  if (!doc?.path || doc.kind !== "big") return false;
  try {
    const info = await big.open(doc.path);
    if (doc.bigId !== undefined) big.close(doc.bigId).catch(() => {});
    store.updateDoc(docId, { ...bigDocFields(info, await statMs(doc.path)), dirty: false });
    pollBigIndex(docId, info.id);
    return true;
  } catch (e) {
    store.toast(`Could not reload ${doc.name}:\n${String(e)}`, "error");
    return false;
  }
}

export function installExternalChangeWatch(): () => void {
  const onFocus = () => void checkExternalChanges();
  window.addEventListener("focus", onFocus);
  const onVis = () => { if (document.visibilityState === "visible") void checkExternalChanges(); };
  document.addEventListener("visibilitychange", onVis);
  const unsub = useStore.subscribe((s, prev) => {
    if (s.activeId !== prev.activeId && s.activeId) void checkExternalChanges(s.activeId);
  });
  return () => {
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVis);
    unsub();
  };
}

export function nextTab(delta: number) {
  const s = useStore.getState();
  if (s.docs.length < 2) return;
  const idx = s.docs.findIndex((d) => d.id === s.activeId);
  const next = s.docs[(idx + delta + s.docs.length) % s.docs.length];
  s.setActive(next.id);
}

// ---------- settings & session ----------

export async function loadSettings(): Promise<Settings> {
  let settings = DEFAULT_SETTINGS;
  let raw: string | null = null;
  try {
    raw = await appData.read(SETTINGS_FILE);
    if (raw) settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) });
  } catch {
    // Unreadable settings: keep a copy so nothing is lost when the next change rewrites the file.
    settings = DEFAULT_SETTINGS;
    const backup = `${SETTINGS_FILE}.bak`;
    if (raw) await appData.write(backup, raw).catch(() => {});
    window.setTimeout(() => useStore.getState().toast(`Settings file was unreadable; using defaults. The old file was kept as ${backup}.`, "warning", 10000), 500);
  }
  useStore.getState().set({ settings, settingsLoaded: true });
  return settings;
}

const clampInt = (v: unknown, min: number, max: number, dflt: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(Math.max(min, Math.min(max, v))) : dflt;

/** Clamp numeric settings read from disk to the same bounds the Settings panel enforces. */
const BOOLEAN_SETTINGS = ["insertSpaces", "wordWrap", "lineNumbers", "highlightActiveLine", "bracketMatching", "autoCloseBrackets", "renderWhitespace", "restoreSession", "mica", "confirmRuns", "autoUpdateCheck", "bigHighlight", "claudeEnabled", "lspEnabled", "claudeGitConfirm", "gitMergeWithChanges"] as const;

export function sanitizeSettings(s: Settings): Settings {
  const switches = Object.fromEntries(BOOLEAN_SETTINGS.map((k) => [k, typeof s[k] === "boolean" ? s[k] : DEFAULT_SETTINGS[k]]));
  return {
    ...s,
    ...switches,
    fontFamily: typeof s.fontFamily === "string" && s.fontFamily.trim() ? s.fontFamily : DEFAULT_SETTINGS.fontFamily,
    fontSize: clampInt(s.fontSize, 8, 40, DEFAULT_SETTINGS.fontSize),
    tabSize: clampInt(s.tabSize, 1, 16, DEFAULT_SETTINGS.tabSize),
    jsonIndent: clampInt(s.jsonIndent, 1, 8, DEFAULT_SETTINGS.jsonIndent),
    largeFileThresholdMb: clampInt(s.largeFileThresholdMb, 1, 4096, DEFAULT_SETTINGS.largeFileThresholdMb),
    searchHistoryLimit: clampInt(s.searchHistoryLimit, 0, 1_000_000, DEFAULT_SETTINGS.searchHistoryLimit),
    maxOpenTabs: clampInt(s.maxOpenTabs, 1, 1000, DEFAULT_SETTINGS.maxOpenTabs),
    claudePath: typeof s.claudePath === "string" ? s.claudePath : DEFAULT_SETTINGS.claudePath,
    claudeModel: typeof s.claudeModel === "string" ? s.claudeModel : DEFAULT_SETTINGS.claudeModel,
    claudePermissionMode: s.claudePermissionMode === "default" ? "default" : DEFAULT_SETTINGS.claudePermissionMode,
    gitCompareBranch: s.gitCompareBranch === "split" ? "split" : DEFAULT_SETTINGS.gitCompareBranch,
    claudeGitModel: typeof s.claudeGitModel === "string" ? s.claudeGitModel.trim() : DEFAULT_SETTINGS.claudeGitModel,
    lspDisabled: Array.isArray(s.lspDisabled) ? s.lspDisabled.filter((x): x is string => typeof x === "string") : [],
    lspCommands: s.lspCommands && typeof s.lspCommands === "object" && !Array.isArray(s.lspCommands) ? Object.fromEntries(Object.entries(s.lspCommands).filter(([, v]) => typeof v === "string")) : {},
    theme: (["system", "light", "dark"] as const).includes(s.theme) ? s.theme : DEFAULT_SETTINGS.theme,
    menuPosition: (["top", "titlebar", "hidden"] as const).includes(s.menuPosition) ? s.menuPosition : DEFAULT_SETTINGS.menuPosition,
    defaultEol: s.defaultEol === "LF" || s.defaultEol === "CRLF" ? s.defaultEol : DEFAULT_SETTINGS.defaultEol,
    scriptsDir: typeof s.scriptsDir === "string" ? s.scriptsDir.replace(/[\r\n]/g, "").trim() : "",
    macrosDir: typeof s.macrosDir === "string" ? s.macrosDir.replace(/[\r\n]/g, "").trim() : "",
  };
}

let settingsTimer: number | undefined;
/** Ask before a destructive delete. Resolves true to proceed. */
export function confirmDelete(what: string, detail = "The file is moved to the Recycle Bin."): Promise<boolean> {
  return choose(
    `Delete ${what}?`,
    detail,
    [
      { label: "Delete", kind: "danger", value: true },
      { label: "Cancel", cancel: true, default: true, value: false },
    ],
    false,
  );
}

export function persistSettings() {
  window.clearTimeout(settingsTimer);
  settingsTimer = window.setTimeout(() => {
    appData.write(SETTINGS_FILE, JSON.stringify(useStore.getState().settings, null, 2)).catch(() => {});
  }, 300);
}

interface SessionDoc {
  /** null for untitled documents, whose text is persisted inline. */
  path: string | null;
  name?: string;
  text?: string;
  /** Claude Code tab: its folder and session (resumed on the next message). */
  claude?: { cwd: string; sessionId?: string };
  cursor?: number;
  scrollTop?: number;
}

interface Session {
  folder: string | null;
  /** Expanded Explorer folders under `folder` (not the folder itself). */
  explorerExpanded?: string[];
  /** Legacy field (paths only); superseded by `docs`. */
  openFiles: string[];
  activePath: string | null;
  docs?: SessionDoc[];
  activeIndex?: number | null;
  /** Split editor: `docs` index of what the other pane shows. */
  split?: { otherIndex: number; focused: 0 | 1; ratio: number } | null;
  recentFiles: string[];
  recentFolders: string[];
  sidebarVisible: boolean;
  sidebarPanel: string;
  sidebarWidth: number;
  pinnedPanels?: string[];
  panelWidths?: Partial<Record<string, number>>;
  /** Bottom panel height in px (whether it is shown, and its tab, are not kept). */
  bottomHeight?: number;
}

const UNTITLED_SESSION_MAX = 2 * 1024 * 1024;
const untitledTooBigWarned = new Set<string>();

function sessionDocs(s: ReturnType<typeof useStore.getState>): { docs: SessionDoc[]; activeIndex: number | null; otherIndex: number | null } {
  const out: SessionDoc[] = [];
  let activeIndex: number | null = null;
  let otherIndex: number | null = null;
  for (const d of s.docs) {
    const entry: SessionDoc = { path: d.path };
    if (d.kind === "text") {
      const state = editor.stateOf(d.id);
      if (state) {
        entry.cursor = state.selection.main.head;
        entry.scrollTop = editor.scrollTopOf(d.id);
      }
      if (!d.path) {
        const text = state?.doc.toString() ?? "";
        // Empty untitled buffers carry nothing worth restoring (a fresh one is created on start anyway).
        if (text.length === 0) continue;
        if (text.length > UNTITLED_SESSION_MAX) {
          if (!untitledTooBigWarned.has(d.id)) {
            untitledTooBigWarned.add(d.id);
            s.toast(`${d.name} is too large to keep in the session; save it to a file or it will be lost on exit.`, "warning", 8000);
          }
          continue;
        }
        entry.name = d.name;
        entry.text = text;
      }
    } else if (d.kind === "claude") {
      if (!d.claude) continue;
      entry.claude = { ...d.claude };
    } else if (!d.path) {
      continue;
    }
    if (d.id === s.activeId) activeIndex = out.length;
    if (d.id === s.split?.otherId) otherIndex = out.length;
    out.push(entry);
  }
  return { docs: out, activeIndex, otherIndex };
}

function buildSession(): Session {
  const s = useStore.getState();
  const { docs, activeIndex, otherIndex } = sessionDocs(s);
  return {
    folder: s.folder,
    explorerExpanded: s.folder ? sessionExpanded(s.folder, [...s.explorerExpanded]) : [],
    openFiles: s.docs.filter((d) => d.path).map((d) => d.path!),
    activePath: activeDoc(s)?.path ?? null,
    docs,
    activeIndex,
    split: s.split && otherIndex !== null && activeIndex !== null ? { otherIndex, focused: s.split.focused, ratio: s.split.ratio } : null,
    recentFiles: s.recentFiles,
    recentFolders: s.recentFolders,
    sidebarVisible: s.sidebarVisible,
    sidebarPanel: s.sidebarPanel,
    sidebarWidth: s.sidebarWidth,
    pinnedPanels: s.pinnedPanels,
    // Settings always reopens at 35%, so its width is not kept.
    panelWidths: Object.fromEntries(Object.entries(s.panelWidths).filter(([p]) => p !== "settings")),
    bottomHeight: s.bottomHeight,
  };
}

let sessionTimer: number | undefined;
/** True until restoreSession() is done: a session written meanwhile would drop the tabs not yet restored. */
let restoring = true;
export function saveSession() {
  if (restoring) return;
  window.clearTimeout(sessionTimer);
  sessionTimer = window.setTimeout(() => void flushSession(), 500);
}

/** Write the session now (used before the window closes so cursor/scroll are not lost). False if it failed. */
export async function flushSession(): Promise<boolean> {
  window.clearTimeout(sessionTimer);
  if (restoring) return false;
  try {
    await appData.write(SESSION_FILE, JSON.stringify(buildSession(), null, 2));
    return true;
  } catch {
    return false;
  }
}

/** Drop paths that no longer exist (recent lists), keeping order. */
async function pruneExisting(paths: string[]): Promise<string[]> {
  const flags = await Promise.all(paths.map((p) => fs.exists(p).catch(() => false)));
  return paths.filter((_, i) => flags[i]);
}

export async function restoreSession() {
  try {
    await restoreSessionTabs();
  } finally {
    restoring = false;
    saveSession();
  }
}

async function restoreSessionTabs() {
  const store = useStore.getState();
  let session: Partial<Session> = {};
  try {
    const raw = await appData.read(SESSION_FILE);
    if (raw) session = JSON.parse(raw) as Session;
  } catch {
    /* no session */
  }
  const pinned = (session.pinnedPanels ?? []).filter((p): p is SidebarPanel => PANELS.includes(p as SidebarPanel));
  const panel: SidebarPanel = PANELS.includes(session.sidebarPanel as SidebarPanel) ? (session.sidebarPanel as SidebarPanel) : "explorer";
  store.set({
    recentFiles: await pruneExisting(session.recentFiles ?? []),
    recentFolders: await pruneExisting(session.recentFolders ?? []),
    // Only a pinned panel reopens on start; an unpinned one would float beside the editor.
    sidebarVisible: (session.sidebarVisible ?? true) && pinned.includes(panel),
    sidebarPanel: panel,
    sidebarWidth: session.sidebarWidth ?? 300,
    pinnedPanels: pinned,
    panelWidths: Object.fromEntries(Object.entries(session.panelWidths ?? {}).filter(([p, w]) => PANELS.includes(p as SidebarPanel) && typeof w === "number" && w >= 200)),
    // Only the height comes back; the panel itself starts hidden, on Console.
    bottomHeight: clampBottomHeight(session.bottomHeight, window.innerHeight),
  });
  const startup = await sys.startupPaths().catch(() => [] as string[]);
  if (session.folder && store.settings.restoreSession) {
    // The folder comes back without opening the Explorer: only pinned panels reopen.
    // Its expanded folders come back too, minus those that are gone.
    if (await fs.exists(session.folder)) await openFolder(session.folder, { show: false, expanded: session.explorerExpanded ?? [] });
  }
  if (store.settings.restoreSession) {
    const all: SessionDoc[] = session.docs ?? (session.openFiles ?? []).map((p) => ({ path: p }));
    // Opened with files (e.g. a double-click in File Explorer): those replace the session's tabs,
    // but unsaved Untitled text exists only in the session, so it always comes back.
    const entries = startup.length === 0 ? all : all.filter((e) => !e.path && !e.claude && typeof e.text === "string");
    const restored: (Doc | null)[] = [];
    for (const entry of entries) {
      let doc: Doc | null = null;
      if (entry.path) {
        if (await fs.exists(entry.path)) doc = await openPath(entry.path, { activate: false, noLimit: true });
      } else if (entry.claude) {
        // Claude tabs come back idle; the process starts (resuming the session) on the next message.
        if (store.settings.claudeEnabled && (await fs.exists(entry.claude.cwd))) doc = await openClaudeTab(entry.claude.cwd, { sessionId: entry.claude.sessionId, activate: false, start: false, reuse: false });
      } else if (typeof entry.text === "string") {
        doc = await newDocument(entry.text, entry.name);
      }
      if (doc && doc.kind === "text" && (entry.cursor !== undefined || entry.scrollTop !== undefined)) {
        editor.restoreViewState(doc.id, entry.cursor ?? 0, entry.scrollTop ?? 0);
      }
      restored.push(doc);
    }
    // Prefer the previously active tab; fall back to the last restored one, then any open doc.
    let active: Doc | null = null;
    if (session.activeIndex !== undefined && session.activeIndex !== null) active = restored[session.activeIndex] ?? null;
    if (!active && session.activePath) active = useStore.getState().docs.find((x) => samePath(x.path, session.activePath)) ?? null;
    if (!active) active = [...restored].reverse().find((d) => d) ?? null;
    const cur = useStore.getState();
    if (active) {
      cur.setActive(active.id);
      // The split comes back when both of its documents did (the right pane only shows text).
      const other = session.split ? restored[session.split.otherIndex] : null;
      const right = session.split?.focused === 1 ? active : other;
      if (session.split && other && right?.kind === "text") {
        cur.set({ split: { otherId: other.id, focused: session.split.focused, ratio: Math.max(0.15, Math.min(0.85, session.split.ratio || 0.5)) } });
      }
    } else if (cur.docs.length > 0 && !cur.docs.some((d) => d.id === cur.activeId)) cur.setActive(cur.docs[cur.docs.length - 1].id);
  }
  // With nothing to restore the Welcome page shows; no empty Untitled document is created.
  for (const p of startup) await openPath(p);
}

/**
 * Hot exit: an untitled buffer that the session will bring back on the next start is not worth a
 * "Save changes?" prompt when the app closes. Prompt for dirty file-backed documents (their file
 * would diverge), for untitled buffers too large for the session, and for everything when session
 * restore is off. An empty untitled buffer has nothing to lose. Pure so it can be unit-tested.
 */
export function needsSavePromptOnExit(doc: Pick<Doc, "dirty" | "path" | "kind">, textLength: number, restoreSession: boolean): boolean {
  if (!doc.dirty) return false;
  if (doc.path || doc.kind !== "text") return true;
  if (!restoreSession) return true;
  // An empty one is not kept by the session either, but it holds nothing to lose.
  return textLength > UNTITLED_SESSION_MAX;
}

export function installCloseGuard() {
  const win = getCurrentWindow();
  win.onCloseRequested(async (event) => {
    const s = useStore.getState();
    const dirty = s.docs.filter((d) => needsSavePromptOnExit(d, d.kind === "text" && !d.path ? (editor.stateOf(d.id)?.doc.length ?? 0) : 0, s.settings.restoreSession));
    event.preventDefault();
    if (dirty.length === 0) {
      // Untitled buffers skipped the prompt because the session keeps them; if it can't be written, ask.
      if (await flushSession()) {
        await Promise.all([stopAllClaude(), stopAllServers()]);
        await win.destroy();
        return;
      }
      dirty.push(...s.docs.filter((d) => needsSavePromptOnExit(d, 0, false)));
      if (dirty.length === 0) {
        await Promise.all([stopAllClaude(), stopAllServers()]);
        await win.destroy();
        return;
      }
    }
    // In-app dialog so there is a real Cancel (the native ask() only offers two buttons).
    const choice = await askSaveChanges(dirty.length === 1 ? `Save changes to ${dirty[0].name} before closing?` : `Save changes to ${dirty.length} files before closing?`);
    if (choice === "cancel") return;
    if (choice === "save") {
      for (const d of dirty) {
        const saved = await saveDocument(d.id);
        if (!saved) return;
      }
    }
    await flushSession();
    for (const d of useStore.getState().docs) if (d.kind === "big" && d.bigId !== undefined) big.close(d.bigId).catch(() => {});
    await Promise.all([stopAllClaude(), stopAllServers()]);
    await win.destroy();
  });
}
