/**
 * The Edit › Lines and Code › Indentation commands: pure functions over an array of lines, and
 * `lineTransformSpec`, which works out which lines a command acts on and builds the transaction.
 */
import type { EditorState, TransactionSpec } from "@codemirror/state";

export type LineFn = (lines: string[]) => string[];

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export const sortAsc: LineFn = (l) => [...l].sort(collator.compare);
export const sortDesc: LineFn = (l) => [...l].sort(collator.compare).reverse();
export const reverseLines: LineFn = (l) => [...l].reverse();
export const dedupe: LineFn = (l) => l.filter((x, i) => l.indexOf(x) === i);
export const removeBlank: LineFn = (l) => l.filter((x) => x.trim() !== "");
export const removeEmpty: LineFn = (l) => l.filter((x) => x !== "");
export const trimTrailing: LineFn = (l) => l.map((x) => x.replace(/[ \t]+$/, ""));
export const joinLines: LineFn = (l) => [l.map((x) => x.trim()).filter(Boolean).join(" ")];
export const numberLines: LineFn = (l) => {
  const w = String(l.length).length;
  return l.map((x, i) => String(i + 1).padStart(w, " ") + "  " + x);
};
export const indentToSpaces = (tabSize: number): LineFn => (l) => l.map((x) => x.replace(/^\t+/, (m) => " ".repeat(m.length * tabSize)));
export const indentToTabs = (tabSize: number): LineFn => (l) =>
  l.map((x) => x.replace(/^( {2,})/, (m) => "\t".repeat(Math.floor(m.length / tabSize)) + " ".repeat(m.length % tabSize)));

/**
 * The transaction for a line command, or null when it changes nothing. With nothing selected it
 * acts on the whole document, except the empty line after a final line break (sorting would move
 * it to the top); otherwise on the lines the main selection touches, leaving out a last line the
 * selection only reaches at its start.
 */
export function lineTransformSpec(st: EditorState, fn: LineFn): TransactionSpec | null {
  const { doc } = st;
  const sel = st.selection.main;
  let fromLine: number, toLine: number;
  if (sel.empty) {
    fromLine = 1;
    toLine = doc.lines > 1 && doc.line(doc.lines).length === 0 ? doc.lines - 1 : doc.lines;
  } else {
    fromLine = doc.lineAt(sel.from).number;
    const end = doc.lineAt(sel.to);
    toLine = end.number > fromLine && sel.to === end.from ? end.number - 1 : end.number;
  }
  const from = doc.line(fromLine).from;
  const to = doc.line(toLine).to;
  const text = st.sliceDoc(from, to);
  const out = fn(text.split("\n")).join("\n");
  if (out === text) return null;
  return { changes: { from, to, insert: out }, selection: sel.empty ? undefined : { anchor: from, head: from + out.length }, userEvent: "input.transform" };
}
