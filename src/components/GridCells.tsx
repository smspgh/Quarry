import { isNumeric, type Field } from "../lib/delimited";

/**
 * One row of the large-file CSV / TSV grid: fixed-width cells (`widths` in characters; longer
 * values end in an ellipsis and show in full on hover), numbers right-aligned. Cells overlapping
 * `hit` (a span of the line, e.g. the current search match) are marked.
 */
export function GridCells({ fields, widths, hit = null }: { fields: readonly Field[]; widths: readonly number[]; hit?: readonly [number, number] | null }) {
  return (
    <>
      {fields.map((f, i) => {
        // Width = the text plus 1ch padding each side plus the 1px border, so a value that fits isn't cut.
        const w = widths[i] ?? 3;
        const cut = f.text.length > w;
        const isHit = !!hit && f.start < hit[1] && f.end > hit[0];
        return (
          <span key={i} className={`big-cell ${isNumeric(f.text) ? "num" : ""} ${isHit ? "hit" : ""}`} style={{ width: `calc(${w + 2}ch + 1px)` }} title={cut ? f.text : undefined}>
            {f.text}
          </span>
        );
      })}
    </>
  );
}
