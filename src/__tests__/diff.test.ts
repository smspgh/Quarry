import { describe, expect, it } from "vitest";
import { compareTitle, distinctLabels, joinEol, splitEol, type Side } from "../lib/diff";

const side = (label: string, path: string | null): Side => ({ label, path, text: "", editable: true, encoding: "UTF-8", bom: false, eol: "LF", dirty: false, source: path ? { kind: "file", path } : { kind: "text", label, text: "" } });

describe("compare", () => {
  it("normalises line endings for the editors and restores them on save", () => {
    expect(splitEol("a\r\nb\r\nc")).toEqual({ text: "a\nb\nc", eol: "CRLF" });
    expect(splitEol("a\nb")).toEqual({ text: "a\nb", eol: "LF" });
    expect(splitEol("a\rb\rc")).toEqual({ text: "a\nb\nc", eol: "CR" });
    expect(splitEol("one line")).toEqual({ text: "one line", eol: "LF" });
    expect(joinEol("a\nb", "CRLF")).toBe("a\r\nb");
    expect(joinEol("a\nb", "LF")).toBe("a\nb");
    expect(joinEol(splitEol("x\r\ny\r\n").text, "CRLF")).toBe("x\r\ny\r\n");
  });

  it("names the tab after the files", () => {
    expect(compareTitle(side("a.ts", "C:\\p\\a.ts"), side("b.ts", "C:\\p\\b.ts"))).toBe("a.ts ↔ b.ts");
    expect(compareTitle(side("stats.ts", "C:\\p\\old\\stats.ts"), side("stats.ts", "C:\\p\\new\\stats.ts"))).toBe("stats.ts (old ↔ new)");
    expect(compareTitle(side("Clipboard", null), side("a.ts", "C:\\a.ts"))).toBe("Clipboard ↔ a.ts");
  });

  it("tells same-named files apart by their folders", () => {
    const [a, b] = distinctLabels(side("stats.ts", "C:\\p\\old\\stats.ts"), side("stats.ts", "C:\\p\\new\\stats.ts"));
    expect([a.label, b.label]).toEqual(["old\\stats.ts", "new\\stats.ts"]);
    const [c, d] = distinctLabels(side("a.ts", "C:\\a.ts"), side("b.ts", "C:\\b.ts"));
    expect([c.label, d.label]).toEqual(["a.ts", "b.ts"]);
  });
});
