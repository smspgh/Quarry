/**
 * What the editor's right-click menu (components/EditorMenu.tsx) acts on: folding the clicked
 * line, and Cut / Copy / Paste done the way CodeMirror's own clipboard handling does them (an
 * empty selection copies or cuts its whole line).
 */
import { foldable, foldedRanges, foldEffect, unfoldEffect } from "@codemirror/language";
import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";

export interface FoldTarget {
  /** 1-based line. */
  line: number;
  /** The region the line starts, when it can be folded. */
  foldable: { from: number; to: number } | null;
  /** The folded region on the line, when it is folded. */
  folded: { from: number; to: number } | null;
}

/** The fold state of a line, or null when it neither starts a foldable region nor holds a fold. */
export function foldTargetAt(state: EditorState, lineNumber: number): FoldTarget | null {
  if (lineNumber < 1 || lineNumber > state.doc.lines) return null;
  const line = state.doc.line(lineNumber);
  let folded: { from: number; to: number } | null = null;
  foldedRanges(state).between(line.from, line.to, (from, to) => {
    if (!folded && from >= line.from && from <= line.to) folded = { from, to };
  });
  const range = folded ? null : foldable(state, line.from, line.to);
  if (!folded && !range) return null;
  return { line: lineNumber, foldable: range, folded };
}

/** Fold (or unfold) the region of a line; null when there is nothing to do. */
export function foldLineSpec(state: EditorState, lineNumber: number, fold: boolean): TransactionSpec | null {
  const t = foldTargetAt(state, lineNumber);
  if (fold && t?.foldable) return { effects: foldEffect.of(t.foldable) };
  if (!fold && t?.folded) return { effects: unfoldEffect.of(t.folded) };
  return null;
}

/**
 * Collapse All / Expand All from the menu: the line's region and every region nested in it, so a
 * key three levels deep folds with all its children while its siblings and parents stay as they are.
 * Null when there is nothing to do.
 */
export function foldTreeSpec(state: EditorState, lineNumber: number, fold: boolean): TransactionSpec | null {
  const t = foldTargetAt(state, lineNumber);
  const region = t?.folded ?? t?.foldable;
  if (!region) return null;
  const start = state.doc.line(lineNumber).from;
  const effects = [];
  if (fold) {
    const last = state.doc.lineAt(region.to).number;
    for (let n = lineNumber; n <= last; n++) {
      const line = state.doc.line(n);
      const range = foldable(state, line.from, line.to);
      if (range && range.to <= region.to) effects.push(foldEffect.of(range));
    }
  } else {
    foldedRanges(state).between(start, region.to, (from, to) => {
      if (from >= start && to <= region.to) effects.push(unfoldEffect.of({ from, to }));
    });
  }
  return effects.length ? { effects } : null;
}

/** Text Copy / Cut take: the selections, or the lines of empty ones (with their line breaks). */
export function clipboardText(state: EditorState): { text: string; lineWise: boolean } {
  const ranges = state.selection.ranges;
  if (ranges.some((r) => !r.empty)) {
    return { text: ranges.filter((r) => !r.empty).map((r) => state.sliceDoc(r.from, r.to)).join(state.lineBreak), lineWise: false };
  }
  const lines: string[] = [];
  let last = -1;
  for (const r of ranges) {
    const line = state.doc.lineAt(r.head);
    if (line.number === last) continue;
    last = line.number;
    lines.push(line.text + state.lineBreak);
  }
  return { text: lines.join(""), lineWise: true };
}

/** The deletion Cut makes after copying `clipboardText`. */
export function cutSpec(state: EditorState): TransactionSpec {
  const { lineWise } = clipboardText(state);
  if (!lineWise) return { ...state.replaceSelection(""), userEvent: "delete.cut", scrollIntoView: true };
  const seen = new Set<number>();
  const changes = [];
  for (const r of state.selection.ranges) {
    const line = state.doc.lineAt(r.head);
    if (seen.has(line.number)) continue;
    seen.add(line.number);
    changes.push({ from: line.from, to: Math.min(state.doc.length, line.to + 1) });
  }
  return { changes, userEvent: "delete.cut", scrollIntoView: true };
}

/** Insert clipboard text at every selection (each cursor gets its own line when the counts match, as CodeMirror's paste does). */
export function pasteSpec(state: EditorState, text: string): TransactionSpec {
  const parts = text.split(/\r\n?|\n/);
  const ranges = state.selection.ranges;
  if (ranges.length > 1 && parts.length === ranges.length) {
    let i = 0;
    return {
      ...state.changeByRange((r) => {
        const insert = parts[i++];
        return { changes: { from: r.from, to: r.to, insert }, range: EditorSelection.cursor(r.from + insert.length) };
      }),
      userEvent: "input.paste",
      scrollIntoView: true,
    };
  }
  return { ...state.replaceSelection(state.toText(text)), userEvent: "input.paste", scrollIntoView: true };
}
