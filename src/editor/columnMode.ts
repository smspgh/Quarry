/**
 * Column / block selection mode.
 *
 * When enabled, every mouse drag becomes a rectangular selection and
 * Shift+Arrow keys extend the block vertically/horizontally. CodeMirror's native
 * multi-range selection then makes typing, deleting and pasting apply to every row.
 */
import { EditorSelection, StateEffect, StateField, countColumn, findColumn, type Extension, type SelectionRange } from "@codemirror/state";
import { EditorView, keymap, rectangularSelection, type Command } from "@codemirror/view";

export const columnModeEnabled = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setColumnMode)) value = e.value;
    return value;
  },
});

export const setColumnMode = StateEffect.define<boolean>();

interface Block {
  anchorLine: number;
  anchorCol: number;
  headLine: number;
  headCol: number;
}

function colOf(view: EditorView, pos: number): { line: number; col: number } {
  const line = view.state.doc.lineAt(pos);
  return { line: line.number, col: countColumn(line.text, view.state.tabSize, pos - line.from) };
}

/** Derive the current block from the selection (anchor = first range, head = main range). */
function currentBlock(view: EditorView): Block {
  const sel = view.state.selection;
  const ranges = sel.ranges;
  const main = sel.main;
  const first = ranges[0];
  const last = ranges[ranges.length - 1];
  const anchorRange = main === last ? first : last;
  const a = colOf(view, anchorRange.anchor);
  const h = colOf(view, main.head);
  if (ranges.length === 1) {
    return { anchorLine: a.line, anchorCol: a.col, headLine: h.line, headCol: h.col };
  }
  return { anchorLine: a.line, anchorCol: a.col, headLine: h.line, headCol: h.col };
}

export function blockSelection(view: EditorView, b: Block): EditorSelection {
  const { doc, tabSize } = view.state;
  const top = Math.min(b.anchorLine, b.headLine);
  const bottom = Math.max(b.anchorLine, b.headLine);
  const ranges: SelectionRange[] = [];
  const left = Math.min(b.anchorCol, b.headCol);
  for (let ln = top; ln <= bottom; ln++) {
    const line = doc.line(ln);
    // Rows too short to reach the block's left edge get an empty cursor at their end instead of
    // a clamped range that would grab characters left of the column.
    if (countColumn(line.text, tabSize, line.length) <= left) {
      ranges.push(EditorSelection.range(line.to, line.to, undefined, b.headCol));
      continue;
    }
    const from = line.from + findColumn(line.text, b.anchorCol, tabSize);
    const to = line.from + findColumn(line.text, b.headCol, tabSize);
    ranges.push(EditorSelection.range(from, to, undefined, b.headCol));
  }
  const mainIdx = b.headLine >= b.anchorLine ? ranges.length - 1 : 0;
  return EditorSelection.create(ranges, mainIdx);
}

function extend(dLine: number, dCol: number): Command {
  return (view) => {
    const b = currentBlock(view);
    const lines = view.state.doc.lines;
    const headLine = Math.max(1, Math.min(lines, b.headLine + dLine));
    const headCol = Math.max(0, b.headCol + dCol);
    const sel = blockSelection(view, { ...b, headLine, headCol });
    view.dispatch({ selection: sel, scrollIntoView: true, userEvent: "select" });
    return true;
  };
}

const extendHome: Command = (view) => {
  const b = currentBlock(view);
  view.dispatch({ selection: blockSelection(view, { ...b, headCol: 0 }), scrollIntoView: true });
  return true;
};
const extendEnd: Command = (view) => {
  const b = currentBlock(view);
  const { doc, tabSize } = view.state;
  let max = 0;
  for (let ln = Math.min(b.anchorLine, b.headLine); ln <= Math.max(b.anchorLine, b.headLine); ln++) {
    max = Math.max(max, countColumn(doc.line(ln).text, tabSize, doc.line(ln).length));
  }
  view.dispatch({ selection: blockSelection(view, { ...b, headCol: max }), scrollIntoView: true });
  return true;
};

/** Collapse a block selection into cursors (one per row) at the head column. */
export const blockToCursors: Command = (view) => {
  const sel = view.state.selection;
  if (sel.ranges.length < 2 && sel.main.empty) return false;
  view.dispatch({
    selection: EditorSelection.create(
      sel.ranges.map((r) => EditorSelection.cursor(r.head)),
      sel.mainIndex,
    ),
  });
  return true;
};

const columnKeymap = keymap.of([
  { key: "Shift-ArrowDown", run: extend(1, 0) },
  { key: "Shift-ArrowUp", run: extend(-1, 0) },
  { key: "Shift-ArrowLeft", run: extend(0, -1) },
  { key: "Shift-ArrowRight", run: extend(0, 1) },
  { key: "Shift-Home", run: extendHome },
  { key: "Shift-End", run: extendEnd },
  { key: "Shift-PageDown", run: extend(20, 0) },
  { key: "Shift-PageUp", run: extend(-20, 0) },
]);

/** Extensions that are active only while column mode is on. */
export function columnModeExtensions(on: boolean): Extension {
  if (!on) return [rectangularSelection()];
  return [
    rectangularSelection({ eventFilter: () => true }),
    columnKeymap,
    EditorView.editorAttributes.of({ class: "column-mode" }),
  ];
}

/** Always-available block commands. */
export const blockCommands = {
  /** Alt+Shift+Down style: add a cursor on the line below at the same column. */
  addCursorBelow: extend(1, 0),
  addCursorAbove: extend(-1, 0),
  blockToCursors,
};
