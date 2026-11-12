import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Copy } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { editor, type PaneIndex } from "../editor/manager";
import { breadcrumbWindow, formatPath, nodeAtOffset, pathSegments } from "../lib/jsonPath";
import { getJsonTree, looksLikeJson } from "../lib/jsonModel";
import { paneDocId, useStore } from "../lib/store";
import { FindBar } from "./FindBar";
import { EditorMenu } from "./EditorMenu";
import { foldTargetAt, type FoldTarget } from "../editor/lineMenu";

/**
 * JSON path bar. Always rendered for JSON-looking documents (showing `$` when the caret is not
 * inside a value) so the editor does not jump when a path appears; while the document is invalid
 * the last good path stays visible, greyed out.
 */
function Breadcrumb({ docId, language }: { docId: string; language: string }) {
  const [state, setState] = useState<{ json: boolean; segs: (string | number)[]; stale: boolean }>({ json: language === "JSON", segs: [], stale: false });
  const toast = useStore((s) => s.toast);
  useEffect(() => {
    let timer: number | undefined;
    setState({ json: language === "JSON", segs: [], stale: false });
    const compute = () => {
      const view = editor.viewOf(docId);
      if (!view) return;
      if (!looksLikeJson(docId, language)) {
        setState({ json: false, segs: [], stale: false });
        return;
      }
      const tree = getJsonTree(docId);
      if (!tree?.root) {
        setState((p) => ({ json: true, segs: p.segs, stale: true }));
        return;
      }
      const node = nodeAtOffset(tree.root, view.state.selection.main.head);
      setState({ json: true, segs: node ? pathSegments(node) : [], stale: false });
    };
    compute();
    const off = editor.onDocUpdate((id, u) => {
      if (id !== docId || !(u.selectionSet || u.docChanged)) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(compute, u.docChanged ? 300 : 60);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [docId, language]);

  if (!state.json) return null;
  const { segs, stale } = state;
  const dot = formatPath(segs, "dot");
  // Deep documents (thousands of levels) show the first and last segments around an ellipsis.
  const win = breadcrumbWindow(segs.length);
  const seg = (i: number) => {
    const s = segs[i];
    const label = typeof s === "number" ? `[${s}]` : s;
    return (
      <span key={i} style={{ display: "contents" }}>
        <span className="sep">›</span>
        <button className="seg" title="Copy path up to here" onClick={() => copy(formatPath(segs.slice(0, i + 1), "dot"))}>
          {label.length > 40 ? label.slice(0, 39) + "…" : label}
        </button>
      </span>
    );
  };
  const copy = async (text: string) => {
    await writeText(text);
    toast(`Copied: ${text}`, "success", 1500);
  };
  return (
    <div className={`breadcrumb ${stale ? "stale" : ""}`} title={stale ? "Document has errors; showing the last known path" : undefined}>
      <button className="seg" onClick={() => copy("$")} title="Root">$</button>
      {win.head.map(seg)}
      {win.hidden > 0 && (
        <>
          <span className="sep">›</span>
          <span className="seg muted" title={`${win.hidden.toLocaleString()} more levels`}>…</span>
        </>
      )}
      {win.tail.map(seg)}
      <button className="path-copy" title="Copy full path (Ctrl+Alt+P)" onClick={() => copy(dot)}>
        <span className="truncate" style={{ maxWidth: 360 }}>{dot}</span>
        <Copy size={12} />
      </button>
    </div>
  );
}

/** One pane of the editor: the shared text view of pane 0 (the whole area unless split) or 1. */
export function CodeEditor({ pane, visible }: { pane: PaneIndex; visible: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const doc = useStore((s) => s.docs.find((d) => d.id === paneDocId(s, pane)));
  const focused = useStore((s) => (s.split?.focused ?? 0) === pane);
  const text = doc?.kind === "text";

  useEffect(() => {
    if (hostRef.current) editor.mount(hostRef.current, pane);
    return () => editor.unmount(pane);
  }, []);

  // Showing the document itself happens synchronously in the manager's store subscription (see
  // manager.mount), so commands dispatched right after setActive() hit the right document; this
  // effect only reaffirms it (syncPanes is idempotent) and handles read-only state.
  useEffect(() => {
    editor.syncPanes();
    if (text) editor.setReadOnly(doc.readonly, pane);
  }, [doc?.id, text, doc?.readonly]);

  // The focused pane takes the keyboard when it gets a new document.
  useEffect(() => {
    if (!text || !focused) return;
    const keep = editor.takeKeepFocus();
    if (!keep) requestAnimationFrame(() => editor.focus());
  }, [doc?.id, text, focused]);

  // Screen readers announce the editor by the document it shows (CodeMirror leaves aria-label alone).
  const label = text ? `${doc.name}${doc.readonly ? ", read-only" : ""}, editor${pane === 1 ? " (right)" : ""}` : "Editor";
  useEffect(() => {
    hostRef.current?.querySelector(".cm-content")?.setAttribute("aria-label", label);
  }, [label]);

  // Right-click on a line that starts a foldable region or holds a fold (its text or its fold
  // arrow) opens Quarry's menu; elsewhere the browser's own Cut / Copy / Paste menu stays.
  const [menu, setMenu] = useState<{ x: number; y: number; target: FoldTarget } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const onContextMenu = (e: React.MouseEvent) => {
    const view = editor.paneView(pane);
    if (!text || !view || !(e.target as HTMLElement).closest(".cm-content, .cm-gutters")) return;
    const block = view.lineBlockAtHeight(e.clientY - view.documentTop);
    const target = foldTargetAt(view.state, view.state.doc.lineAt(block.from).number);
    if (!target) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, target });
  };

  return (
    <div className="editor-stack" style={{ display: visible ? undefined : "none" }}>
      {text && <Breadcrumb docId={doc.id} language={doc.language} />}
      <div className="editor-host" ref={hostRef} onContextMenu={onContextMenu} />
      {focused && <FindBar />}
      {menu && text && <EditorMenu x={menu.x} y={menu.y} target={menu.target} readOnly={doc.readonly} onClose={closeMenu} />}
    </div>
  );
}
