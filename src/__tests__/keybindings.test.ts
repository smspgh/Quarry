import { describe, expect, it } from "vitest";
import { captureStep, checkKeys, keyRowMatches, restoreDefault, sanitizeKeybindings, strokeProblem, vacatedKeys, withKeys, type KeyRow } from "../lib/keybindings";
import { getCommandsForKeys, isVacatedKey, keyRows, register, resolveStroke, setKeyOverrides } from "../lib/commands";
import { sanitizeSettings } from "../lib/actions";
import { DEFAULT_SETTINGS } from "../lib/types";

const MNEMONICS = { File: "f", Edit: "e", Git: "g" };
const row = (id: string, keys: string, defaultKeys = keys, extra: Partial<KeyRow> = {}): KeyRow => ({ id, title: id.toUpperCase(), category: "Test", keys, defaultKeys, ...extra });
const ROWS = [row("save", "Ctrl+S"), row("lang", "Ctrl+K M"), row("dup", "Ctrl+Shift+D"), row("plain", "")];

describe("strokeProblem", () => {
  it("wants Ctrl or Alt, or a function key", () => {
    expect(strokeProblem("K", MNEMONICS)).toMatch(/needs Ctrl or Alt/);
    expect(strokeProblem("Shift+K", MNEMONICS)).toMatch(/needs Ctrl or Alt/);
    expect(strokeProblem("Enter", MNEMONICS)).toMatch(/needs Ctrl or Alt/);
    expect(strokeProblem("F6", MNEMONICS)).toBeNull();
    expect(strokeProblem("Shift+F6", MNEMONICS)).toBeNull();
    expect(strokeProblem("Ctrl+Alt+K", MNEMONICS)).toBeNull();
  });
  it("keeps the clipboard keys, F10 and the menu letters", () => {
    expect(strokeProblem("Ctrl+C", MNEMONICS)).toBe("Ctrl+C is kept for Copy.");
    expect(strokeProblem("F10", MNEMONICS)).toBe("F10 opens the menu bar.");
    expect(strokeProblem("Alt+G", MNEMONICS)).toBe("Alt+G opens the Git menu.");
    expect(strokeProblem("Alt+Q", MNEMONICS)).toBeNull();
    expect(strokeProblem("Alt+Shift+G", MNEMONICS)).toBeNull();
  });
});

describe("checkKeys", () => {
  it("accepts free keys and names the commands that have them now", () => {
    expect(checkKeys("Ctrl+Alt+J", "plain", ROWS, MNEMONICS)).toEqual({ ok: true, conflicts: [] });
    const r = checkKeys("Ctrl+S", "plain", ROWS, MNEMONICS);
    expect(r.ok && r.conflicts.map((c) => c.id)).toEqual(["save"]);
  });
  it("does not count the command's own keys as a conflict", () => {
    expect(checkKeys("Ctrl+S", "save", ROWS, MNEMONICS)).toEqual({ ok: true, conflicts: [] });
  });
  it("refuses a single stroke that starts a two-key shortcut, and the reverse", () => {
    const a = checkKeys("Ctrl+K", "plain", ROWS, MNEMONICS);
    expect(!a.ok && a.error).toBe("Ctrl+K starts two-key shortcuts such as Ctrl+K M (LANG).");
    const b = checkKeys("Ctrl+S X", "plain", ROWS, MNEMONICS);
    expect(!b.ok && b.error).toBe("Ctrl+S is the shortcut of SAVE, so a two-key shortcut cannot start with it.");
    expect(checkKeys("Ctrl+K X", "plain", ROWS, MNEMONICS)).toEqual({ ok: true, conflicts: [] });
  });
  it("refuses nothing pressed and three strokes", () => {
    expect(checkKeys("", "plain", ROWS, MNEMONICS).ok).toBe(false);
    expect(checkKeys("Ctrl+K A B", "plain", ROWS, MNEMONICS).ok).toBe(false);
  });
});

describe("withKeys / restoreDefault", () => {
  it("stores only what differs from the built-in keys", () => {
    expect(withKeys({}, ROWS, "plain", "Ctrl+Alt+J")).toEqual({ plain: "Ctrl+Alt+J" });
    expect(withKeys({ save: "Ctrl+Alt+S" }, ROWS, "save", "Ctrl+S")).toEqual({});
    expect(withKeys({}, ROWS, "save", "")).toEqual({ save: "" });
  });
  it("takes the keys away from the commands that had them", () => {
    expect(withKeys({}, ROWS, "plain", "Ctrl+S", ["save"])).toEqual({ plain: "Ctrl+S", save: "" });
  });
  it("restoring a default takes it back from a command the user gave it to", () => {
    const rows = [row("save", "", "Ctrl+S"), row("plain", "Ctrl+S", "")];
    expect(restoreDefault({ plain: "Ctrl+S", save: "" }, rows, "save")).toEqual({});
  });
  it("commands sharing keys by default both keep them", () => {
    const rows = [row("next", "Ctrl+Alt+N", "Ctrl+Tab"), row("nextAlias", "Ctrl+Tab", "Ctrl+Tab")];
    expect(restoreDefault({ next: "Ctrl+Alt+N" }, rows, "next")).toEqual({});
  });
});

describe("captureStep", () => {
  it("collects one or two strokes, then starts over", () => {
    expect(captureStep([], "Ctrl+K")).toEqual({ kind: "strokes", strokes: ["Ctrl+K"] });
    expect(captureStep(["Ctrl+K"], "J")).toEqual({ kind: "strokes", strokes: ["Ctrl+K", "J"] });
    expect(captureStep(["Ctrl+K", "J"], "Ctrl+L")).toEqual({ kind: "strokes", strokes: ["Ctrl+L"] });
  });
  it("Escape cancels, Enter accepts, Backspace clears", () => {
    expect(captureStep(["Ctrl+K"], "Escape")).toEqual({ kind: "cancel" });
    expect(captureStep(["Ctrl+K"], "Enter")).toEqual({ kind: "accept" });
    expect(captureStep(["Ctrl+K"], "Backspace")).toEqual({ kind: "strokes", strokes: [] });
    expect(captureStep([], "Ctrl+Enter")).toEqual({ kind: "strokes", strokes: ["Ctrl+Enter"] });
  });
});

describe("keyRowMatches / sanitizeKeybindings / vacatedKeys", () => {
  it("finds a command by name, category or keys", () => {
    const r = row("dup", "Ctrl+Shift+D", "Ctrl+Shift+D", { title: "Duplicate Line Down", category: "Edit" });
    expect(keyRowMatches("duplicate", r)).toBe(true);
    expect(keyRowMatches("edit: dup", r)).toBe(true);
    expect(keyRowMatches("ctrl+shift+d", r)).toBe(true);
    expect(keyRowMatches("ctrl shift d", r)).toBe(true);
    expect(keyRowMatches("git", r)).toBe(false);
  });
  it("keeps only string values of at most two strokes", () => {
    expect(sanitizeKeybindings({ a: "Ctrl+J", b: 3, c: "", d: "Ctrl+K A B", e: " Ctrl+K M " })).toEqual({ a: "Ctrl+J", c: "", e: "Ctrl+K M" });
    expect(sanitizeKeybindings(["x"])).toEqual({});
    expect(sanitizeKeybindings(null)).toEqual({});
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS, keybindings: "bad" as never }).keybindings).toEqual({});
  });
  it("a moved or removed built-in key is vacated unless something else uses it", () => {
    expect([...vacatedKeys([row("a", "", "Ctrl+/"), row("b", "Ctrl+Alt+B", "Alt+Up"), row("c", "Ctrl+K M")])]).toEqual(["Ctrl+/", "Alt+Up"]);
    expect([...vacatedKeys([row("a", "", "Ctrl+/"), row("b", "Ctrl+/", "")])]).toEqual([]);
  });
});

describe("setKeyOverrides", () => {
  register({ id: "kb.one", title: "One", category: "Test", keys: "Ctrl+Alt+Shift+F1", run: () => true });
  register({ id: "kb.two", title: "Two", category: "Test", run: () => true });
  const ids = (k: string) => {
    const r = resolveStroke(k, null);
    return r.kind === "run" ? r.cmds.map((c) => c.id) : r.kind;
  };
  const find = (id: string) => keyRows().find((r) => r.id === id)!;

  it("moves a shortcut, and the old key stops working", () => {
    setKeyOverrides({ "kb.one": "shift+alt+ctrl+F2" });
    expect(ids("Ctrl+Alt+Shift+F2")).toEqual(["kb.one"]);
    expect(ids("Ctrl+Alt+Shift+F1")).toBe("none");
    expect(isVacatedKey("Ctrl+Alt+Shift+F1")).toBe(true);
    expect(find("kb.one")).toMatchObject({ keys: "Ctrl+Alt+Shift+F2", defaultKeys: "Ctrl+Alt+Shift+F1" });
  });
  it("removes a shortcut and gives a command without one a two-key shortcut", () => {
    setKeyOverrides({ "kb.one": "", "kb.two": "Ctrl+Alt+Shift+F3 T" });
    expect(ids("Ctrl+Alt+Shift+F1")).toBe("none");
    expect(find("kb.one").keys).toBe("");
    expect(ids("Ctrl+Alt+Shift+F3")).toBe("chordStart");
    expect(getCommandsForKeys("Ctrl+Alt+Shift+F3")).toHaveLength(1);
    const r = resolveStroke("T", "Ctrl+Alt+Shift+F3");
    expect(r.kind === "run" && r.cmds.map((c) => c.id)).toEqual(["kb.two"]);
  });
  it("goes back to the built-in keys", () => {
    setKeyOverrides({});
    expect(ids("Ctrl+Alt+Shift+F1")).toEqual(["kb.one"]);
    expect(ids("Ctrl+Alt+Shift+F3")).toBe("none");
    expect(isVacatedKey("Ctrl+Alt+Shift+F1")).toBe(false);
    expect(find("kb.two")).toMatchObject({ keys: "", defaultKeys: "" });
  });
  it("a command registered later gets the user's keys too", () => {
    setKeyOverrides({ "kb.late": "Ctrl+Alt+Shift+F4" });
    register({ id: "kb.late", title: "Late", category: "Test", keys: "Ctrl+Alt+Shift+F5", run: () => true });
    expect(ids("Ctrl+Alt+Shift+F4")).toEqual(["kb.late"]);
    expect(ids("Ctrl+Alt+Shift+F5")).toBe("none");
    setKeyOverrides({});
    expect(ids("Ctrl+Alt+Shift+F5")).toEqual(["kb.late"]);
  });
});
