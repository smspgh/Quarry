import { beforeEach, describe, expect, it } from "vitest";
import { EditorState, Text } from "@codemirror/state";
import { paneDocId, useStore, type Doc } from "../lib/store";
import { groupFiles, kindOf, rowKind } from "../lib/gitStatus";
import type { GitFile } from "../lib/gitApi";
import { changesOf, gitDiff, gitExtensions, relativeTime, revertSpec, setGitBase } from "../editor/git";

const doc = (id: string, kind: Doc["kind"] = "text"): Doc => ({ id, kind, path: `C:\\r\\${id}.txt`, name: id, dirty: false, encoding: "UTF-8", bom: false, eol: "LF", language: "Plain Text", readonly: false, modifiedMs: 0 });

describe("split editor store", () => {
  beforeEach(() => {
    useStore.setState({ docs: [doc("a"), doc("b"), doc("c"), doc("claude", "claude")], activeId: "a", split: null });
  });
  const panes = () => {
    const s = useStore.getState();
    return [paneDocId(s, 0), paneDocId(s, 1), s.split?.focused ?? 0];
  };

  it("without a split only the left pane exists", () => {
    expect(panes()).toEqual(["a", null, 0]);
  });

  it("picking a tab changes the focused pane only", () => {
    useStore.setState({ split: { otherId: "a", focused: 1, ratio: 0.5 } });
    useStore.getState().setActive("b");
    expect(panes()).toEqual(["a", "b", 1]);
  });

  it("picking the other pane's document moves the focus there", () => {
    useStore.setState({ activeId: "b", split: { otherId: "a", focused: 1, ratio: 0.5 } });
    useStore.getState().setActive("a");
    expect(panes()).toEqual(["a", "b", 0]);
  });

  it("a tab that isn't text opens in the left pane, the right keeping its document", () => {
    useStore.setState({ activeId: "b", split: { otherId: "a", focused: 1, ratio: 0.5 } });
    useStore.getState().setActive("claude");
    expect(panes()).toEqual(["claude", "b", 0]);
  });

  it("focusPane swaps which pane is active", () => {
    useStore.setState({ activeId: "b", split: { otherId: "a", focused: 1, ratio: 0.5 } });
    useStore.getState().focusPane(0);
    expect(panes()).toEqual(["a", "b", 0]);
    expect(useStore.getState().activeId).toBe("a");
  });

  it("closing the other pane's document closes the split", () => {
    useStore.setState({ activeId: "b", split: { otherId: "a", focused: 1, ratio: 0.5 } });
    useStore.getState().removeDoc("a");
    expect(useStore.getState().split).toBeNull();
    expect(useStore.getState().activeId).toBe("b");
  });

  it("closing the right pane's document shows the nearest text tab there", () => {
    useStore.setState({ docs: [doc("a"), doc("b"), doc("claude", "claude"), doc("c")], activeId: "b", split: { otherId: "a", focused: 1, ratio: 0.5 } });
    useStore.getState().removeDoc("b");
    expect(panes()).toEqual(["a", "c", 1]);
  });

  it("adding a non-text tab while the right pane is focused puts it on the left", () => {
    useStore.setState({ activeId: "b", split: { otherId: "a", focused: 1, ratio: 0.5 } });
    useStore.getState().addDoc(doc("term", "terminal"));
    expect(panes()).toEqual(["term", "b", 0]);
  });
});

const f = (path: string, index: string, worktree: string, extra: Partial<GitFile> = {}): GitFile => ({ path, origPath: null, index, worktree, conflicted: false, untracked: false, ...extra });

describe("git status helpers", () => {
  it("names the change of a file", () => {
    expect(kindOf(f("x", ".", "M"))).toBe("modified");
    expect(kindOf(f("x", "A", "."))).toBe("added");
    expect(kindOf(f("x", "A", "M"))).toBe("added");
    expect(kindOf(f("x", "D", "."))).toBe("deleted");
    expect(kindOf(f("x", "R", "."))).toBe("renamed");
    expect(kindOf(f("x", "?", "?", { untracked: true }))).toBe("untracked");
    expect(kindOf(f("x", "U", "U", { conflicted: true }))).toBe("conflict");
  });

  it("groups files: partly staged files show in both lists", () => {
    const g = groupFiles([f("C:\\r\\b.txt", "M", "M"), f("C:\\r\\a.txt", ".", "M"), f("C:\\r\\n.txt", "?", "?", { untracked: true }), f("C:\\r\\c.txt", "U", "U", { conflicted: true }), f("C:\\r\\s.txt", "A", ".")]);
    expect(g.conflict.map((x) => x.path)).toEqual(["C:\\r\\c.txt"]);
    expect(g.staged.map((x) => x.path)).toEqual(["C:\\r\\b.txt", "C:\\r\\s.txt"]);
    expect(g.changes.map((x) => x.path)).toEqual(["C:\\r\\a.txt", "C:\\r\\b.txt", "C:\\r\\n.txt"]);
  });

  it("shows each side's own change", () => {
    const x = f("x", "A", "D");
    expect(rowKind(x, "staged")).toBe("added");
    expect(rowKind(x, "changes")).toBe("deleted");
  });
});

describe("change markers", () => {
  /** Lines joined into a text. */
  const L = (...lines: string[]) => lines.join("\n");
  const state = (base: string, now: string) => {
    const st = EditorState.create({ doc: now, extensions: gitExtensions() });
    return st.update({ effects: setGitBase.of(Text.of(base.split("\n"))) }).state;
  };
  const show = (st: EditorState) => changesOf(st).map((c) => `${c.kind} ${c.first}-${c.last}`);
  /** The document after reverting change `i`. */
  const reverted = (st: EditorState, i: number) => st.update({ changes: revertSpec(changesOf(st)[i], st.field(gitDiff).base!, st.doc) }).state.doc.toString();

  it("finds added, changed and deleted lines", () => {
    const st = state(L("one", "two", "three", "four", "five"), L("one", "TWO", "three", "four", "five", "six"));
    // "five" is unchanged although a line break now follows it.
    expect(show(st)).toEqual(["modified 2-2", "added 6-6"]);
    expect(show(state(L("one", "two", "three"), L("one", "three")))).toEqual(["deleted 2-1"]);
  });

  it("follows edits without a new base", () => {
    let st = state(L("a", "b", "c"), L("a", "b", "c"));
    expect(show(st)).toEqual([]);
    st = st.update({ changes: { from: 0, insert: "new\n" } }).state;
    expect(show(st)).toEqual(["added 1-1"]);
  });

  it("reverts each kind of change to the committed text", () => {
    const base = L("one", "two", "three", "four", "five");
    expect(reverted(state(base, L("one", "TWO", "three", "four", "five")), 0)).toBe(base);
    expect(reverted(state(base, L("one", "two", "three", "four", "five", "six")), 0)).toBe(base);
    expect(reverted(state(base, L("zero", "one", "two", "three", "four", "five")), 0)).toBe(base);
    expect(reverted(state(base, L("one", "three", "four", "five")), 0)).toBe(base);
    expect(reverted(state(base, L("one", "two", "three", "four")), 0)).toBe(base);
  });

  it("treats the line after a final line break as no line", () => {
    const filled = state(L("hello", ""), L("hello", "appended"));
    expect(show(filled)).toEqual(["added 2-2"]);
    expect(reverted(filled, 0)).toBe(L("hello", ""));
    const emptied = state(L("hello", "bye"), L("hello", ""));
    expect(changesOf(emptied).map((c) => c.kind)).toEqual(["deleted"]);
    expect(reverted(emptied, 0)).toBe(L("hello", "bye"));
  });

  it("has no markers without a base", () => {
    const st = EditorState.create({ doc: "x", extensions: gitExtensions() });
    expect(changesOf(st)).toHaveLength(0);
  });
});


describe("relativeTime", () => {
  const now = Date.UTC(2026, 9, 27, 12);
  it("rounds down to the largest unit", () => {
    expect(relativeTime(now / 1000 - 30, now)).toBe("just now");
    expect(relativeTime(now / 1000 - 120, now)).toBe("2 minutes ago");
    expect(relativeTime(now / 1000 - 86400, now)).toBe("1 day ago");
    expect(relativeTime(now / 1000 - 86400 * 400, now)).toBe("1 year ago");
  });
});
