/**
 * The Edit › Lines and Code › Indentation commands: pure functions over an array of lines, and
 * `lineTransformSpec`, which works out which lines a command acts on and builds the transaction.
 */
import { EditorSelection, type EditorState, type SelectionRange, type TransactionSpec } from "@codemirror/state";

export type LineFn = (lines: string[]) => string[];

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export const sortAsc: LineFn = (l) => [...l].sort(collator.compare);
export const sortDesc: LineFn = (l) => [...l].sort(collator.compare).reverse();
export const reverseLines: LineFn = (l) => [...l].reverse();
export const dedupe: LineFn = (l) => {
  const seen = new Set<string>();
  return l.filter((x) => !seen.has(x) && !!seen.add(x));
};
export const removeBlank: LineFn = (l) => l.filter((x) => x.trim() !== "");
export const removeEmpty: LineFn = (l) => l.filter((x) => x !== "");
export const trimTrailing: LineFn = (l) => l.map((x) => x.replace(/[ \t]+$/, ""));
export const joinLines: LineFn = (l) => [l.map((x) => x.trim()).filter(Boolean).join(" ")];
export const numberLines: LineFn = (l) => {
  const w = String(l.length).length;
  return l.map((x, i) => String(i + 1).padStart(w, " ") + "  " + x);
};
/** Width in columns of a run of spaces and tabs at the start of a line (tabs go to the next stop). */
function indentWidth(ws: string, tabSize: number) {
  let col = 0;
  for (const c of ws) col = c === "\t" ? col + tabSize - (col % tabSize) : col + 1;
  return col;
}
/** Rewrite each line's leading spaces and tabs, keeping its width; the rest of the line is untouched. */
const reindent = (tabSize: number, make: (width: number) => string): LineFn => (l) =>
  l.map((x) => x.replace(/^[ \t]+/, (m) => make(indentWidth(m, tabSize))));
export const indentToSpaces = (tabSize: number) => reindent(tabSize, (w) => " ".repeat(w));
export const indentToTabs = (tabSize: number) => reindent(tabSize, (w) => "\t".repeat(Math.floor(w / tabSize)) + " ".repeat(w % tabSize));

/**
 * Transform to Title Case: the first letter of every word goes upper case; the rest of the word is
 * left alone, so acronyms stay ("HTML parser" -> "HTML Parser"). Letters are Unicode letters, and
 * an apostrophe inside a word does not start a new one ("don't" -> "Don't").
 */
export const titleCase = (text: string) => text.replace(/(^|[^\p{L}\p{N}']|((^|\P{L})'))\p{L}/gmu, (m) => m.toLocaleUpperCase());

/**
 * The transaction for a line command, or null when it changes nothing. With nothing selected it
 * acts on the whole document, except the empty line after a final line break (sorting would move
 * it to the top). Otherwise it acts on the lines each selection touches, leaving out a last line a
 * selection only reaches at its start; selections on the same or adjacent lines form one block
 * (a column selection is sorted as a whole), separate blocks are transformed one by one.
 */
export function lineTransformSpec(st: EditorState, fn: LineFn): TransactionSpec | null {
  const { doc, selection } = st;
  const whole = selection.ranges.every((r) => r.empty);
  const blocks: { from: number; to: number; main: boolean }[] = [];
  if (whole) {
    blocks.push({ from: 1, to: doc.lines > 1 && doc.line(doc.lines).length === 0 ? doc.lines - 1 : doc.lines, main: true });
  } else {
    const spans = selection.ranges.map((r, i) => {
      const from = doc.lineAt(r.from).number;
      const end = doc.lineAt(r.to);
      return { from, to: end.number > from && r.to === end.from ? end.number - 1 : end.number, main: i === selection.mainIndex };
    }).sort((a, b) => a.from - b.from);
    for (const b of spans) {
      const last = blocks[blocks.length - 1];
      if (last && b.from <= last.to + 1) {
        last.to = Math.max(last.to, b.to);
        last.main ||= b.main;
      } else blocks.push({ ...b });
    }
  }
  const changes: { from: number; to: number; insert: string }[] = [];
  const ranges: SelectionRange[] = [];
  let mainIndex = 0;
  let shift = 0;
  for (const b of blocks) {
    const from = doc.line(b.from).from;
    const to = doc.line(b.to).to;
    const text = st.sliceDoc(from, to);
    const out = fn(text.split("\n")).join("\n");
    if (out !== text) changes.push({ from, to, insert: out });
    if (b.main) mainIndex = ranges.length;
    ranges.push(EditorSelection.range(from + shift, from + shift + out.length));
    shift += out.length - text.length;
  }
  if (changes.length === 0) return null;
  return { changes, selection: whole ? undefined : EditorSelection.create(ranges, mainIndex), userEvent: "input.transform" };
}
