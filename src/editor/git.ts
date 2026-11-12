/**
 * Git in the editor: change markers in the gutter (the document against its HEAD version, kept up
 * to date while typing with @codemirror/merge's Chunk.updateB), a peek of a change with Revert
 * (click a marker), and the blame of the cursor line shown at its end. lib/git.ts feeds the HEAD
 * text (`setGitBase`) and the blame (`setBlame`).
 */
import { Chunk } from "@codemirror/merge";
import { RangeSetBuilder, StateEffect, StateField, Text, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, gutter, GutterMarker, showTooltip, WidgetType, type Tooltip } from "@codemirror/view";
import type { GitBlame } from "../lib/gitApi";

// ---------- change markers ----------

/** The text the document is compared with (its HEAD version), or null for no markers. */
export const setGitBase = StateEffect.define<Text | null>();

interface GitDiff {
  base: Text | null;
  chunks: readonly Chunk[];
}

const DIFF_CONF = { scanLimit: 2000, timeout: 300 };

export const gitDiff = StateField.define<GitDiff>({
  create: () => ({ base: null, chunks: [] }),
  update(v, tr) {
    for (const e of tr.effects) {
      if (e.is(setGitBase)) {
        const base = e.value;
        if (base && v.base && base.eq(v.base) && !tr.docChanged) return v;
        return { base, chunks: base ? Chunk.build(base, tr.state.doc, DIFF_CONF) : [] };
      }
    }
    if (tr.docChanged && v.base) return { base: v.base, chunks: Chunk.updateB(v.chunks, v.base, tr.state.doc, tr.changes, DIFF_CONF) };
    return v;
  },
});

export type ChangeKind = "added" | "modified" | "deleted";

/**
 * One change in whole lines: document lines `first..last` (1-based; empty, last = first - 1, for a
 * deletion, which is marked on line `first`) replace HEAD lines `aFirst..aLast`. Chunks are found
 * per character, so lines that match at either end of one (a line break added after an unchanged
 * last line, say) are trimmed off.
 */
export interface LineChange {
  kind: ChangeKind;
  first: number;
  last: number;
  aFirst: number;
  aLast: number;
}

/** Lines a character range covers: `to` past the range's last line break, as in a Chunk. */
function lineSpan(text: Text, from: number, to: number): [number, number] {
  const first = text.lineAt(Math.min(from, text.length)).number;
  if (to <= from) return [first, first - 1];
  const end = Math.min(to, text.length + 1) - 1;
  // A range ending right after a line break stops on the line before it.
  const last = end < from ? first - 1 : text.lineAt(Math.min(end, text.length)).number;
  return [first, Math.max(first - 1, last)];
}

export function lineChange(c: Chunk, base: Text, doc: Text): LineChange | null {
  let [aFirst, aLast] = lineSpan(base, c.fromA, c.toA);
  let [first, last] = lineSpan(doc, c.fromB, c.toB);
  while (aFirst <= aLast && first <= last && base.line(aFirst).text === doc.line(first).text) aFirst++, first++;
  while (aFirst <= aLast && first <= last && base.line(aLast).text === doc.line(last).text) aLast--, last--;
  if (aFirst > aLast && first > last) return null;
  // The empty "line" after a final line break isn't a line: filling it adds lines, emptying it
  // deletes them (only the kind changes; Revert still swaps the ranges).
  const tailA = aFirst === aLast && aLast === base.lines && base.line(aLast).text === "";
  const tailB = first === last && last === doc.lines && doc.line(last).text === "";
  const kind: ChangeKind = aFirst > aLast || (tailA && first <= last) ? "added" : first > last || (tailB && aFirst <= aLast) ? "deleted" : "modified";
  return { kind, first, last, aFirst, aLast };
}

/** Line numbers of a change's gutter markers (a deletion's single marker). */
export function changeRows(ch: LineChange, doc: Text): [number, number] {
  if (ch.kind !== "deleted") return [ch.first, ch.last];
  const n = Math.min(Math.max(1, ch.first), doc.lines);
  return [n, n];
}

/** The document's changes against HEAD, in order (cached per state). */
const lineChanges = StateField.define<readonly LineChange[]>({
  create: (state) => computeLineChanges(state),
  update: (v, tr) => (tr.docChanged || tr.startState.field(gitDiff, false) !== tr.state.field(gitDiff, false) ? computeLineChanges(tr.state) : v),
});

function computeLineChanges(state: EditorState): LineChange[] {
  const d = state.field(gitDiff, false);
  if (!d?.base) return [];
  const out: LineChange[] = [];
  for (const c of d.chunks) {
    const ch = lineChange(c, d.base, state.doc);
    if (ch) out.push(ch);
  }
  return out;
}

export function changesOf(state: EditorState): readonly LineChange[] {
  return state.field(lineChanges, false) ?? [];
}

/** The change marked on a given line, if any. */
export function changeAtLine(state: EditorState, line: number): LineChange | null {
  for (const ch of changesOf(state)) {
    const [a, b] = changeRows(ch, state.doc);
    if (line >= a && line <= b) return ch;
    if (a > line) break;
  }
  return null;
}

class ChangeMarker extends GutterMarker {
  constructor(readonly kind: ChangeKind) {
    super();
  }
  eq(other: ChangeMarker) {
    return other.kind === this.kind;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = `cm-git-mark cm-git-${this.kind}`;
    return el;
  }
}

const MARKS = { added: new ChangeMarker("added"), modified: new ChangeMarker("modified"), deleted: new ChangeMarker("deleted") };

const gitMarkers = StateField.define({
  create: (state) => buildMarkers(state),
  update: (v, tr) => (tr.startState.field(lineChanges, false) !== tr.state.field(lineChanges, false) ? buildMarkers(tr.state) : v),
});

function buildMarkers(state: EditorState) {
  const b = new RangeSetBuilder<GutterMarker>();
  const doc = state.doc;
  for (const ch of changesOf(state)) {
    const [first, last] = changeRows(ch, doc);
    for (let n = first; n <= last; n++) b.add(doc.line(n).from, doc.line(n).from, MARKS[ch.kind]);
  }
  return b.finish();
}

/** HEAD's text of a change (its lines joined, no final line break). */
function oldText(ch: LineChange, base: Text): string {
  if (ch.aFirst > ch.aLast) return "";
  return base.sliceString(base.line(ch.aFirst).from, base.line(ch.aLast).to);
}

/** The edit that puts HEAD's lines of a change back. */
export function revertSpec(ch: LineChange, base: Text, doc: Text): { from: number; to: number; insert: string } {
  const old = oldText(ch, base);
  // Going by the ranges, not the kind (see lineChange about the line after a final line break).
  if (ch.aFirst <= ch.aLast && ch.first <= ch.last) return { from: doc.line(ch.first).from, to: doc.line(ch.last).to, insert: old };
  if (ch.first > ch.last) {
    if (ch.first <= doc.lines) return { from: doc.line(ch.first).from, to: doc.line(ch.first).from, insert: old + "\n" };
    return { from: doc.length, to: doc.length, insert: "\n" + old };
  }
  // Added lines go with one of their line breaks.
  if (ch.last < doc.lines) return { from: doc.line(ch.first).from, to: doc.line(ch.last + 1).from, insert: "" };
  if (ch.first > 1) return { from: doc.line(ch.first - 1).to, to: doc.line(ch.last).to, insert: "" };
  return { from: 0, to: doc.length, insert: "" };
}

/** Undo one change: put the HEAD text back. */
export function revertChange(view: EditorView, ch: LineChange) {
  const base = view.state.field(gitDiff, false)?.base;
  if (!base) return;
  view.dispatch({ changes: revertSpec(ch, base, view.state.doc), userEvent: "input.revert", scrollIntoView: true });
  view.dispatch({ effects: setPeek.of(null) });
}

// ---------- peek (click a marker) ----------

/** Show the HEAD text of the change at a line (null closes the peek). */
export const setPeek = StateEffect.define<number | null>();

const peekField = StateField.define<{ line: number } | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setPeek)) return e.value === null ? null : { line: e.value };
    if (v && tr.docChanged) return null;
    return v;
  },
  provide: (f) =>
    showTooltip.compute([f, lineChanges], (state): Tooltip | null => {
      const p = state.field(f);
      if (!p) return null;
      const ch = changeAtLine(state, p.line);
      if (!ch) return null;
      const [, last] = changeRows(ch, state.doc);
      return { pos: state.doc.line(last).to, above: false, create: (view) => ({ dom: peekDOM(view, ch) }) };
    }),
});

function peekDOM(view: EditorView, ch: LineChange): HTMLElement {
  const state = view.state;
  const base = state.field(gitDiff).base!;
  const all = changesOf(state);
  const index = all.indexOf(ch);
  const dom = document.createElement("div");
  dom.className = "cm-git-peek";
  const head = document.createElement("div");
  head.className = "cm-git-peek-head";
  const title = document.createElement("span");
  title.textContent = `${ch.kind === "added" ? "Added lines" : ch.kind === "deleted" ? "Deleted lines" : "Changed lines"} · change ${index + 1} of ${all.length} (since the last commit)`;
  head.append(title);
  const button = (label: string, tip: string, run: () => void) => {
    const b = document.createElement("button");
    b.className = "btn small";
    b.textContent = label;
    b.title = tip;
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = run;
    head.append(b);
    return b;
  };
  const go = (to: LineChange | undefined) => {
    if (!to) return;
    const line = changeRows(to, view.state.doc)[0];
    view.dispatch({ selection: { anchor: view.state.doc.line(line).from }, effects: [setPeek.of(line), EditorView.scrollIntoView(view.state.doc.line(line).from, { y: "center" })] });
    view.focus();
  };
  button("↑", "Previous change", () => go(all[index - 1])).disabled = index <= 0;
  button("↓", "Next change", () => go(all[index + 1])).disabled = index >= all.length - 1;
  button("Revert", "Put back the committed text of this change", () => revertChange(view, ch));
  button("✕", "Close (Escape)", () => {
    view.dispatch({ effects: setPeek.of(null) });
    view.focus();
  });
  dom.append(head);
  if (ch.kind !== "added") {
    const pre = document.createElement("pre");
    pre.className = "cm-git-peek-old";
    pre.textContent = oldText(ch, base);
    dom.append(pre);
  } else {
    const p = document.createElement("div");
    p.className = "cm-git-peek-note";
    p.textContent = "These lines are new; Revert removes them.";
    dom.append(p);
  }
  return dom;
}

// ---------- blame of the cursor line ----------

export const setBlame = StateEffect.define<GitBlame | null>();

/** Blame per line of the document as it was when asked; dropped on the next edit (lib/git.ts asks again). */
const blameField = StateField.define<GitBlame | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setBlame)) return e.value;
    return tr.docChanged ? null : v;
  },
});

export function relativeTime(unixSecs: number, now = Date.now()): string {
  const s = Math.max(0, Math.round(now / 1000 - unixSecs));
  const units: [number, string][] = [
    [31536000, "year"],
    [2592000, "month"],
    [604800, "week"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  for (const [n, name] of units) {
    const k = Math.floor(s / n);
    if (k >= 1) return `${k} ${name}${k === 1 ? "" : "s"} ago`;
  }
  return "just now";
}

class BlameWidget extends WidgetType {
  constructor(readonly text: string, readonly tip: string) {
    super();
  }
  eq(o: BlameWidget) {
    return o.text === this.text;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-git-blame";
    el.textContent = this.text;
    el.title = this.tip;
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

const blameDecorations = EditorView.decorations.compute(["selection", blameField], (state) => {
  const blame = state.field(blameField);
  if (!blame || state.selection.ranges.length > 1) return Decoration.none;
  const line = state.doc.lineAt(state.selection.main.head);
  const info = blame.commits[blame.lines[line.number - 1]];
  if (!info) return Decoration.none;
  const when = new Date(info.time * 1000);
  const text = info.uncommitted ? "You · not committed yet" : `${info.author}, ${relativeTime(info.time)} · ${info.summary}`;
  const tip = info.uncommitted ? "This line has changes that are not committed." : `${info.short} ${info.summary}\n${info.author} <${info.email}>\n${when.toLocaleString()}`;
  return Decoration.set([Decoration.widget({ widget: new BlameWidget(text, tip), side: 1 }).range(line.to)]);
});

// ---------- extension ----------

export function gitExtensions(): Extension {
  return [
    gitDiff,
    lineChanges,
    gitMarkers,
    peekField,
    blameField,
    blameDecorations,
    gutter({
      class: "cm-git-gutter",
      markers: (view) => view.state.field(gitMarkers),
      domEventHandlers: {
        mousedown(view, line) {
          const n = view.state.doc.lineAt(line.from).number;
          if (!changeAtLine(view.state, n)) return false;
          const open = view.state.field(peekField);
          view.dispatch({ effects: setPeek.of(open?.line === n ? null : n) });
          return true;
        },
      },
    }),
    EditorView.domEventHandlers({
      keydown(e, view) {
        if (e.key !== "Escape" || !view.state.field(peekField)) return false;
        view.dispatch({ effects: setPeek.of(null) });
        return true;
      },
    }),
  ];
}
