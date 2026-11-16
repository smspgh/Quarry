import { EditorState, Prec, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { getChunks, goToNextChunk, goToPreviousChunk, MergeView, unifiedMergeView } from "@codemirror/merge";
import { ArrowDown, ArrowLeftRight, ArrowUp, ChevronsDownUp, Columns2, RefreshCw, Rows2, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { baseExtensions, detectLanguage, settingsReconfigure } from "../editor/cmSetup";
import { captureSideTexts, diffViews, markSideEdited, patchDiff, reloadDiff, saveDiff, swapDiff, useDiff, type Side } from "../lib/diff";
import { useStore, type Doc } from "../lib/store";
import { editor } from "../editor/manager";
import { useGit } from "../lib/git";
import { barPlace } from "../lib/gitHunks";
import { applyChange, applySelection, changeAtCursor as stagingChangeAt, linesPickable, selectedLines as stagingSelection, type ApplyAction } from "../lib/gitStaging";

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

// ---------- partial staging (specs/git-staging.md): a bar above each change ----------

/** Index of the change at the cursor of a tab's right side (-1: none): what the `git.*Change`
 *  commands act on. */
export const changeAtCursor = (docId: string) => stagingChangeAt(docId);
/** What the selection of a tab's right side takes from its changes: what the `git.*Lines`
 *  commands act on. */
export const selectedLines = (docId: string) => stagingSelection(docId);

const BAR_BUTTONS: Record<"changes" | "staged", { action: ApplyAction; label: string; title: string }[]> = {
  changes: [
    { action: "stage", label: "Stage Change", title: "Stage this change (Ctrl+K S at the cursor)" },
    { action: "discard", label: "Discard Change", title: "Discard this change… (asks first)" },
  ],
  staged: [{ action: "unstage", label: "Unstage Change", title: "Unstage this change (Ctrl+K U at the cursor)" }],
};

/** The bar above a change: Stage Change / Discard Change, or Unstage Change. */
class HunkBar extends WidgetType {
  constructor(readonly docId: string, readonly index: number, readonly kind: "changes" | "staged") {
    super();
  }
  eq(o: HunkBar) {
    return o.docId === this.docId && o.index === this.index && o.kind === this.kind;
  }
  toDOM() {
    const bar = document.createElement("div");
    bar.className = "diff-hunk-bar";
    for (const b of BAR_BUTTONS[this.kind]) {
      const btn = bar.appendChild(document.createElement("button"));
      btn.type = "button";
      btn.className = `diff-hunk-btn${b.action === "discard" ? " danger" : ""}`;
      btn.textContent = b.label;
      btn.title = b.title;
      btn.dataset.action = b.action;
      btn.disabled = !!useGit.getState().busy;
      // Keep the keyboard focus in the editor (F7 goes on to the next change).
      btn.onmousedown = (e) => e.preventDefault();
      btn.onclick = (e) => {
        e.preventDefault();
        void applyChange(this.docId, b.action, this.index);
      };
    }
    return bar;
  }
  ignoreEvent() {
    return true;
  }
}

/** The same height on the left side, so the two sides stay level. */
class HunkGap extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const gap = document.createElement("div");
    gap.className = "diff-hunk-gap";
    return gap;
  }
}

/** Bars above the changes of the right / inline editor (`kind`), or matching gaps in the left one. */
function hunkBars(docId: string, kind: "changes" | "staged" | "gap", inline = false): Extension {
  const build = (state: EditorState): DecorationSet => {
    const got = getChunks(state);
    if (!got) return Decoration.none;
    const doc = state.doc;
    return Decoration.set(
      got.chunks.map((c, i) => {
        // Inline: above the removed lines drawn there (side -1). Side by side: where the two
        // editors stay level (`barPlace`).
        const at = inline
          ? { pos: doc.lineAt(Math.min(c.fromB, doc.length)).from, side: -2 }
          : kind === "gap"
            ? barPlace(doc, c.fromA, c.toA, c.fromB, c.toB)
            : barPlace(doc, c.fromB, c.toB, c.fromA, c.toA);
        return Decoration.widget({ widget: kind === "gap" ? new HunkGap() : new HunkBar(docId, i, kind), block: true, side: at.side }).range(at.pos);
      }),
      true,
    );
  };
  return StateField.define<DecorationSet>({
    create: build,
    update: (v, tr) => (tr.docChanged || getChunks(tr.startState)?.chunks !== getChunks(tr.state)?.chunks ? build(tr.state) : v),
    provide: (f) => EditorView.decorations.from(f),
  });
}

/** Where the reader was, kept across a rebuild of the editors (a refresh after staging). */
interface Place {
  line: number;
  col: number;
  /** First line in view, and how far (px) its text starts above the top edge (negative: below). */
  top: number;
  off: number;
  focused: boolean;
}

function placeOf(view: EditorView, host: HTMLElement): Place {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  let top = 1;
  let off = 0;
  try {
    const edge = host.getBoundingClientRect().top;
    const from = view.lineBlockAtHeight(edge - view.documentTop).from;
    top = view.state.doc.lineAt(from).number;
    const at = view.coordsAtPos(from);
    if (at) off = edge - at.top;
  } catch {
    // not laid out
  }
  return { line: line.number, col: head - line.from, top, off, focused: view.hasFocus };
}

function restorePlace(view: EditorView, p: Place) {
  const doc = view.state.doc;
  const line = doc.line(Math.min(p.line, doc.lines));
  const top = doc.line(Math.min(p.top, doc.lines)).from;
  const scrolled = p.top > 1 || p.off > 0;
  // The text got shorter than where the reader was (the last change near the end was staged): show
  // the end of the file at the bottom rather than putting its last line at the top of an empty view.
  const past = p.top > doc.lines;
  const scroll = () => (past ? EditorView.scrollIntoView(doc.length, { y: "end" }) : EditorView.scrollIntoView(top, { y: "start", yMargin: -p.off }));
  view.dispatch({ selection: { anchor: Math.min(line.from + p.col, line.to) }, effects: scrolled ? scroll() : [] });
  if (p.focused) view.focus();
  // Side by side, the spacers that level the two sides are only added once the new editors are
  // measured, which moves the lines again: put the same line back when that has happened.
  if (scrolled && typeof requestAnimationFrame === "function") {
    let frames = 3;
    const again = () => {
      if (!view.dom.isConnected) return;
      view.dispatch({ effects: scroll() });
      if (--frames > 0) requestAnimationFrame(again);
    };
    requestAnimationFrame(again);
  }
}

export function DiffView({ doc, visible }: { doc: Doc; visible: boolean }) {
  const s = useDiff((st) => st.sessions[doc.id]);
  const settings = useStore((st) => st.settings);
  const host = useRef<HTMLDivElement>(null);
  const [nav, setNav] = useState({ index: 0, total: 0 });
  // Partial staging: is a git action running, does the selection touch a change, where the reader was.
  const busy = useGit((g) => !!g.busy);
  const [lines, setLines] = useState(false);
  const place = useRef<Place | null>(null);

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
      // Source Control comparison, sides not swapped: change bars and the selected-lines buttons.
      const staging = cur.git && !cur.swapped && linesPickable(cur) ? (cur.git.staged ? "staged" : "changes") : null;
      const report = (view: EditorView) => {
        setNav(position(view));
        // Only the right side's cursor / selection counts (the left side's is ignored).
        if (staging && view === changeViews.get(doc.id)) setLines(stagingSelection(doc.id).length > 0);
      };
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
            extensions: [side("right", cur.right), staging ? hunkBars(doc.id, staging, true) : [], unifiedMergeView({ original: cur.left.text, mergeControls: false, gutter: true, highlightChanges: true, syntaxHighlightDeletions: true, collapseUnchanged: fold, diffConfig: { timeout: 3000 } })],
          }),
        });
        changeViews.set(doc.id, single);
        diffViews.set(doc.id, { right: single });
        if (place.current) restorePlace(single, place.current);
        report(single);
      } else {
        merge = new MergeView({
          parent: el,
          a: { doc: cur.left.text, extensions: [side("left", cur.left), staging ? hunkBars(doc.id, "gap") : []] },
          b: { doc: cur.right.text, extensions: [side("right", cur.right), staging ? hunkBars(doc.id, staging) : []] },
          revertControls: cur.right.editable ? "a-to-b" : cur.left.editable ? "b-to-a" : undefined,
          highlightChanges: true,
          gutter: true,
          collapseUnchanged: fold,
          diffConfig: { timeout: 3000 },
        });
        changeViews.set(doc.id, merge.b);
        diffViews.set(doc.id, { left: merge.a, right: merge.b });
        if (place.current) restorePlace(merge.b, place.current);
        report(merge.b);
      }
    });
    return () => {
      disposed = true;
      // Edits live in the editors: keep them for the rebuilt ones (inline / side by side, fold).
      captureSideTexts(doc.id);
      // A refresh after staging must not jump away from where the reader was.
      const shown = changeViews.get(doc.id);
      if (shown) place.current = placeOf(shown, el);
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
  // While git is busy the bars' buttons are disabled (new bars read the state when they are drawn).
  useEffect(() => {
    host.current?.querySelectorAll<HTMLButtonElement>(".diff-hunk-btn").forEach((b) => (b.disabled = busy));
  }, [busy, version, inline, collapse]);
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
          <button role="radio" aria-checked={!s.inline} className={!s.inline ? "on" : ""} title="Side by side" onClick={() => patchDiff(doc.id, () => ({ inline: false }))}><Columns2 size={13} /><span className="seg-text">Side by side</span></button>
          <button role="radio" aria-checked={s.inline} className={s.inline ? "on" : ""} title="One editor, removed lines shown inline" onClick={() => patchDiff(doc.id, () => ({ inline: true }))}><Rows2 size={13} /><span className="seg-text">Inline</span></button>
        </div>
        <button className={`icon-btn ${s.collapse ? "on" : ""}`} title={s.collapse ? "Show unchanged lines" : "Fold unchanged lines"} aria-pressed={s.collapse} onClick={() => patchDiff(doc.id, (cur) => ({ collapse: !cur.collapse }))}><ChevronsDownUp size={15} /></button>
        <button className="icon-btn" title="Swap sides" aria-label="Swap sides" disabled={dirty} onClick={() => swapDiff(doc.id)}><ArrowLeftRight size={15} /></button>
        <button className="icon-btn" title="Reload the files from disk" aria-label="Reload" disabled={dirty} onClick={() => void reloadDiff(doc.id)}><RefreshCw size={15} /></button>
        {s.git && !s.swapped && linesPickable(s) && (
          <>
            <span className="diff-sep" />
            {(s.git.staged
              ? [{ action: "unstage" as const, label: "Unstage Selected Lines", short: "Unstage Lines", title: "Unstage the selected lines of the right side (Ctrl+K N)" }]
              : [
                  { action: "stage" as const, label: "Stage Selected Lines", short: "Stage Lines", title: "Stage the selected lines of the right side (Ctrl+K L)" },
                  { action: "discard" as const, label: "Discard Selected Lines", short: "Discard Lines", title: "Discard the selected lines of the right side… (asks first)" },
                ]
            ).map((b) => (
              <button key={b.action} aria-label={b.label} className={`btn small diff-lines-btn${b.action === "discard" ? " btn-danger" : ""}`} title={b.title} disabled={busy || !lines} onMouseDown={(e) => e.preventDefault()} onClick={() => void applySelection(doc.id, b.action)}>
                <span className="long">{b.label}</span>
                <span className="short">{b.short}</span>
              </button>
            ))}
          </>
        )}
        {dirty && (
          <button className="btn small btn-primary" title="Save the edited side (Ctrl+S)" onClick={() => void saveDiff(doc.id)}><Save size={13} /> Save</button>
        )}
      </div>
      <div ref={host} className={`diff-host ${s.inline ? "inline" : "split"}`} />
    </div>
  );
}
