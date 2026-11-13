import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { search, setSearchQuery } from "@codemirror/search";
import { findScopeField, inScope, scopeFromSelection, scopeSpans, setFindScope } from "../editor/findScope";
import { replaceAllSpec, replaceNextSpec } from "../editor/findReplace";
import { findMatchSelection } from "../editor/bulkEdit";
import { buildQuery } from "../components/FindBar";
import { useStore } from "../lib/store";

const mk = (doc: string, selection?: EditorSelection) => EditorState.create({ doc, selection, extensions: [findScopeField, search(), EditorState.allowMultipleSelections.of(true)] });
const scoped = (state: EditorState, spans: { from: number; to: number }[]) => state.update({ effects: setFindScope.of(spans) }).state;
const q = (query: string, replaceText = "", inSelection = true) => buildQuery({ query, replaceText, regex: false, caseSensitive: false, wholeWord: false, inSelection });
const all = (state: EditorState, query: ReturnType<typeof q>) => {
  const out: [number, number][] = [];
  const c = query.getCursor(state);
  for (let r = c.next(); !r.done; r = c.next()) out.push([r.value.from, r.value.to]);
  return out;
};

beforeEach(() => useStore.getState().setFindBar({ inSelection: true }));
afterEach(() => useStore.getState().setFindBar({ inSelection: false }));

describe("Find in Selection scope", () => {
  it("takes the non-empty selection ranges, sorted", () => {
    const state = mk("aaa bbb ccc", EditorSelection.create([EditorSelection.range(8, 11), EditorSelection.cursor(5), EditorSelection.range(0, 3)]));
    expect(scopeFromSelection(state)).toEqual([{ from: 0, to: 3 }, { from: 8, to: 11 }]);
  });

  it("uses the cursors' lines when nothing is selected, skipping empty lines", () => {
    const state = mk("one\n\nthree", EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(2), EditorSelection.cursor(4)], 0));
    expect(scopeFromSelection(state)).toEqual([{ from: 0, to: 3 }]);
    expect(scopeFromSelection(mk("one\n\nthree", EditorSelection.single(4)))).toBeNull();
  });

  it("limits matches to the ranges; a match crossing a range edge is left out", () => {
    const state = scoped(mk("foo foo foo foo"), [{ from: 4, to: 9 }, { from: 12, to: 15 }]);
    expect(all(state, q("foo"))).toEqual([[4, 7], [12, 15]]);
    expect(all(state, q("foo", "", false))).toHaveLength(4);
    expect(inScope(state, 4, 7)).toBe(true);
    expect(inScope(state, 7, 10)).toBe(false);
  });

  it("stops filtering once the option is off, and without a scope", () => {
    const state = scoped(mk("foo foo"), [{ from: 0, to: 3 }]);
    useStore.getState().setFindBar({ inSelection: false });
    expect(all(state, q("foo"))).toHaveLength(2);
    expect(inScope(mk("foo"), 0, 3)).toBe(true);
  });

  it("maps the ranges through edits", () => {
    let state = scoped(mk("xx foo yy foo"), [{ from: 3, to: 6 }]);
    state = state.update({ changes: { from: 0, insert: "123" } }).state;
    expect(scopeSpans(state)).toEqual([{ from: 6, to: 9 }]);
    expect(all(state, q("foo"))).toEqual([[6, 9]]);
    // Deleting the whole range leaves an empty scope: nothing matches, the whole document is not searched.
    state = state.update({ changes: { from: 0, to: state.doc.length, insert: "foo" } }).state;
    expect(all(state, q("foo"))).toEqual([]);
  });

  it("Replace All and Replace (the Preserve Case path) stay inside the ranges", () => {
    const state = scoped(mk("foo [Foo foo] foo"), [{ from: 4, to: 13 }]);
    const r = replaceAllSpec(state, q("foo", "bar"))!;
    expect(r.count).toBe(2);
    expect(state.update(r.spec).state.doc.toString()).toBe("foo [Bar bar] foo");
    // Replace from outside the scope selects its first match, not the one at the cursor.
    const atStart = state.update({ selection: EditorSelection.cursor(0) }).state;
    const spec = replaceNextSpec(atStart, q("foo", "bar"))!;
    expect(spec.selection).toEqual(EditorSelection.single(5, 8));
  });

  it("a replacement at the edge of a range keeps it in the scope", () => {
    let state = scoped(mk("foo"), [{ from: 0, to: 3 }]);
    state = state.update({ changes: { from: 0, to: 3, insert: "foofoo" } }).state;
    expect(scopeSpans(state)).toEqual([{ from: 0, to: 6 }]);
  });

  it("Select All Find Matches selects only the matches in the scope", () => {
    let state = scoped(mk("a a a a"), [{ from: 2, to: 5 }]);
    state = state.update({ effects: setSearchQuery.of(q("a")) }).state;
    const r = findMatchSelection(state)!;
    expect(r.selection.ranges.map((x) => [x.from, x.to])).toEqual([[2, 3], [4, 5]]);
  });
});
