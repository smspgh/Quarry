import { beforeAll, describe, expect, it } from "vitest";
import { isolateHistory, redo, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { editor } from "../editor/manager";
import { useStore, type Doc } from "../lib/store";

// SPLIT-005: the same document in both panes shares one undo history, kept by the pane that showed
// it first and handed over when that pane moves on.
// jsdom has no layout; CodeMirror's measuring only needs these to exist.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const doc = (id: string): Doc => ({ id, kind: "text", path: `C:\\r\\${id}.txt`, name: id, dirty: false, encoding: "UTF-8", bom: false, eol: "LF", language: "Plain Text", readonly: false, modifiedMs: 0 });

/** One edit that is its own undo step. */
const type = (view: EditorView, at: number, text: string) =>
  view.dispatch({ changes: { from: at, insert: text }, userEvent: "input.type", annotations: isolateHistory.of("full") });
const text = (view: EditorView) => view.state.doc.toString();

describe("split editor: one undo history for a document in both panes", () => {
  let left: EditorView;
  let right: EditorView;

  beforeAll(async () => {
    useStore.setState({ docs: [doc("a"), doc("b")], activeId: "a", split: { otherId: "a", focused: 0, ratio: 0.5 } });
    editor.mount(document.body.appendChild(document.createElement("div")), 0);
    editor.mount(document.body.appendChild(document.createElement("div")), 1);
    await editor.create("a", "hello", "a.txt");
    await editor.create("b", "other", "b.txt");
    left = editor.paneView(0)!;
    right = editor.paneView(1)!;
  });

  it("copies an edit made in either pane to the other", () => {
    type(left, 0, "one ");
    type(right, 9, " two");
    expect(text(left)).toBe("one hello two");
    expect(text(right)).toBe("one hello two");
  });

  it("undoes in edit order from either pane and redoes from the other", () => {
    expect(undo(editor.historyView(right))).toBe(true);
    expect(text(left)).toBe("one hello");
    expect(text(right)).toBe("one hello");
    expect(undo(editor.historyView(right))).toBe(true);
    expect(text(right)).toBe("hello");
    expect(redo(editor.historyView(left))).toBe(true);
    expect(text(left)).toBe("one hello");
    expect(text(right)).toBe("one hello");
  });

  it("hands the history to the remaining pane when the owning pane shows another tab", () => {
    type(right, 9, "!");
    expect(text(left)).toBe("one hello!");
    // The left pane showed "a" first; it now shows "b".
    useStore.getState().setActive("b");
    expect(text(left)).toBe("other");
    expect(editor.historyView(right)).toBe(right);
    expect(undo(right)).toBe(true);
    expect(text(right)).toBe("one hello");
    expect(undo(right)).toBe(true);
    expect(text(right)).toBe("hello");
  });

  it("keeps the history when the split closes", () => {
    // "a" in both panes again, the right one (which kept it) focused.
    useStore.setState({ activeId: "a", split: { otherId: "a", focused: 1, ratio: 0.5 } });
    expect(text(left)).toBe("hello");
    type(right, 0, "1 ");
    type(left, 7, " 2");
    expect(text(right)).toBe("1 hello 2");
    useStore.setState({ split: null });
    expect(editor.historyView(left)).toBe(left);
    expect(undo(left)).toBe(true);
    expect(text(left)).toBe("1 hello");
    expect(undo(left)).toBe(true);
    expect(text(left)).toBe("hello");
  });
});
