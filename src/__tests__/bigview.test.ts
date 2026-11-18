import { describe, expect, it } from "vitest";
import { editGate, utf8Span, visibleRowText } from "../components/BigFileView";

describe("large-file line editing gate", () => {
  const base = { readonly: false, encoding: "UTF-8", truncated: new Set<number>(), lossy: new Set<number>() };
  it("allows ordinary lines", () => {
    expect(editGate(3, base)).toBeNull();
  });
  it("refuses read-only documents and lines cut at the read cap; UTF-16 lines are editable", () => {
    expect(editGate(0, { ...base, readonly: true })).toEqual({ kind: "refuse", message: "This document is read-only." });
    expect(editGate(0, { ...base, encoding: "UTF-16LE" })).toBeNull();
    expect(editGate(0, { ...base, truncated: new Set([0]) })?.kind).toBe("refuse");
  });
  it("asks before editing a line with invalid UTF-8", () => {
    const g = editGate(41, { ...base, lossy: new Set([41]) });
    expect(g?.kind).toBe("confirm");
    expect(g?.message).toContain("Line 42");
    expect(editGate(1, { ...base, encoding: "UTF-16BE", lossy: new Set([1]) })?.message).toContain("not valid UTF-16BE");
  });
  it("makes lone CR characters visible", () => {
    expect(visibleRowText("a\rb")).toBe("a␍b");
    expect(visibleRowText("plain")).toBe("plain");
  });
});

describe("utf8Span (byte columns from Rust to string indices)", () => {
  it("is the identity for ASCII", () => {
    expect(utf8Span("hello world", 6, 5)).toEqual([6, 11]);
  });
  it("accounts for 2-, 3- and 4-byte characters", () => {
    // h é l l o _ 世 _ 😀 x : bytes 1 2 1 1 1 1 3 1 4 1
    const t = "h\u00e9llo \u4e16 \u{1F600}x";
    expect(utf8Span(t, 7, 3)).toEqual([6, 7]); // 世
    expect(utf8Span(t, 11, 4)).toEqual([8, 10]); // 😀 (a surrogate pair)
    expect(utf8Span(t, 15, 1)).toEqual([10, 11]); // x
  });
  it("returns null past the end and clamps a match running past it", () => {
    expect(utf8Span("abc", 10, 1)).toBeNull();
    expect(utf8Span("abc", 1, 50)).toEqual([1, 3]);
    expect(utf8Span("abc", 3, 0)).toEqual([3, 3]);
  });
});
