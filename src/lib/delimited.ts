/**
 * CSV / TSV fields of one line, for the large-file grid. Each line is split on its own (as it is
 * drawn), so a quoted field that contains a line break shows its parts on separate rows.
 */

/** One field: its text (quotes removed, `""` unescaped) and its span `[start, end)` in the line. */
export interface Field {
  text: string;
  start: number;
  end: number;
}

/** Pure helper (testable): the fields of `line` separated by `sep` (`,` or a tab). */
export function splitDelimited(line: string, sep: string): Field[] {
  const out: Field[] = [];
  let i = 0;
  for (;;) {
    const start = i;
    let text: string;
    if (line[i] === '"' && sep === ",") {
      // Quoted: up to the closing quote; "" inside is one quote.
      let j = i + 1;
      let t = "";
      for (; j < line.length; j++) {
        if (line[j] === '"') {
          if (line[j + 1] === '"') {
            t += '"';
            j++;
          } else break;
        } else t += line[j];
      }
      // Anything between the closing quote and the separator is kept, as spreadsheets do.
      const next = line.indexOf(sep, j);
      const end = next < 0 ? line.length : next;
      text = t + line.slice(Math.min(j + 1, end), end);
      i = end;
    } else {
      const next = line.indexOf(sep, i);
      i = next < 0 ? line.length : next;
      text = line.slice(start, i);
    }
    out.push({ text, start, end: i });
    if (i >= line.length) return out;
    i += sep.length;
  }
}

/** A cell that reads as a number (right-aligned in the grid). */
export const isNumeric = (s: string) => /^\s*[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?([eE][-+]?\d+)?\s*$/.test(s) || /^\s*[-+]?\.\d+\s*$/.test(s);

/** Widest a column grows to (in characters); longer values are cut with an ellipsis. */
export const MAX_COL_CH = 40;

/**
 * Pure helper (testable): grow `widths` (characters per column) to fit `rows`, so columns only
 * widen as more rows are seen and the layout doesn't jump while scrolling.
 */
export function growWidths(widths: number[], rows: readonly Field[][]): number[] {
  const out = widths.slice();
  for (const fields of rows) {
    fields.forEach((f, i) => {
      const w = Math.min(MAX_COL_CH, Math.max(3, f.text.length));
      if (!(out[i] >= w)) out[i] = w;
    });
  }
  return out;
}
