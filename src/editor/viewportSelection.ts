/**
 * Selection drawing that scales to huge multi-cursor selections.
 *
 * CodeMirror's `drawSelection()` measures every selection range on every update, visible or not.
 * Column mode over 200 000 lines (or Select All Occurrences with 100 000 hits) made each keystroke
 * take tens of seconds. These layers measure only ranges that intersect the rendered viewport; the
 * rest of `drawSelection()` (config, native-selection hiding) is kept as is.
 */
import type { Extension, SelectionRange } from "@codemirror/state";
import { EditorSelection } from "@codemirror/state";
import { drawSelection, getDrawSelectionConfig, layer, RectangleMarker, type EditorView, type LayerMarker } from "@codemirror/view";

/** Indices [lo, hi) of the sorted `ranges` that touch [from, to]. */
export function rangesInWindow(ranges: readonly { from: number; to: number }[], from: number, to: number): [number, number] {
  let lo = 0;
  let hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ranges[mid].to < from) lo = mid + 1;
    else hi = mid;
  }
  let end = lo;
  while (end < ranges.length && ranges[end].from <= to) end++;
  return [lo, end];
}

function visible(view: EditorView): readonly SelectionRange[] {
  const { ranges } = view.state.selection;
  const [a, b] = rangesInWindow(ranges, view.viewport.from, view.viewport.to);
  return a === 0 && b === ranges.length ? ranges : ranges.slice(a, b);
}

const cursorLayer = layer({
  above: true,
  markers(view) {
    const { state } = view;
    const conf = getDrawSelectionConfig(state);
    const main = state.selection.main;
    const out: LayerMarker[] = [];
    for (const r of visible(view)) {
      if (!r.empty && !conf.drawRangeCursor) continue;
      const cls = r === main ? "cm-cursor cm-cursor-primary" : "cm-cursor cm-cursor-secondary";
      const cursor = r.empty ? r : EditorSelection.cursor(r.head, r.assoc);
      for (const piece of RectangleMarker.forRange(view, cls, cursor)) out.push(piece);
    }
    return out;
  },
  update(update, dom) {
    if (update.transactions.some((tr) => tr.selection)) dom.style.animationName = dom.style.animationName === "cm-blink" ? "cm-blink2" : "cm-blink";
    // Unlike the stock layer, scrolling can reveal cursors that were not drawn yet.
    return update.docChanged || update.selectionSet || update.viewportChanged;
  },
  mount(dom, view) {
    const rate = getDrawSelectionConfig(view.state).cursorBlinkRate;
    dom.style.animationDuration = `${rate}ms`;
    if (!rate) dom.style.animationName = "none";
  },
  class: "cm-cursorLayer",
});

const selectionLayer = layer({
  above: false,
  markers(view) {
    const out: LayerMarker[] = [];
    for (const r of visible(view)) {
      if (r.empty) continue;
      for (const m of RectangleMarker.forRange(view, "cm-selectionBackground", r)) out.push(m);
    }
    return out;
  },
  update(update) {
    return update.docChanged || update.selectionSet || update.viewportChanged;
  },
  class: "cm-selectionLayer",
});

/** `drawSelection()` with viewport-limited cursor and selection layers. */
export function viewportDrawSelection(): Extension {
  const stock = drawSelection();
  // Current shape: [config, cursorLayer, selectionLayer, hideNativeSelection, nativeSelectionHidden].
  if (!Array.isArray(stock) || stock.length !== 5) return stock;
  return [stock[0], cursorLayer, selectionLayer, stock[3], stock[4]];
}
