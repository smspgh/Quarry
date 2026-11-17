import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Settings › Keyboard shortcuts in jsdom (specs/settings.md SET-020), with the Tauri side replaced.
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => undefined }));

const { render, cleanup, flush, fire, byText, act } = await import("./helpers/render");
const { ShortcutsSection } = await import("../components/panels/ShortcutsSection");
const { getKeyCapture, register, resolveStroke, setKeyOverrides } = await import("../lib/commands");
const { useStore } = await import("../lib/store");
const { dismissDialog } = await import("../lib/dialogs");

register({ id: "sc.alpha", title: "Alpha", category: "Test", keys: "Ctrl+Alt+Shift+F1", run: () => true });
register({ id: "sc.beta", title: "Beta", category: "Test", run: () => true });
register({ id: "sc.chord", title: "Gamma", category: "Test", keys: "Ctrl+Alt+Shift+F2 G", run: () => true });
register({ id: "sc.hidden", title: "Hidden Alias", category: "Test", keys: "Ctrl+Alt+Shift+F3", hidden: true, run: () => true });
// What registerAllCommands installs in the application.
useStore.subscribe((s, p) => {
  if (s.settings.keybindings !== p.settings.keybindings) setKeyOverrides(s.settings.keybindings);
});

const rowOf = (id: string) => document.querySelector<HTMLElement>(`.shortcut-row[data-command="${id}"]`);
const button = (id: string, label: string) => rowOf(id)!.querySelector<HTMLButtonElement>(`button[aria-label^="${label}"]`)!;
const bindings = () => useStore.getState().settings.keybindings;
const press = (key: string, init: KeyboardEventInit = {}) =>
  act(async () => {
    getKeyCapture()!(new KeyboardEvent("keydown", { key, cancelable: true, ...init }));
  });
const F = (n: number) => press(`F${n}`, { ctrlKey: true, altKey: true, shiftKey: true });
const runs = (k: string) => {
  const r = resolveStroke(k, null);
  return r.kind === "run" ? r.cmds.map((c) => c.id) : r.kind;
};
const status = (id: string) => rowOf(id)!.querySelector("[role=status]")!.textContent;

beforeEach(async () => {
  await act(async () => useStore.getState().updateSettings({ keybindings: {} }));
});
afterEach(async () => {
  dismissDialog();
  await cleanup();
});

describe("ShortcutsSection", () => {
  it("lists only changed shortcuts until Show all, and never an untouched hidden command", async () => {
    await render(<ShortcutsSection query="" />);
    expect(document.body.textContent).toContain("No shortcuts changed");
    expect(rowOf("sc.alpha")).toBeNull();
    await fire.click(byText(document.body, "button", "Show all")[0]);
    expect(rowOf("sc.alpha")!.textContent).toContain("Test: Alpha");
    expect(rowOf("sc.alpha")!.querySelector(".kbd")!.textContent).toBe("Ctrl+Alt+Shift+F1");
    expect(rowOf("sc.beta")!.textContent).toContain("None");
    expect(rowOf("sc.hidden")).toBeNull();
  });

  it("the Settings filter finds commands by name or keys", async () => {
    const m = await render(<ShortcutsSection query="gamma" />);
    expect(rowOf("sc.chord")).not.toBeNull();
    expect(rowOf("sc.alpha")).toBeNull();
    await m.rerender(<ShortcutsSection query="ctrl+alt+shift+f1" />);
    expect(rowOf("sc.alpha")).not.toBeNull();
    expect(byText(document.body, "button", "Show all")).toHaveLength(0);
  });

  it("records new keys and assigns them on Enter", async () => {
    await render(<ShortcutsSection query="beta" />);
    await fire.click(button("sc.beta", "Change"));
    expect(getKeyCapture()).not.toBeNull();
    await F(6);
    expect(rowOf("sc.beta")!.querySelector(".shortcut-capture")!.textContent).toBe("Ctrl+Alt+Shift+F6");
    await press("Enter");
    expect(bindings()).toEqual({ "sc.beta": "Ctrl+Alt+Shift+F6" });
    expect(runs("Ctrl+Alt+Shift+F6")).toEqual(["sc.beta"]);
    expect(getKeyCapture()).toBeNull();
    expect(rowOf("sc.beta")!.querySelector(".kbd")!.textContent).toBe("Ctrl+Alt+Shift+F6");
  });

  it("says whose keys they are and takes them away on Assign", async () => {
    await render(<ShortcutsSection query="Test:" />);
    await fire.click(button("sc.beta", "Change"));
    await F(1);
    expect(status("sc.beta")).toContain("is the shortcut of Alpha");
    await fire.click(byText(rowOf("sc.beta")!, "button", "Assign")[0]);
    expect(bindings()).toEqual({ "sc.beta": "Ctrl+Alt+Shift+F1", "sc.alpha": "" });
    expect(runs("Ctrl+Alt+Shift+F1")).toEqual(["sc.beta"]);
    // Restoring Alpha's default takes the keys back from Beta.
    await fire.click(button("sc.alpha", "Restore"));
    expect(bindings()).toEqual({});
    expect(runs("Ctrl+Alt+Shift+F1")).toEqual(["sc.alpha"]);
  });

  it("refuses keys that cannot be a shortcut and keeps Assign off", async () => {
    await render(<ShortcutsSection query="beta" />);
    await fire.click(button("sc.beta", "Change"));
    await press("k", { code: "KeyK" });
    expect(status("sc.beta")).toBe("A shortcut needs Ctrl or Alt, or a function key.");
    expect(byText(rowOf("sc.beta")!, "button", "Assign")[0].hasAttribute("disabled")).toBe(true);
    await press("Enter");
    expect(bindings()).toEqual({});
    await press("Backspace");
    await press("f", { code: "KeyF", altKey: true });
    expect(status("sc.beta")).toBe("Alt+F opens the File menu.");
    await press("Backspace");
    await F(2);
    expect(status("sc.beta")).toContain("starts two-key shortcuts such as Ctrl+Alt+Shift+F2 G (Gamma)");
    await press("Escape");
    expect(getKeyCapture()).toBeNull();
    expect(bindings()).toEqual({});
  });

  it("records a two-key shortcut", async () => {
    await render(<ShortcutsSection query="beta" />);
    await fire.click(button("sc.beta", "Change"));
    await F(2);
    await press("b", { code: "KeyB" });
    await press("Enter");
    expect(bindings()).toEqual({ "sc.beta": "Ctrl+Alt+Shift+F2 B" });
  });

  it("removes a shortcut, shows a hidden command that lost its keys, and Restore all asks first", async () => {
    await render(<ShortcutsSection query="" />);
    await act(async () => useStore.getState().updateSettings({ keybindings: { "sc.hidden": "" } }));
    expect(rowOf("sc.hidden")).not.toBeNull();
    await fire.click(byText(document.body, "button", "Show all")[0]);
    await fire.click(button("sc.alpha", "Remove"));
    expect(bindings()).toEqual({ "sc.hidden": "", "sc.alpha": "" });
    expect(runs("Ctrl+Alt+Shift+F1")).toBe("none");
    expect(document.body.textContent).toContain("2 shortcuts changed");
    await fire.click(byText(document.body, "button", "Restore all")[0]);
    const dialog = useStore.getState().dialog!;
    expect(dialog.title).toBe("Restore all keyboard shortcuts?");
    expect(bindings()).toEqual({ "sc.hidden": "", "sc.alpha": "" });
    await act(async () => dialog.actions.find((a) => a.label === "Restore")!.run());
    await flush();
    expect(bindings()).toEqual({});
    expect(runs("Ctrl+Alt+Shift+F1")).toEqual(["sc.alpha"]);
  });
});
