import { ALargeSmall, ArrowDown, ArrowUp, CaseSensitive, ChevronDown, ChevronRight, ListFilter, Regex, ReplaceAll, Search as SearchIcon, WholeWord, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { editor } from "../../editor/manager";
import { dirName, isInside, openPath, samePath } from "../../lib/actions";
import { bus } from "../../lib/bus";
import { search as searchIpc } from "../../lib/ipc";
import { reloadOpenDocs, undoEntriesOf } from "../../lib/replaceUndo";
import { runCommand } from "../../lib/commands";
import { activeDoc, DEFAULT_SEARCH_QUERY, useStore, type SearchResultsFile, type SearchState } from "../../lib/store";
import { InfoTip } from "../InfoTip";
import { FileMenu } from "../FileMenu";
import { rangeOf, toggleIn } from "./ExplorerPanel";
import { ClearButton, HistoryMenu, openHistoryFromKey } from "../HistoryMenu";
import { recordHistory } from "../../lib/searchHistory";
import { expandReplacement, preserveCase, replaceMatches } from "../../lib/replace";
import type { FileMatch, SearchQuery } from "../../lib/types";
import { choose } from "../../lib/dialogs";

let seq = 1;

/** The search as a JavaScript regex (open documents, the replace preview). Whole Word follows the
 *  folder search's rule: no word character just before or after the match ("-2" in "x -2 y"). */
export function buildJsRegex(q: Pick<SearchQuery, "pattern" | "isRegex" | "wholeWord" | "caseSensitive" | "dotAll">): RegExp | null {
  try {
    let src = q.isRegex ? q.pattern : q.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (q.wholeWord) src = `(?<!\\w)(?:${src})(?!\\w)`;
    return new RegExp(src, `gm${q.caseSensitive ? "" : "i"}${q.dotAll ? "s" : ""}`);
  } catch {
    return null;
  }
}

/** Characters kept from the end of a single word too long to show whole before a match. */
const LONG_WORD_TAIL = 12;

/**
 * Pure helper (testable): the text shown before a match in a result row. Keeps the last `words`
 * whole words before the match (at most `maxChars`), so the match and the words after it stay in
 * view; "…" marks text left out. At the start of a line nothing is added (indentation dropped).
 */
export function previewBefore(before: string, cut = false, words = 3, maxChars = 32): string {
  const tokens = before.match(/\s+|\S+\s*/g) ?? [];
  let kept = "";
  let n = 0;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (/\S/.test(t)) {
      if (n === words) break;
      n++;
    }
    if (kept.length + t.length > maxChars) {
      // A single very long word: keep just a short tail of it.
      if (!/\S/.test(kept)) kept = t.slice(-Math.min(LONG_WORD_TAIL, maxChars - kept.length)) + kept;
      break;
    }
    kept = t + kept;
  }
  const dropped = before.slice(0, before.length - kept.length);
  const ellipsis = cut || /\S/.test(dropped);
  return ellipsis ? `…${kept.replace(/^\s+/, " ")}` : kept.trimStart();
}

/** `path` relative to the first of `roots` that contains it (or its directory when none does). */
export function relativeDir(path: string, roots: string[]): string {
  const dir = dirName(path);
  for (const r of roots) {
    const root = r.replace(/[\\/]+$/, "");
    if (dir.toLowerCase() === root.toLowerCase()) return "";
    if (dir.toLowerCase().startsWith(root.toLowerCase() + "\\") || dir.toLowerCase().startsWith(root.toLowerCase() + "/")) return dir.slice(root.length + 1);
  }
  return dir;
}

/**
 * Re-locate a (possibly stale) match in the current text: the hit must still be at `line:col`,
 * otherwise the nearby lines (±`radius`) are scanned for the hit text. `null` = not found.
 */
export function locateMatch(text: string, m: FileMatch, radius = 5): { line: number; col: number } | null {
  const hit = m.preview.slice(m.previewCol, m.previewCol + m.len);
  const lines = text.split("\n");
  const at = (ln: number) => (lines[ln - 1] ?? "").replace(/\r$/, "");
  if (hit.length === 0) return m.line <= lines.length ? { line: m.line, col: m.col } : null;
  if (at(m.line).startsWith(hit, m.col)) return { line: m.line, col: m.col };
  for (let d = 0; d <= radius; d++) {
    for (const ln of d === 0 ? [m.line] : [m.line - d, m.line + d]) {
      if (ln < 1 || ln > lines.length) continue;
      const i = at(ln).indexOf(hit);
      if (i >= 0) return { line: ln, col: i };
    }
  }
  return null;
}

/** Search the text of open documents in memory: all of them, or only the one with id `onlyId`. */
function searchOpenDocs(q: SearchQuery, onlyId?: string): SearchResultsFile[] {
  const re = buildJsRegex(q);
  if (!re) return [];
  const out: SearchResultsFile[] = [];
  for (const d of useStore.getState().docs) {
    if (d.kind !== "text" || (onlyId !== undefined && d.id !== onlyId)) continue;
    const text = editor.textOf(d.id);
    const matches: FileMatch[] = [];
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let lineStarts: number[] | null = null;
    while ((m = re.exec(text)) && matches.length < q.maxResults) {
      if (m[0].length === 0) re.lastIndex++;
      if (!lineStarts) {
        lineStarts = [0];
        for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
      }
      let lo = 0;
      let hi = lineStarts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineStarts[mid] <= m.index) lo = mid;
        else hi = mid - 1;
      }
      const ls = lineStarts[lo];
      let le = text.indexOf("\n", m.index);
      if (le < 0) le = text.length;
      const pstart = m.index - ls > 40 ? m.index - 40 : ls;
      const preview = text.slice(pstart, Math.min(le, pstart + 400)).replace(/\r$/, "");
      matches.push({ path: d.path ?? d.name, line: lo + 1, col: m.index - ls, len: m[0].length, preview, previewCol: m.index - pstart, previewCut: pstart > ls });
    }
    if (matches.length) out.push({ path: d.path ?? d.name, matches });
  }
  return out;
}

const SEARCH_TIP = [
  "Enter — run search",
  "Ctrl+Enter — insert a newline (multi-line pattern)",
  "Regex mode: $1, $2 in Replace refer to capture groups",
  "Dot-matches-newline lets patterns span lines",
  "Results: ↑/↓ preview, Enter opens, ←/→ collapse/expand a file, F4 / Shift+F4 next/previous result",
  "Delete (or × on a row) leaves a result or a whole file out of Replace All",
  "Preserve Case (in Replace) keeps FOO / Foo / foo in step with what it replaces",
].join("\n");

const keyOf = (m: FileMatch) => `${m.path}:${m.line}:${m.col}`;
const MAX_SHOWN = 500;
/** Tallest the Find in Files search box grows (about eight lines) before it scrolls. */
const FIND_MAX_HEIGHT = 156;

/** Result rows (file headers + matches) rendered at once; more appear on demand. Rendering every row
 *  of a 5 000-file result on each 100 ms batch blocked the window for seconds. */
export const ROW_BUDGET = 1500;

/**
 * How many matches of each file to render within `limit` rows (a file header counts as one row):
 * `-1` means the file is not rendered at all. Collapsed files only cost their header.
 */
export function budgetRows(files: { matches: number; collapsed: boolean }[], limit: number, perFile = MAX_SHOWN): number[] {
  let left = limit;
  return files.map((f) => {
    if (left <= 0) return -1;
    left--;
    if (f.collapsed) return 0;
    const n = Math.max(0, Math.min(f.matches, perFile, left));
    left -= n;
    return n;
  });
}

/**
 * Pure helper (testable): the scope a search actually uses. Current File needs an open document
 * and Open Files needs open tabs; without them their buttons are hidden and the search falls back
 * to Open Files, then Folder. The chosen scope is kept, so it applies again once files are open.
 */
export function effectiveScope(scope: SearchState["scope"], hasActive: boolean, hasDocs: boolean): SearchState["scope"] {
  if (scope === "doc" && !hasActive) return hasDocs ? "open" : "folder";
  if (scope === "open" && !hasDocs) return "folder";
  return scope;
}

/**
 * Pure helper (testable): what the Folder scope searches. That is the files and folders picked in
 * the Explorer (`targets`) that are in the open folder, without any that a picked folder already
 * contains. With none left it is the open folder itself.
 */
export function explorerRoots(targets: string[], folder: string | null): string[] {
  if (!folder) return [];
  const inFolder = targets.filter((t) => samePath(t, folder) || isInside(t, folder));
  const roots: string[] = [];
  for (const t of inFolder) {
    if (roots.some((r) => samePath(r, t))) continue;
    if (inFolder.some((o) => !samePath(o, t) && isInside(t, o))) continue;
    roots.push(t);
  }
  return roots.length ? roots : [folder];
}

/** Pure helper (testable): the line under the scope buttons: "Quarry\src", "notes.txt", "3 items: a.txt, src, b.md". */
export function targetSummary(roots: string[], folder: string): string {
  if (roots.length === 1) return folderLabel(roots[0], folder);
  const names = roots.map((r) => r.split(/[\\/]/).filter(Boolean).pop() ?? r);
  return `${roots.length} items: ${names.join(", ")}`;
}

/** Pure helper (testable): `target` shown from the open folder's own name down ("Quarry\src"). */
export function folderLabel(target: string, folder: string): string {
  const parent = dirName(folder).replace(/[\\/]+$/, "");
  const inside = parent && target.length > parent.length && target.toLowerCase().startsWith(parent.toLowerCase());
  return inside ? target.slice(parent.length).replace(/^[\\/]+/, "") : target;
}

/** Pure helper (testable): how many filters differ from their defaults, for the badge on the
 *  Filters button. Include / exclude and .gitignore only apply to folder scopes. */
export function activeFilterCount(q: SearchQuery, folderScope: boolean): number {
  let n = 0;
  if (folderScope) {
    if (q.include.length) n++;
    if (q.exclude.length) n++;
    if (q.respectGitignore !== DEFAULT_SEARCH_QUERY.respectGitignore) n++;
  }
  if (q.dotAll) n++;
  if (q.maxResults !== DEFAULT_SEARCH_QUERY.maxResults) n++;
  return n;
}

/**
 * Pure helper (testable): the search-state change that leaves one result (or, without `m`, a whole
 * file) out of the list and of Replace All. A left-out match is remembered in `excluded` so the
 * replace skips it; a file with nothing left is dropped from the results.
 */
export function leaveOutPatch(st: Pick<SearchState, "files" | "excluded" | "totalMatches" | "leftOut">, path: string, m?: FileMatch): Partial<SearchState> | null {
  const f = st.files.find((x) => x.path === path);
  if (!f) return null;
  const rest = m ? f.matches.filter((x) => x !== m) : [];
  if (m && rest.length === f.matches.length) return null;
  const removed = f.matches.length - rest.length;
  const { [path]: prev = [], ...others } = st.excluded;
  return {
    files: rest.length ? st.files.map((x) => (x === f ? { ...x, matches: rest } : x)) : st.files.filter((x) => x !== f),
    excluded: rest.length ? { ...others, [path]: [...prev, `${m!.line}:${m!.col}`] } : others,
    totalMatches: Math.max(0, st.totalMatches - removed),
    leftOut: st.leftOut + removed,
  };
}

export function SearchPanel() {
  const st = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);
  const folder = useStore((s) => s.folder);
  const activeName = useStore((s) => activeDoc(s)?.name);
  const hasDocs = useStore((s) => s.docs.length > 0);
  const toast = useStore((s) => s.toast);
  const set = useStore((s) => s.set);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  /** The query of the results on screen, used to highlight matches in documents opened from them. */
  const ranQuery = useRef<SearchQuery | null>(null);
  /** When the search behind the results started: Replace in Files leaves files changed since. */
  const searchedAt = useRef<number | undefined>(undefined);
  /** The editor selection made by opening a result, so reopening the panel does not take it as a new search term. */
  const resultSel = useRef<{ docId: string; from: number; to: number } | null>(null);
  const findWrapRef = useRef<HTMLDivElement>(null);
  const replaceWrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [regexError, setRegexError] = useState<string | null>(null);
  const [stale, setStale] = useState<Set<string>>(new Set());
  const [replaceNote, setReplaceNote] = useState<string | null>(null);
  const replaceUndo = useStore((s) => s.replaceUndo);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  /** File rows picked with Ctrl / Shift+click, for the right-click menu. */
  const [selFiles, setSelFiles] = useState<string[]>([]);
  const fileAnchor = useRef<string | null>(null);
  const [fileMenu, setFileMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const focusWanted = useRef<string | null>(null);
  const q = st.query;
  const scope = effectiveScope(st.scope, activeName !== undefined, hasDocs);
  const targetRoots = explorerRoots(st.treeTargets.map((t) => t.path), folder);
  const wholeFolder = targetRoots.length === 1 && !!folder && samePath(targetRoots[0], folder);
  const targetIsFolder = targetRoots.length === 1 && (wholeFolder || !!st.treeTargets.find((t) => samePath(t.path, targetRoots[0]))?.isDir);

  useEffect(() => bus.on("search.focus", () => {
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 30);
    const view = editor.view;
    if (view) {
      const sel = view.state.selection.main;
      const r = resultSel.current;
      const fromResult = !!r && r.docId === useStore.getState().activeId && r.from === sel.from && r.to === sel.to;
      if (!sel.empty && sel.to - sel.from < 300 && !fromResult) setSearch({ query: { ...useStore.getState().search.query, pattern: view.state.sliceDoc(sel.from, sel.to) } });
    }
  }), []);

  // The search box grows to show the whole term (wrapped), up to FIND_MAX_HEIGHT, then scrolls.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "0px";
      const borders = el.offsetHeight - el.clientHeight;
      const h = Math.max(30, Math.min(FIND_MAX_HEIGHT, el.scrollHeight + borders));
      el.style.height = `${h}px`;
      el.style.overflowY = el.scrollHeight + borders > FIND_MAX_HEIGHT ? "auto" : "hidden";
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el.parentElement ?? el);
    return () => ro.disconnect();
  }, [q.pattern]);

  useEffect(() => {
    const un: Promise<() => void>[] = [];
    un.push(
      searchIpc.onResults(({ searchId, matches }) => {
        const cur = useStore.getState().search;
        if (searchId !== cur.searchId) return;
        // Matches arrive grouped by file. Collect each run first, then make one new file entry per
        // run: copying a file's list per match was quadratic, and objects of the previous state
        // must not be mutated.
        const files = [...cur.files];
        let run: { path: string; matches: typeof matches } | null = null;
        const flushRun = () => {
          if (!run) return;
          const last = files[files.length - 1];
          if (last && last.path === run.path) files[files.length - 1] = { ...last, matches: last.matches.concat(run.matches) };
          else files.push({ path: run.path, matches: run.matches });
          run = null;
        };
        for (const m of matches) {
          if (run && run.path === m.path) run.matches.push(m);
          else {
            flushRun();
            run = { path: m.path, matches: [m] };
          }
        }
        flushRun();
        setSearch({ files, totalMatches: cur.totalMatches + matches.length });
      }),
    );
    un.push(
      searchIpc.onDone((d) => {
        const cur = useStore.getState().search;
        if (d.searchId !== cur.searchId) return;
        setSearch({ running: false, filesSearched: d.filesSearched, truncated: d.truncated, cancelled: d.cancelled, totalMatches: Math.max(d.matches, cur.totalMatches) });
      }),
    );
    un.push(searchIpc.onError(({ searchId, error }) => {
      if (searchId !== useStore.getState().search.searchId) return;
      setSearch({ running: false, error });
    }));
    return () => {
      un.forEach((p) => p.then((f) => f()));
    };
  }, []);

  // Validate regex with the Rust engine (the one that actually runs); JS RegExp is only a fast pre-check.
  const jsInvalid = q.isRegex && !buildJsRegex(q);
  useEffect(() => {
    if (!q.isRegex || !q.pattern) {
      setRegexError(null);
      return;
    }
    let live = true;
    const t = window.setTimeout(() => {
      searchIpc.validateRegex(q.pattern, { caseSensitive: q.caseSensitive, wholeWord: q.wholeWord, dotAll: q.dotAll })
        .then((err) => live && setRegexError(err))
        .catch(() => live && setRegexError(null));
    }, 150);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [q.isRegex, q.pattern, q.caseSensitive, q.wholeWord, q.dotAll]);
  const invalidRegex = jsInvalid || regexError !== null;
  const regexMessage = regexError ?? (jsInvalid ? "Invalid regular expression" : null);

  const setQ = (patch: Partial<SearchQuery>) => setSearch({ query: { ...q, ...patch } });

  const run = async () => {
    if (!q.pattern || invalidRegex) return;
    recordHistory("find", q.pattern);
    ranQuery.current = q;
    // File times are whole milliseconds; a write in the same millisecond as the search start still counts as later.
    searchedAt.current = Date.now() - 1;
    editor.clearResultHighlights();
    // Results are coming: dock the panel so documents opened from them aren't hidden behind it.
    set({ searchDocked: true });
    if (st.running) await searchIpc.cancel(st.searchId).catch(() => {});
    const id = seq++;
    setStale(new Set());
    setSelFiles([]);
    setReplaceNote(null);
    setFocusKey(null);
    setSearch({ searchId: id, files: [], totalMatches: 0, filesSearched: 0, truncated: false, cancelled: false, error: null, running: true, collapsed: new Set(), fileErrors: {}, activeKey: null, excluded: {}, leftOut: 0 });
    const active = scope === "doc" ? activeDoc(useStore.getState()) : null;
    if (scope === "doc" && !active) {
      setSearch({ running: false });
      toast("Open a document to search, or pick another scope.", "warning");
      return;
    }
    if (scope === "open" || active?.kind === "text") {
      const files = searchOpenDocs(q, active?.id);
      setSearch({ running: false, inMemory: true, files, totalMatches: files.reduce((n, f) => n + f.matches.length, 0), filesSearched: active ? 1 : useStore.getState().docs.length });
      return;
    }
    // A large-file document is searched on disk like a one-file folder.
    const roots = active ? (active.path ? [active.path] : []) : scope === "custom" ? st.customRoots : targetRoots;
    if (roots.length === 0) {
      setSearch({ running: false });
      toast("Open a folder (Ctrl+Shift+O) or choose a search location first.", "warning");
      return;
    }
    const scopeQuery = active ? { ...q, include: [], exclude: [], respectGitignore: false } : q;
    setSearch({ inMemory: false });
    try {
      await searchIpc.start(id, roots, { ...scopeQuery, multiline: q.isRegex || q.pattern.includes("\n") });
    } catch (e) {
      setSearch({ running: false, error: String(e) });
    }
  };

  const cancel = () => {
    searchIpc.cancel(st.searchId).catch(() => {});
    setSearch({ running: false, cancelled: true });
  };

  /** Open a result. `focusEditor=false` previews it and keeps keyboard focus in the result list. */
  const openMatch = async (m: FileMatch, focusEditor = true) => {
    const key = keyOf(m);
    setSearch({ activeKey: key });
    setFocusKey(key);
    const keepFocus = () => {
      if (focusEditor) return;
      const el = listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
      requestAnimationFrame(() => el?.focus({ preventScroll: true }));
    };
    const goto = (docId: string) => {
      // Highlight every match like the find bar does; the selected one is marked as current.
      editor.setResultHighlight(docId, ranQuery.current ? buildJsRegex(ranQuery.current) : null);
      const loc = locateMatch(editor.textOf(docId), m);
      if (!loc) {
        setStale((s) => new Set(s).add(key));
        editor.goTo(m.line, 1);
      } else {
        if (loc.line !== m.line || loc.col !== m.col) setStale((s) => new Set(s).add(key));
        editor.goTo(loc.line, loc.col + 1, { to: m.len });
      }
      const sel = editor.view?.state.selection.main;
      resultSel.current = sel ? { docId, from: sel.from, to: sel.to } : null;
      keepFocus();
    };
    const doc = useStore.getState().docs.find((d) => (d.path ?? d.name) === m.path);
    if (doc) {
      useStore.getState().setActive(doc.id);
      if (doc.kind === "text") requestAnimationFrame(() => goto(doc.id));
      else {
        bus.emit("big.goto", { line: m.line });
        keepFocus();
      }
      return;
    }
    const d = await openPath(m.path, { line: m.line, col: m.col + 1 });
    if (d?.kind === "text") setTimeout(() => goto(d.id), 50);
    else keepFocus();
  };

  // Flat list of visible result rows (file headers + shown matches) for keyboard navigation.
  const visibleKeys = useMemo(() => {
    const out: { key: string; file?: SearchResultsFile; match?: FileMatch }[] = [];
    for (const f of st.files) {
      out.push({ key: `file:${f.path}`, file: f });
      if (!st.collapsed.has(f.path)) for (const m of f.matches.slice(0, MAX_SHOWN)) out.push({ key: keyOf(m), match: m });
    }
    return out;
  }, [st.files, st.collapsed]);

  const allMatches = useMemo(() => st.files.flatMap((f) => f.matches.slice(0, MAX_SHOWN)), [st.files]);
  const activeIndex = useMemo(() => (st.activeKey ? allMatches.findIndex((m) => keyOf(m) === st.activeKey) : -1), [allMatches, st.activeKey]);

  const [rowLimit, setRowLimit] = useState(ROW_BUDGET);
  useEffect(() => setRowLimit(ROW_BUDGET), [st.searchId]);
  const shownPerFile = useMemo(() => budgetRows(st.files.map((f) => ({ matches: f.matches.length, collapsed: st.collapsed.has(f.path) })), rowLimit), [st.files, st.collapsed, rowLimit]);
  const hiddenFiles = shownPerFile.filter((n) => n < 0).length;

  useEffect(() => {
    const k = focusWanted.current;
    if (!k) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(k)}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "nearest" });
      focusWanted.current = null;
    }
  }, [visibleKeys, focusKey]);

  const focusItem = (key: string) => {
    // Keyboard navigation past the rendered rows grows the budget; the effect above focuses once rendered.
    const at = visibleKeys.findIndex((k) => k.key === key);
    if (at >= rowLimit - 1) setRowLimit(at + ROW_BUDGET);
    setFocusKey(key);
    focusWanted.current = key;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "nearest" });
      focusWanted.current = null;
    }
  };

  // F4 / Shift+F4 (find.nextResult / find.prevResult) step through all results and open them.
  useEffect(() => bus.on("search.step", (payload) => {
    const dir = (payload as { dir: 1 | -1 } | undefined)?.dir ?? 1;
    const list = allMatches;
    if (list.length === 0) return;
    const cur = useStore.getState().search.activeKey;
    const i = cur ? list.findIndex((m) => keyOf(m) === cur) : -1;
    const next = list[((i < 0 ? (dir > 0 ? -1 : 0) : i) + dir + list.length) % list.length];
    if (st.collapsed.has(next.path)) {
      const c = new Set(st.collapsed);
      c.delete(next.path);
      setSearch({ collapsed: c });
    }
    void openMatch(next, true);
  }), [allMatches, st.collapsed]);

  const toggleCollapse = (path: string, open?: boolean) => {
    const c = new Set(st.collapsed);
    const willOpen = open ?? c.has(path);
    if (willOpen) c.delete(path);
    else c.add(path);
    setSearch({ collapsed: c });
  };

  /** Remove a result (or a whole file) from the list and from Replace All; focus moves to the next row. */
  const leaveOut = (path: string, m?: FileMatch) => {
    const cur = useStore.getState().search;
    if (cur.running) return;
    const patch = leaveOutPatch(cur, path, m);
    if (!patch) return;
    const gone = (k: { key: string; file?: SearchResultsFile; match?: FileMatch }) =>
      m ? k.match === m || (k.file?.path === path && patch.files!.every((f) => f.path !== path)) : (k.file ?? k.match)?.path === path;
    const at = visibleKeys.findIndex((k) => (m ? k.match === m : k.file?.path === path));
    const next = visibleKeys.slice(at + 1).find((k) => !gone(k)) ?? visibleKeys.slice(0, Math.max(0, at)).reverse().find((k) => !gone(k));
    const activeGone = cur.activeKey !== null && (m ? cur.activeKey === keyOf(m) : cur.activeKey.startsWith(`${path}:`));
    setSearch({ ...patch, ...(activeGone ? { activeKey: null } : {}) });
    if (next) {
      setFocusKey(next.key);
      focusWanted.current = next.key;
    }
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (visibleKeys.length === 0) return;
    // The focused row (it may have been reached with Tab rather than a click or the arrows).
    const cur = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-key]")?.dataset.key ?? focusKey;
    const idx = cur ? visibleKeys.findIndex((v) => v.key === cur) : -1;
    const item = idx >= 0 ? visibleKeys[idx] : null;
    const go = (i: number) => {
      const it = visibleKeys[Math.max(0, Math.min(visibleKeys.length - 1, i))];
      focusItem(it.key);
      if (it.match) void openMatch(it.match, false);
    };
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
        go(visibleKeys.length - 1);
        break;
      case "PageDown":
        go(idx + 15);
        break;
      case "PageUp":
        go(idx - 15);
        break;
      case "ArrowRight":
        if (item?.file) {
          if (st.collapsed.has(item.file.path)) toggleCollapse(item.file.path, true);
          else if (idx + 1 < visibleKeys.length && visibleKeys[idx + 1].match) go(idx + 1);
        }
        break;
      case "ArrowLeft":
        if (item?.file) toggleCollapse(item.file.path, false);
        else if (item?.match) focusItem(`file:${item.match.path}`);
        break;
      case "Enter":
        if (item?.match) void openMatch(item.match, true);
        else if (item?.file) toggleCollapse(item.file.path);
        break;
      case " ":
        if (item?.match) void openMatch(item.match, false);
        else if (item?.file) toggleCollapse(item.file.path);
        break;
      case "Delete":
        if (item?.match) leaveOut(item.match.path, item.match);
        else if (item?.file) leaveOut(item.file.path);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const replaceAllInResults = async () => {
    if (st.files.length === 0) return;
    // Replace what the user reviewed: the query that produced these results, not edits made to
    // the find box or match toggles since. Preserve Case only shapes the replacement, so it stays live.
    const rq: SearchQuery = { ...(ranQuery.current ?? q), preserveCase: q.preserveCase };
    const edited = (["pattern", "isRegex", "caseSensitive", "wholeWord", "dotAll"] as const).some((k) => rq[k] !== q[k]);
    const docs = useStore.getState().docs;
    const skipped: SearchResultsFile[] = [];
    const targets: { path: string; skip: [number, number][]; searchedMs?: number }[] = [];
    const skipOf = (path: string) => (st.excluded[path] ?? []).map((k) => k.split(":").map(Number) as [number, number]);
    if (!st.inMemory) {
      for (const f of st.files) {
        const open = docs.find((d) => d.path && d.path.toLowerCase() === f.path.toLowerCase());
        if (open?.dirty) skipped.push(f);
        else targets.push({ path: f.path, skip: skipOf(f.path), searchedMs: searchedAt.current });
      }
    }
    const skippedCount = skipped.reduce((n, f) => n + f.matches.length, 0);
    const total = st.totalMatches - skippedCount;
    const nFiles = st.files.length - skipped.length;
    if (nFiles === 0) {
      toast("All matching files are open with unsaved changes; save them first.", "warning");
      return;
    }
    const skippedList = skipped.length
      ? `\n\nSkipped (open with unsaved changes):\n${skipped.slice(0, 8).map((f) => `• ${f.path.split(/[\\/]/).pop()} (${f.matches.length})`).join("\n")}${skipped.length > 8 ? `\n… ${skipped.length - 8} more` : ""}`
      : "";
    const ok = await choose(
      `Replace ${total.toLocaleString()} occurrence${total === 1 ? "" : "s"} in ${nFiles} file${nFiles === 1 ? "" : "s"}?`,
            (st.inMemory ? "Changes are applied to the open documents and can be undone per file." : "Files on disk will be rewritten. Find › Undo Replace in Files restores them.") +
            (edited ? `

This uses the search for "${rq.pattern}" that produced these results; search again to use the edited query.` : "") +
            (st.leftOut ? `

${st.leftOut.toLocaleString()} result${st.leftOut === 1 ? "" : "s"} you left out will not be changed.` : "") +
            skippedList,
      [
        { label: "Replace", kind: "primary", value: true },
        { label: "Cancel", value: false },
      ],
      false,
    );
    if (!ok) return;
    recordHistory("replace", st.replacement);
    const re = buildJsRegex(rq);
    if (st.inMemory) {
      if (!re) return;
      let n = 0;
      for (const f of st.files) {
        const doc = docs.find((d) => (d.path ?? d.name) === f.path && d.kind === "text");
        if (!doc) continue;
        const r = replaceMatches(editor.textOf(doc.id), re, st.replacement, { isRegex: rq.isRegex, preserveCase: rq.preserveCase, skip: new Set(st.excluded[f.path]) });
        if (r.count === 0) continue;
        editor.replaceAll(doc.id, r.text);
        n++;
      }
      const note = `Replaced ${total.toLocaleString()} occurrence(s) in ${n} open document(s)`;
      toast(note, "success");
      setReplaceNote(note);
      setStale(new Set(allMatches.map(keyOf)));
      return;
    }
    try {
      const res = await searchIpc.replaceInFiles(targets, { ...rq, multiline: true }, st.replacement);
      const n = res.reduce((a, r) => a + r.replaced, 0);
      const errs = res.filter((r) => r.error);
      const fileErrors: Record<string, string> = {};
      for (const r of errs) fileErrors[r.path] = r.error!;
      await reloadOpenDocs(res.filter((r) => r.replaced > 0).map((r) => r.path));
      const undoEntries = undoEntriesOf(res);
      set({ replaceUndo: undoEntries.length ? { entries: undoEntries, summary: `${rq.pattern} → ${st.replacement}` } : null });
      // Originals over the undo budget (or with no undo folder) are replaced without a backup: say so.
      const noBackup = res.filter((r) => r.replaced > 0 && !r.error && !r.backup).length;
      const note = `Replaced ${n.toLocaleString()} occurrence(s) in ${res.filter((r) => r.replaced > 0).length} file(s)${skipped.length ? `; skipped ${skipped.length} unsaved` : ""}${errs.length ? `; ${errs.length} failed` : ""}${noBackup ? `; ${noBackup} can't be undone (no backup)` : ""}`;
      toast(note, errs.length ? "warning" : "success");
      setReplaceNote(note);
      // Keep the list so failures can be inspected; replaced rows are stale now.
      const done = new Set(res.filter((r) => r.replaced > 0 && !r.error).map((r) => r.path));
      setStale(new Set(allMatches.filter((m) => done.has(m.path)).map(keyOf)));
      setSearch({ fileErrors });
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const previewReplacement = useMemo(() => {
    if (!st.showReplace) return null;
    const pq = ranQuery.current && st.files.length ? { ...ranQuery.current, preserveCase: q.preserveCase } : q;
    const re = buildJsRegex(pq);
    if (!re) return null;
    return (s: string) => {
      re.lastIndex = 0;
      const m = re.exec(s);
      if (!m) return st.replacement;
      const rep = pq.isRegex ? expandReplacement(st.replacement, m) : st.replacement;
      return q.preserveCase ? preserveCase(m[0], rep) : rep;
    };
  }, [st.showReplace, st.replacement, st.files.length, q]);

  // Result rows show their folder relative to these.
  const roots = scope === "custom" ? st.customRoots : folder ? [folder] : [];
  const folderScope = scope === "folder" || scope === "custom";
  const filterCount = activeFilterCount(q, folderScope);

  const status = (() => {
    if (st.error) return <span style={{ color: "var(--danger)" }}>{st.error}</span>;
    if (st.running) return `Searching… ${st.totalMatches.toLocaleString()} found`;
    if (replaceNote)
      return (
        <span className="search-status">
          {replaceNote}
          {replaceUndo && (
            <>
              {" · "}
              <button className="link-btn" onClick={() => runCommand("find.undoReplaceInFiles")}>Undo</button>
            </>
          )}
        </span>
      );
    const tail = st.cancelled ? ` (cancelled, stopped after ${st.filesSearched.toLocaleString()} files)` : st.truncated ? " (limit reached)" : "";
    const left = st.leftOut ? ` · ${st.leftOut.toLocaleString()} left out` : "";
    if (st.files.length > 0) return <span className={`search-status ${st.cancelled ? "cancelled" : ""}`}>{`${st.totalMatches.toLocaleString()} result${st.totalMatches === 1 ? "" : "s"} in ${st.files.length} file${st.files.length === 1 ? "" : "s"}${tail}${left}`}</span>;
    if (st.leftOut) return <span className="search-status">{`All ${st.leftOut.toLocaleString()} result${st.leftOut === 1 ? "" : "s"} left out`}</span>;
    if (st.cancelled) return <span className="search-status cancelled">{`Cancelled after ${st.filesSearched.toLocaleString()} file${st.filesSearched === 1 ? "" : "s"}`}</span>;
    if (st.filesSearched > 0) return `No results in ${st.filesSearched.toLocaleString()} file${st.filesSearched === 1 ? "" : "s"}`;
    return "";
  })();

  return (
    <>
      <div className="sidebar-header">
        Find in Files
        <InfoTip text={SEARCH_TIP} label="Search tips" />
        <span className="grow" />
        {st.files.length > 0 && (
          <button className="icon-btn" title="Clear results" onClick={() => { editor.clearResultHighlights(); set({ searchDocked: false }); setReplaceNote(null); setStale(new Set()); setSearch({ query: { ...q, pattern: "" }, files: [], totalMatches: 0, filesSearched: 0, cancelled: false, error: null, fileErrors: {}, activeKey: null, excluded: {}, leftOut: 0 }); }}>
            <X size={15} />
          </button>
        )}
      </div>
      <div className="panel-section search-top" style={{ paddingTop: 0 }}>
        <div className="row">
          <button className="icon-btn" title={st.showReplace ? "Hide replace" : "Show replace"} onClick={() => setSearch({ showReplace: !st.showReplace })}>
            {st.showReplace ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <div ref={findWrapRef} className="input-wrap with-actions-5 align-top grow">
            <textarea
              ref={inputRef}
              className={`input mono search-find ${invalidRegex ? "invalid" : ""}`}
              rows={1}
              placeholder="Search"
              value={q.pattern}
              onChange={(e) => setQ({ pattern: e.target.value })}
              onKeyDown={(e) => {
                if (openHistoryFromKey(e, "find")) return;
                if (e.key === "Enter" && e.ctrlKey) {
                  e.preventDefault();
                  const el = e.currentTarget;
                  const { selectionStart: a, selectionEnd: b } = el;
                  setQ({ pattern: q.pattern.slice(0, a) + "\n" + q.pattern.slice(b) });
                  requestAnimationFrame(() => el.setSelectionRange(a + 1, a + 1));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  void run();
                } else if (e.key === "ArrowDown" && visibleKeys.length > 0 && !q.pattern.includes("\n")) {
                  e.preventDefault();
                  focusItem(visibleKeys[0].key);
                }
              }}
              spellCheck={false}
            />
            <div className="input-actions">
              <ClearButton value={q.pattern} label="Clear search" onClear={() => { setQ({ pattern: "" }); inputRef.current?.focus(); }} />
              <HistoryMenu kind="find" anchor={findWrapRef} onPick={(t) => setQ({ pattern: t })} />
              <button className={`icon-btn xs ${q.caseSensitive ? "on" : ""}`} aria-pressed={!!q.caseSensitive} title="Match Case" onClick={() => setQ({ caseSensitive: !q.caseSensitive })}><CaseSensitive size={15} /></button>
              <button className={`icon-btn xs ${q.wholeWord ? "on" : ""}`} aria-pressed={!!q.wholeWord} title="Match Whole Word" onClick={() => setQ({ wholeWord: !q.wholeWord })}><WholeWord size={15} /></button>
              <button className={`icon-btn xs ${q.isRegex ? "on" : ""}`} aria-pressed={!!q.isRegex} title="Use Regular Expression" onClick={() => setQ({ isRegex: !q.isRegex })}><Regex size={14} /></button>
            </div>
          </div>
        </div>
        {regexMessage && <div className="regex-error" role="alert">{regexMessage}</div>}
        {st.showReplace && (
          <div className="row">
            <span style={{ width: 26 }} />
            <div ref={replaceWrapRef} className="input-wrap with-actions-3 grow">
              <input ref={replaceRef} className="input mono" placeholder={q.isRegex ? "Replace ($1 groups)" : "Replace"} value={st.replacement} onChange={(e) => setSearch({ replacement: e.target.value })} onKeyDown={(e) => { if (openHistoryFromKey(e, "replace")) return; if (e.key === "Enter") void run(); }} spellCheck={false} />
              <div className="input-actions">
                <ClearButton value={st.replacement} label="Clear replace" onClear={() => { setSearch({ replacement: "" }); replaceRef.current?.focus(); }} />
                <HistoryMenu kind="replace" anchor={replaceWrapRef} onPick={(t) => setSearch({ replacement: t })} />
                <button className={`icon-btn xs ${q.preserveCase ? "on" : ""}`} aria-pressed={q.preserveCase} title={"Preserve Case\nFOO → BAR, Foo → Bar, foo → bar"} onClick={() => setQ({ preserveCase: !q.preserveCase })}><ALargeSmall size={15} /></button>
              </div>
            </div>
            <button className="icon-btn" title="Replace All in results" disabled={st.files.length === 0 || st.running} onClick={() => void replaceAllInResults()}><ReplaceAll size={15} /></button>
          </div>
        )}
        <div className="row scope-row">
          <div className="segmented scope-seg" role="group" aria-label="Search in">
            {activeName !== undefined && (
              <button className={scope === "doc" ? "on" : ""} aria-pressed={scope === "doc"} onClick={() => setSearch({ scope: "doc" })} title={`Search ${activeName}`}>Current File</button>
            )}
            {hasDocs && <button className={scope === "open" ? "on" : ""} aria-pressed={scope === "open"} onClick={() => setSearch({ scope: "open" })} title="Search every open tab">Open Files</button>}
            <button className={scope === "folder" ? "on" : ""} aria-pressed={scope === "folder"} onClick={() => setSearch({ scope: "folder" })} title={folder ? `Search ${targetRoots.join("\n")}\n\nClick files or folders in the Explorer (Ctrl / Shift for several) to search them instead.` : "No folder open"}>{targetIsFolder ? "Folder" : "Selection"}</button>
            <button className={scope === "custom" ? "on" : ""} aria-pressed={scope === "custom"} title={scope === "custom" && st.customRoots.length ? st.customRoots.join("\n") : "Pick folders to search"} onClick={async () => {
              const { open } = await import("@tauri-apps/plugin-dialog");
              const picked = await open({ directory: true, multiple: true, title: "Search in folders" });
              if (!picked) return;
              setSearch({ scope: "custom", customRoots: Array.isArray(picked) ? picked : [picked] });
            }}>{scope === "custom" && st.customRoots.length ? `${st.customRoots.length} folder${st.customRoots.length > 1 ? "s" : ""}` : "Choose…"}</button>
          </div>
          <button
            className={`icon-btn filters-btn ${st.showFilters ? "on" : ""}`}
            aria-expanded={st.showFilters}
            title={`Filters${filterCount ? ` (${filterCount} set)` : ""}: include / exclude, .gitignore, dot matches newline, result limit`}
            onClick={() => setSearch({ showFilters: !st.showFilters })}
          >
            <ListFilter size={15} />
            {filterCount > 0 && <span className="filters-count">{filterCount}</span>}
          </button>
        </div>
        {scope === "folder" && folder && (
          <div className="scope-target muted" title={targetRoots.join("\n")}>
            <span className="truncate">In {targetSummary(targetRoots, folder)}</span>
            {!wholeFolder && (
              <button className="link-btn" title={`Search all of ${folder}`} onClick={() => setSearch({ treeTargets: [] })}>Whole folder</button>
            )}
          </div>
        )}
        {st.showFilters && (
          <div className="search-filters">
            {folderScope ? (
              <>
                <input className="input" aria-label="Files to include" placeholder="Include: *.json, src/**" value={q.include.join(", ")} onChange={(e) => setQ({ include: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                <input className="input" aria-label="Files to exclude" placeholder="Exclude: *.min.js, dist/**" value={q.exclude.join(", ")} onChange={(e) => setQ({ exclude: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
              </>
            ) : (
              <div className="muted filters-note">Include / exclude patterns and .gitignore apply when searching a folder.</div>
            )}
            <div className="search-options">
              {folderScope && (
                <label className="check" title="Skip files ignored by .gitignore / .ignore">
                  <input type="checkbox" checked={q.respectGitignore} onChange={(e) => setQ({ respectGitignore: e.target.checked })} />
                  Use .gitignore
                </label>
              )}
              <label className="check" title="Let . match newlines so a regex can span lines">
                <input type="checkbox" checked={q.dotAll} onChange={(e) => setQ({ dotAll: e.target.checked })} />
                Dot matches newline
              </label>
              <label className="check" title="Stop after this many matches">
                Max
                <input
                  type="number"
                  className="input num"
                  min={1}
                  max={1_000_000}
                  step={1000}
                  value={q.maxResults}
                  onChange={(e) => {
                    const n = Math.floor(Number(e.target.value));
                    if (Number.isFinite(n) && n >= 1) setQ({ maxResults: Math.min(1_000_000, n) });
                  }}
                />
              </label>
            </div>
          </div>
        )}
        <div className="row search-run-row">
          {st.running ? (
            <button className="btn small" onClick={cancel}>Cancel</button>
          ) : (
            <button className="btn btn-primary small" onClick={() => void run()} disabled={!q.pattern || invalidRegex}><SearchIcon size={13} /> Search</button>
          )}
          <span className="muted search-run-status">{status}</span>
          {allMatches.length > 0 && (
            <span className="result-nav">
              {activeIndex >= 0 && <span className="result-pos" aria-live="polite">{`${activeIndex + 1} of ${allMatches.length.toLocaleString()}`}</span>}
              <button className="icon-btn" title="Previous result (Shift+F4)" aria-label="Previous result" onClick={() => bus.emit("search.step", { dir: -1 })}><ArrowUp size={15} /></button>
              <button className="icon-btn" title="Next result (F4)" aria-label="Next result" onClick={() => bus.emit("search.step", { dir: 1 })}><ArrowDown size={15} /></button>
            </span>
          )}
        </div>
        {st.running && <div className="progress indeterminate"><div /></div>}
      </div>
      <div className="panel-body" style={{ borderTop: "1px solid var(--stroke)" }} ref={listRef} role="tree" aria-label="Search results" onKeyDown={onListKeyDown}>
        {st.files.map((f, fi) => {
          const shown = shownPerFile[fi];
          if (shown < 0) return null;
          const name = f.path.split(/[\\/]/).pop();
          const collapsed = st.collapsed.has(f.path);
          const fileKey = `file:${f.path}`;
          const err = st.fileErrors[f.path];
          const rel = relativeDir(f.path, roots);
          return (
            <div key={f.path}>
              <div
                className={`results-file ${err ? "failed" : ""} ${selFiles.includes(f.path) ? "selected" : ""}`}
                aria-selected={selFiles.includes(f.path)}
                data-key={fileKey}
                role="treeitem"
                aria-expanded={!collapsed}
                tabIndex={focusKey === fileKey || (!focusKey && fi === 0) ? 0 : -1}
                onClick={(e) => {
                  setFocusKey(fileKey);
                  e.currentTarget.focus({ preventScroll: true });
                  if (e.ctrlKey || e.shiftKey) {
                    // Ctrl+click adds / removes a file, Shift+click selects a run of files; the
                    // right-click menu then acts on all of them.
                    const all = st.files.map((x) => x.path);
                    setSelFiles(e.shiftKey ? rangeOf(all, fileAnchor.current ?? f.path, f.path) : toggleIn(selFiles, f.path));
                    if (!e.shiftKey) fileAnchor.current = f.path;
                    return;
                  }
                  fileAnchor.current = f.path;
                  setSelFiles([]);
                  toggleCollapse(f.path);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!selFiles.includes(f.path)) setSelFiles([]);
                  setFileMenu({ x: e.clientX, y: e.clientY, path: f.path });
                }}
                title={f.path}
              >
                <span className={`tree-chevron ${collapsed ? "" : "open"}`}><ChevronRight size={14} /></span>
                <span className="name">{name}</span>
                <span className="dir">{rel}</span>
                <span className="count">{f.matches.length}</span>
                {!st.running && (
                  <button className="icon-btn xs results-dismiss" tabIndex={-1} title={st.showReplace ? "Leave this file out of Replace All (Delete)" : "Dismiss this file (Delete)"} aria-label="Leave file out" onClick={(e) => { e.stopPropagation(); leaveOut(f.path); }}>
                    <X size={12} />
                  </button>
                )}
              </div>
              {err && <div className="results-error" title={err}>Replace failed: {err}</div>}
              {!collapsed &&
                f.matches.slice(0, shown).map((m) => {
                  const key = keyOf(m);
                  const before = m.preview.slice(0, m.previewCol);
                  const hit = m.preview.slice(m.previewCol, m.previewCol + m.len);
                  const after = m.preview.slice(m.previewCol + m.len);
                  const isStale = stale.has(key);
                  return (
                    <div
                      key={key}
                      data-key={key}
                      role="treeitem"
                      tabIndex={focusKey === key ? 0 : -1}
                      className={`results-match ${st.activeKey === key ? "active" : ""} ${isStale ? "stale" : ""}`}
                      onClick={(e) => { e.currentTarget.focus({ preventScroll: true }); void openMatch(m, true); }}
                      title={`Line ${m.line}, Col ${m.col + 1}${isStale ? " — text has changed since the search" : ""}`}
                    >
                      <span className="ln">{m.line}</span>
                      <span className="truncate">
                        {previewBefore(before, m.previewCut)}
                        <span className={previewReplacement ? "hl del" : "hl"}>{hit || "∅"}</span>
                        {previewReplacement && <span className="rep">{previewReplacement(hit)}</span>}
                        {after}
                      </span>
                      {!st.running && (
                        <button className="icon-btn xs results-dismiss" tabIndex={-1} title={st.showReplace ? "Leave out of Replace All (Delete)" : "Dismiss (Delete)"} aria-label="Leave result out" onClick={(e) => { e.stopPropagation(); leaveOut(m.path, m); }}>
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  );
                })}
              {!collapsed && f.matches.length > MAX_SHOWN && shown === MAX_SHOWN && <div className="results-match muted">… {f.matches.length - MAX_SHOWN} more in this file</div>}
            </div>
          );
        })}
        {hiddenFiles > 0 && (
          <button className="btn small results-more" onClick={() => setRowLimit((n) => n + ROW_BUDGET * 2)}>
            Show more results ({hiddenFiles.toLocaleString()} more file{hiddenFiles === 1 ? "" : "s"})
          </button>
        )}
      </div>
      {fileMenu && (() => {
        const paths = selFiles.length > 1 && selFiles.includes(fileMenu.path) ? selFiles : [fileMenu.path];
        return (
          <FileMenu
            x={fileMenu.x}
            y={fileMenu.y}
            paths={paths}
            isDir={() => false}
            pasteDir={dirName(fileMenu.path)}
            onClose={() => setFileMenu(null)}
            onDeleted={(deleted) => {
              // Deleted files leave the results.
              const cur = useStore.getState().search;
              const gone = new Set(deleted);
              const removed = cur.files.filter((x) => gone.has(x.path)).reduce((n, x) => n + x.matches.length, 0);
              setSearch({ files: cur.files.filter((x) => !gone.has(x.path)), totalMatches: Math.max(0, cur.totalMatches - removed) });
              setSelFiles((sel) => sel.filter((p) => !gone.has(p)));
            }}
          />
        );
      })()}
    </>
  );
}
