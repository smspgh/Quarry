import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState, type SelectionRange } from "@codemirror/state";
import { blockToEdge, cursorsOfBlock, extendBlock } from "../editor/columnMode";
import { rangesInWindow } from "../editor/viewportSelection";

const state = (doc: string, selection: EditorSelection, tabSize = 4) =>
  EditorState.create({ doc, selection, extensions: [EditorState.allowMultipleSelections.of(true), EditorState.tabSize.of(tabSize)] });

/** Each range as [line, fromColumn, toColumn] (character offsets within the line). */
const rows = (st: EditorState, sel: EditorSelection) =>
  sel.ranges.map((r: SelectionRange) => {
    const line = st.doc.lineAt(r.from);
    return [line.number, r.from - line.from, r.to - line.from];
  });

/** Apply a selection and return the new state, so the next step starts from it. */
const step = (st: EditorState, sel: EditorSelection) => st.update({ selection: sel }).state;

describe("add cursor above / below", () => {
  it("adds a cursor on the next lines at the same column", () => {
    let st = state("0123456789\n0123456789\n0123456789", EditorSelection.single(5));
    st = step(st, extendBlock(st, 1, 0));
    st = step(st, extendBlock(st, 1, 0));
    expect(rows(st, st.selection)).toEqual([[1, 5, 5], [2, 5, 5], [3, 5, 5]]);
    expect(st.selection.mainIndex).toBe(2);
  });
  it("gives a line too short a cursor at its end", () => {
    const st = state("abcdefghij\nab", EditorSelection.single(8));
    expect(rows(st, extendBlock(st, 1, 0))).toEqual([[1, 8, 8], [2, 2, 2]]);
  });
  it("counts a tab as its visual width", () => {
    const st = state("abcdefgh\n\txyz", EditorSelection.single(4));
    expect(rows(st, extendBlock(st, 1, 0))).toEqual([[1, 4, 4], [2, 1, 1]]);
  });
  it("goes up as well, and stops at the first and last line", () => {
    let st = state("aaaa\nbbbb", EditorSelection.single(7));
    st = step(st, extendBlock(st, -1, 0));
    expect(rows(st, st.selection)).toEqual([[1, 2, 2], [2, 2, 2]]);
    expect(st.selection.mainIndex).toBe(0);
    expect(rows(st, extendBlock(st, -1, 0))).toEqual([[1, 2, 2], [2, 2, 2]]);
  });
});

describe("column mode block", () => {
  it("Shift+Down and Shift+Right grow a rectangle", () => {
    let st = state("abcd\nefgh\nijkl\nmnop", EditorSelection.single(0));
    for (let i = 0; i < 3; i++) st = step(st, extendBlock(st, 1, 0));
    for (let i = 0; i < 2; i++) st = step(st, extendBlock(st, 0, 1));
    expect(rows(st, st.selection)).toEqual([[1, 0, 2], [2, 0, 2], [3, 0, 2], [4, 0, 2]]);
  });
  it("Shift+Page Down moves 20 rows, clamped to the document", () => {
    const st = state(Array.from({ length: 100 }, () => "x").join("\n"), EditorSelection.single(0));
    const sel = extendBlock(st, 20, 0);
    expect(sel.ranges.length).toBe(21);
    const short = state("a\nb\nc", EditorSelection.single(0));
    expect(extendBlock(short, 20, 0).ranges.length).toBe(3);
  });
  it("Shift+End reaches the longest row; shorter rows are selected to their ends", () => {
    let st = state("12345\n123456789012\n12345678", EditorSelection.single(0));
    st = step(st, extendBlock(st, 2, 0));
    expect(rows(st, blockToEdge(st, true))).toEqual([[1, 0, 5], [2, 0, 12], [3, 0, 8]]);
    expect(rows(st, blockToEdge(st, false))).toEqual([[1, 0, 0], [2, 0, 0], [3, 0, 0]]);
  });
  it("Split Block Selection into Cursors leaves one cursor per row at the head", () => {
    let st = state("abcd\nefgh\nijkl", EditorSelection.single(1));
    st = step(st, extendBlock(st, 2, 2));
    const cursors = cursorsOfBlock(st)!;
    expect(rows(st, cursors)).toEqual([[1, 3, 3], [2, 3, 3], [3, 3, 3]]);
    expect(cursorsOfBlock(state("abc", EditorSelection.single(1)))).toBeNull();
  });
});

describe("rangesInWindow", () => {
  const ranges = [{ from: 0, to: 2 }, { from: 10, to: 12 }, { from: 20, to: 20 }, { from: 30, to: 35 }];
  it("returns the ranges touching the window", () => {
    expect(rangesInWindow(ranges, 11, 25)).toEqual([1, 3]);
    expect(rangesInWindow(ranges, 0, 100)).toEqual([0, 4]);
  });
  it("includes ranges that only touch an edge", () => {
    expect(rangesInWindow(ranges, 12, 20)).toEqual([1, 3]);
  });
  it("is empty for a window between ranges or past the end", () => {
    expect(rangesInWindow(ranges, 3, 9)).toEqual([1, 1]);
    expect(rangesInWindow(ranges, 40, 50)).toEqual([4, 4]);
    expect(rangesInWindow([], 0, 10)).toEqual([0, 0]);
  });
});
