import { describe, expect, it } from "vitest";
import { canGroupUndo, shouldStopToEnd } from "../lib/macros";
import { describeWhen, formatScriptError, scriptApplies } from "../lib/scripting";

describe("macro play-to-end", () => {
  it("stops when the cursor does not move down or the last line was processed", () => {
    expect(shouldStopToEnd(5, 6, 10)).toBe(false);
    expect(shouldStopToEnd(5, 5, 10)).toBe(true);
    expect(shouldStopToEnd(5, 4, 10)).toBe(true);
    expect(shouldStopToEnd(10, 11, 10)).toBe(true);
    expect(shouldStopToEnd(9, 10, 10)).toBe(false); // last line still needs a pass
  });
  it("groups into one undo step unless the macro itself undoes", () => {
    const cmd = (id: string) => ({ type: "command", id }) as never;
    expect(canGroupUndo([cmd("edit.upper"), cmd("edit.indent")])).toBe(true);
    expect(canGroupUndo([cmd("edit.upper"), cmd("edit.undo")])).toBe(false);
    expect(canGroupUndo([])).toBe(true);
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
