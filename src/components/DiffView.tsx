import { EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getChunks, goToNextChunk, goToPreviousChunk, MergeView, unifiedMergeView } from "@codemirror/merge";
import { ArrowDown, ArrowLeftRight, ArrowUp, ChevronsDownUp, Columns2, RefreshCw, Rows2, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { baseExtensions, detectLanguage, settingsReconfigure } from "../editor/cmSetup";
import { captureSideTexts, diffViews, markSideEdited, patchDiff, reloadDiff, saveDiff, swapDiff, useDiff, type Side } from "../lib/diff";
import { useStore, type Doc } from "../lib/store";
import { editor } from "../editor/manager";

/** The editor that holds the changes (the right side, or the single inline editor), per tab, for
 *  the Next / Previous Change commands. */
const changeViews = new Map<string, EditorView>();

export function stepChange(docId: string, dir: 1 | -1): boolean {
  const v = changeViews.get(docId);
  if (!v) return false;
  const moved = (dir === 1 ? goToNextChunk : goToPreviousChunk)({ state: v.state, dispatch: (tr) => v.dispatch(tr) });
  v.focus();
  return moved;
}

/** Which change the cursor is in (1-based, 0 = none) and how many there are. */
function position(view: EditorView): { index: number; total: number } {
  const got = getChunks(view.state);
  if (!got) return { index: 0, total: 0 };
  const head = view.state.selection.main.head;
  const useB = got.side !== "a";
  const i = got.chunks.findIndex((c) => (useB ? head >= c.fromB && head <= Math.max(c.fromB, c.toB) : head >= c.fromA && head <= Math.max(c.fromA, c.toA)));
  return { index: i + 1, total: got.chunks.length };
}

export function DiffView({ doc, visible }: { doc: Doc; visible: boolean }) {
  const s = useDiff((st) => st.sessions[doc.id]);
  const settings = useStore((st) => st.settings);
  const host = useRef<HTMLDivElement>(null);
  const [nav, setNav] = useState({ index: 0, total: 0 });

  const version = s?.version;
  const inline = s?.inline;
  const collapse = s?.collapse;

  useEffect(() => {
    const el = host.current;
    const cur = useDiff.getState().sessions[doc.id];
    if (!el || !cur) return;
    let disposed = false;
    let merge: MergeView | null = null;
    let single: EditorView | null = null;
    const path = cur.right.path ?? cur.left.path;
    const firstLine = (cur.right.text || cur.left.text).slice(0, 200);
    void detectLanguage(path, firstLine).load().then((support) => {
      if (disposed) return;
      const report = (view: EditorView) => setNav(position(view));
      const side = (which: "left" | "right", s: Side): Extension[] =>
        baseExtensions(settings, [
          support ?? [],
          // baseExtensions already sets readOnly (false) and the facet keeps the first value.
          Prec.highest(EditorState.readOnly.of(!s.editable)),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) markSideEdited(doc.id, which);
            if (u.docChanged || u.selectionSet || u.viewportChanged) report(u.view);
          }),
        ]);
      const fold = collapse ? { margin: 3, minSize: 6 } : undefined;
      if (inline) {
        single = new EditorView({
          parent: el,
          state: EditorState.create({
            doc: cur.right.text,
            extensions: [side("right", cur.right), unifiedMergeView({ original: cur.left.text, mergeControls: false, gutter: true, highlightChanges: true, syntaxHighlightDeletions: true, collapseUnchanged: fold, diffConfig: { timeout: 3000 } })],
          }),
        });
        changeViews.set(doc.id, single);
        diffViews.set(doc.id, { right: single });
        report(single);
      } else {
        merge = new MergeView({
          parent: el,
          a: { doc: cur.left.text, extensions: side("left", cur.left) },
          b: { doc: cur.right.text, extensions: side("right", cur.right) },
          revertControls: cur.right.editable ? "a-to-b" : cur.left.editable ? "b-to-a" : undefined,
          highlightChanges: true,
          gutter: true,
          collapseUnchanged: fold,
          diffConfig: { timeout: 3000 },
        });
        changeViews.set(doc.id, merge.b);
        diffViews.set(doc.id, { left: merge.a, right: merge.b });
        report(merge.b);
      }
    });
    return () => {
      disposed = true;
      // Edits live in the editors: keep them for the rebuilt ones (inline / side by side, fold).
      captureSideTexts(doc.id);
      merge?.destroy();
      single?.destroy();
      changeViews.delete(doc.id);
      diffViews.delete(doc.id);
      el.replaceChildren();
    };
    // Rebuilt for a new text (reload, swap) or layout; settings are applied in place below.
  }, [doc.id, version, inline, collapse]); // eslint-disable-line react-hooks/exhaustive-deps

  // Font, tab size, wrap, line numbers, ...: reconfigure the editors (a rebuild would lose undo and position).
  useEffect(() => {
    const views = diffViews.get(doc.id);
    for (const v of [views?.left, views?.right]) v?.dispatch({ effects: settingsReconfigure(settings) });
  }, [settings, doc.id]);

  useEffect(() => editor.registerFocus(doc.id, () => changeViews.get(doc.id)?.focus()), [doc.id]);
  useEffect(() => {
    if (!visible) return;
    requestAnimationFrame(() => {
      const v = changeViews.get(doc.id);
      v?.requestMeasure();
      // Like a text tab, a Compare tab takes the keyboard when it is shown.
      if (!editor.takeKeepFocus()) v?.focus();
    });
  }, [visible, doc.id]);

  if (!s) return null;
  const dirty = s.left.dirty || s.right.dirty;
  const label = (side: Side) => (
    <span className="diff-label" title={side.path ?? side.label}>
      {side.label}
      {!side.editable && <span className="diff-tag">read-only</span>}
      {side.dirty && <span className="diff-tag edited">edited</span>}
    </span>
  );

  return (
    <div className="diff-view" hidden={!visible}>
      <div className="diff-toolbar">
        <div className="diff-sides">
          {label(s.left)}
          <ArrowLeftRight size={13} className="diff-arrow" />
          {label(s.right)}
        </div>
        <span className="diff-count">
          {nav.total === 0 ? "No differences" : nav.index ? `Change ${nav.index} of ${nav.total}` : `${nav.total} change${nav.total === 1 ? "" : "s"}`}
        </span>
        <button className="icon-btn" title="Previous change (Shift+F7)" aria-label="Previous change" disabled={!nav.total} onClick={() => stepChange(doc.id, -1)}><ArrowUp size={15} /></button>
        <button className="icon-btn" title="Next change (F7)" aria-label="Next change" disabled={!nav.total} onClick={() => stepChange(doc.id, 1)}><ArrowDown size={15} /></button>
        <span className="diff-sep" />
        <div className="segmented" role="radiogroup" aria-label="Layout">
          <button role="radio" aria-checked={!s.inline} className={!s.inline ? "on" : ""} title="Side by side" onClick={() => patchDiff(doc.id, () => ({ inline: false }))}><Columns2 size={13} /> Side by side</button>
          <button role="radio" aria-checked={s.inline} className={s.inline ? "on" : ""} title="One editor, removed lines shown inline" onClick={() => patchDiff(doc.id, () => ({ inline: true }))}><Rows2 size={13} /> Inline</button>
        </div>
        <button className={`icon-btn ${s.collapse ? "on" : ""}`} title={s.collapse ? "Show unchanged lines" : "Fold unchanged lines"} aria-pressed={s.collapse} onClick={() => patchDiff(doc.id, (cur) => ({ collapse: !cur.collapse }))}><ChevronsDownUp size={15} /></button>
        <button className="icon-btn" title="Swap sides" aria-label="Swap sides" disabled={dirty} onClick={() => swapDiff(doc.id)}><ArrowLeftRight size={15} /></button>
        <button className="icon-btn" title="Reload the files from disk" aria-label="Reload" disabled={dirty} onClick={() => void reloadDiff(doc.id)}><RefreshCw size={15} /></button>
        {dirty && (
          <button className="btn small btn-primary" title="Save the edited side (Ctrl+S)" onClick={() => void saveDiff(doc.id)}><Save size={13} /> Save</button>
        )}
      </div>
      <div ref={host} className={`diff-host ${s.inline ? "inline" : "split"}`} />
    </div>
  );
}
