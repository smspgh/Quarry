import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tabStripKey } from "../components/TitleBar";
import { MENU_MNEMONICS, menuForMnemonic, mnemonicKey, nextMenuIndex, splitMnemonic, submenuPlace, submenuShift } from "../components/MenuBar";
import { placeFlyout, typeAheadIndex } from "../components/Select";
import { describeValue, firstFontFamily, fontListFor, rowMatches } from "../components/panels/SettingsPanel";
import { previewBefore } from "../components/panels/SearchPanel";

describe("submenuShift (UI-003.9)", () => {
  it("leaves a submenu that fits where it is", () => {
    expect(submenuShift(300, 500, 816)).toBe(0);
    expect(submenuShift(600, 808, 816)).toBe(0);
  });
  it("moves a submenu up by what would be below the window, keeping a margin", () => {
    expect(submenuShift(695, 914, 816)).toBe(106);
  });
  it("never moves it above the top margin", () => {
    expect(submenuShift(40, 900, 816)).toBe(32);
    expect(submenuShift(4, 900, 816)).toBe(0);
  });
});

describe("submenuPlace (UI-003.9, UI-003.10)", () => {
  const entry = { top: 300, left: 100, right: 340, bottom: 330 };
  it("puts a submenu just right of its entry, level with it", () => {
    expect(submenuPlace(entry, 220, 150, 1400, 816)).toEqual({ top: 296, left: 338 });
  });
  it("moves it up to stay inside the window", () => {
    expect(submenuPlace({ ...entry, top: 700 }, 220, 219, 1400, 816)).toEqual({ top: 589, left: 338 });
  });
  it("opens it on the left when the right side has no room", () => {
    // No room on either side: kept at the left margin.
    expect(submenuPlace(entry, 220, 150, 560, 816)).toEqual({ top: 296, left: 8 });
    expect(submenuPlace({ top: 300, left: 900, right: 1140 }, 220, 150, 1200, 816)).toEqual({ top: 296, left: 682 });
  });
});

describe("the menu layout (UI-003.10)", () => {
  const css = readFileSync("src/styles/app.css", "utf8");
  it("lets a top-level menu scroll and keeps transforms off menus (they would anchor the fixed submenus)", () => {
    expect(css).toMatch(/\.menu-flyout:not\(\.submenu\) \{\s*overflow-y: auto;/);
    expect(css).toMatch(/\.menu-flyout \{[^}]*animation: menu-fade/);
    expect(css).toMatch(/@keyframes menu-fade \{\s*from \{\s*opacity/);
  });
});

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

describe("menu mnemonics", () => {
  const labels = ["File", "Edit", "Code", "Selection", "Find", "View", "Git", "JSON", "Scripts", "Macros", "Tools", "Help"];
  const key = (code: string, mods: Partial<{ altKey: boolean; ctrlKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}) =>
    ({ key: code.slice(3).toLowerCase(), code, altKey: true, ctrlKey: false, shiftKey: false, metaKey: false, ...mods });

  it("maps Alt+letter to its menu", () => {
    expect(menuForMnemonic("f", labels)).toBe(0);
    expect(menuForMnemonic("E", labels)).toBe(1);
    expect(menuForMnemonic("o", labels)).toBe(2);
    expect(menuForMnemonic("n", labels)).toBe(4);
    expect(menuForMnemonic("i", labels)).toBe(8);
    expect(menuForMnemonic("h", labels)).toBe(11);
    expect(menuForMnemonic("q", labels)).toBeNull();
    expect(menuForMnemonic("", labels)).toBeNull();
  });
  it("every menu has a unique letter that appears in its label", () => {
    const letters = labels.map((l) => MENU_MNEMONICS[l]);
    expect(letters.every(Boolean)).toBe(true);
    expect(new Set(letters).size).toBe(labels.length);
    for (const l of labels) expect(splitMnemonic(l, MENU_MNEMONICS[l])).not.toBeNull();
    expect(menuForMnemonic("f")).toBe(0); // the real menu bar starts with File
  });
  it("no letter is taken by a plain Alt+letter shortcut", () => {
    const src = ["src/lib/commands.ts", "src/lib/gitCommands.ts"].map((f) => readFileSync(f, "utf8")).join("\n");
    const registered = [...src.matchAll(/keys: "Alt\+([A-Z])"/g)].map((m) => m[1].toLowerCase());
    expect(registered).toContain("z");
    // CodeMirror's Alt+L / Alt+U and the find bar's Alt+C / W / R / P.
    const taken = new Set([...registered, "l", "u", "c", "w", "r", "p"]);
    for (const l of labels) expect(taken.has(MENU_MNEMONICS[l])).toBe(false);
  });
  it("Git › Stash lists the five stash commands, after Unstage Current File, with no Drop All and no shortcuts", () => {
    const menu = readFileSync("src/components/MenuBar.tsx", "utf8");
    const sub = /\{ cmd: "git\.unstageFile" \},\s*(?:\{[^\n]*\},\s*)?\{ label: "Stash", submenu: \(\) => \[([^\]]*)\] \}/.exec(menu);
    expect(sub).not.toBeNull();
    expect([...sub![1].matchAll(/cmd: "([^"]+)"/g)].map((m) => m[1])).toEqual(["git.stash", "git.stashApply", "git.stashPop", "git.stashDrop", "git.showStashes"]);
    const cmds = readFileSync("src/lib/gitCommands.ts", "utf8");
    const stash = cmds.split("\n").filter((l) => /register\(\{ id: "git\.(stash|showStashes)/.test(l));
    expect(stash).toHaveLength(5);
    expect(stash.some((l) => l.includes("keys:"))).toBe(false);
    expect(/Drop All|stashClear|stashDropAll/i.test(menu + cmds)).toBe(false);
  });
  it("Git › Claude is the last group of the Git menu, left out while Claude Code is off, with no shortcuts", () => {
    const menu = readFileSync("src/components/MenuBar.tsx", "utf8");
    // The whole submenu is inside the claudeEnabled condition (left out, not greyed), right before the Git menu ends.
    const sub = /\.\.\.\(useStore\.getState\(\)\.settings\.claudeEnabled\s*\? \(\[\{ sep: true \}, \{ label: "Claude", submenu: \(\) => \[([^\]]*)\] \}\] as Item\[\]\)\s*: \[\]\),\s*\],\s*\},\s*\{\s*label: "JSON"/.exec(menu);
    expect(sub).not.toBeNull();
    expect([...sub![1].matchAll(/cmd: "([^"]+)"/g)].map((m) => m[1])).toEqual(["git.draftMessage", "git.explainConflict", "git.summariseBranch", "git.stopClaude"]);
    // Explain is not also in the Conflicts submenu.
    expect(/label: "Conflicts", submenu: \(\) => \[[^\]]*explainConflict/.test(menu)).toBe(false);
    const cmds = readFileSync("src/lib/gitCommands.ts", "utf8");
    const mine = cmds.split("\n").filter((l) => /id: "git\.(draftMessage|explainConflict|summariseBranch|stopClaude)"/.test(l));
    expect(mine).toHaveLength(4);
    expect(mine.some((l) => l.includes("keys:"))).toBe(false);
  });
  it("reads the letter from the physical key and only for a bare Alt", () => {
    expect(mnemonicKey(key("KeyF"))).toBe("f");
    expect(mnemonicKey({ ...key("KeyF"), key: "ƒ" })).toBe("f");
    expect(mnemonicKey(key("KeyF", { ctrlKey: true }))).toBeNull();
    expect(mnemonicKey(key("KeyF", { shiftKey: true }))).toBeNull();
    expect(mnemonicKey(key("KeyF", { altKey: false }))).toBeNull();
    expect(mnemonicKey({ ...key("KeyF"), code: "F4", key: "F4" })).toBeNull();
  });
  it("splits a label around the first occurrence of its letter", () => {
    expect(splitMnemonic("Scripts", "i")).toEqual(["Scr", "i", "pts"]);
    expect(splitMnemonic("JSON", "j")).toEqual(["", "J", "SON"]);
    expect(splitMnemonic("Help", "x")).toBeNull();
    expect(splitMnemonic("Help", undefined)).toBeNull();
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
