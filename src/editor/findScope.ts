/**
 * Find in Selection: the ranges the find bar is limited to. They live in the document's own
 * EditorState (one per document, see manager.ts), so they map through every edit, and are drawn
 * with a faint background (`.cm-findScope`). The find bar's SearchQuery gets a `test` that keeps
 * only matches inside one of the ranges (`inScope`), so the count, highlighting, Next / Previous,
 * Replace, Replace All, Preserve Case and Select All Matches all honour it.
 */
import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

export interface Span {
  from: number;
  to: number;
}

/** Set the scope (sorted, non-empty spans) or clear it with `null`. */
export const setFindScope = StateEffect.define<readonly Span[] | null>({
  map: (spans, changes) => spans?.map((s) => ({ from: changes.mapPos(s.from, -1), to: changes.mapPos(s.to, 1) })).filter((s) => s.to > s.from) ?? null,
});

// Inclusive on both sides: a replacement at the edge of a range stays inside it.
const mark = Decoration.mark({ class: "cm-findScope", inclusive: true });

export const findScopeField = StateField.define<DecorationSet | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setFindScope)) return e.value ? Decoration.set(e.value.map((s) => mark.range(s.from, s.to)), true) : null;
    return value && tr.docChanged ? value.map(tr.changes) : value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v ?? Decoration.none),
});

/**
 * The scope for the current selection: its non-empty ranges, or, when every range is a bare
 * cursor, the cursors' lines (empty lines skipped). `null` when that leaves nothing.
 */
export function scopeFromSelection(state: EditorState): Span[] | null {
  const ranges = state.selection.ranges;
  let spans: Span[] = ranges.filter((r) => !r.empty).map((r) => ({ from: r.from, to: r.to }));
  if (!spans.length) {
    spans = [];
    for (const r of ranges) {
      const line = state.doc.lineAt(r.head);
      if (line.to > line.from && !spans.some((s) => s.from === line.from)) spans.push({ from: line.from, to: line.to });
    }
  }
  spans.sort((a, b) => a.from - b.from);
  return spans.length ? spans : null;
}

/** The current scope's spans, or `null` when the document has none (empty when all its text was deleted). */
export function scopeSpans(state: EditorState): Span[] | null {
  const set = state.field(findScopeField, false);
  if (!set) return null;
  const out: Span[] = [];
  for (let it = set.iter(); it.value; it.next()) out.push({ from: it.from, to: it.to });
  return out;
}

/** Whether `from..to` lies inside one range of the scope; true when the document has no scope. */
export function inScope(state: EditorState, from: number, to: number): boolean {
  const set = state.field(findScopeField, false);
  if (!set) return true;
  let found = false;
  set.between(from, to, (a, b) => {
    if (a <= from && b >= to) {
      found = true;
      return false;
    }
  });
  return found;
}
