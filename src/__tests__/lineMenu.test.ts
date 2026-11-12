import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { codeFolding, foldedRanges } from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import { clipboardText, cutSpec, foldLineSpec, foldTargetAt, foldTreeSpec, pasteSpec } from "../editor/lineMenu";

const JSON_DOC = ['{', '  "a": {', '    "b": 1', '  },', '  "c": [1, 2],', '  "d": 3', '}'].join("\n");
const jsonState = () => EditorState.create({ doc: JSON_DOC, extensions: [json(), codeFolding()] });

describe("fold target of a right-clicked line", () => {
  it("offers lines that start a foldable region, and only those", () => {
    const st = jsonState();
    expect(foldTargetAt(st, 1)?.foldable).not.toBeNull();
    expect(foldTargetAt(st, 2)?.foldable).not.toBeNull();
    expect(foldTargetAt(st, 3)).toBeNull(); // "b": 1
    expect(foldTargetAt(st, 6)).toBeNull(); // "d": 3
    expect(foldTargetAt(st, 99)).toBeNull();
  });

  it("collapses the clicked line's region, then offers to expand it", () => {
    let st = jsonState();
    st = st.update(foldLineSpec(st, 2, true)!).state;
    const t = foldTargetAt(st, 2);
    expect(t?.folded).not.toBeNull();
    expect(t?.foldable).toBeNull();
    expect(foldLineSpec(st, 2, true)).toBeNull();
    st = st.update(foldLineSpec(st, 2, false)!).state;
    expect(foldTargetAt(st, 2)?.folded).toBeNull();
  });

  it("does nothing for a line with no region", () => {
    expect(foldLineSpec(jsonState(), 3, true)).toBeNull();
    expect(foldTreeSpec(jsonState(), 3, true)).toBeNull();
  });
});

describe("Collapse All / Expand All from a line", () => {
  // 1 {  2 "a": {  3 "b": {  4 "c": 1  5 },  6 "d": [  7 2  8 ]  9 },  10 "e": {  11 "f": 1  12 }  13 }
  const DEEP = ['{', ' "a": {', '  "b": {', '   "c": 1', '  },', '  "d": [', '   2', '  ]', ' },', ' "e": {', '  "f": 1', ' }', '}'].join("\n");
  const deep = () => EditorState.create({ doc: DEEP, extensions: [json(), codeFolding()] });
  const foldedLines = (st: EditorState) => {
    const lines: number[] = [];
    foldedRanges(st).between(0, st.doc.length, (from) => void lines.push(st.doc.lineAt(from).number));
    return lines;
  };

  it("folds the line's region and every region inside it, and nothing else", () => {
    const st = deep();
    const after = st.update(foldTreeSpec(st, 2, true)!).state;
    expect(foldedLines(after)).toEqual([2, 3, 6]);
  });

  it("keeps the children folded when the region alone is expanded", () => {
    let st = deep();
    st = st.update(foldTreeSpec(st, 2, true)!).state;
    st = st.update(foldLineSpec(st, 2, false)!).state;
    expect(foldedLines(st)).toEqual([3, 6]);
  });

  it("expands the region and everything inside it, leaving other folds alone", () => {
    let st = deep();
    st = st.update(foldTreeSpec(st, 2, true)!).state;
    st = st.update(foldLineSpec(st, 10, true)!).state;
    st = st.update(foldTreeSpec(st, 2, false)!).state;
    expect(foldedLines(st)).toEqual([10]);
  });
});

describe("clipboard items", () => {
  const at = (doc: string, ...ranges: [number, number][]) =>
    EditorState.create({ doc, selection: EditorSelection.create(ranges.map(([a, b]) => EditorSelection.range(a, b))), extensions: EditorState.allowMultipleSelections.of(true) });

  it("copies the selection, or the whole line of an empty one", () => {
    expect(clipboardText(at("hello world", [0, 5]))).toEqual({ text: "hello", lineWise: false });
    expect(clipboardText(at("one\ntwo", [5, 5]))).toEqual({ text: "two\n", lineWise: true });
  });

  it("cuts the selection, or the whole line", () => {
    const a = at("hello world", [0, 6]);
    expect(a.update(cutSpec(a)).state.doc.toString()).toBe("world");
    const b = at("one\ntwo\nthree", [5, 5]);
    expect(b.update(cutSpec(b)).state.doc.toString()).toBe("one\nthree");
  });

  it("pastes one line per cursor when the counts match", () => {
    const st = at("a\nb", [1, 1], [3, 3]);
    expect(st.update(pasteSpec(st, "X\nY")).state.doc.toString()).toBe("aX\nbY");
    const one = at("ab", [1, 1]);
    expect(one.update(pasteSpec(one, "1\r\n2")).state.doc.toString()).toBe("a1\n2b");
  });
});
