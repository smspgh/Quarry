import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { cmReplacement, replaceAllSpec, replaceNextSpec } from "../editor/findReplace";
import { buildQuery } from "../components/FindBar";

const q = (query: string, replaceText: string, regex = false) => buildQuery({ query, replaceText, regex, caseSensitive: false, wholeWord: false });
const apply = (state: EditorState, spec: TransactionSpec | null) => (spec ? state.update(spec).state : state);

describe("find bar Preserve Case", () => {
  it("Replace All keeps each match's case in one transaction", () => {
    const state = EditorState.create({ doc: "foo Foo FOO fOO" });
    const r = replaceAllSpec(state, q("foo", "bar"))!;
    expect(r.count).toBe(4);
    expect(apply(state, r.spec).doc.toString()).toBe("bar Bar BAR bar");
    expect(replaceAllSpec(state, q("zzz", "bar"))).toBeNull();
  });

  it("uses CodeMirror's replacement rules in regex mode", () => {
    const state = EditorState.create({ doc: "Key=1 key=2" });
    const r = replaceAllSpec(state, q("(\\w+)=(\\d)", "$2:$1\\t$$", true))!;
    // "Key" has a leading capital; the replacement starts with "1", so only the rest is as typed.
    expect(apply(state, r.spec).doc.toString()).toBe("1:Key\t$ 2:key\t$");
    // `$&` and unknown groups, as CodeMirror's own replace does them.
    const m = { from: 0, to: 3, match: /k(e)y/.exec("key")! };
    expect(cmReplacement(q("k(e)y", "[$&|$1|$9]", true), m)).toBe("[key|e|$9]");
    expect(cmReplacement(q("x", "a\\tb"), { from: 0, to: 1 })).toBe("a\\tb");
  });

  it("Replace selects the next match first, then replaces it and moves on (wrapping)", () => {
    let state = EditorState.create({ doc: "Foo x FOO", selection: EditorSelection.cursor(2) });
    const query = q("foo", "bar");
    state = apply(state, replaceNextSpec(state, query));
    expect(state.selection.main).toMatchObject({ from: 6, to: 9 });
    state = apply(state, replaceNextSpec(state, query));
    expect(state.doc.toString()).toBe("Foo x BAR");
    expect(state.selection.main).toMatchObject({ from: 0, to: 3 });
    state = apply(state, replaceNextSpec(state, query));
    expect(state.doc.toString()).toBe("Bar x BAR");
    expect(state.selection.main.empty).toBe(true);
    expect(replaceNextSpec(state, query)).toBeNull();
  });
});
