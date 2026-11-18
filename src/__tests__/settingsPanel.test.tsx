import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Settings panel in jsdom (specs/settings.md SET-001, SET-004, SET-014, SET-021), with the Tauri side replaced.
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (cmd: string) => (cmd === "app_data_path" ? "C:\\Data\\com.quarry.app" : null) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async () => null }));
// jsdom has no canvas: the font check then counts every font as installed.
HTMLCanvasElement.prototype.getContext = (() => null) as never;

const { render, cleanup, flush, fire, byText, act } = await import("./helpers/render");
const { SettingsPanel, SECTIONS, modifiedKeys, splitPath, sameValue } = await import("../components/panels/SettingsPanel");
const { splitMatches } = await import("../components/MatchText");
const { register } = await import("../lib/commands");
const { useStore } = await import("../lib/store");
const { DEFAULT_SETTINGS } = await import("../lib/types");

register({ id: "sp.dup", title: "Duplicate Line Down", category: "Edit", keys: "Ctrl+Shift+D", run: () => true });

const filter = () => document.querySelector<HTMLInputElement>('input[aria-label="Filter settings"]')!;
const typeInto = (el: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const sectionsWithRows = () =>
  [...document.querySelectorAll<HTMLElement>(".settings-section")].filter((s) => s.querySelector(".field-row")).map((s) => s.dataset.section);
const labels = () => [...document.querySelectorAll(".settings-card .field-row .field-label > span")].map((e) => e.textContent?.trim());
const chips = () => [...document.querySelectorAll(".settings-chips button")].map((b) => b.textContent);

beforeEach(async () => {
  try { localStorage.clear(); } catch { /* none */ }
  await act(async () => useStore.getState().updateSettings({ ...DEFAULT_SETTINGS }));
});
afterEach(cleanup);

describe("Settings helpers", () => {
  it("counts the settings changed from their defaults that have a row", () => {
    expect(modifiedKeys({ ...DEFAULT_SETTINGS })).toEqual([]);
    expect(modifiedKeys({ ...DEFAULT_SETTINGS, tabSize: 2, keybindings: { a: "" } })).toEqual(["tabSize", "keybindings"]);
    // The custom command has no row unless Custom… is the shell; server lists none with code intelligence off.
    expect(modifiedKeys({ ...DEFAULT_SETTINGS, terminalCustom: "wsl.exe" })).toEqual([]);
    expect(modifiedKeys({ ...DEFAULT_SETTINGS, lspEnabled: false, lspDisabled: ["go"] })).toEqual(["lspEnabled"]);
  });
  it("compares lists and maps by content", () => {
    expect(sameValue([], [])).toBe(true);
    expect(sameValue({ a: "1" }, { a: "2" })).toBe(false);
    expect(sameValue(0, false)).toBe(false);
  });
  it("cuts a path before its last folder", () => {
    expect(splitPath("C:\\Users\\me\\scripts")).toEqual(["C:\\Users\\me", "\\scripts"]);
    expect(splitPath("scripts")).toEqual(["", "scripts"]);
  });
  it("splits text around the filter's matches", () => {
    expect(splitMatches("Word wrap", "WRAP")).toEqual(["Word ", "wrap", ""]);
    expect(splitMatches("abc", "")).toEqual(["abc"]);
  });
});

describe("SettingsPanel", () => {
  it("shows the sections in order, each as one card, with a jump button per section", async () => {
    await render(<SettingsPanel />);
    await flush();
    expect(sectionsWithRows()).toEqual(SECTIONS.map((s) => s[0]));
    expect(chips()).toEqual(SECTIONS.map((s) => s[2]));
    expect(document.querySelectorAll(".settings-card").length).toBe(SECTIONS.length);
  });

  it("filters by label, hint, keyword or group, highlights the match, and drops empty sections from the jump bar", async () => {
    await render(<SettingsPanel />);
    await typeInto(filter(), "wrap");
    expect(labels()).toEqual(["Word wrap"]);
    expect(document.querySelector(".settings-card mark")!.textContent).toBe("wrap");
    expect(chips()).toEqual(["Editor"]);
    await typeInto(filter(), "indent");
    expect(labels()).toEqual(["Tab size", "Insert spaces", "Pretty-print indent"]);
    await typeInto(filter(), "json");
    expect(labels()).toContain("Pretty-print indent");
    await typeInto(filter(), "zzzz");
    expect(sectionsWithRows()).toEqual([]);
    expect(document.querySelector(".settings-empty")!.textContent).toBe("No settings match “zzzz”");
  });

  it("Modified shows only changed settings, marked, and says when there are none", async () => {
    await render(<SettingsPanel />);
    const modified = () => byText(document.body, "button", "Modified")[0];
    await fire.click(modified());
    expect(document.querySelector(".settings-empty")!.textContent).toBe("Every setting has its default value");
    await act(async () => useStore.getState().updateSettings({ tabSize: 2, wordWrap: true }));
    expect(modified().textContent).toBe("Modified (2)");
    expect(labels()).toEqual(["Tab size", "Word wrap"]);
    expect(document.querySelectorAll(".field-row.modified").length).toBe(2);
    await fire.click(modified());
    expect(labels().length).toBeGreaterThan(20);
  });

  it("a section collapses from its heading, is remembered, and opens again from the jump bar", async () => {
    const m = await render(<SettingsPanel />);
    const head = () => document.querySelector<HTMLButtonElement>('.settings-section[data-section="editor"] .section-head')!;
    const card = () => document.querySelector<HTMLElement>('.settings-section[data-section="editor"] .settings-card')!;
    await fire.click(head());
    expect(head().getAttribute("aria-expanded")).toBe("false");
    expect(card().hidden).toBe(true);
    await m.unmount();
    await render(<SettingsPanel />);
    expect(card().hidden).toBe(true);
    // Filtering shows matches inside a collapsed section.
    await typeInto(filter(), "wrap");
    expect(card().hidden).toBe(false);
    await typeInto(filter(), "");
    await fire.click(document.querySelector('.settings-chips button[data-target="editor"]')!);
    expect(card().hidden).toBe(false);
  });

  it("the shortcuts row counts changes and offers the commands the filter finds", async () => {
    await render(<SettingsPanel />);
    const row = () => byText(document.body, ".field-row", "Keyboard shortcuts")[0];
    expect(row().textContent).toContain("No shortcuts changed");
    await typeInto(filter(), "duplicate line");
    expect(row().textContent).toContain("1 command match “duplicate line”");
    await fire.click(byText(row(), "button", "Show matches")[0]);
    const tab = useStore.getState().docs.find((d) => d.kind === "shortcuts");
    expect(tab).toBeTruthy();
    await act(async () => useStore.getState().removeDoc(tab!.id));
  });

  it("folder rows show the folder in use with its last part, and turn into a text box on click", async () => {
    await render(<SettingsPanel />);
    await flush();
    const path = document.querySelector<HTMLButtonElement>(".path-display")!;
    expect(path.querySelector(".path-tail")!.textContent).toBe("\\scripts");
    expect(path.title).toContain("C:\\Data\\com.quarry.app\\scripts");
    await fire.click(path);
    const box = document.querySelector<HTMLInputElement>('.field-row.stack input.input.mono')!;
    expect(box.value).toBe("C:\\Data\\com.quarry.app\\scripts");
  });
});
