import { ChevronDown, ChevronRight, ChevronsDown, ChevronsUp, ChevronUp, Files, FilePlus, FolderOpen, FolderPlus, Pencil, RefreshCw, Search, Terminal, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dirName, openFiles, openFolderDialog, openPath } from "../../lib/actions";
import { filesToClipboard, pasteInto, trashPaths } from "../../lib/fileOps";
import { FileMenu } from "../FileMenu";
import { runCommand } from "../../lib/commands";
import { bus } from "../../lib/bus";
import { fs } from "../../lib/ipc";
import { isPanelShown, showPanel } from "../../lib/panels";
import { editor } from "../../editor/manager";
import { useStore, type SidebarPanel } from "../../lib/store";
import { KIND_LABEL, KIND_LETTER, kindOf, useGit } from "../../lib/git";
import type { DirEntry } from "../../lib/types";

interface Row {
  entry: DirEntry;
  depth: number;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Folders first, then natural (numeric-aware, case-insensitive) order. */
export function compareEntries(a: DirEntry, b: DirEntry): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
  return collator.compare(a.name, b.name) || a.name.localeCompare(b.name);
}

const samePath = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** Why Windows won't take `name` as a file or folder name (null when it is fine). Pure, tested. */
export function fileNameProblem(name: string): string | null {
  if (/[\\/]/.test(name)) return "A name can't contain \\ or /.";
  // eslint-disable-next-line no-control-regex
  if (/[<>:"|?*\x00-\x1f]/.test(name)) return 'A name can\'t contain any of < > : " | ? *';
  if (/[. ]$/.test(name)) return "A name can't end with a dot or a space.";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name)) return `${name} is reserved by Windows.`;
  return null;
}

const isUnder = (path: string, dir: string) => path.toLowerCase().startsWith(dir.toLowerCase().replace(/[\\/]+$/, "") + "\\");

/** Every directory strictly between `root` and `path` (plus `root` itself), outermost first. */
export function ancestorDirs(root: string, path: string): string[] {
  if (!isUnder(path, root)) return [];
  const out = [root];
  let d = dirName(path);
  const stack: string[] = [];
  while (d && d.length > root.length && isUnder(d, root)) {
    stack.push(d);
    d = dirName(d);
  }
  return out.concat(stack.reverse());
}

/** Pure helper (testable): the rows from `a` to `b` (either order), as Shift+click selects them. */
export function rangeOf(paths: string[], a: string, b: string): string[] {
  const i = paths.findIndex((p) => samePath(p, a));
  const j = paths.findIndex((p) => samePath(p, b));
  if (j < 0) return [];
  if (i < 0) return [paths[j]];
  return paths.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/** Pure helper (testable): Ctrl+click adds `path` to the selection, or removes it if already there. */
export function toggleIn(list: string[], path: string): string[] {
  return list.some((p) => samePath(p, path)) ? list.filter((p) => !samePath(p, path)) : [...list, path];
}

/** Expand All stops after this many folders, so a huge tree can't stall the panel. */
export const EXPAND_ALL_MAX = 500;
/** Folders Expand All passes over (it still expands them when you right-click one of them). */
const EXPAND_ALL_SKIP = new Set([".git", "node_modules"]);

/** Pure helper (testable): Collapse All: the expanded set without `dir` and every folder under it. */
export function collapseUnder(expanded: ReadonlySet<string>, dir: string): Set<string> {
  return new Set([...expanded].filter((p) => !samePath(p, dir) && !isUnder(p, dir)));
}

/**
 * The same tree over another root (the Scripts panel). It keeps its own expanded folders
 * (`scriptsExpanded`) and leaves the Explorer's folder watcher and Find in Files targets alone.
 */
export interface TreeVariant {
  root: string;
  title: string;
  /** The side panel it lives in: the tree reloads when that panel opens. */
  panel: SidebarPanel;
  labels: { newFile: string; newFolder: string; filePlaceholder: string; folderPlaceholder: string };
  /** Browse only: no New / Rename / Cut / Copy / Paste / Delete. */
  readOnly?: boolean;
  /** Which files to list (folders always are). Must be a stable function. */
  fileFilter?: (entry: DirEntry) => boolean;
  /** Buttons after Refresh (instead of Close Folder). */
  headerExtra?: React.ReactNode;
  /** New File: the final file name and what the file starts with. */
  newFile?: (name: string) => { name: string; content: string };
  /** A file row was clicked or right-clicked. */
  onSelect?: (entry: DirEntry) => void;
  /** Given: clicking a file only selects it, and double-click / Enter call this instead of opening it. */
  onActivate?: (entry: DirEntry) => void;
  /** Items at the top of a row's right-click menu. */
  menuLead?: (entry: DirEntry, close: () => void) => React.ReactNode;
  /** Bus event that starts New File in the root. */
  newFileEvent?: string;
}

export function ExplorerPanel() {
  return <FileTree />;
}

export function FileTree({ variant }: { variant?: TreeVariant }) {
  const openFolder = useStore((s) => s.folder);
  const folder = variant ? variant.root : openFolder;
  const isVariant = !!variant;
  const readOnly = !!variant?.readOnly;
  const fileFilter = variant?.fileFilter;
  const expanded = useStore((s) => (isVariant ? s.scriptsExpanded : s.explorerExpanded));
  const getExpanded = () => (isVariant ? useStore.getState().scriptsExpanded : useStore.getState().explorerExpanded);
  const setExpanded = (next: Set<string>) => useStore.getState().set(isVariant ? { scriptsExpanded: next } : { explorerExpanded: next });
  const panelShown = useStore((s) => (variant ? isPanelShown(s, variant.panel) : false));
  const set = useStore((s) => s.set);
  const toast = useStore((s) => s.toast);
  const activePath = useStore((s) => s.docs.find((d) => d.id === s.activeId)?.path ?? null);
  const gitFiles = useGit((s) => s.files);
  const gitDirs = useGit((s) => s.dirs);
  const [children, setChildren] = useState<Map<string, DirEntry[]>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  /** Rows picked with Ctrl / Shift+click (empty = just `selected`). */
  const [multi, setMulti] = useState<string[]>([]);
  /** Where a Shift+click range starts: the last row clicked without Shift. */
  const anchor = useRef<string | null>(null);
  const [creating, setCreating] = useState<{ dir: string; kind: "file" | "dir" } | null>(null);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  /** Right-click menu; `entry` null = blank space below the rows (Paste only). */
  const [menu, setMenu] = useState<{ x: number; y: number; entry: DirEntry | null } | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const focusWanted = useRef<string | null>(null);
  const revealWanted = useRef<string | null>(null);
  const typeahead = useRef<{ text: string; at: number }>({ text: "", at: 0 });

  const load = useCallback(async (dir: string, force = false, quiet = false) => {
    if (!force && children.has(dir)) return;
    try {
      const list = await fs.listDir(dir, true);
      list.sort(compareEntries);
      setChildren((m) => new Map(m).set(dir, list));
    } catch (e) {
      // A background reload of a folder that has gone just forgets it.
      if (quiet) setChildren((m) => {
        const n = new Map(m);
        n.delete(dir);
        return n;
      });
      else toast(String(e), "error");
    }
  }, [children]);

  useEffect(() => {
    if (folder) {
      setChildren(new Map());
      setSelected(null);
      setMulti([]);
      load(folder, true);
    }
  }, [folder]);

  useEffect(() => {
    for (const dir of expanded) if (!children.has(dir)) load(dir);
  }, [expanded]);

  // Refs so the (folder-keyed) watcher effect always sees the current listing cache and loader.
  const childrenRef = useRef(children);
  childrenRef.current = children;
  const loadRef = useRef(load);
  loadRef.current = load;

  // File watcher: reload the loaded directories that contain a changed path.
  useEffect(() => {
    if (!folder) return;
    let disposed = false;
    const un = fs.onChanged((paths) => {
      if (disposed) return;
      const m = childrenRef.current;
      const dirs = new Set<string>();
      for (const p of paths) {
        const parent = dirName(p);
        if (m.has(parent)) dirs.add(parent);
      }
      for (const d of dirs) void loadRef.current(d, true);
      if (dirs.size) set({ fileListCache: null });
    });
    // There is one watcher and it belongs to the Explorer's folder; another tree only listens.
    if (!isVariant) fs.watchStart(folder).catch((e) => toast(`File watcher unavailable: ${e}`, "warning"));
    return () => {
      disposed = true;
      un.then((f) => f());
      if (!isVariant) fs.watchStop().catch(() => {});
    };
  }, [folder]);

  // Without a watcher of its own, the tree reloads when its panel opens and when the window regains focus.
  useEffect(() => {
    if (!isVariant || !panelShown) return;
    const reload = () => {
      for (const d of childrenRef.current.keys()) void loadRef.current(d, true, true);
    };
    reload();
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [isVariant, panelShown, folder]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (dir: string, depth: number) => {
      const list = children.get(dir);
      if (!list) return;
      for (const e of list) {
        if (!e.isDir && fileFilter && !fileFilter(e)) continue;
        out.push({ entry: e, depth });
        if (e.isDir && expanded.has(e.path)) walk(e.path, depth + 1);
      }
    };
    if (folder) walk(folder, 0);
    return out;
  }, [children, expanded, folder, fileFilter]);

  // Reveal the active file: expand its ancestors, then scroll its row into view once it exists.
  const reveal = useCallback((path: string | null) => {
    if (!folder || !path || !isUnder(path, folder)) return;
    const dirs = ancestorDirs(folder, path);
    const cur = getExpanded();
    if (dirs.some((d) => !cur.has(d))) setExpanded(new Set([...cur, ...dirs]));
    revealWanted.current = path;
    setSelected(path);
  }, [folder]);

  useEffect(() => {
    reveal(activePath);
  }, [activePath, folder]);

  // "Show in Quarry Explorer" (tab menu): reveal that file and focus its row. The request can arrive
  // just before a newly opened folder reaches this component, so it waits for the folder.
  const pendingReveal = useRef<string | null>(null);
  const [revealTick, setRevealTick] = useState(0);
  useEffect(() => {
    if (isVariant) return;
    return bus.on("explorer.reveal", (p) => {
      pendingReveal.current = p as string;
      setRevealTick((t) => t + 1);
    });
  }, [isVariant]);
  useEffect(() => {
    const p = pendingReveal.current;
    if (!p || !folder || !isUnder(p, folder)) return;
    pendingReveal.current = null;
    reveal(p);
    focusWanted.current = p;
  }, [revealTick, folder, reveal]);

  useEffect(() => {
    const want = revealWanted.current;
    if (want) {
      const el = rowRefs.current.get(want.toLowerCase());
      if (el) {
        el.scrollIntoView({ block: "nearest" });
        revealWanted.current = null;
      }
    }
    const f = focusWanted.current;
    if (f) {
      const el = rowRefs.current.get(f.toLowerCase());
      if (el) {
        el.focus();
        el.scrollIntoView({ block: "nearest" });
        focusWanted.current = null;
      }
    }
  }, [rows]);

  const focusRow = (path: string) => {
    setSelected(path);
    setMulti([]);
    anchor.current = path;
    focusWanted.current = path;
    const el = rowRefs.current.get(path.toLowerCase());
    if (el) {
      el.focus();
      el.scrollIntoView({ block: "nearest" });
      focusWanted.current = null;
    }
  };

  const toggle = (path: string, open?: boolean) => {
    const next = new Set(expanded);
    const willOpen = open ?? !next.has(path);
    if (!willOpen) {
      next.delete(path);
      // Keep the selection visible: a selected row inside the collapsed folder moves to the folder.
      if (selected && isUnder(selected, path)) setSelected(path);
    } else next.add(path);
    setExpanded(next);
  };

  const refresh = () => {
    if (!folder) return;
    setChildren(new Map());
    load(folder, true);
    for (const d of expanded) load(d, true);
    set({ fileListCache: null });
  };

  const targetDir = () => {
    if (!selected) return folder!;
    const row = rows.find((r) => r.entry.path === selected);
    if (!row) return folder!;
    return row.entry.isDir ? row.entry.path : dirName(row.entry.path);
  };

  // Enter commits, and so does the blur that follows when the new file opens in the editor: once only.
  const committingCreate = useRef(false);
  // Set by Escape and once a name box has been dealt with: a blur that arrives as the box is
  // removed (stale closure, same name) must not create or rename anything.
  const createClosed = useRef(false);
  const renameClosed = useRef(false);
  const closeCreate = () => {
    createClosed.current = true;
    setCreating(null);
    setNewName("");
  };
  const commitCreate = async () => {
    if (committingCreate.current || createClosed.current) return;
    if (!creating || !newName.trim()) {
      closeCreate();
      return;
    }
    const problem = fileNameProblem(newName.trim());
    if (problem) {
      toast(problem, "error");
      return;
    }
    committingCreate.current = true;
    const made = creating.kind === "file" && variant?.newFile ? variant.newFile(newName.trim()) : { name: newName.trim(), content: "" };
    const path = `${creating.dir}\\${made.name}`;
    try {
      if (await fs.exists(path)) {
        toast(`${made.name} already exists`, "error");
        closeCreate();
        return;
      }
      if (creating.kind === "dir") await fs.createDir(path);
      else {
        await fs.writeText(path, made.content);
        await openPath(path);
      }
      setExpanded(new Set([...getExpanded(), creating.dir]));
      await load(creating.dir, true);
    } catch (e) {
      toast(String(e), "error");
    } finally {
      committingCreate.current = false;
    }
    closeCreate();
  };

  const startRename = (entry: DirEntry) => {
    setMenu(null);
    renameClosed.current = false;
    setRenaming(entry.path);
    setRenameName(entry.name);
  };

  const commitRename = async () => {
    if (renameClosed.current) return;
    renameClosed.current = true;
    const from = renaming;
    setRenaming(null);
    const name = renameName.trim();
    if (!from || !name) return;
    const problem = fileNameProblem(name);
    if (problem) {
      toast(problem, "error");
      return;
    }
    const dir = dirName(from);
    const to = `${dir}\\${name}`;
    if (from === to) return;
    try {
      // A change of letter case only is a real rename; the "existing" file is this one.
      if (!samePath(from, to) && (await fs.exists(to))) {
        toast(`${name} already exists`, "error");
        return;
      }
      await fs.rename(from, to);
      const st = useStore.getState();
      for (const d of st.docs) {
        if (d.path && samePath(d.path, from)) st.updateDoc(d.id, { path: to, name });
        else if (d.path && isUnder(d.path, from)) st.updateDoc(d.id, { path: to + d.path.slice(from.length) });
      }
      if (expanded.has(from)) {
        const next = new Set(expanded);
        next.delete(from);
        next.add(to);
        setExpanded(next);
      }
      set({ fileListCache: null });
      await load(dir, true);
      focusRow(to);
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const isDirPath = (p: string) => rows.find((r) => samePath(r.entry.path, p))?.entry.isDir ?? false;

  /** What Find in Files' Folder scope searches: the rows clicked or selected last. */
  const pickTargets = (paths: string[]) => {
    if (isVariant) return;
    useStore.getState().setSearch({ treeTargets: paths.map((p) => ({ path: p, isDir: isDirPath(p) })) });
  };

  /**
   * Open All Files: the selected files, plus the files directly inside each selected folder that
   * has nothing of its own selected.
   */
  const openAll = async (paths: string[]) => {
    setMenu(null);
    const files: string[] = [];
    for (const p of paths) {
      if (!isDirPath(p)) files.push(p);
      else if (!paths.some((q) => isUnder(q, p))) {
        try {
          const list = (await fs.listDir(p, true)).filter((e) => !e.isDir).sort(compareEntries);
          files.push(...list.map((e) => e.path));
        } catch (e) {
          toast(String(e), "error");
        }
      }
    }
    if (!files.length) toast("No files to open there.", "info", 2000);
    else await openFiles(files);
  };

  /** Expand All: `root` and every folder beneath it (loading their listings), up to EXPAND_ALL_MAX. */
  const expandAll = async (root: string) => {
    setMenu(null);
    const next = new Set(getExpanded());
    const loaded = new Map<string, DirEntry[]>();
    const queue = [root];
    let count = 0;
    let capped = false;
    while (queue.length) {
      const batch = queue.splice(0, 16);
      const lists = await Promise.all(
        batch.map(async (d) => {
          try {
            return [d, childrenRef.current.get(d) ?? (await fs.listDir(d, true)).sort(compareEntries)] as const;
          } catch {
            return [d, [] as DirEntry[]] as const;
          }
        }),
      );
      for (const [d, list] of lists) {
        loaded.set(d, list);
        next.add(d);
        count++;
        for (const k of list) {
          if (!k.isDir || EXPAND_ALL_SKIP.has(k.name.toLowerCase())) continue;
          if (count + queue.length >= EXPAND_ALL_MAX) capped = true;
          else queue.push(k.path);
        }
      }
    }
    setChildren((m) => {
      const n = new Map(m);
      for (const [d, list] of loaded) if (!n.has(d)) n.set(d, list);
      return n;
    });
    setExpanded(next);
    if (capped) toast(`Expanded the first ${EXPAND_ALL_MAX} folders; expand the rest one at a time.`, "info", 4000);
  };

  /** Collapse All: the folder and every folder under it. */
  const collapseAll = (dir: string) => {
    setMenu(null);
    setExpanded(collapseUnder(getExpanded(), dir));
    if (selected && isUnder(selected, dir)) setSelected(dir);
  };

  /** Context menu: Find in File / Folder / Selected. */
  const findIn = (paths: string[]) => {
    setMenu(null);
    pickTargets(paths);
    useStore.getState().setSearch({ scope: "folder" });
    showPanel("search");
  };

  /** The rows an action applies to: the Ctrl / Shift selection, else the selected row. */
  const selection = () => (multi.length ? multi : selected ? [selected] : []);
  /** Paste goes into a folder row, or the folder of a file row (the open folder for blank space). */
  const pasteDirFor = (path: string | null) => (!path ? folder! : isDirPath(path) ? path : dirName(path));

  const afterPaste = (pasted: string[], dest: string) => {
    if (!pasted.length) return;
    if (folder && !samePath(dest, folder)) setExpanded(new Set([...getExpanded(), dest]));
    void load(dest, true);
    focusRow(pasted[0]);
    if (pasted.length > 1) setMulti(pasted);
  };
  const afterDelete = (deleted: string[]) => {
    if (!deleted.length) return;
    const gone = (p: string) => deleted.some((d) => samePath(p, d) || isUnder(p, d));
    setMulti((m) => m.filter((p) => !gone(p)));
    if (selected && gone(selected)) setSelected(dirName(selected));
  };
  const deleteSelection = () => void trashPaths(selection(), isDirPath).then(afterDelete);
  const startCreate = (kind: "file" | "dir", dir = targetDir()) => {
    createClosed.current = false;
    setCreating({ dir, kind });
    setNewName("");
  };
  const newFileEvent = !readOnly ? variant?.newFileEvent : undefined;
  useEffect(() => (newFileEvent && folder ? bus.on(newFileEvent, () => startCreate("file", folder)) : undefined), [newFileEvent, folder]);
  /** Double-click / Enter on a file: the variant's action, or (false) the usual open. */
  const activate = (entry: DirEntry) => {
    if (!variant?.onActivate) return false;
    variant.onActivate(entry);
    return true;
  };
  const pasteHere = () => {
    const dest = pasteDirFor(selected);
    void pasteInto(dest).then((p) => afterPaste(p, dest));
  };

  // A paste or delete elsewhere (Find in Files results) reloads the folders it touched.
  useEffect(() => bus.on("explorer.reload", (dirs) => {
    for (const d of dirs as string[]) if (childrenRef.current.has(d)) void loadRef.current(d, true);
  }), []);

  const onTreeKeyDown = (e: React.KeyboardEvent) => {
    if (renaming || creating || rows.length === 0) return;
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const idx = selected ? rows.findIndex((r) => samePath(r.entry.path, selected)) : -1;
    const row = idx >= 0 ? rows[idx] : null;
    const go = (i: number) => focusRow(rows[Math.max(0, Math.min(rows.length - 1, i))].entry.path);
    if (readOnly && (e.key === "F2" || e.key === "Delete")) return;
    if (!readOnly && e.ctrlKey && !e.shiftKey && !e.altKey && ["c", "x", "v"].includes(e.key.toLowerCase())) {
      const k = e.key.toLowerCase();
      if (k === "v") pasteHere();
      else void filesToClipboard(selection(), k === "x");
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        go(idx + 1);
        break;
      case "ArrowUp":
        go(idx <= 0 ? 0 : idx - 1);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(rows.length - 1);
        break;
      case "PageDown":
        go(idx + 15);
        break;
      case "PageUp":
        go(idx - 15);
        break;
      case "ArrowRight":
        if (!row) go(0);
        else if (row.entry.isDir && !expanded.has(row.entry.path)) toggle(row.entry.path, true);
        else if (row.entry.isDir && idx + 1 < rows.length && rows[idx + 1].depth > row.depth) go(idx + 1);
        break;
      case "ArrowLeft":
        if (!row) go(0);
        else if (row.entry.isDir && expanded.has(row.entry.path)) toggle(row.entry.path, false);
        else {
          const parent = dirName(row.entry.path);
          if (folder && !samePath(parent, folder)) focusRow(parent);
        }
        break;
      case "Enter":
      case " ":
        if (!row) return;
        if (row.entry.isDir) toggle(row.entry.path);
        else if (!activate(row.entry)) void openPath(row.entry.path);
        break;
      case "F2":
        if (row) startRename(row.entry);
        break;
      case "Delete":
        deleteSelection();
        break;
      default: {
        if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return;
        const now = Date.now();
        const t = typeahead.current;
        t.text = now - t.at < 700 ? t.text + e.key.toLowerCase() : e.key.toLowerCase();
        t.at = now;
        const start = t.text.length === 1 ? idx + 1 : Math.max(0, idx);
        for (let k = 0; k < rows.length; k++) {
          const r = rows[(start + k) % rows.length];
          if (r.entry.name.toLowerCase().startsWith(t.text)) {
            focusRow(r.entry.path);
            break;
          }
        }
        break;
      }
    }
    e.preventDefault();
    e.stopPropagation();
  };

  if (!folder) {
    return (
      <>
        <div className="sidebar-header">Explorer</div>
        <div className="panel-section">
          <p className="muted" style={{ margin: "4px 0" }}>No folder open.</p>
          <button className="btn btn-primary" onClick={() => void openFolderDialog()}>
            <FolderOpen size={15} /> Open Folder
          </button>
        </div>
      </>
    );
  }

  const name = folder.split(/[\\/]/).filter(Boolean).pop();
  const firstPath = rows[0]?.entry.path;

  return (
    <>
      <div className="sidebar-header">
        <span className="truncate" title={folder}>{variant?.title ?? name}</span>
        <span className="grow" />
        {!readOnly && <button className="icon-btn" title={variant?.labels.newFile ?? "New File"} onClick={() => startCreate("file")}><FilePlus size={15} /></button>}
        {!readOnly && <button className="icon-btn" title={variant?.labels.newFolder ?? "New Folder"} onClick={() => startCreate("dir")}><FolderPlus size={15} /></button>}
        <button className="icon-btn" title="Refresh" onClick={refresh}><RefreshCw size={14} /></button>
        {variant ? variant.headerExtra : <button className="icon-btn" title="Close Folder" onClick={() => set({ folder: null, fileListCache: null })}><X size={15} /></button>}
      </div>
      <div
        className="panel-body"
        role="tree"
        aria-label={variant?.title ?? "Explorer"}
        aria-multiselectable
        data-file-keys
        onClick={() => { setSelected(null); setMulti([]); }}
        onContextMenu={(e) => { e.preventDefault(); setSelected(null); setMulti([]); if (!readOnly) setMenu({ x: e.clientX, y: e.clientY, entry: null }); }}
        onKeyDown={onTreeKeyDown}
      >
        {rows.length === 0 && !creating && children.has(folder) && variant && (
          <div className="empty-state">{readOnly ? "No scripts here yet." : `Nothing here yet. Use ${variant.labels.newFile} above.`}</div>
        )}
        {creating && (
          <div className="tree-row" style={{ paddingLeft: 24 }} onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              className="input"
              style={{ height: 22, fontSize: 12 }}
              placeholder={creating.kind === "dir" ? (variant?.labels.folderPlaceholder ?? "folder name") : (variant?.labels.filePlaceholder ?? "file name")}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commitCreate();
                if (e.key === "Escape") closeCreate();
                e.stopPropagation();
              }}
              onBlur={() => void commitCreate()}
            />
          </div>
        )}
        {rows.map(({ entry, depth }) => {
          const isActive = !!activePath && samePath(entry.path, activePath);
          const isSelected = multi.length ? multi.some((p) => samePath(p, entry.path)) : !!selected && samePath(entry.path, selected);
          const gitFile = entry.isDir ? null : gitFiles[entry.path.toLowerCase()];
          const gitKind = entry.isDir ? gitDirs[entry.path.toLowerCase()] : gitFile ? kindOf(gitFile) : undefined;
          const isOpen = entry.isDir && expanded.has(entry.path);
          const tabIndex = isSelected || (!selected && entry.path === firstPath) ? 0 : -1;
          return (
            <div
              key={entry.path}
              ref={(el) => {
                if (el) rowRefs.current.set(entry.path.toLowerCase(), el);
                else rowRefs.current.delete(entry.path.toLowerCase());
              }}
              role="treeitem"
              aria-level={depth + 1}
              aria-selected={isSelected}
              aria-expanded={entry.isDir ? isOpen : undefined}
              tabIndex={tabIndex}
              className={`tree-row ${isSelected ? "selected" : ""} ${isActive ? "active" : ""}`}
              style={{ paddingLeft: 8 + depth * 14 }}
              title={entry.path}
              onClick={(e) => {
                e.stopPropagation();
                if (renaming === entry.path) return;
                e.currentTarget.focus();
                if (e.ctrlKey || e.shiftKey) {
                  // Ctrl+click adds or removes a row, Shift+click selects the rows from the last
                  // click; nothing opens. Find in Files then searches the whole selection.
                  const base = multi.length ? multi : selected ? [selected] : [];
                  const range = e.shiftKey ? rangeOf(rows.map((r) => r.entry.path), anchor.current ?? selected ?? entry.path, entry.path) : [];
                  const next = e.shiftKey ? (e.ctrlKey ? [...base, ...range.filter((p) => !base.some((b) => samePath(b, p)))] : range) : toggleIn(base, entry.path);
                  if (!e.shiftKey) anchor.current = entry.path;
                  setMulti(next);
                  setSelected(entry.path);
                  pickTargets(next);
                  return;
                }
                anchor.current = entry.path;
                setMulti([]);
                setSelected(entry.path);
                // Find in Files' Folder scope searches what was clicked last.
                pickTargets([entry.path]);
                if (!entry.isDir) variant?.onSelect?.(entry);
                if (entry.isDir) toggle(entry.path);
                else if (!variant?.onActivate) {
                  // A single click opens the file but leaves focus here, so Ctrl+C / Ctrl+X /
                  // Delete act on it; double-click (or Enter) goes to the editor.
                  const st = useStore.getState();
                  if (st.docs.find((d) => d.id === st.activeId)?.path?.toLowerCase() !== entry.path.toLowerCase()) editor.keepFocusOnNextOpen();
                  // A preview tab: the next file clicked here replaces it unless it has changes.
                  void openPath(entry.path, { preview: true });
                }
              }}
              onDoubleClick={(e) => {
                if (entry.isDir || renaming === entry.path) return;
                e.stopPropagation();
                if (activate(entry)) return;
                // Double-click keeps the tab (no longer a preview) and goes to the editor.
                void openPath(entry.path).then((d) => {
                  if (d?.preview) useStore.getState().updateDoc(d.id, { preview: false });
                  requestAnimationFrame(() => editor.focus());
                });
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                // Right-clicking outside a multi-row selection selects just that row.
                if (!multi.some((p) => samePath(p, entry.path))) setMulti([]);
                setSelected(entry.path);
                e.currentTarget.focus();
                // A folder's listing tells the menu whether it has subfolders (Expand All).
                if (entry.isDir) void load(entry.path);
                else variant?.onSelect?.(entry);
                setMenu({ x: e.clientX, y: e.clientY, entry });
              }}
            >
              <span className={`tree-chevron ${entry.isDir ? (isOpen ? "open" : "") : "leaf"}`}>
                <ChevronRight size={14} />
              </span>
              <FileIcon entry={entry} open={isOpen} />
              {renaming === entry.path ? (
                <input
                  autoFocus
                  className="input tree-rename"
                  value={renameName}
                  onChange={(e) => setRenameName(e.target.value)}
                  onFocus={(e) => {
                    const dot = entry.isDir ? -1 : entry.name.lastIndexOf(".");
                    e.currentTarget.setSelectionRange(0, dot > 0 ? dot : entry.name.length);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitRename();
                    if (e.key === "Escape") {
                      renameClosed.current = true;
                      setRenaming(null);
                    }
                    e.stopPropagation();
                  }}
                  onBlur={() => void commitRename()}
                />
              ) : (
                <span className={`tree-label ${gitKind ? `git-${gitKind}` : ""}`}>{entry.name}</span>
              )}
              {gitKind &&
                (entry.isDir ? (
                  <span className={`tree-git-dot git-${gitKind}`} title="Contains changes" />
                ) : (
                  <span className={`tree-git git-${gitKind}`} title={KIND_LABEL[gitKind]}>{KIND_LETTER[gitKind]}</span>
                ))}
            </div>
          );
        })}
      </div>
      {menu && (() => {
        const e = menu.entry;
        const inSel = !!e && multi.length > 1 && multi.some((p) => samePath(p, e.path));
        const paths = !e ? [] : inSel ? multi : [e.path];
        const dest = pasteDirFor(e?.path ?? null);
        return (
          <FileMenu
            x={menu.x}
            y={menu.y}
            paths={readOnly ? [] : paths}
            isDir={isDirPath}
            pasteDir={readOnly ? null : dest}
            onClose={() => setMenu(null)}
            showInQuarry={false}
            keyHints
            onPasted={(p) => afterPaste(p, dest)}
            onDeleted={afterDelete}
            lead={!e ? (
              folder && !isVariant ? (
                <>
                  <button className="palette-item" onClick={() => { setMenu(null); void runCommand("terminal.new", folder); }}><Terminal size={13} /><span className="title">Open in Terminal</span></button>
                  <div className="menu-sep" />
                </>
              ) : undefined
            ) : (
              <>
                {e.isDir && !inSel && (() => {
                  const isOpen = expanded.has(e.path);
                  const hasSubfolders = !!children.get(e.path)?.some((k) => k.isDir);
                  const openBelow = [...expanded].some((p) => isUnder(p, e.path));
                  return (
                    <>
                      {!isOpen && <button className="palette-item" onClick={() => { setMenu(null); toggle(e.path, true); }}><ChevronDown size={13} /><span className="title">Expand</span><span className="kbd">→</span></button>}
                      {hasSubfolders && <button className="palette-item" title="This folder and every folder inside it" onClick={() => void expandAll(e.path)}><ChevronsDown size={13} /><span className="title">Expand All</span></button>}
                      {isOpen && <button className="palette-item" onClick={() => { setMenu(null); toggle(e.path, false); }}><ChevronUp size={13} /><span className="title">Collapse</span><span className="kbd">←</span></button>}
                      {isOpen && openBelow && <button className="palette-item" title="This folder and every expanded folder inside it" onClick={() => collapseAll(e.path)}><ChevronsUp size={13} /><span className="title">Collapse All</span></button>}
                      {!readOnly && <div className="menu-sep" />}
                    </>
                  );
                })()}
                {!inSel && variant?.menuLead?.(e, () => setMenu(null))}
                {!readOnly && (inSel || e.isDir) && <button className="palette-item" onClick={() => void openAll(paths)} title={inSel ? "Open each selected file in its own tab (and the files in selected folders)" : "Open each file in this folder in its own tab"}><Files size={13} /><span className="title">Open All Files</span></button>}
                {e.isDir && !inSel && !isVariant && (
                  <button className="palette-item" onClick={() => { setMenu(null); void runCommand("terminal.new", e.path); }}><Terminal size={13} /><span className="title">Open in Terminal</span></button>
                )}
                {!isVariant && <button className="palette-item" onClick={() => findIn(paths)}><Search size={13} /><span className="title">{inSel ? `Find in Selected (${paths.length})` : e.isDir ? "Find in Folder" : "Find in File"}</span></button>}
                {!inSel && !readOnly && <button className="palette-item" onClick={() => startRename(e)}><Pencil size={13} /><span className="title">Rename</span><span className="kbd">F2</span></button>}
                {!readOnly && <div className="menu-sep" />}
              </>
            )}
          />
        );
      })()}
    </>
  );
}

const ICON_BY_EXT: Record<string, string> = {
  json: "var(--icon-json)",
  js: "var(--icon-js)", mjs: "var(--icon-js)", cjs: "var(--icon-js)", jsx: "var(--icon-js)",
  ts: "var(--icon-ts)", tsx: "var(--icon-ts)",
  md: "var(--icon-text)", txt: "var(--icon-text)", log: "var(--icon-text)",
  css: "var(--icon-css)", scss: "var(--icon-css)",
  html: "var(--icon-html)", xml: "var(--icon-html)",
  rs: "var(--icon-rust)", toml: "var(--icon-rust)",
  py: "var(--icon-py)",
  csv: "var(--icon-csv)", tsv: "var(--icon-csv)",
};

function FileIcon({ entry, open }: { entry: DirEntry; open: boolean }) {
  if (entry.isDir) {
    return (
      <svg className="tree-icon" viewBox="0 0 16 16" fill="currentColor" style={{ color: "var(--icon-folder)" }}>
        {open ? (
          <path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.2l1.4 1.5H13a1.5 1.5 0 0 1 1.5 1.5v1H3.3a1.5 1.5 0 0 0-1.44 1.08L1.5 8.5v-5Zm0 8V9.6l.7-2.4h11.8l-1.2 4.4a1.5 1.5 0 0 1-1.45 1.1H3a1.5 1.5 0 0 1-1.5-1.5Z" />
        ) : (
          <path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.2l1.4 1.5H13a1.5 1.5 0 0 1 1.5 1.5v6.5A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5v-8Z" />
        )}
      </svg>
    );
  }
  const ext = entry.name.includes(".") ? entry.name.split(".").pop()!.toLowerCase() : "";
  const color = ICON_BY_EXT[ext] ?? "var(--icon-file)";
  return (
    <svg className="tree-icon" viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.3">
      <path d="M4 1.5h5l3 3v10H4z" />
      <path d="M9 1.5v3h3" />
    </svg>
  );
}
