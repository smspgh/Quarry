import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { AlertTriangle, Braces, Brackets, CheckCircle2, ChevronRight, ChevronsDownUp, ChevronsUpDown, CircleOff, ClipboardCopy, Copy, Crosshair, Hash, Minimize2, Quote, ToggleLeft, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { editor } from "../../editor/manager";
import { getCommand, isBigJson, isEnabled, runCommand } from "../../lib/commands";
import { BigJsonTree } from "./BigJsonTree";
import { describeCopiedPath, formatPath, nodeAtOffset, nodeKey, nodePreview, pathSegments, valueClipboardText, type JsonNode, type JsonNodeType, type ParseOutcome, type PathStyle } from "../../lib/jsonPath";
import { getJsonTree, PATH_STYLES, previewValue } from "../../lib/jsonModel";
import { useActiveDoc, useStore } from "../../lib/store";
import { isPanelShown } from "../../lib/panels";
import { Select } from "../Select";

const ROW_H = 24;

interface FlatRow {
  node: JsonNode;
  key: string;
  hasChildren: boolean;
}

/** Row identity: a hash of the node's path (stable across re-parses, O(1) at any depth); the root is "". */
const keyOf = nodeKey;

const ROOT_KEY = "";

const TYPE_ICON: Record<JsonNodeType, typeof Braces> = {
  object: Braces,
  array: Brackets,
  number: Hash,
  string: Quote,
  boolean: ToggleLeft,
  null: CircleOff,
};

/** Label shown for a node's key: `""` for the empty key, `{root}` / `[root]` for the root. */
export function nodeLabel(n: JsonNode): string {
  if (n.key === null) return n.type === "array" ? "[root]" : "{root}";
  if (typeof n.key === "number") return String(n.key);
  return n.key === "" ? '""' : n.key;
}

export function JsonPanel() {
  const doc = useActiveDoc();
  const [version, setVersion] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([ROOT_KEY]));
  const [follow, setFollow] = useState(true);
  const [style, setStyle] = useState<PathStyle>("dot");
  const [cursorKey, setCursorKey] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const lastGood = useRef<{ docId: string; outcome: ParseOutcome } | null>(null);
  const toast = useStore((s) => s.toast);
  const panelVisible = useStore((s) => isPanelShown(s, "json"));

  // Re-parse (debounced) on edits; track cursor for follow mode.
  useEffect(() => {
    if (!panelVisible) return;
    let timer: number | undefined;
    const off = editor.onDocUpdate((_id, u) => {
      if (u.docChanged) {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => setVersion((v) => v + 1), 250);
      }
      if (u.selectionSet || u.docChanged) {
        window.clearTimeout(cursorTimer.current);
        // Through the ref: this listener outlives renders, and Follow can be toggled meanwhile.
        cursorTimer.current = window.setTimeout(() => updateCursorRef.current(), 80);
      }
    });
    setVersion((v) => v + 1);
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [panelVisible, doc?.id]);

  const cursorTimer = useRef<number | undefined>(undefined);

  const outcome = useMemo(() => {
    if (!doc || doc.kind !== "text" || !panelVisible) return null;
    return getJsonTree(doc.id);
  }, [doc?.id, version, panelVisible]);

  // While the document is mid-edit (invalid), keep showing the last tree that parsed, dimmed.
  if (outcome?.root && doc) lastGood.current = { docId: doc.id, outcome };
  // A document over the size limit shows no tree at all, not the last one that fitted.
  const shown = outcome?.root ? outcome : outcome?.tooLarge ? null : lastGood.current && lastGood.current.docId === doc?.id ? lastGood.current.outcome : null;
  const stale = !!shown && shown !== outcome;

  const updateCursor = () => {
    const view = editor.view;
    if (!view || !doc || !follow) return;
    const tree = getJsonTree(doc.id);
    if (!tree?.root) return;
    const node = nodeAtOffset(tree.root, view.state.selection.main.head);
    if (!node) return;
    const key = keyOf(node);
    setCursorKey(key);
    // Reveal ancestors.
    setExpanded((prev) => {
      const next = new Set(prev);
      let p = node.parent;
      while (p) {
        next.add(keyOf(p));
        p = p.parent;
      }
      return next;
    });
  };
  const updateCursorRef = useRef(updateCursor);
  updateCursorRef.current = updateCursor;
  // Turning Follow on jumps to the cursor straight away.
  useEffect(() => {
    if (follow && panelVisible) updateCursorRef.current();
  }, [follow, panelVisible]);

  const rows = useMemo(() => {
    const out: FlatRow[] = [];
    const root = shown?.root;
    if (!root) return out;
    // Iterative pre-order walk: documents can nest far deeper than the call stack allows.
    const todo: JsonNode[] = [root];
    while (todo.length) {
      const n = todo.pop()!;
      const key = keyOf(n);
      const hasChildren = !!n.children && n.children.length > 0;
      out.push({ node: n, key, hasChildren });
      if (hasChildren && expanded.has(key)) for (let k = n.children!.length - 1; k >= 0; k--) todo.push(n.children![k]);
    }
    return out;
  }, [shown, expanded]);

  const scrollRowIntoView = (idx: number) => {
    const el = bodyRef.current;
    if (!el || idx < 0) return;
    const top = idx * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
  };

  // Keep the cursor row visible.
  useEffect(() => {
    if (!cursorKey || !bodyRef.current) return;
    const idx = rows.findIndex((r) => r.key === cursorKey);
    if (idx < 0) return;
    const el = bodyRef.current;
    const top = idx * ROW_H;
    if (top < el.scrollTop || top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = Math.max(0, top - el.clientHeight / 2);
  }, [cursorKey, rows]);

  // Roving focus: after a keyboard move the target row may only exist once the virtual window re-renders.
  useEffect(() => {
    const key = pendingFocus.current;
    if (!key || !bodyRef.current) return;
    const el = bodyRef.current.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  });

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (doc && isBigJson(doc)) {
    return (
      <>
        <div className="sidebar-header">
          JSON
          <span className="grow" />
          <button className="icon-btn" title="Validate (Ctrl+Alt+V)" onClick={() => runCommand("json.validate")}><CheckCircle2 size={15} /></button>
        </div>
        {panelVisible && <BigJsonTree key={doc.id} doc={doc} />}
      </>
    );
  }
  if (!doc || doc.kind !== "text") {
    return (
      <>
        <div className="sidebar-header">JSON</div>
        <div className="panel-note">{doc?.kind === "big" ? "This file is open in large-file mode and isn't a .json file, so there's no JSON tree for it." : "Open a JSON document to see its structure here."}</div>
      </>
    );
  }

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const setOpen = (key: string, open: boolean) => {
    setExpanded((prev) => {
      if (prev.has(key) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  };
  const expandAll = () => {
    const all = new Set<string>();
    const walk = (n: JsonNode, depth: number) => {
      if (n.children && n.children.length) {
        all.add(keyOf(n));
        if (depth < 12 && all.size < 50_000) for (const c of n.children) walk(c, depth + 1);
      }
    };
    if (shown?.root) walk(shown.root, 0);
    setExpanded(all);
  };
  const copyPath = async (node: JsonNode) => {
    const text = formatPath(pathSegments(node), style);
    await writeText(text);
    toast(describeCopiedPath(text, style), "success", 1800);
  };
  /** Strings copy unquoted; everything else copies the raw JSON source of the value, dedented. */
  const copyValue = async (node: JsonNode) => {
    const d = editor.docOf(doc.id);
    if (!d) return;
    const text = valueClipboardText(d.toString(), node);
    await writeText(text);
    toast(`Copied value: ${previewValue(text)}`, "success", 1800);
  };
  const reveal = (n: JsonNode, focus: boolean) => {
    editor.reveal(n.keyFrom ?? n.from, n.to, { focus });
    setCursorKey(keyOf(n));
  };

  const focusRow = (idx: number) => {
    const r = rows[Math.max(0, Math.min(rows.length - 1, idx))];
    if (!r) return;
    setFocusKey(r.key);
    pendingFocus.current = r.key;
    scrollRowIntoView(rows.indexOf(r));
  };
  const onRowKeyDown = (e: KeyboardEvent<HTMLDivElement>, idx: number) => {
    const r = rows[idx];
    if (!r) return;
    const open = expanded.has(r.key);
    switch (e.key) {
      case "ArrowDown":
        focusRow(idx + 1);
        break;
      case "ArrowUp":
        focusRow(idx - 1);
        break;
      case "Home":
        focusRow(0);
        break;
      case "End":
        focusRow(rows.length - 1);
        break;
      case "PageDown":
        focusRow(idx + Math.max(1, Math.floor(height / ROW_H) - 1));
        break;
      case "PageUp":
        focusRow(idx - Math.max(1, Math.floor(height / ROW_H) - 1));
        break;
      case "ArrowRight":
        if (r.hasChildren && !open) setOpen(r.key, true);
        else if (r.hasChildren) focusRow(idx + 1);
        break;
      case "ArrowLeft":
        if (r.hasChildren && open) setOpen(r.key, false);
        else if (r.node.parent) {
          const pk = keyOf(r.node.parent);
          focusRow(rows.findIndex((x) => x.key === pk));
        }
        break;
      case "Enter":
        reveal(r.node, true);
        break;
      case " ":
        if (r.hasChildren) toggle(r.key);
        break;
      case "c":
      case "C":
        if (e.ctrlKey) void (e.shiftKey ? copyPath(r.node) : copyValue(r.node));
        else return;
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 10);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_H) + 10);
  const isEmpty = (editor.docOf(doc.id)?.length ?? 0) === 0;
  const err = isEmpty ? null : outcome?.error;
  const lineAt = (offset: number) => { const d = editor.docOf(doc.id); return d ? d.lineAt(Math.min(offset, d.length)).number : 1; };
  const jsonLike = doc.language === "JSON" || !!shown?.root;
  // The header buttons follow the JSON commands' rule (language JSON), greyed out like the JSON menu.
  const can = (id: string) => { const c = getCommand(id); return !!c && isEnabled(c); };
  const notJson = doc.language !== "JSON" ? " (set the language to JSON first)" : "";
  // The focused row falls back to the cursor row, then the root, so Tab lands somewhere useful.
  const tabKey = (focusKey && rows.some((r) => r.key === focusKey) ? focusKey : null) ?? (cursorKey && rows.some((r) => r.key === cursorKey) ? cursorKey : null) ?? rows[0]?.key;

  return (
    <>
      <div className="sidebar-header">
        JSON
        <span className="grow" />
        <button className="icon-btn" disabled={!can("json.format")} title={`Format / pretty-print (Ctrl+Alt+F)${notJson}`} onClick={() => runCommand("json.format")}><Braces size={15} /></button>
        <button className="icon-btn" disabled={!can("json.minify")} title={`Minify (Ctrl+Alt+M)${notJson}`} onClick={() => runCommand("json.minify")}><Minimize2 size={14} /></button>
        <button className="icon-btn" disabled={!can("json.validate")} title={`Validate (Ctrl+Alt+V)${notJson}`} onClick={() => runCommand("json.validate")}><CheckCircle2 size={15} /></button>
      </div>
      <div className="panel-section" style={{ paddingTop: 0, gap: 6 }}>
        <div className="row">
          {err ? (
            <span className="chip danger" title={err.message}><XCircle size={12} /> Invalid</span>
          ) : outcome?.tooLarge ? (
            <span className="chip" title="Over 64 MB or 2,000,000 values: no tree is built. Validate and Format still work.">Too large</span>
          ) : outcome?.root && outcome.lenient ? (
            <span className="chip warning" title={`Parsed leniently: ${outcome.lenient.reason} at line ${lineAt(outcome.lenient.offset)}. Validate and Format need strict JSON.`}><AlertTriangle size={12} /> Lenient</span>
          ) : outcome?.root ? (
            <span className="chip success"><CheckCircle2 size={12} /> Parsed</span>
          ) : (
            <span className="chip">{isEmpty ? "Empty document" : jsonLike ? "Parsing…" : "Not JSON"}</span>
          )}
          <span className="grow" />
          <Select size="sm" style={{ width: 150 }} value={style} onChange={(v) => setStyle(v as PathStyle)} title="Path format used when copying" options={PATH_STYLES.map((p) => ({ value: p.id, label: p.label, hint: p.example }))} />
          <button className={`icon-btn xs ${follow ? "on" : ""}`} aria-pressed={!!follow} title="Follow cursor" onClick={() => setFollow((f) => !f)}><Crosshair size={14} /></button>
          <button className="icon-btn xs" title="Expand all" onClick={expandAll}><ChevronsUpDown size={14} /></button>
          <button className="icon-btn xs" title="Collapse all" onClick={() => setExpanded(new Set([ROOT_KEY]))}><ChevronsDownUp size={14} /></button>
        </div>
        {err && (
          <button
            className="btn small"
            style={{ justifyContent: "flex-start", color: "var(--danger)", height: "auto", padding: "6px 10px", whiteSpace: "normal", textAlign: "left" }}
            onClick={() => {
              const d = editor.docOf(doc.id);
              if (!d) return;
              const line = d.lineAt(Math.min(d.length, err.offset));
              editor.goTo(line.number, err.offset - line.from + 1);
            }}
          >
            {err.message} — click to jump
          </button>
        )}
        {outcome?.tooLarge && <div className="panel-note" style={{ padding: 0 }}>Document too large for tree view (over 64 MB or 2,000,000 values).</div>}
      </div>
      <div
        className={`panel-body json-tree ${stale ? "stale" : ""}`}
        role="tree"
        aria-label="JSON structure"
        title={stale ? "Showing the last structure that parsed; the document currently has errors." : undefined}
        ref={bodyRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        style={{ borderTop: "1px solid var(--stroke)", position: "relative" }}
      >
        <div style={{ height: rows.length * ROW_H, position: "relative", flexShrink: 0 }}>
          {rows.slice(first, last).map((r, i) => {
            const idx = first + i;
            const n = r.node;
            const open = expanded.has(r.key);
            const Icon = TYPE_ICON[n.type];
            return (
              <div
                key={r.key}
                data-key={r.key}
                role="treeitem"
                aria-level={n.depth + 1}
                aria-expanded={r.hasChildren ? open : undefined}
                aria-selected={cursorKey === r.key}
                tabIndex={r.key === tabKey ? 0 : -1}
                className={`tree-row ${cursorKey === r.key ? "active" : ""}`}
                style={{ position: "absolute", top: idx * ROW_H, left: 0, right: 0, paddingLeft: 6 + n.depth * 14 }}
                title={formatPath(pathSegments(n), style)}
                onFocus={() => setFocusKey(r.key)}
                onKeyDown={(e) => onRowKeyDown(e, idx)}
                onClick={() => reveal(n, false)}
                onDoubleClick={() => r.hasChildren && toggle(r.key)}
              >
                <span
                  className={`tree-chevron ${r.hasChildren ? (open ? "open" : "") : "leaf"}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(r.key);
                  }}
                >
                  <ChevronRight size={14} />
                </span>
                <Icon size={12} className={`json-type-icon ${n.type}`} aria-hidden />
                <span className={typeof n.key === "number" ? "json-idx" : "json-key"}>{nodeLabel(n)}</span>
                <span className="muted">:</span>
                {r.hasChildren || n.type === "object" || n.type === "array" ? (
                  <span className="json-count">{nodePreview(n)}</span>
                ) : (
                  <span className={`json-val ${n.type}`}>{nodePreview(n)}</span>
                )}
                <span className="json-row-actions">
                  <button className="icon-btn xs" tabIndex={-1} title="Copy value (Ctrl+C)" onClick={(e) => { e.stopPropagation(); void copyValue(n); }}><ClipboardCopy size={12} /></button>
                  <button className="icon-btn xs" tabIndex={-1} title="Copy path (Ctrl+Shift+C)" onClick={(e) => { e.stopPropagation(); void copyPath(n); }}><Copy size={12} /></button>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
