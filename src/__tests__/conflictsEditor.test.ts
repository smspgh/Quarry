import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { conflictAtCursor, conflictExtensions, conflictsOf, nextConflict, resolveChange } from "../editor/conflicts";

// The editor layer over lib/conflicts.ts: which blocks a document has as it is edited, and the
// edits Accept Current / Incoming / Both make.
const text = ["top", "<<<<<<< HEAD", "main one", "=======", "theirs one", ">>>>>>> feature", "middle", "<<<<<<< HEAD", "=======", "added", ">>>>>>> other", "end"].join("\n");
const make = (doc: string, line = 1) => {
  const s = EditorState.create({ doc, extensions: conflictExtensions() });
  return s.update({ selection: EditorSelection.cursor(s.doc.line(line).from) }).state;
};

describe("conflicts in the editor", () => {
  it("finds the blocks of a conflicted document", () => {
    expect(conflictsOf(make(text)).map((b) => [b.start, b.end])).toEqual([[1, 5], [7, 10]]);
    expect(conflictsOf(make("no conflicts here"))).toEqual([]);
  });

  it("a clean document is rescanned only when a marker is typed or pasted", () => {
    let s = make("a\nb\n");
    s = s.update({ changes: { from: 0, insert: "x" } }).state;
    expect(conflictsOf(s)).toEqual([]);
    s = s.update({ changes: { from: s.doc.length, insert: "<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> b\n" } }).state;
    expect(conflictsOf(s)).toHaveLength(1);
  });

  it("drops a block once its markers are gone", () => {
    let s = make(text);
    const b = conflictsOf(s)[0];
    s = s.update({ changes: resolveChange(s.doc, b, "current") }).state;
    expect(conflictsOf(s)).toHaveLength(1);
  });

  it("accepts current, incoming or both", () => {
    const s = make(text);
    const [first, second] = conflictsOf(s);
    const apply = (b: typeof first, c: "current" | "incoming" | "both") => s.update({ changes: resolveChange(s.doc, b, c) }).state.doc.toString().split("\n");
    expect(apply(first, "current").slice(0, 3)).toEqual(["top", "main one", "middle"]);
    expect(apply(first, "incoming").slice(0, 3)).toEqual(["top", "theirs one", "middle"]);
    expect(apply(first, "both").slice(0, 4)).toEqual(["top", "main one", "theirs one", "middle"]);
    // An empty side kept: the block's line goes too, no blank line is left.
    expect(apply(second, "current").slice(-2)).toEqual(["middle", "end"]);
  });

  it("finds the conflict at or after the cursor", () => {
    expect(conflictAtCursor(make(text, 3))?.start).toBe(1); // inside the first
    expect(conflictAtCursor(make(text, 7))?.start).toBe(7); // the next one below
    expect(conflictAtCursor(make(text, 12))?.start).toBe(1); // after the last: the first
    expect(conflictAtCursor(make("clean"))).toBeNull();
  });

  it("steps to the next and previous conflict, wrapping", () => {
    expect(nextConflict(make(text, 1), 1)?.start).toBe(1);
    expect(nextConflict(make(text, 3), 1)?.start).toBe(7);
    expect(nextConflict(make(text, 12), 1)?.start).toBe(1);
    expect(nextConflict(make(text, 12), -1)?.start).toBe(7);
    expect(nextConflict(make(text, 9), -1)?.start).toBe(1); // inside the second: the one before it
    expect(nextConflict(make(text, 1), -1)?.start).toBe(7);
    expect(nextConflict(make("clean"), 1)).toBeNull();
  });
});
