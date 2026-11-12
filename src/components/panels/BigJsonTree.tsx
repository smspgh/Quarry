import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Braces, Brackets, ChevronRight, ChevronsDownUp, CircleOff, Copy, Hash, Quote, RefreshCw, ToggleLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { bus } from "../../lib/bus";
import { big, type BigJsonNode } from "../../lib/ipc";
import { describeCopiedPath, formatPath, type PathStyle } from "../../lib/jsonPath";
import { PATH_STYLES } from "../../lib/jsonModel";
import { useStore, type Doc } from "../../lib/store";
import { Select } from "../Select";

const ROW_H = 24;
/** Children listed per page (and per "Load more"). */
export const PAGE = 200;

const ICON = { object: Braces, array: Brackets, number: Hash, string: Quote, boolean: ToggleLeft, null: CircleOff } as const;

interface Children {
  nodes: BigJsonNode[];
  next: number | null;
  loading: boolean;
  error?: string;
}

/** A row of the flattened tree: a node, or the "Load more" row after a partly listed container. */
export type Row =
  | { type: "node"; node: BigJsonNode; depth: number; path: (string | number)[]; key: string }
  | { type: "more"; parent: BigJsonNode; depth: number; key: string; shown: number };

/**
 * Pure helper (testable): the visible rows, depth first. A node's key is its byte offset, which is
 * unique within the file. Only expanded nodes with loaded children contribute child rows.
 */
export function flattenRows(root: BigJsonNode, expanded: ReadonlySet<number>, kids: ReadonlyMap<number, Pick<Children, "nodes" | "next">>): Row[] {
  const out: Row[] = [];
  // Iterative depth-first walk (files can nest deeper than the call stack allows). Items pop in
  // order because each container's children are pushed in reverse, after its "Load more" row.
  const todo: Row[] = [{ type: "node", node: root, depth: 0, path: [], key: String(root.start) }];
  while (todo.length) {
    const r = todo.pop()!;
    out.push(r);
    if (r.type !== "node") continue;
    const c = kids.get(r.node.start);
    if (!expanded.has(r.node.start) || !c) continue;
    if (c.next !== null) todo.push({ type: "more", parent: r.node, depth: r.depth + 1, key: `more:${r.node.start}`, shown: c.nodes.length });
    for (let k = c.nodes.length - 1; k >= 0; k--) {
      const n = c.nodes[k];
      todo.push({ type: "node", node: n, depth: r.depth + 1, path: [...r.path, n.key ?? n.index], key: String(n.start) });
    }
  }
  return out;
}

/** A row's key label: the member name (`""` for the empty name), or the array index. */
const label = (n: BigJsonNode) => (n.key !== null ? (n.key === "" ? '""' : n.key) : String(n.index));

/** The JSON panel for a file in large-file mode: a lazily loaded tree read from the file itself. */
export function BigJsonTree({ doc }: { doc: Doc }) {
  const toast = useStore((s) => s.toast);
  const [root, setRoot] = useState<BigJsonNode | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);
  const [kids, setKids] = useState<Map<number, Children>>(new Map());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [rootCount, setRootCount] = useState<number | "counting" | null>(null);
  const [style, setStyle] = useState<PathStyle>("dot");
  const [active, setActive] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const [reload, setReload] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const id = doc.bigId!;

  const load = async (node: BigJsonNode, resume: number | null = null) => {
    setKids((m) => new Map(m).set(node.start, { ...(m.get(node.start) ?? { nodes: [], next: null }), loading: true }));
    try {
      const have = resume === null ? 0 : (kids.get(node.start)?.nodes.length ?? 0);
      const page = await big.jsonChildren(id, node.start, resume, have, PAGE);
      setKids((m) => {
        const prev = resume === null ? [] : (m.get(node.start)?.nodes ?? []);
        return new Map(m).set(node.start, { nodes: [...prev, ...page.nodes], next: page.next, loading: false });
      });
    } catch (e) {
      setKids((m) => new Map(m).set(node.start, { nodes: m.get(node.start)?.nodes ?? [], next: null, loading: false, error: String(e) }));
    }
  };

  // The root, its first page, and (in the background) how many children it has in all.
  useEffect(() => {
    let live = true;
    setRoot(null);
    setRootError(null);
    setKids(new Map());
    setExpanded(new Set());
    setRootCount(null);
    if (doc.dirty) return;
    big.jsonRoot(id).then(
      (r) => {
        if (!live) return;
        setRoot(r);
        if (r.kind === "object" || r.kind === "array") {
          setExpanded(new Set([r.start]));
          void load(r);
          setRootCount("counting");
          big.jsonCount(id, r.start).then((n) => live && setRootCount(n), () => live && setRootCount(null));
        }
      },
      (e) => live && setRootError(String(e)),
    );
    return () => {
      live = false;
    };
  }, [id, doc.dirty, reload]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [root]);

  const rows = useMemo(() => (root ? flattenRows(root, expanded, kids) : []), [root, expanded, kids]);

  const toggle = (n: BigJsonNode, open?: boolean) => {
    if (n.kind !== "object" && n.kind !== "array") return;
    const willOpen = open ?? !expanded.has(n.start);
    setExpanded((s) => {
      const next = new Set(s);
      if (willOpen) next.add(n.start);
      else next.delete(n.start);
      return next;
    });
    if (willOpen && !kids.has(n.start)) void load(n);
  };
  const jump = async (n: BigJsonNode) => {
    try {
      const line = await big.lineOfOffset(id, n.start);
      bus.emitFor(doc.id, "big.goto", { line });
    } catch (e) {
      toast(String(e), "warning");
    }
  };
  const copyPath = async (path: (string | number)[]) => {
    const text = formatPath(path, style);
    await writeText(text);
    toast(describeCopiedPath(text, style), "success", 1800);
  };
  const focusRow = (i: number) => {
    const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
    if (!r) return;
    setActive(r.key);
    const el = bodyRef.current;
    if (el) {
      const top = rows.indexOf(r) * ROW_H;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
    }
    requestAnimationFrame(() => bodyRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(r.key)}"]`)?.focus({ preventScroll: true }));
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    const r = rows[i];
    switch (e.key) {
      case "ArrowDown": focusRow(i + 1); break;
      case "ArrowUp": focusRow(i - 1); break;
      case "Home": focusRow(0); break;
      case "End": focusRow(rows.length - 1); break;
      case "PageDown": focusRow(i + Math.max(1, Math.floor(height / ROW_H) - 1)); break;
      case "PageUp": focusRow(i - Math.max(1, Math.floor(height / ROW_H) - 1)); break;
      case "ArrowRight": if (r.type === "node") { if (!expanded.has(r.node.start)) toggle(r.node, true); else focusRow(i + 1); } break;
      case "ArrowLeft":
        if (r.type === "node" && expanded.has(r.node.start)) toggle(r.node, false);
        else for (let k = i - 1; k >= 0; k--) if (rows[k].depth < r.depth) { focusRow(k); break; }
        break;
      case "Enter":
        if (r.type === "more") void load(r.parent, kids.get(r.parent.start)?.next ?? null);
        else void jump(r.node);
        break;
      default:
        if (e.key.toLowerCase() === "c" && e.ctrlKey && e.shiftKey && r.type === "node") void copyPath(r.path);
        else return;
    }
    e.preventDefault();
  };

  if (doc.dirty) return <div className="panel-note">Save the file to see its tree: in large-file mode the tree reads the file as saved.</div>;
  if (rootError) return <div className="panel-note" style={{ color: "var(--danger)" }}>Can't read this file as JSON: {rootError}</div>;
  if (!root) return <div className="panel-note">Reading…</div>;

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 10);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_H) + 10);
  const tabKey = active && rows.some((r) => r.key === active) ? active : rows[0]?.key;
  const countText = (n: BigJsonNode) => {
    const c = n.start === root.start ? rootCount : n.count;
    if (c === "counting") return n.kind === "array" ? "[counting…]" : "{counting…}";
    if (c === null || c === undefined) return n.preview;
    return n.kind === "array" ? `[${c.toLocaleString()}]` : `{${c.toLocaleString()}}`;
  };

  return (
    <>
      <div className="panel-section" style={{ paddingTop: 0, gap: 6 }}>
        <div className="row">
          <span className="chip" title="Large-file mode: each part of the tree is read from the file when you expand it">Read from the file</span>
          <span className="grow" />
          <Select size="sm" style={{ width: 150 }} value={style} onChange={(v) => setStyle(v as PathStyle)} title="Path format used when copying" options={PATH_STYLES.map((p) => ({ value: p.id, label: p.label, hint: p.example }))} />
          <button className="icon-btn xs" title="Collapse all" onClick={() => setExpanded(new Set([root.start]))}><ChevronsDownUp size={14} /></button>
          <button className="icon-btn xs" title="Re-read the file" onClick={() => setReload((n) => n + 1)}><RefreshCw size={13} /></button>
        </div>
      </div>
      <div className="panel-body json-tree" role="tree" aria-label="JSON structure" ref={bodyRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} style={{ borderTop: "1px solid var(--stroke)", position: "relative" }}>
        <div style={{ height: rows.length * ROW_H, position: "relative", flexShrink: 0 }}>
          {rows.slice(first, last).map((r, k) => {
            const i = first + k;
            const pos = { position: "absolute" as const, top: i * ROW_H, left: 0, right: 0, paddingLeft: 6 + r.depth * 14 };
            if (r.type === "more") {
              const c = kids.get(r.parent.start);
              const total = r.parent.start === root.start && typeof rootCount === "number" ? rootCount : r.parent.count;
              return (
                <div key={r.key} data-key={r.key} role="treeitem" aria-level={r.depth + 1} tabIndex={r.key === tabKey ? 0 : -1} className="tree-row json-more" style={pos} onFocus={() => setActive(r.key)} onKeyDown={(e) => onKey(e, i)} onClick={() => void load(r.parent, c?.next ?? null)}>
                  <span className="tree-chevron leaf" />
                  <span className="link-btn">{c?.loading ? "Loading…" : `Load ${PAGE} more`}</span>
                  <span className="muted">{`${r.shown.toLocaleString()}${total ? ` of ${total.toLocaleString()}` : ""} shown`}</span>
                </div>
              );
            }
            const n = r.node;
            const container = n.kind === "object" || n.kind === "array";
            const open = expanded.has(n.start);
            const Icon = ICON[n.kind];
            const c = kids.get(n.start);
            return (
              <div
                key={r.key}
                data-key={r.key}
                role="treeitem"
                aria-level={r.depth + 1}
                aria-expanded={container ? open : undefined}
                aria-selected={active === r.key}
                tabIndex={r.key === tabKey ? 0 : -1}
                className={`tree-row ${active === r.key ? "active" : ""}`}
                style={pos}
                title={`${formatPath(r.path, style)}  ·  click to go to its line`}
                onFocus={() => setActive(r.key)}
                onKeyDown={(e) => onKey(e, i)}
                onClick={() => { setActive(r.key); void jump(n); }}
                onDoubleClick={() => toggle(n)}
              >
                <span className={`tree-chevron ${container && (n.count ?? 1) > 0 ? (open ? "open" : "") : "leaf"}`} onClick={(e) => { e.stopPropagation(); toggle(n); }}>
                  <ChevronRight size={14} />
                </span>
                <Icon size={12} className={`json-type-icon ${n.kind}`} aria-hidden />
                <span className={n.key !== null ? "json-key" : "json-idx"}>{r.depth === 0 ? (n.kind === "array" ? "[root]" : n.kind === "object" ? "{root}" : "root") : label(n)}</span>
                <span className="muted">:</span>
                {container ? <span className="json-count">{countText(n)}</span> : <span className={`json-val ${n.kind}`}>{n.preview}</span>}
                {c?.error && <span className="json-val" style={{ color: "var(--danger)" }} title={c.error}>{c.error}</span>}
                <span className="json-row-actions">
                  <button className="icon-btn xs" tabIndex={-1} title="Copy path (Ctrl+Shift+C)" onClick={(e) => { e.stopPropagation(); void copyPath(r.path); }}><Copy size={12} /></button>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
