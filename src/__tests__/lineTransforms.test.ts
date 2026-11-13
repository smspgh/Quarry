import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import * as L from "../lib/lineTransforms";

/** Run a line command on `doc` with the given selection ([anchor, head] or a cursor). */
const run = (doc: string, fn: L.LineFn, sel: [number, number] | number = 0) => {
  const selection = typeof sel === "number" ? EditorSelection.single(sel) : EditorSelection.single(sel[0], sel[1]);
  const st = EditorState.create({ doc, selection });
  const spec = L.lineTransformSpec(st, fn);
  if (!spec) return { text: doc, changed: false, sel: null };
  const next = st.update(spec).state;
  const m = next.selection.main;
  return { text: next.doc.toString(), changed: true, sel: spec.selection ? next.sliceDoc(m.from, m.to) : null };
};

const multi = (doc: string, ranges: [number, number][], main: number) =>
  EditorState.create({
    doc,
    selection: EditorSelection.create(ranges.map(([a, h]) => EditorSelection.range(a, h)), main),
    extensions: EditorState.allowMultipleSelections.of(true),
  });

describe("line commands: which lines", () => {
  it("acts on the whole document when nothing is selected", () => {
    expect(run("c\na\nb", L.sortAsc, 2).text).toBe("a\nb\nc");
  });
  it("keeps a final line break at the end instead of sorting it to the top", () => {
    expect(run("c\na\nb\n", L.sortAsc).text).toBe("a\nb\nc\n");
    expect(run("b\na\n", L.numberLines).text).toBe("1  b\n2  a\n");
    expect(run("a\n\nb\n", L.removeEmpty).text).toBe("a\nb\n");
    expect(run("a\nb\n", L.joinLines).text).toBe("a b\n");
  });
  it("acts on the lines the selection touches and selects the result", () => {
    // "d", "c", "b", "a": from inside "c" to inside "b"
    const r = run("d\nc\nb\na", L.sortAsc, [3, 5]);
    expect(r.text).toBe("d\nb\nc\na");
    expect(r.sel).toBe("b\nc");
  });
  it("leaves out a last line the selection reaches only at its start", () => {
    // Lines "c" and "b" selected by dragging to the start of "a".
    const r = run("c\nb\na", L.sortAsc, [0, 4]);
    expect(r.text).toBe("b\nc\na");
    expect(r.sel).toBe("b\nc");
  });
  it("transforms the lines of every selection, each block on its own", () => {
    // Blocks "c","b" (lines 1-2) and "z","y" (lines 4-5); "m" in between is untouched.
    const st = multi("c\nb\nm\nz\ny", [[0, 3], [6, 9]], 1);
    const next = st.update(L.lineTransformSpec(st, L.sortAsc)!).state;
    expect(next.doc.toString()).toBe("b\nc\nm\ny\nz");
    expect(next.selection.ranges.map((r) => next.sliceDoc(r.from, r.to))).toEqual(["b\nc", "y\nz"]);
    expect(next.selection.mainIndex).toBe(1);
  });
  it("treats selections on adjacent lines (a column selection) as one block", () => {
    const st = multi("c1\nb2\na3", [[0, 1], [3, 4], [6, 7]], 2);
    const next = st.update(L.lineTransformSpec(st, L.sortAsc)!).state;
    expect(next.doc.toString()).toBe("a3\nb2\nc1");
    expect(next.selection.ranges.length).toBe(1);
  });
  it("reports no change when the text would stay the same", () => {
    expect(run("a\nb\nc", L.sortAsc).changed).toBe(false);
  });
});

describe("line commands: transforms", () => {
  it("sorts naturally, ignoring case", () => {
    expect(L.sortAsc(["file10", "File2", "file1"])).toEqual(["file1", "File2", "file10"]);
    expect(L.sortDesc(["a", "c", "b"])).toEqual(["c", "b", "a"]);
    expect(L.reverseLines(["c", "b", "a"])).toEqual(["a", "b", "c"]);
  });
  it("removes duplicates, keeping the first of each (case-sensitive)", () => {
    expect(L.dedupe(["a", "b", "a", "A", "b"])).toEqual(["a", "b", "A"]);
  });
  it("removes duplicates from a long list in linear time", () => {
    const many = Array.from({ length: 200_000 }, (_, i) => `line ${i % 150_000}`);
    const t = performance.now();
    expect(L.dedupe(many).length).toBe(150_000);
    expect(performance.now() - t).toBeLessThan(1000);
  });
  it("tells blank from empty lines", () => {
    expect(L.removeEmpty(["a", "", "   ", "b"])).toEqual(["a", "   ", "b"]);
    expect(L.removeBlank(["a", "", "   ", "b"])).toEqual(["a", "b"]);
  });
  it("trims trailing whitespace only", () => {
    expect(L.trimTrailing(["value  \t", "  lead"])).toEqual(["value", "  lead"]);
  });
  it("joins trimmed, non-empty lines with one space", () => {
    expect(L.joinLines(["  one", "", "two  ", "three"])).toEqual(["one two three"]);
  });
  it("numbers lines, padded to the widest number", () => {
    const out = L.numberLines(Array.from({ length: 12 }, (_, i) => `l${i}`));
    expect(out[0]).toBe(" 1  l0");
    expect(out[11]).toBe("12  l11");
  });
});
