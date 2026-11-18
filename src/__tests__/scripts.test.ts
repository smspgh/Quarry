import { describe, expect, it } from "vitest";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { dropPickerStep, MacroUndo, undoRedoKind, isUnrecordable, markPickerStep, recordCommand, scriptBlockedByMacro, shouldStopToEnd, startRecording, stopRecording } from "../lib/macros";
import { describeWhen, formatScriptError, isScriptPath, newScriptFileName, scriptApplies, scriptNameOf } from "../lib/scripting";

describe("macro play-to-end", () => {
  it("stops when the cursor does not move down or the last line was processed", () => {
    expect(shouldStopToEnd(5, 6, 10)).toBe(false);
    expect(shouldStopToEnd(5, 5, 10)).toBe(true);
    expect(shouldStopToEnd(5, 4, 10)).toBe(true);
    expect(shouldStopToEnd(10, 11, 10)).toBe(true);
    expect(shouldStopToEnd(9, 10, 10)).toBe(false); // last line still needs a pass
  });
});

// MACRO-008.4: an Undo / Redo step inside a macro works on the playback's own steps.
describe("macro undo inside a playback", () => {
  const cmd = (id: string) => ({ type: "command", id }) as never;
  const key = (k: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) => ({ type: "key", key: k, ctrl: mods.ctrl ?? true, shift: !!mods.shift, alt: !!mods.alt, meta: false }) as never;

  it("knows which steps undo and which redo", () => {
    expect(undoRedoKind(cmd("edit.undo"))).toBe("undo");
    expect(undoRedoKind(cmd("edit.redo"))).toBe("redo");
    expect(undoRedoKind(cmd("edit.redoAlt"))).toBe("redo");
    expect(undoRedoKind(cmd("edit.upper"))).toBeNull();
    expect(undoRedoKind(key("z"))).toBe("undo");
    expect(undoRedoKind(key("Z", { shift: true }))).toBe("redo");
    expect(undoRedoKind(key("y"))).toBe("redo");
    expect(undoRedoKind(key("z", { ctrl: false }))).toBeNull();
    expect(undoRedoKind(key("z", { alt: true }))).toBeNull();
    expect(undoRedoKind({ type: "input", text: "z" } as never)).toBeNull();
  });

  it("undoes the macro's previous step, joining the edits one step made", () => {
    const u = new MacroUndo();
    let state = EditorState.create({ doc: "abc" });
    const edit = (insert: string) => {
      const tr = state.update({ changes: { from: state.doc.length, insert } });
      u.record(tr);
      state = tr.state;
    };
    u.step();
    edit("1");
    edit("2"); // same step: one entry
    u.step();
    edit("X");
    expect(state.doc.toString()).toBe("abc12X");
    u.step();
    state = state.update(u.undo()!).state;
    expect(state.doc.toString()).toBe("abc12");
    u.step();
    state = state.update(u.undo()!).state;
    expect(state.doc.toString()).toBe("abc");
    // Nothing before the playback is ever taken back.
    expect(u.undo()).toBeNull();
    expect(state.doc.toString()).toBe("abc");
    state = state.update(u.redo()!).state;
    expect(state.doc.toString()).toBe("abc12");
  });

  it("a new edit after an undo clears what could be redone; its own transactions are not recorded", () => {
    const u = new MacroUndo();
    let state = EditorState.create({ doc: "" });
    const apply = (spec: TransactionSpec) => {
      const tr = state.update(spec);
      u.record(tr);
      state = tr.state;
    };
    u.step();
    apply({ changes: { from: 0, insert: "one" } });
    u.step();
    apply(u.undo()!); // recorded call is skipped: it carries the stack's own mark
    expect(state.doc.toString()).toBe("");
    u.step();
    apply({ changes: { from: 0, insert: "two" } });
    expect(u.redo()).toBeNull();
    u.step();
    apply(u.undo()!);
    expect(state.doc.toString()).toBe("");
    expect(u.undo()).toBeNull();
  });
});

describe("macro steps around a picker", () => {
  it("keeps only the picked command, not the command that opened the picker", () => {
    startRecording();
    recordCommand("git.mergeBranch");
    markPickerStep(); // pickBranch, while git.mergeBranch runs
    dropPickerStep(); // a row is picked
    recordCommand("git.mergeRef", "feature");
    expect(stopRecording()).toEqual([{ type: "command", id: "git.mergeRef", args: "feature" }]);
  });
  it("never drops an earlier step when a button (no command) opened the picker", async () => {
    startRecording();
    recordCommand("edit.upper");
    await Promise.resolve();
    markPickerStep();
    dropPickerStep();
    recordCommand("git.checkoutTo", "main");
    expect(stopRecording().map((s) => (s as { id: string }).id)).toEqual(["edit.upper", "git.checkoutTo"]);
  });
});

describe("scripts and macros", () => {
  it("refuses script runs while a macro records or plays", () => {
    expect(scriptBlockedByMacro({ recording: false, macroPlaying: false })).toBeNull();
    expect(scriptBlockedByMacro({ recording: true, macroPlaying: false })).toMatch(/recording/);
    expect(scriptBlockedByMacro({ recording: false, macroPlaying: true })).toMatch(/playing/);
  });
  it("never records macro commands or script runs", () => {
    expect(isUnrecordable("macro.toggleRecord")).toBe(true);
    expect(isUnrecordable("script.runActive")).toBe(true);
    expect(isUnrecordable("script.run")).toBe(true);
    expect(isUnrecordable("script.panel")).toBe(false);
    expect(isUnrecordable("edit.upper")).toBe(false);
  });
});

describe("script applicability", () => {
  it("applies everywhere without a filter and matches languages or extensions", () => {
    expect(scriptApplies({}, null)).toBe(true);
    expect(scriptApplies({ when: { languages: ["JSON"] } }, null)).toBe(false);
    expect(scriptApplies({ when: { languages: ["JSON"] } }, { language: "JSON" })).toBe(true);
    expect(scriptApplies({ when: { languages: ["JSON"] } }, { language: "YAML" })).toBe(false);
    expect(scriptApplies({ when: { extensions: [".csv"] } }, { name: "Data.CSV", path: null })).toBe(true);
    expect(scriptApplies({ when: { extensions: [".csv"] } }, { path: "C:\\x\\a.tsv" })).toBe(false);
  });
  it("describes the filter for tooltips", () => {
    expect(describeWhen({})).toBe("");
    expect(describeWhen({ when: { languages: ["JSON", "YAML"] } })).toBe("JSON / YAML only");
    expect(describeWhen({ when: { languages: ["JSON"], extensions: [".csv"] } })).toBe("JSON or .csv files only");
  });
});

describe("script files", () => {
  it("names a script after its file and recognises scripts by extension", () => {
    expect(isScriptPath("C:\\s\\Sort Lines.JS")).toBe(true);
    expect(isScriptPath("C:\\s\\notes.md")).toBe(false);
    expect(scriptNameOf("C:\\s\\csv\\Sort Lines.js")).toBe("Sort Lines");
    expect(scriptNameOf("C:/s/readme.md")).toBe("readme.md");
  });
  it("adds .js to a new script's name unless an extension was typed", () => {
    expect(newScriptFileName("trim")).toBe("trim.js");
    expect(newScriptFileName("trim.js")).toBe("trim.js");
    expect(newScriptFileName("notes.md")).toBe("notes.md");
    expect(newScriptFileName("v1.2 cleanup")).toBe("v1.2 cleanup.js");
  });
});

describe("formatScriptError", () => {
  it("maps wrapper line numbers to script lines and drops worker frames", () => {
    const raw = "Error: boom\n    at eval (eval at <anonymous> (blob:x), <anonymous>:7:9)\n    at self.onmessage (http://localhost/scriptWorker.ts:12:3)";
    const e = formatScriptError(raw, 4);
    expect(e.message).toBe("Error: boom");
    expect(e.line).toBe(3);
    expect(e.column).toBe(9);
    expect(e.stack).not.toMatch(/scriptWorker|localhost/);
    expect(e.stack).toContain("script:3:9");
  });
  it("leaves the line undefined when the frame points into the wrapper", () => {
    const e = formatScriptError("TypeError: x\n    at <anonymous>:2:1", 4);
    expect(e.line).toBeUndefined();
    expect(e.message).toBe("TypeError: x");
    expect(formatScriptError("", 0).message).toBe("Script error");
  });
});
