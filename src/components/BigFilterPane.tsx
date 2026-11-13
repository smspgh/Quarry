import { CaseSensitive, EyeOff, ListFilter, Regex, WholeWord, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { segments, tokenize, type BigLang } from "../lib/bigHighlight";
import { splitDelimited, type Field } from "../lib/delimited";
import { GridCells } from "./GridCells";
import { bigGeometry } from "../lib/bigGeometry";
import { big } from "../lib/ipc";
import type { Doc } from "../lib/store";

const PAGE = 200;

/** Quick filters for logs: the level words `bigHighlight` colours. */
export const LEVEL_FILTERS = {
  errors: "\\b(FATAL|CRITICAL|CRIT|SEVERE|ERROR|ERR|FAIL(ED|URE)?)\\b",
  warnings: "\\b(WARN(ING)?)\\b",
} as const;

export interface FilterQuery {
  pattern: string;
  regex: boolean;
  cs: boolean;
  word: boolean;
  invert: boolean;
}

/**
 * The filter view of a large file: only the lines matching (or, with "Hide matching", not
 * matching) a search, read on demand page by page, so it scrolls through millions of lines.
 * Clicking a line shows it in context in the main view.
 */
export function BigFilterPane({ doc, lang, rowH, version, onJump, onClose, growth, grid = null }: {
  doc: Doc;
  lang: BigLang | null;
  rowH: number;
  /** Changes when the document's lines change (edits, Replace All, reload): the filter re-runs. */
  version: number;
  /** Show file line `line` (0-based) in the main view. */
  onJump: (line: number) => void;
  onClose: () => void;
  /** Follow mode: the filter's new size after the file grew (null = no change). */
  growth: number | null;
  /** The main view's CSV / TSV grid, when it is on: rows here are drawn as the same cells. */
  grid?: { sep: string; widths: number[]; header: Field[] | null } | null;
}) {
  const id = doc.bigId!;
  const indexed = doc.bigInfo?.indexed ?? false;
  const [q, setQ] = useState<FilterQuery>({ pattern: "", regex: false, cs: false, word: false, invert: false });
  const [ran, setRan] = useState<FilterQuery | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<Map<number, [number, string][]>>(new Map());
  const [active, setActive] = useState(-1);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(240);
  const loading = useRef(new Set<number>());
  /** Bumped by each filter run: pages requested for an earlier result are dropped when they arrive. */
  const generation = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stick = useRef(false);

  useEffect(() => inputRef.current?.focus(), []);

  const run = async (query: FilterQuery = q) => {
    if (!query.pattern) return;
    setQ(query);
    setRan(query);
    setError(null);
    if (!indexed) return; // runs once indexing finishes (effect below)
    setBusy(true);
    try {
      const n = await big.filter(id, { pattern: query.pattern, isRegex: query.regex, caseSensitive: query.cs, wholeWord: query.word, dotAll: false }, query.invert);
      generation.current++;
      loading.current.clear();
      setPages(new Map());
      setTotal(n);
      setActive(-1);
      if (listRef.current) listRef.current.scrollTop = 0;
    } catch (e) {
      setError(String(e));
      setTotal(null);
    } finally {
      setBusy(false);
    }
  };

  // A filter asked for while indexing runs as soon as the index is complete, and again when the
  // document is reopened (a reload gives it a new id) or edited (line numbers move).
  useEffect(() => {
    if (ran && indexed) void run(ran);
  }, [indexed, id, version]);

  // Follow mode grew the filter: show the new lines, and keep the end in view if it was.
  useEffect(() => {
    if (growth === null || total === null) return;
    const atEnd = !!listRef.current && listRef.current.scrollTop + listRef.current.clientHeight >= listRef.current.scrollHeight - rowH * 2;
    const lastPage = Math.floor(total / PAGE);
    setPages((m) => {
      const next = new Map(m);
      for (const k of [...next.keys()]) if (k >= lastPage) next.delete(k);
      return next;
    });
    for (const k of [...loading.current]) if (k >= lastPage) loading.current.delete(k);
    setTotal(growth);
    stick.current = atEnd;
  }, [growth]);

  useEffect(() => {
    if (stick.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
      stick.current = false;
    }
  }, [total]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Scroll geometry as in the main view: past a few million rows the list would be taller than the
  // browser can lay out, so the scroll range is scaled (bigGeometry) and rows are placed from `top`.
  const { maxTop, scale, spacerH } = bigGeometry(total ?? 0, height, rowH);
  const top = Math.min(maxTop, scrollTop / (rowH * scale)); // fractional first visible row
  const rowsShown = height / rowH;
  const scrollToRow = (row: number) => {
    if (listRef.current) listRef.current.scrollTop = Math.max(0, row) * rowH * scale;
  };

  // Fetch the pages on screen.
  const first = Math.max(0, Math.floor(top) - 5);
  const last = total === null ? 0 : Math.min(total, Math.ceil(top + rowsShown) + 5);
  useEffect(() => {
    if (total === null) return;
    const gen = generation.current;
    for (let p = Math.floor(first / PAGE); p <= Math.floor(Math.max(first, last - 1) / PAGE); p++) {
      if (pages.has(p) || loading.current.has(p)) continue;
      loading.current.add(p);
      big.filterLines(id, p * PAGE, PAGE).then(
        (r) => {
          loading.current.delete(p);
          if (gen !== generation.current) return;
          setPages((m) => {
            const next = new Map(m).set(p, r.lines);
            // Keep the pages around the view; scrolling through millions of lines must not keep them all.
            if (next.size > 40) for (const k of next.keys()) if (Math.abs(k - p) > 20) next.delete(k);
            return next;
          });
        },
        () => loading.current.delete(p),
      );
    }
  }, [first, last, total, pages, id]);

  const rowAt = (k: number): [number, string] | undefined => pages.get(Math.floor(k / PAGE))?.[k % PAGE];
  const choose = (k: number) => {
    if (total === null || total === 0) return;
    const i = Math.max(0, Math.min(total - 1, k));
    setActive(i);
    if (i < top) scrollToRow(i);
    else if (i + 1 > top + rowsShown) scrollToRow(i + 1 - rowsShown);
    const r = rowAt(i);
    if (r) onJump(r[0]);
  };
  const onListKey = (e: KeyboardEvent) => {
    const step = Math.max(1, Math.floor(height / rowH) - 1);
    const to = { ArrowDown: active + 1, ArrowUp: active - 1, PageDown: active + step, PageUp: active - step, Home: 0, End: (total ?? 1) - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    choose(to);
  };

  const status = busy
    ? "Filtering…"
    : error
      ? error
      : ran && !indexed
        ? "Waiting for indexing to finish…"
        : total === null
          ? "Show only the lines that match (Enter)"
          : `${total.toLocaleString()} line${total === 1 ? "" : "s"}${ran?.invert ? " without a match" : ""}`;
  const lnWidth = Math.max(5, (doc.bigInfo?.totalLines ?? 1).toLocaleString().length) + 3;

  return (
    <div className="big-filter" onKeyDown={(e) => e.stopPropagation()}>
      <div className="big-filter-bar">
        <ListFilter size={14} className="muted" aria-hidden />
        <div className="input-wrap with-actions-4 grow">
          <input
            ref={inputRef}
            className="input mono"
            placeholder="Filter lines (Enter)"
            aria-label="Filter lines"
            value={q.pattern}
            onChange={(e) => setQ({ ...q, pattern: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") void run();
              else if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown" && total) { e.preventDefault(); listRef.current?.focus(); choose(Math.max(0, active)); }
            }}
            spellCheck={false}
          />
          <div className="input-actions">
            <button className={`icon-btn xs ${q.cs ? "on" : ""}`} aria-pressed={q.cs} title="Match Case" onClick={() => setQ({ ...q, cs: !q.cs })}><CaseSensitive size={15} /></button>
            <button className={`icon-btn xs ${q.word ? "on" : ""}`} aria-pressed={q.word} title="Whole Word" onClick={() => setQ({ ...q, word: !q.word })}><WholeWord size={15} /></button>
            <button className={`icon-btn xs ${q.regex ? "on" : ""}`} aria-pressed={q.regex} title="Regular Expression" onClick={() => setQ({ ...q, regex: !q.regex })}><Regex size={14} /></button>
            <button className={`icon-btn xs ${q.invert ? "on" : ""}`} aria-pressed={q.invert} title="Hide matching lines (show the rest)" onClick={() => void run({ ...q, invert: !q.invert })}><EyeOff size={14} /></button>
          </div>
        </div>
        {lang === "log" && (
          <>
            <button className="btn small" title="Lines with ERROR, FATAL, CRITICAL, FAILED…" onClick={() => void run({ pattern: LEVEL_FILTERS.errors, regex: true, cs: true, word: false, invert: false })}>Errors</button>
            <button className="btn small" title="Lines with WARN or WARNING" onClick={() => void run({ pattern: LEVEL_FILTERS.warnings, regex: true, cs: true, word: false, invert: false })}>Warnings</button>
          </>
        )}
        <span className={`muted big-filter-status ${error ? "error" : ""}`} aria-live="polite" title={status}>{status}</span>
        <button className="icon-btn" title="Close the filter (Esc)" onClick={onClose}><X size={15} /></button>
      </div>
      <div className="big-filter-list" ref={listRef} tabIndex={0} role="listbox" aria-label="Filtered lines" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} onKeyDown={onListKey}>
        {grid?.header && total !== null && (
          <div className="big-row big-grid-head big-filter-head" style={{ height: rowH, lineHeight: `${rowH}px` }}>
            <span className="big-ln" style={{ width: `${lnWidth}ch` }}>1</span>
            <span className="big-text"><GridCells fields={grid.header} widths={grid.widths} /></span>
          </div>
        )}
        <div style={{ height: total === null ? 0 : spacerH, position: "relative" }}>
          {total !== null &&
            Array.from({ length: Math.max(0, last - first) }, (_, j) => {
              const k = first + j;
              const r = rowAt(k);
              return (
                <div
                  key={k}
                  role="option"
                  aria-selected={k === active}
                  className={`big-row ${k === active ? "cursor" : ""}`}
                  style={{ position: "absolute", top: Math.round(scrollTop + (k - top) * rowH), height: rowH, lineHeight: `${rowH}px`, left: 0, right: 0 }}
                  onMouseDown={(e) => { e.preventDefault(); listRef.current?.focus(); choose(k); }}
                >
                  <span className="big-ln" style={{ width: `${lnWidth}ch` }}>{r ? (r[0] + 1).toLocaleString() : ""}</span>
                  <span className="big-text">
                    {r === undefined ? <span className="big-loading">…</span> : grid
                      ? <GridCells fields={splitDelimited(r[1].slice(0, 20000), grid.sep)} widths={grid.widths} />
                      : lang
                      ? segments(r[1].slice(0, 2000), tokenize(lang, r[1].slice(0, 2000)), null).map((s, i) => (s.cls ? <span key={i} className={`hl-${s.cls}`}>{s.text}</span> : s.text))
                      : r[1].slice(0, 2000)}
                    {r !== undefined && r[1].length > (grid ? 20000 : 2000) && (
                      <span className="big-more" title="Long line: click it to see it in the file view">… ({(r[1].length - (grid ? 20000 : 2000)).toLocaleString()} more chars)</span>
                    )}
                  </span>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
