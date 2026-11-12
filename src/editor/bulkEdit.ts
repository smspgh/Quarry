/**
 * Linear-time typing and deleting for selections with many ranges.
 *
 * CodeMirror's `replaceSelection` / `changeByRange` compose one change set per range, which is
 * quadratic: typing one character into a 20 000-line column block took 21 s, and 200 000 cursors
 * effectively hung the editor. Above BULK_MIN ranges these handlers build a single change set and
 * the new selection in one pass instead. Below it, CodeMirror's own commands run unchanged.
 */
import { EditorSelection, findClusterBreak, Prec, type ChangeSpec, type EditorState, type Extension, type SelectionRange } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { getSearchQuery, SearchCursor } from "@codemirror/search";

export const BULK_MIN = 500;

interface Span {
  from: number;
  to: number;
}

/**
 * Replace every span (sorted, non-overlapping) with `insert`. Returns the change list and where each
 * cursor ends up (just after its inserted text) in the new document.
 */
export function bulkReplace(spans: readonly Span[], insert: string): { changes: { from: number; to: number; insert: string }[]; cursors: number[] } {
  const changes: { from: number; to: number; insert: string }[] = [];
  const cursors: number[] = [];
  let shift = 0;
  for (const s of spans) {
    changes.push({ from: s.from, to: s.to, insert });
    cursors.push(s.from + shift + insert.length);
    shift += insert.length - (s.to - s.from);
  }
  return { changes, cursors };
}

/** Spans a Backspace (`forward=false`) or Delete removes for each range: the selection, or one grapheme. */
export function deletionSpans(state: EditorState, ranges: readonly SelectionRange[], forward: boolean): Span[] {
  const out: Span[] = [];
  let lastEnd = -1;
  for (const r of ranges) {
    let from = r.from;
    let to = r.to;
    if (r.empty) {
      // CodeMirror documents always use a one-character line break internally.
      const line = state.doc.lineAt(r.head);
      if (forward) to = r.head < line.to ? line.from + findClusterBreak(line.text, r.head - line.from, true) : Math.min(state.doc.length, r.head + 1);
      else from = r.head > line.from ? line.from + findClusterBreak(line.text, r.head - line.from, false) : Math.max(0, r.head - 1);
    }
    // Neighbouring cursors must not delete the same character twice.
    from = Math.max(from, lastEnd);
    to = Math.max(to, from);
    out.push({ from, to });
    lastEnd = to;
  }
  return out;
}

function apply(view: EditorView, spans: Span[], insert: string, userEvent: string): boolean {
  const { changes, cursors } = bulkReplace(spans, insert);
  const sel = view.state.selection;
  view.dispatch({
    changes: changes as ChangeSpec,
    selection: EditorSelection.create(cursors.map((c) => EditorSelection.cursor(c)), sel.mainIndex),
    userEvent,
    scrollIntoView: true,
  });
  return true;
}

const many = (view: EditorView) => view.state.selection.ranges.length >= BULK_MIN && !view.state.readOnly;

/** Fast paths for typing and Backspace/Delete with BULK_MIN or more ranges. */
export function bulkEditing(): Extension {
  return [
    // Low precedence: other input handlers (the macro recorder) must see the text first.
    Prec.low(
      EditorView.inputHandler.of((view, _from, _to, text) => {
        if (!many(view) || view.composing) return false;
        return apply(view, view.state.selection.ranges.slice(), text, "input.type");
      }),
    ),
    Prec.high(
      keymap.of([
        { key: "Backspace", run: (view) => many(view) && apply(view, deletionSpans(view.state, view.state.selection.ranges, false), "", "delete.backward") },
        { key: "Delete", run: (view) => many(view) && apply(view, deletionSpans(view.state, view.state.selection.ranges, true), "", "delete.forward") },
      ]),
    ),
  ];
}

/** Most ranges Select All Occurrences creates (CodeMirror's own command gives up silently past 1 000). */
export const MAX_OCCURRENCES = 200_000;

/**
 * Ranges of every occurrence of the main selection's text (or of the word at the cursor when the
 * selection is empty), case-sensitive like CodeMirror's command, without its 1 000-match cap.
 */
export function occurrenceSelection(state: EditorState, limit = MAX_OCCURRENCES): { selection: EditorSelection; capped: boolean } | null {
  let { from, to } = state.selection.main;
  if (from === to) {
    const word = state.wordAt(from);
    if (!word) return null;
    ({ from, to } = word);
  }
  const query = state.sliceDoc(from, to);
  const ranges: SelectionRange[] = [];
  let main = 0;
  let capped = false;
  const cursor = new SearchCursor(state.doc, query);
  while (!cursor.next().done) {
    if (ranges.length >= limit) {
      capped = true;
      break;
    }
    if (cursor.value.from === from) main = ranges.length;
    ranges.push(EditorSelection.range(cursor.value.from, cursor.value.to));
  }
  if (!ranges.length) return null;
  return { selection: EditorSelection.create(ranges, main), capped };
}

/**
 * Every match of the find bar's current query as a selection (CodeMirror's selectMatches gives up
 * past 1 000 matches). Returns null when there is no valid query or no match.
 */
export function findMatchSelection(state: EditorState, limit = MAX_OCCURRENCES): { selection: EditorSelection; capped: boolean } | null {
  const query = getSearchQuery(state);
  if (!query.valid) return null;
  const ranges: SelectionRange[] = [];
  const head = state.selection.main.head;
  let main = 0;
  let capped = false;
  const it = query.getCursor(state);
  for (let r = it.next(); !r.done; r = it.next()) {
    if (ranges.length >= limit) {
      capped = true;
      break;
    }
    if (r.value.from <= head) main = ranges.length;
    ranges.push(EditorSelection.range(r.value.from, r.value.to));
  }
  if (!ranges.length) return null;
  return { selection: EditorSelection.create(ranges, main), capped };
}

/** Select every find match; toasts through `warn` when the limit was hit. */
export function selectAllFindMatches(view: EditorView, warn?: (msg: string) => void): boolean {
  const r = findMatchSelection(view.state);
  if (!r) return false;
  view.dispatch({ selection: r.selection, userEvent: "select.search.matches", scrollIntoView: true });
  if (r.capped) warn?.(`Selected the first ${MAX_OCCURRENCES.toLocaleString()} matches.`);
  return true;
}
