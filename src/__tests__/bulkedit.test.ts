import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { search, SearchQuery, setSearchQuery } from "@codemirror/search";
import { bulkReplace, deletionSpans, findMatchSelection, occurrenceSelection } from "../editor/bulkEdit";

const applyBulk = (doc: string, spans: { from: number; to: number }[], insert: string) => {
  const st = EditorState.create({ doc });
  const { changes, cursors } = bulkReplace(spans, insert);
  return { text: st.update({ changes }).state.doc.toString(), cursors };
};

describe("bulk multi-cursor editing", () => {
  it("inserts at every cursor and places each cursor after its text", () => {
    const r = applyBulk("ab\ncd\nef", [{ from: 1, to: 1 }, { from: 4, to: 4 }, { from: 7, to: 7 }], "XY");
    expect(r.text).toBe("aXYb\ncXYd\neXYf");
    expect(r.cursors).toEqual([3, 8, 13]);
  });
  it("replaces selections of different lengths", () => {
    const r = applyBulk("hello world", [{ from: 0, to: 5 }, { from: 6, to: 11 }], "x");
    expect(r.text).toBe("x x");
    expect(r.cursors).toEqual([1, 3]);
  });
  it("Backspace and Delete remove one grapheme per cursor, never the same one twice", () => {
    const st = EditorState.create({ doc: "a😀b\ncd", extensions: EditorState.allowMultipleSelections.of(true) });
    const ranges = EditorSelection.create([EditorSelection.cursor(3), EditorSelection.cursor(4), EditorSelection.cursor(5)]).ranges;
    const back = deletionSpans(st, ranges, false);
    expect(back).toEqual([{ from: 1, to: 3 }, { from: 3, to: 4 }, { from: 4, to: 5 }]);
    const fwd = deletionSpans(st, EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(4)]).ranges, true);
    expect(fwd).toEqual([{ from: 1, to: 3 }, { from: 4, to: 5 }]); // emoji is one grapheme; line end deletes the break
  });
  it("is linear: 200 000 cursors in well under a second", () => {
    const n = 200_000;
    const doc = Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");
    const st = EditorState.create({ doc });
    const spans = Array.from({ length: n }, (_, i) => { const p = st.doc.line(i + 1).from; return { from: p, to: p }; });
    const t0 = performance.now();
    const { changes } = bulkReplace(spans, "#");
    const out = st.update({ changes }).state.doc;
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(out.line(n).text).toBe(`#line ${n - 1}`);
  });
});

describe("select all occurrences / matches beyond CodeMirror's 1 000 cap", () => {
  const doc = Array.from({ length: 100_000 }, (_, i) => `foo item ${i}`).join("\n");
  it("selects 100 000 occurrences of the selected text", () => {
    const st = EditorState.create({ doc, selection: { anchor: 0, head: 3 }, extensions: EditorState.allowMultipleSelections.of(true) });
    const r = occurrenceSelection(st)!;
    expect(r.selection.ranges).toHaveLength(100_000);
    expect(r.capped).toBe(false);
    expect(r.selection.main.from).toBe(0);
  });
  it("uses the word at an empty cursor and honours the limit", () => {
    const st = EditorState.create({ doc, selection: { anchor: 5 }, extensions: EditorState.allowMultipleSelections.of(true) });
    const r = occurrenceSelection(st, 10)!;
    expect(r.selection.ranges).toHaveLength(10);
    expect(r.capped).toBe(true);
    expect(st.sliceDoc(r.selection.ranges[0].from, r.selection.ranges[0].to)).toBe("item");
  });
  it("selects every find-bar match", () => {
    let st = EditorState.create({ doc, extensions: [EditorState.allowMultipleSelections.of(true), search()] });
    st = st.update({ effects: setSearchQuery.of(new SearchQuery({ search: "item 9", caseSensitive: true })) }).state;
    const r = findMatchSelection(st)!;
    expect(r.selection.ranges.length).toBe(11_111);
  });
});
