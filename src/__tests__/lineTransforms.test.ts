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
