/**
 * Virtualized viewer/editor for disk-backed documents. Only the visible rows are
 * fetched from Rust, in cached chunks; the scrollbar is scaled so files with
 * hundreds of millions of lines still map onto a finite pixel height.
 *
 * Geometry: `topLine` ranges over [0, maxTop] where maxTop = total - fullRows, so the
 * last line is always reachable. The spacer is `viewH + maxTop * rowH * scale` tall,
 * which makes scrollTop / (rowH * scale) map exactly onto that range.
 */
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { ALargeSmall, ArrowDown, ArrowUp, CaseSensitive, ChevronDown, ChevronRight, ListFilter, Radio, Regex, ReplaceAll, Search, Table2, WholeWord, WrapText, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { askDialog, formatBytes, reloadBig } from "../lib/actions";
import { BigFilterPane } from "./BigFilterPane";
import { GridCells } from "./GridCells";
import { growWidths, splitDelimited, type Field } from "../lib/delimited";
import { bus } from "../lib/bus";
import { big } from "../lib/ipc";
import { useStore, type BigFindState, type BigViewState, type Doc } from "../lib/store";
import type { BigSearchArgs } from "../lib/types";
import { bigLanguageOf, segments, tokenize } from "../lib/bigHighlight";
import { choose } from "../lib/dialogs";
import { editor } from "../editor/manager";
import { bigGeometry } from "../lib/bigGeometry";

const CHUNK = 256;
const OVERSCAN = 8;
/** Longest run of characters rendered for one row; the rest is summarised. */
export const MAX_ROW_CHARS = 20_000;

const EMPTY_FIND: BigFindState = {
  open: false, replace: false, query: "", replacement: "", regex: false, cs: false, word: false, dotAll: false,
  results: [], total: 0, truncated: false, current: -1, searched: false,
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export { bigGeometry };

/** Split a long line into the part that is rendered and the number of clipped chars. */
export function clipRow(text: string, max = MAX_ROW_CHARS): { shown: string; more: number } {
  if (text.length <= max) return { shown: text, more: 0 };
  return { shown: text.slice(0, max), more: text.length - max };
}

/**
 * Whether line editing may start: "refuse" (with the reason) for read-only documents and lines that
 * were cut at the read cap, "confirm" for lines whose bytes are not valid UTF-8, otherwise null.
 */
/**
 * Match columns from the Rust engine are UTF-8 byte offsets; map `[byteCol, byteCol + byteLen)` to
 * string indices of `text`. Null when the start lies beyond `text` (e.g. past a clipped row).
 */
export function utf8Span(text: string, byteCol: number, byteLen: number): [number, number] | null {
  let bytes = 0;
  let start = -1;
  let i = 0;
  for (; i < text.length; i++) {
    if (start < 0 && bytes >= byteCol) start = i;
    if (start >= 0 && bytes >= byteCol + byteLen) return [start, i];
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  if (start < 0 && bytes >= byteCol) start = text.length;
  return start < 0 ? null : [start, i];
}

export function editGate(line: number, o: { readonly: boolean; encoding: string; truncated: Set<number>; lossy: Set<number> }): { kind: "refuse" | "confirm"; message: string } | null {
  if (o.readonly) return { kind: "refuse", message: o.encoding !== "UTF-8" ? `${o.encoding} large files are read-only.` : "This document is read-only." };
  if (o.truncated.has(line)) return { kind: "refuse", message: `Line ${(line + 1).toLocaleString()} is longer than 16 MB and cannot be edited in large-file mode.` };
  if (o.lossy.has(line)) return { kind: "confirm", message: `Line ${(line + 1).toLocaleString()} contains bytes that are not valid UTF-8. Editing it replaces them with the replacement character when saved; other lines are not affected.` };
  return null;
}

/** Display text for a row: lone CR characters (mixed line endings) are made visible. */
export function visibleRowText(text: string): string {
  return text.includes("\r") ? text.replace(/\r/g, "\u240d") : text;
}

export function BigFileView({ doc }: { doc: Doc }) {
  const id = doc.bigId!;
  const settings = useStore((s) => s.settings);
  const updateDoc = useStore((s) => s.updateDoc);
  const toast = useStore((s) => s.toast);
  const set = useStore((s) => s.set);
  const rowH = Math.round(settings.fontSize * 1.5);
  const total = Math.max(1, doc.bigInfo?.totalLines ?? 1);
  const indexed = doc.bigInfo?.indexed ?? false;
  // CSV / TSV grid: aligned cells under a header row (the file's first line) that stays at the top.
  const gridSep = /\.csv$/i.test(doc.name) ? "," : /\.(tsv|tab)$/i.test(doc.name) ? "\t" : null;
  const [gridWanted, setGridWanted] = useState(true);
  const grid = gridSep !== null && gridWanted;
  /** Column widths in characters; they only grow as more rows are seen. */
  const colW = useRef<number[]>([]);
  const header = useRef<Field[] | null>(null);

  const saved = useStore.getState().bigViewState[doc.id];
  const scrollRef = useRef<HTMLDivElement>(null);
  const hScrollRef = useRef<HTMLDivElement>(null);
  const [viewH, setViewH] = useState(600);
  const [topLine, setTopLine] = useState(saved?.topLine ?? 0);
  const [cursor, setCursor] = useState(saved ? saved.cursorLine - 1 : 0);
  const rowIdPrefix = `bigrow-${useId().replace(/:/g, "")}-`;
  const [anchor, setAnchor] = useState<number | null>(saved?.anchorLine != null ? saved.anchorLine - 1 : null);
  const [editing, setEditing] = useState<{ line: number; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [, bump] = useState(0);
  const [gen, setGen] = useState(0);
  const cache = useRef(new Map<number, string[]>());
  /** Absolute line numbers that were cut at the read cap / are not valid UTF-8 (see editGate). */
  const truncatedLines = useRef(new Set<number>());
  const lossyLines = useRef(new Set<number>());
  const loading = useRef(new Set<number>());
  const generation = useRef(0);
  const drag = useRef<{ start: number } | null>(null);
  /** 1-based line requested by `big.goto` before indexing finished; applied once `indexed` flips. */
  const pendingGoto = useRef<number | null>(null);

  const [find, setFind] = useState<BigFindState>(saved?.find ?? EMPTY_FIND);
  const [busy, setBusy] = useState(false);
  const findInput = useRef<HTMLInputElement>(null);

  const { fullRows, renderRows, maxTop, scale, spacerH } = bigGeometry(total, viewH, rowH);

  // Latest values for handlers that run outside React's render cycle (bus events, unmount).
  const live = useRef({ topLine, cursor, anchor, find, maxTop, fullRows, total });
  live.current = { topLine, cursor, anchor, find, maxTop, fullRows, total };

  const focusView = () => scrollRef.current?.focus({ preventScroll: true });
  useEffect(() => editor.registerFocus(doc.id, () => scrollRef.current?.focus({ preventScroll: true })), [doc.id]);

  const invalidate = useCallback(() => {
    cache.current.clear();
    loading.current.clear();
    truncatedLines.current.clear();
    lossyLines.current.clear();
    generation.current++;
    setGen((g) => g + 1);
  }, []);

  const ensure = useCallback(
    (from: number, to: number) => {
      const c0 = Math.max(0, Math.floor(from / CHUNK));
      const c1 = Math.floor(Math.max(0, to) / CHUNK);
      for (let c = c0; c <= c1; c++) {
        if (cache.current.has(c) || loading.current.has(c)) continue;
        loading.current.add(c);
        const gen = generation.current;
        big.lines(id, c * CHUNK, CHUNK)
          .then((chunk) => {
            if (gen !== generation.current) return;
            // Chunks read before indexing finished may be short; keep them only until the index is ready.
            if (!chunk.indexed && chunk.lines.length < CHUNK) {
              setTimeout(() => loading.current.delete(c), 300);
              bump((n) => n + 1);
              return;
            }
            cache.current.set(c, chunk.lines);
            for (const k of chunk.lossy ?? []) lossyLines.current.add(c * CHUNK + k);
            if (chunk.truncated && chunk.lines.length) truncatedLines.current.add(c * CHUNK + chunk.lines.length - 1);
            if (cache.current.size > 400) {
              const first = cache.current.keys().next().value;
              if (first !== undefined) cache.current.delete(first);
            }
            bump((n) => n + 1);
          })
          .catch(() => {})
          .finally(() => loading.current.delete(c));
      }
    },
    [id],
  );

  useEffect(() => {
    ensure(topLine - OVERSCAN, topLine + renderRows + OVERSCAN);
  }, [topLine, renderRows, ensure, total, gen, indexed]); // `indexed`: chunks read while indexing were dropped; a file whose line count never changes (one huge line) would otherwise never refetch

  // A deferred jump happens as soon as indexing has reached its line (or indexing is done).
  useEffect(() => {
    if (pendingGoto.current !== null && (indexed || total >= pendingGoto.current)) {
      const line = pendingGoto.current;
      pendingGoto.current = null;
      jumpTo(line - 1);
      focusView();
    }
  }, [indexed, total]);

  // Refetch while indexing grows the line count.
  useEffect(() => {
    if (!indexed) {
      const t = setInterval(() => {
        // Only a chunk the index hadn't finished when it was read needs refetching; a complete one
        // stays (refetching it would blank the rows on screen every half-second).
        const lastChunk = Math.floor((topLine + renderRows) / CHUNK);
        const c = cache.current.get(lastChunk);
        if (!c || c.length < CHUNK) cache.current.delete(lastChunk);
        bump((n) => n + 1);
        // Progress events can arrive before the tab exists; poll the info until indexed.
        big.info(id).then((info) => {
          updateDoc(doc.id, { bigInfo: info });
          if (info.indexed) invalidate();
        }).catch(() => {});
      }, 500);
      return () => clearInterval(t);
    }
  }, [indexed, topLine, renderRows]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Keep the scrollbar in sync with topLine whenever the geometry changes (mount, resize, indexing).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const t = clamp(live.current.topLine, 0, maxTop);
    if (t !== live.current.topLine) setTopLine(t);
    el.scrollTop = t * rowH * scale;
  }, [scale, maxTop, rowH]);

  // Publish the cursor like the text editor does so the status bar / Go-to palette can show it.
  useEffect(() => {
    const lines = anchor === null ? 1 : Math.abs(anchor - cursor) + 1;
    set({ cursor: { line: cursor + 1, col: 1, selections: lines, selectedChars: 0 } });
  }, [cursor, anchor]);

  // Persist view state so switching tabs and back restores scroll, cursor and find state.
  useEffect(() => {
    return () => {
      const s = useStore.getState();
      if (!s.docs.some((d) => d.id === doc.id)) return;
      const v = live.current;
      const state: BigViewState = { topLine: v.topLine, cursorLine: v.cursor + 1, anchorLine: v.anchor === null ? null : v.anchor + 1, find: v.find };
      s.set({ bigViewState: { ...s.bigViewState, [doc.id]: state } });
    };
  }, [doc.id]);

  // End a drag selection wherever the mouse is released.
  useEffect(() => {
    const up = () => {
      drag.current = null;
      setDragging(false);
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  const lineText = (n: number): string | null => {
    const c = cache.current.get(Math.floor(n / CHUNK));
    if (!c) return null;
    return c[n % CHUNK] ?? "";
  };

  /** Scroll so `line` is the top row (or centred); returns the clamped top line. */
  const scrollTo = (line: number, center = false): number => {
    const { maxTop, fullRows } = live.current;
    const target = clamp(center ? line - Math.floor(fullRows / 2) : line, 0, maxTop);
    setTopLine(target);
    live.current.topLine = target;
    if (scrollRef.current) scrollRef.current.scrollTop = target * rowH * scale;
    return target;
  };
  const revealCursor = (line: number, top = live.current.topLine) => {
    const { fullRows } = live.current;
    // In the grid, the header covers the top row slot: line 0 is always in view, the row under it isn't.
    if (grid && line > 0 && line <= top) scrollTo(line - 1);
    else if (grid && line === 0) return;
    else if (line < top) scrollTo(line);
    else if (line > top + fullRows - 1) scrollTo(line - fullRows + 1);
  };
  const moveCursor = (line: number, extend: boolean, top?: number) => {
    const l = clamp(line, 0, live.current.total - 1);
    if (extend) setAnchor((a) => a ?? cursor);
    else setAnchor(null);
    setCursor(l);
    revealCursor(l, top);
  };
  const jumpTo = (line: number) => {
    const l = clamp(line, 0, live.current.total - 1);
    setAnchor(null);
    setCursor(l);
    scrollTo(l, true);
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const line = clamp(Math.round(el.scrollTop / (rowH * scale)), 0, maxTop);
    if (line !== topLine) setTopLine(line);
    // Follow mode keeps the end in view until you scroll up, and again once you scroll back to the
    // end. A scroll caused by the view changing size (the filter pane opening) doesn't count.
    const prev = lastScroll.current;
    const h = el.clientHeight; // read now: the height state updates after this event
    if (line >= maxTop - 1) stickToEnd.current = true;
    else if (prev.viewH === h && el.scrollTop < prev.top - 2) stickToEnd.current = false;
    lastScroll.current = { top: el.scrollTop, viewH: h };
  };
  const onWheel = (e: React.WheelEvent) => {
    if (scale >= 1) return;
    // Horizontal wheel / Shift+wheel scrolls the row container natively.
    if (e.shiftKey || (e.deltaX !== 0 && e.deltaY === 0)) return;
    e.preventDefault();
    const lines = Math.sign(e.deltaY) * Math.max(1, Math.round(Math.abs(e.deltaY) / rowH) * 3);
    scrollTo(topLine + lines);
  };

  const refreshInfo = async () => {
    const info = await big.info(id);
    updateDoc(doc.id, { bigInfo: info, dirty: info.dirty });
  };

  /** Search hits refer to line numbers that an edit may have shifted: drop them. */
  const clearHits = () => setFind((f) => (f.results.length || f.searched ? { ...f, results: [], total: 0, truncated: false, current: -1, searched: false } : f));

  /** Start editing line `n` unless editGate refuses; lines with invalid UTF-8 ask first. */
  const beginEdit = async (n: number, text: string) => {
    const gate = editGate(n, { readonly: doc.readonly, encoding: doc.encoding, truncated: truncatedLines.current, lossy: lossyLines.current });
    if (gate?.kind === "refuse") {
      toast(gate.message, "warning", 5000);
      return;
    }
    if (gate?.kind === "confirm" && !(await askDialog("Edit a line with invalid UTF-8?", gate.message, "Edit anyway", "primary"))) {
      focusView();
      return;
    }
    setEditing({ line: n, text });
  };

  const editingRef = useRef(editing);
  editingRef.current = editing;
  const commitEdit = async () => {
    const cur = editingRef.current;
    if (!cur) return;
    editingRef.current = null;
    setEditing(null);
    try {
      const info = await big.replaceLine(id, cur.line, cur.text);
      updateDoc(doc.id, { bigInfo: info, dirty: info.dirty });
      invalidate();
      clearHits();
    } catch (e) {
      toast(String(e), "error");
    }
    focusView();
  };

  const selectionRange = (): [number, number] => {
    const a = anchor ?? cursor;
    return [Math.min(a, cursor), Math.max(a, cursor)];
  };

  const deleteSelected = async () => {
    const [a, b] = selectionRange();
    if (b - a + 1 > 100_000) {
      toast("Select fewer than 100,000 lines to delete at once.", "warning");
      return;
    }
    try {
      const info = await big.deleteLines(id, a, b);
      updateDoc(doc.id, { bigInfo: info, dirty: info.dirty });
      setAnchor(null);
      setCursor(Math.min(a, info.totalLines - 1));
      invalidate();
      clearHits();
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const insertLine = async (at: number) => {
    try {
      const info = await big.insertLines(id, at, "");
      updateDoc(doc.id, { bigInfo: info, dirty: info.dirty });
      invalidate();
      clearHits();
      setCursor(at);
      setEditing({ line: at, text: "" });
    } catch (e) {
      toast(String(e), "error");
    }
  };

  /** Native (sub-line) selection inside one row, if any. */
  const nativeRowSelection = (): string | null => {
    const sel = window.getSelection();
    const root = scrollRef.current;
    if (!sel || sel.isCollapsed || !root || !sel.anchorNode || !sel.focusNode) return null;
    if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null;
    const rowOf = (n: Node) => (n instanceof Element ? n : n.parentElement)?.closest(".big-row") ?? null;
    const a = rowOf(sel.anchorNode);
    if (!a || a !== rowOf(sel.focusNode)) return null;
    const text = sel.toString();
    return text.length ? text : null;
  };

  const copySelected = async () => {
    if (anchor === null) {
      const sub = nativeRowSelection();
      if (sub !== null) {
        await writeText(sub);
        toast(`Copied ${sub.length.toLocaleString()} character(s)`, "success", 1200);
        return;
      }
    }
    const [a, b] = selectionRange();
    if (b - a + 1 > 200_000) {
      toast("Copy is limited to 200,000 lines at a time.", "warning");
      return;
    }
    const chunk = await big.lines(id, a, b - a + 1);
    await writeText(chunk.lines.join(doc.eol === "CRLF" ? "\r\n" : "\n"));
    toast(`Copied ${chunk.lines.length.toLocaleString()} line(s)`, "success", 1200);
  };

  const undoRedo = async (redo: boolean) => {
    const info = redo ? await big.redo(id) : await big.undo(id);
    updateDoc(doc.id, { bigInfo: info, dirty: info.dirty });
    invalidate();
    clearHits();
  };

  const queryArgs = (f: BigFindState = find): BigSearchArgs => ({ pattern: f.query, isRegex: f.regex, caseSensitive: f.cs, wholeWord: f.word, dotAll: f.regex && f.dotAll, maxResults: 20000 });

  const runFind = async () => {
    if (!find.query) return;
    setBusy(true);
    try {
      const r = await big.search(id, queryArgs());
      setBusy(false);
      setFind((f) => ({ ...f, results: r.matches, total: r.total, truncated: r.truncated, current: r.matches.length ? 0 : -1, searched: true }));
      if (r.matches.length) jumpTo(r.matches[0].line);
    } catch (e) {
      setBusy(false);
      // A broken pattern must not leave the previous query's hits on screen.
      setFind((f) => ({ ...f, results: [], total: 0, truncated: false, current: -1, searched: false }));
      toast(String(e), "error");
    }
  };
  const step = (dir: 1 | -1) => {
    const f = live.current.find;
    if (!f.results.length) return;
    const next = (f.current + dir + f.results.length) % f.results.length;
    setFind((x) => ({ ...x, current: next }));
    jumpTo(f.results[next].line);
  };
  const closeFind = () => {
    setFind((f) => ({ ...f, open: false, results: [], total: 0, truncated: false, current: -1, searched: false }));
    focusView();
  };
  const replaceAll = async () => {
    const ok = await choose(
      "Replace all occurrences?",
      `This rewrites the whole ${doc.name} into a new working copy on disk (the original is untouched until you save). Undo history is reset.`,
      [
        { label: "Replace All", kind: "primary", default: true, value: true },
        { label: "Cancel", cancel: true, value: false },
      ],
      false,
    );
    if (!ok) return;
    setBusy(true);
    try {
      const n = await big.replaceAll(id, { ...queryArgs(), preserveCase: !!find.keepCase }, find.replacement);
      toast(`Replaced ${n.toLocaleString()} occurrence(s)`, "success");
      invalidate();
      await refreshInfo();
      setBusy(false);
      setFind((f) => ({ ...f, results: [], total: 0, truncated: false, current: -1, searched: false }));
    } catch (e) {
      setBusy(false);
      toast(String(e), "error");
    }
  };

  // Commands routed from the global registry. `onFor` also replays a goto that was
  // emitted (e.g. by a search-result click) before this view was mounted.
  useEffect(() => {
    const onGoto = (p?: unknown) => {
      const line = (p as { line?: number } | undefined)?.line;
      if (line) {
        // A jump past the lines indexed so far (e.g. a search result opening a closed big file)
        // would clamp to the last known line; defer it until indexing reaches that line.
        const info = useStore.getState().docs.find((d) => d.id === doc.id)?.bigInfo;
        if (!info?.indexed && line > (info?.totalLines ?? 0)) { pendingGoto.current = line; return; }
        jumpTo(line - 1);
        focusView();
      } else set({ palette: "goto" });
    };
    const offs = [
      bus.on("big.find", (p) => {
        const r = !!(p as { replace?: boolean } | undefined)?.replace;
        setFind((f) => ({ ...f, open: true, replace: r }));
        setTimeout(() => findInput.current?.select(), 30);
      }),
      bus.on("big.findNext", () => step(1)),
      bus.on("big.findPrev", () => step(-1)),
      bus.on("big.goto", onGoto),
      bus.onFor(doc.id, "big.goto", onGoto),
      bus.on("big.undo", () => void undoRedo(false)),
      bus.on("big.redo", () => void undoRedo(true)),
    ];
    return () => offs.forEach((f) => f());
  });

  /** Edit / insert / delete keys share one gate: read-only first, then indexing. */
  const canChange = () => {
    if (doc.readonly) {
      toast(doc.encoding !== "UTF-8" ? `${doc.encoding} large files are read-only.` : "This document is read-only.", "warning", 5000);
      return false;
    }
    if (!indexed) {
      toast("Editing is enabled once indexing completes.", "info");
      return false;
    }
    return true;
  };

  const onKey = async (e: React.KeyboardEvent) => {
    if (editing) return;
    const ext = e.shiftKey;
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); moveCursor(cursor + 1, ext); break;
      case "ArrowUp": e.preventDefault(); moveCursor(cursor - 1, ext); break;
      case "PageDown": {
        e.preventDefault();
        const top = scrollTo(topLine + fullRows);
        moveCursor(cursor + fullRows, ext, top);
        break;
      }
      case "PageUp": {
        e.preventDefault();
        const top = scrollTo(topLine - fullRows);
        moveCursor(cursor - fullRows, ext, top);
        break;
      }
      case "Home":
        e.preventDefault();
        if (e.ctrlKey) moveCursor(0, ext);
        else if (hScrollRef.current) hScrollRef.current.scrollLeft = 0;
        break;
      case "End":
        e.preventDefault();
        if (e.ctrlKey) moveCursor(total - 1, ext);
        else if (hScrollRef.current) hScrollRef.current.scrollLeft = hScrollRef.current.scrollWidth;
        break;
      case "Enter":
      case "F2": {
        e.preventDefault();
        if (!canChange()) break;
        if (e.ctrlKey) { await insertLine(cursor + 1); break; }
        const t = lineText(cursor);
        if (t !== null) await beginEdit(cursor, t);
        break;
      }
      case "Delete": e.preventDefault(); if (canChange()) await deleteSelected(); break;
      case "a": if (e.ctrlKey) { e.preventDefault(); setAnchor(0); setCursor(total - 1); } break;
      case "c": if (e.ctrlKey) { e.preventDefault(); await copySelected(); } break;
      case "z": if (e.ctrlKey) { e.preventDefault(); await undoRedo(false); } break;
      case "y": if (e.ctrlKey) { e.preventDefault(); await undoRedo(true); } break;
      case "Escape": if (find.open) closeFind(); else setAnchor(null); break;
      default: return;
    }
  };

  const onRowMouseDown = (n: number, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".big-edit")) return;
    focusView();
    if (e.shiftKey) {
      e.preventDefault();
      setAnchor((a) => a ?? cursor);
      setCursor(n);
    } else {
      // Native selection is allowed to start so a sub-line drag inside one row still works.
      setAnchor(null);
      setCursor(n);
      drag.current = { start: n };
    }
  };
  const onRowMouseEnter = (n: number) => {
    const d = drag.current;
    if (!d) return;
    if (n === d.start && anchor === null) return;
    if (!dragging) {
      setDragging(true);
      window.getSelection()?.removeAllRanges();
    }
    setAnchor(d.start);
    setCursor(n);
  };

  const [selA, selB] = selectionRange();
  const hitLines = useMemo(() => new Set(find.results.map((m) => m.line)), [find.results]);
  const currentHit = find.current >= 0 ? find.results[find.current] : null;
  const progress = doc.indexProgress;
  const first = Math.max(0, topLine - OVERSCAN);
  const last = Math.min(total, topLine + renderRows + OVERSCAN);
  const rows: number[] = [];
  for (let i = first; i < last; i++) rows.push(i);
  const lnWidth = Math.max(5, total.toLocaleString().length) + 3;
  const countText = busy
    ? "Searching…"
    : find.results.length
      ? `${find.current + 1} of ${find.total.toLocaleString()}${find.truncated ? "+" : ""}`
      : find.searched && find.query
        ? "No results"
        : "";

  // Filter view and follow mode (tail -f).
  const [filterOpen, setFilterOpen] = useState(false);
  const [following, setFollowing] = useState(false);
  const [filterGrowth, setFilterGrowth] = useState<number | null>(null);
  const stickToEnd = useRef(false);
  const lastScroll = useRef({ top: 0, viewH: 0 });
  // Why follow mode cannot start (null = it can); shared by the button and the palette command.
  const followBlocked = doc.dirty
    ? "Save first: follow mode needs the file unedited"
    : !indexed
      ? "Available once indexing finishes"
      : doc.bigInfo?.encoding !== "UTF-8"
        ? "Follow mode works on UTF-8 files"
        : null;
  const canFollow = followBlocked === null;
  const followState = useRef({ following, followBlocked });
  followState.current = { following, followBlocked };
  useEffect(() => {
    updateDoc(doc.id, { following: following || undefined });
  }, [following]);
  useEffect(() => () => updateDoc(doc.id, { following: undefined }), []);
  useEffect(() => {
    if (following && doc.dirty) {
      setFollowing(false);
      toast("Follow mode stopped: the file has unsaved changes.", "info", 4000);
    }
  }, [doc.dirty]);
  useEffect(() => {
    if (!following || !canFollow) return;
    // Like tail -f: start at the end.
    stickToEnd.current = true;
    scrollTo(live.current.total - 1);
    let busy = false;
    const t = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const before = live.current.total;
        const r = await big.follow(id);
        if (r.appended === "grew") {
          updateDoc(doc.id, { bigInfo: r.info });
          // The old last line may have grown, and new lines follow it: drop that chunk and refetch.
          for (let c = Math.floor(Math.max(0, before - 1) / CHUNK); c <= Math.floor(r.info.totalLines / CHUNK); c++) cache.current.delete(c);
          bump((n) => n + 1);
          if (r.filterTotal !== null) setFilterGrowth(r.filterTotal);
          if (stickToEnd.current) requestAnimationFrame(() => scrollTo(r.info.totalLines - 1));
        } else if (r.appended === "replaced") {
          toast(`${doc.name} was rewritten on disk (a rotated log?); reloading.`, "info", 4000);
          await reloadBig(doc.id);
        }
      } catch {
        // The tab may be closing; the next tick tries again.
      } finally {
        busy = false;
      }
    }, 1000);
    return () => clearInterval(t);
  }, [following, canFollow, id]);
  useEffect(() => bus.onFor(doc.id, "big.filter", () => setFilterOpen(true)), [doc.id]);
  useEffect(
    () =>
      bus.onFor(doc.id, "big.follow", () => {
        const { following: on, followBlocked: why } = followState.current;
        if (!on && why) toast(why, "info", 4000);
        else setFollowing(!on);
      }),
    [doc.id],
  );

  // Colours: by extension, or sniffed from the first lines (once they are loaded) for e.g. .txt.
  const firstLines = cache.current.get(0);
  const lang = useMemo(() => (settings.bigHighlight ? bigLanguageOf(doc.name, firstLines ?? []) : null), [settings.bigHighlight, doc.name, !!firstLines]);

  // Grid: fields of the visible rows (and the header), and column widths grown to fit them.
  const gridFields = new Map<number, Field[]>();
  if (grid && gridSep) {
    const t0 = lineText(0);
    if (t0 !== null) header.current = splitDelimited(t0, gridSep);
    for (const n of rows) {
      const t = lineText(n);
      if (t !== null) gridFields.set(n, splitDelimited(clipRow(t).shown, gridSep));
    }
    colW.current = growWidths(colW.current, header.current ? [header.current, ...gridFields.values()] : [...gridFields.values()]);
  }
  const renderCells = (n: number, text: string) => {
    const found = currentHit?.line === n ? utf8Span(clipRow(text).shown, currentHit.col, currentHit.len) : null;
    return (
      <span className="big-text">
        <GridCells fields={gridFields.get(n) ?? []} widths={colW.current} hit={found} />
      </span>
    );
  };

  const renderText = (n: number, text: string) => {
    const { shown: raw, more } = clipRow(text);
    const shown = visibleRowText(raw);
    // `raw` and `shown` have the same length (a lone CR becomes one ␍), so indices carry over.
    const found = currentHit?.line === n ? utf8Span(raw, currentHit.col, currentHit.len) : null;
    const hit = found && found[0] < shown.length ? found : null;
    let body: React.ReactNode;
    if (lang) {
      // Only visible rows are rendered, so tokenizing here costs the same at any file size.
      body = segments(shown, tokenize(lang, shown), hit).map((seg, k) =>
        seg.hit ? <mark key={k} className={seg.cls ? `hl-${seg.cls}` : undefined}>{seg.text}</mark> : seg.cls ? <span key={k} className={`hl-${seg.cls}`}>{seg.text}</span> : seg.text,
      );
    } else if (hit) {
      body = <>{shown.slice(0, hit[0])}<mark>{shown.slice(hit[0], hit[1])}</mark>{shown.slice(hit[1])}</>;
    } else body = shown;
    return (
      <span className="big-text">
        {body}
        {more > 0 && (truncatedLines.current.has(n)
          ? <span className="big-more" title="This line is longer than 16 MB: only its start is loaded, and it cannot be edited here">… (line continues past 16 MB)</span>
          : <span className="big-more" title="Long line: the rest is not rendered (edit the line to see all of it)">… ({more.toLocaleString()} more chars)</span>)}
      </span>
    );
  };

  return (
    <div className="bigview" style={{ fontSize: settings.fontSize, fontFamily: settings.fontFamily }}>
      <div className="big-banner">
        <strong>Large file mode</strong>
        <span className="muted">· {formatBytes(doc.bigInfo?.size ?? 0)} · {total.toLocaleString()} lines</span>
        {!indexed && progress && (
          <>
            <div className="progress"><div style={{ width: `${Math.round((progress.indexedBytes / Math.max(1, progress.totalBytes)) * 100)}%` }} /></div>
            <span className="muted">indexing {Math.round((progress.indexedBytes / Math.max(1, progress.totalBytes)) * 100)}%</span>
          </>
        )}
        {!indexed && !progress && <span className="muted">indexing…</span>}
        {following && <span className="chip success" title="New lines appear as the file grows">Following</span>}
        <span className="grow" />
        {gridSep && (
          <button className={`btn small ${grid ? "on" : ""}`} aria-pressed={grid} title={grid ? "Show the raw text" : "Show as a grid of columns"} onClick={() => setGridWanted((g) => !g)}><Table2 size={13} /> Grid</button>
        )}
        <button className={`btn small ${filterOpen ? "on" : ""}`} title="Show only the lines that match a search" onClick={() => setFilterOpen((o) => !o)}><ListFilter size={13} /> Filter</button>
        <button
          className={`btn small ${following ? "on" : ""}`}
          title={followBlocked ?? "Follow: show lines as they are added to the file, like tail -f"}
          disabled={!canFollow && !following}
          aria-pressed={following}
          onClick={() => setFollowing((f) => !f)}
        >
          <Radio size={13} /> Follow
        </button>
        <span className="muted">Enter: edit line · Ctrl+Enter: insert · Del: delete · Shift+↑↓ / drag: select · Ctrl+F: find · Ctrl+G: go to line</span>
      </div>
      {find.open && (
        <div className="findbar" style={{ top: 36 }} onKeyDown={(e) => e.stopPropagation()}>
          <div className="findbar-row">
            <button className="icon-btn xs" title={find.replace ? "Hide Replace" : "Show Replace"} onClick={() => setFind((f) => ({ ...f, replace: !f.replace }))}>
              {find.replace ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            </button>
            <div className="input-wrap with-actions-4 grow">
              <input ref={findInput} className="input mono" placeholder="Find in large file (Enter)" value={find.query} onChange={(e) => setFind((f) => ({ ...f, query: e.target.value, searched: false }))} onKeyDown={(e) => { if (e.key === "Enter") void runFind(); if (e.key === "Escape") closeFind(); if (e.key === "F3") { e.preventDefault(); step(e.shiftKey ? -1 : 1); } }} spellCheck={false} />
              <div className="input-actions">
                <button className={`icon-btn xs ${find.cs ? "on" : ""}`} aria-pressed={!!find.cs} title="Match Case" onClick={() => setFind((f) => ({ ...f, cs: !f.cs }))}><CaseSensitive size={15} /></button>
                <button className={`icon-btn xs ${find.word ? "on" : ""}`} aria-pressed={!!find.word} title="Whole Word" onClick={() => setFind((f) => ({ ...f, word: !f.word }))}><WholeWord size={15} /></button>
                <button className={`icon-btn xs ${find.regex ? "on" : ""}`} aria-pressed={!!find.regex} title="Regular Expression" onClick={() => setFind((f) => ({ ...f, regex: !f.regex }))}><Regex size={14} /></button>
                <button className={`icon-btn xs ${find.dotAll ? "on" : ""}`} aria-pressed={!!find.dotAll} title="Dot Matches Newline (regex)" disabled={!find.regex} onClick={() => setFind((f) => ({ ...f, dotAll: !f.dotAll }))}><WrapText size={14} /></button>
              </div>
            </div>
            <span className="count" aria-live="polite">{countText}</span>
            <button className="icon-btn" title="Find All" onClick={() => void runFind()} disabled={!find.query || busy}><Search size={15} /></button>
            <button className="icon-btn" title="Previous (Shift+F3)" onClick={() => step(-1)} disabled={!find.results.length}><ArrowUp size={15} /></button>
            <button className="icon-btn" title="Next (F3)" onClick={() => step(1)} disabled={!find.results.length}><ArrowDown size={15} /></button>
            <button className="icon-btn" title="Close (Esc)" onClick={closeFind}><X size={15} /></button>
          </div>
          {find.replace && (
            <div className="findbar-row">
              <span className="big-find-indent" />
              <div className="input-wrap with-actions-1 grow">
                <input className="input mono" placeholder="Replace ($1 groups with regex)" value={find.replacement} onChange={(e) => setFind((f) => ({ ...f, replacement: e.target.value }))} spellCheck={false} />
                <div className="input-actions">
                  <button className={`icon-btn xs ${find.keepCase ? "on" : ""}`} aria-pressed={!!find.keepCase} title={"Preserve Case\nFOO → BAR, Foo → Bar, foo → bar"} onClick={() => setFind((f) => ({ ...f, keepCase: !f.keepCase }))}><ALargeSmall size={15} /></button>
                </div>
              </div>
              <span className="count" />
              <button className="btn small" title="Replace all occurrences in the file" onClick={() => void replaceAll()} disabled={!find.query || busy || !indexed}><ReplaceAll size={14} /> Replace All</button>
            </div>
          )}
          {find.results.length > 0 && (
            <div className="big-find-results">
              {find.results.slice(0, 2000).map((m, i) => {
                const [a, b] = utf8Span(m.preview, m.previewCol, m.len) ?? [m.preview.length, m.preview.length];
                const before = m.preview.slice(0, a);
                const hit = m.preview.slice(a, b);
                const after = m.preview.slice(b);
                return (
                  <div key={`${m.line}:${m.col}`} className={`results-match ${i === find.current ? "active" : ""}`} onClick={() => { setFind((f) => ({ ...f, current: i })); jumpTo(m.line); }}>
                    <span className="ln">{(m.line + 1).toLocaleString()}</span>
                    <span className="truncate">{before}<span className="hl">{hit}</span>{after}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      <div
        className={`big-scroll ${dragging ? "dragging" : ""}`}
        ref={scrollRef}
        tabIndex={0}
        role="listbox"
        aria-label={`${doc.name}, large file, ${total.toLocaleString()} lines${doc.readonly ? ", read-only" : ""}`}
        aria-multiselectable="true"
        aria-activedescendant={rows.includes(cursor) ? `${rowIdPrefix}${cursor}` : undefined}
        onScroll={onScroll}
        onWheel={onWheel}
        onKeyDown={(e) => void onKey(e)}
      >
        <div className="big-spacer" style={{ height: spacerH }}>
          <div className="big-hscroll" ref={hScrollRef} style={{ height: viewH }}>
            {grid && header.current && (
              <div className="big-row big-grid-head" style={{ top: 0, height: rowH, lineHeight: `${rowH}px` }} title="The file's first line, shown as the header">
                <span className="big-ln" style={{ width: `${lnWidth}ch` }}>1</span>
                <span className="big-text"><GridCells fields={header.current} widths={colW.current} /></span>
              </div>
            )}
            {rows.map((n) => {
              const text = lineText(n);
              const isCursor = n === cursor;
              const isSel = anchor !== null && n >= selA && n <= selB;
              const isHit = hitLines.has(n);
              return (
                <div
                  key={n}
                  id={`${rowIdPrefix}${n}`}
                  role="option"
                  aria-selected={isCursor || isSel}
                  aria-posinset={n + 1}
                  aria-setsize={total}
                  className={`big-row ${isCursor ? "cursor" : ""} ${isSel ? "selected" : ""} ${isHit ? "hit" : ""}`}
                  style={{ top: (n - topLine) * rowH, height: rowH, lineHeight: `${rowH}px` }}
                  onMouseDown={(e) => onRowMouseDown(n, e)}
                  onMouseEnter={() => onRowMouseEnter(n)}
                  onDoubleClick={() => {
                    if (text !== null && canChange()) void beginEdit(n, text);
                  }}
                >
                  <span className="big-ln" style={{ width: `${lnWidth}ch` }}>{(n + 1).toLocaleString()}</span>
                  {editing?.line === n ? (
                    <input
                      autoFocus
                      className="big-edit"
                      aria-label={`Edit line ${(n + 1).toLocaleString()}`}
                      value={editing.text}
                      onChange={(e) => setEditing({ line: n, text: e.target.value })}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") void commitEdit();
                        if (e.key === "Escape") {
                          // Clear the ref first: focusView() blurs the input, and onBlur commits.
                          editingRef.current = null;
                          setEditing(null);
                          focusView();
                        }
                      }}
                      onBlur={() => void commitEdit()}
                    />
                  ) : text === null ? (
                    <span className="big-text big-loading">{n < total ? "…" : ""}</span>
                  ) : grid ? (
                    renderCells(n, text)
                  ) : (
                    renderText(n, text)
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {filterOpen && (
        <BigFilterPane
          doc={doc}
          lang={lang}
          rowH={rowH}
          version={gen}
          growth={filterGrowth}
          grid={grid && gridSep ? { sep: gridSep, widths: colW.current, header: header.current } : null}
          onJump={(line) => jumpTo(line)}
          onClose={() => {
            setFilterOpen(false);
            big.filterClear(id).catch(() => {});
            focusView();
          }}
        />
      )}
    </div>
  );
}
