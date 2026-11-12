import { describe, expect, it } from "vitest";
import { tabStripKey } from "../components/TitleBar";
import { nextMenuIndex } from "../components/MenuBar";
import { placeFlyout, typeAheadIndex } from "../components/Select";
import { describeValue, firstFontFamily, fontListFor, rowMatches } from "../components/panels/SettingsPanel";
import { previewBefore } from "../components/panels/SearchPanel";

describe("nextMenuIndex", () => {
  it("wraps in both directions and handles Home/End and no selection", () => {
    expect(nextMenuIndex(2, 3, "ArrowDown")).toBe(0);
    expect(nextMenuIndex(0, 3, "ArrowUp")).toBe(2);
    expect(nextMenuIndex(-1, 3, "ArrowDown")).toBe(0);
    expect(nextMenuIndex(-1, 3, "ArrowUp")).toBe(2);
    expect(nextMenuIndex(1, 3, "Home")).toBe(0);
    expect(nextMenuIndex(1, 3, "End")).toBe(2);
    expect(nextMenuIndex(0, 0, "ArrowDown")).toBe(-1);
  });
});

describe("placeFlyout", () => {
  const anchor = { left: 10, top: 100, bottom: 126, width: 72 };
  it("opens below when there is room and uses at least 120px width", () => {
    const p = placeFlyout(anchor, 160, 1000, 800);
    expect(p.up).toBe(false);
    expect(p.top).toBe(130);
    expect(p.minWidth).toBe(120);
    expect(p.maxHeight).toBe(160);
  });
  it("flips up near the bottom and clamps to the viewport horizontally", () => {
    const p = placeFlyout({ left: 950, top: 700, bottom: 726, width: 72 }, 160, 1000, 800);
    expect(p.up).toBe(true);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(700);
    expect(p.left + p.minWidth).toBeLessThanOrEqual(1000);
  });
  it("never goes off the top or left edge", () => {
    const p = placeFlyout({ left: -40, top: 20, bottom: 46, width: 72 }, 600, 300, 100);
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.top).toBeGreaterThanOrEqual(0);
  });
});

describe("typeAheadIndex", () => {
  const opts = ["Dot notation", "JSONPath", "JavaScript", "Bracket notation", "JSON Pointer"].map((label) => ({ label }));
  it("cycles single-character matches from the current item", () => {
    expect(typeAheadIndex(opts, "j", 0)).toBe(1);
    expect(typeAheadIndex(opts, "j", 1)).toBe(2);
    expect(typeAheadIndex(opts, "j", 4)).toBe(1);
  });
  it("matches multi-character prefixes from the top and ignores case", () => {
    expect(typeAheadIndex(opts, "json p", 2)).toBe(4);
    expect(typeAheadIndex(opts, "BR", 0)).toBe(3);
    expect(typeAheadIndex(opts, "zz", 0)).toBe(-1);
    expect(typeAheadIndex(opts, "", 0)).toBe(-1);
  });
});

describe("previewBefore", () => {
  it("keeps up to three whole words before the match and marks what was left out", () => {
    expect(previewBefore("the quick brown fox jumps over ")).toBe("…fox jumps over ");
    expect(previewBefore("    let x = ")).toBe("let x = ");
    expect(previewBefore("")).toBe("");
    expect(previewBefore("ab ", false)).toBe("ab ");
  });
  it("adds … when the preview starts partway through the line", () => {
    expect(previewBefore("own fox ", true)).toBe("…own fox ");
  });
  it("keeps a short tail of a very long word", () => {
    const r = previewBefore("x".repeat(100));
    expect(r).toBe("…" + "x".repeat(12));
  });
  it("keeps the part of a word the match starts inside", () => {
    expect(previewBefore("one two ne")).toBe("one two ne");
  });
});

describe("Settings previous / default labels", () => {
  it("describes values for the tooltips", () => {
    expect(describeValue(true)).toBe("On");
    expect(describeValue(false)).toBe("Off");
    expect(describeValue("")).toBe("empty");
    expect(describeValue(14)).toBe("14");
    expect(describeValue("x".repeat(60))).toHaveLength(48);
  });
  it("stores a listed font as a CSS list with a monospace fallback", () => {
    expect(fontListFor("Consolas")).toBe('"Consolas", monospace');
    expect(firstFontFamily(fontListFor("JetBrains Mono"))).toBe("JetBrains Mono");
  });
});

describe("Settings panel helpers", () => {
  it("rowMatches searches section, label and hint case-insensitively", () => {
    expect(rowMatches("", "Theme")).toBe(true);
    expect(rowMatches("WRAP", "Word wrap", "Alt+Z", "Editor")).toBe(true);
    expect(rowMatches("editor", "Tab size", undefined, "Editor")).toBe(true);
    expect(rowMatches("alt+z", "Word wrap", "Alt+Z")).toBe(true);
    expect(rowMatches("mica", "Theme")).toBe(false);
  });
  it("firstFontFamily unquotes the first family", () => {
    expect(firstFontFamily('"Cascadia Code", Consolas, monospace')).toBe("Cascadia Code");
    expect(firstFontFamily("'Fira Code'")).toBe("Fira Code");
    expect(firstFontFamily("")).toBe("");
  });
});

describe("tabStripKey", () => {
  it("moves focus with arrows (wrapping), Home and End", () => {
    expect(tabStripKey("ArrowRight", false, 0, 3)).toEqual({ kind: "focus", index: 1 });
    expect(tabStripKey("ArrowRight", false, 2, 3)).toEqual({ kind: "focus", index: 0 });
    expect(tabStripKey("ArrowLeft", false, 0, 3)).toEqual({ kind: "focus", index: 2 });
    expect(tabStripKey("Home", false, 2, 3)).toEqual({ kind: "focus", index: 0 });
    expect(tabStripKey("End", false, 0, 3)).toEqual({ kind: "focus", index: 2 });
  });
  it("activates with Enter/Space and closes with Delete or Ctrl+W", () => {
    expect(tabStripKey("Enter", false, 1, 3)).toEqual({ kind: "activate" });
    expect(tabStripKey(" ", false, 1, 3)).toEqual({ kind: "activate" });
    expect(tabStripKey("Delete", false, 1, 3)).toEqual({ kind: "close" });
    expect(tabStripKey("W", true, 1, 3)).toEqual({ kind: "close" });
    expect(tabStripKey("ContextMenu", false, 1, 3)).toEqual({ kind: "menu" });
  });
  it("ignores other keys and Ctrl combos", () => {
    expect(tabStripKey("a", false, 0, 3)).toBeNull();
    expect(tabStripKey("ArrowRight", true, 0, 3)).toBeNull();
    expect(tabStripKey("ArrowRight", false, 0, 0)).toBeNull();
  });
});
