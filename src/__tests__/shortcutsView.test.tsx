import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Keyboard Shortcuts tab in jsdom (specs/settings.md SET-020), with the Tauri side replaced.
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => undefined }));

const { render, cleanup, flush, fire, byText, act } = await import("./helpers/render");
const { ShortcutsView, listedRows } = await import("../components/ShortcutsView");
const { getKeyCapture, register, resolveStroke, setKeyOverrides } = await import("../lib/commands");
const { sortKeyRows } = await import("../lib/keybindings");
const { useStore } = await import("../lib/store");
const { dismissDialog } = await import("../lib/dialogs");
const { bus } = await import("../lib/bus");
const { openShortcuts } = await import("../lib/shortcutsTab");

register({ id: "sc.alpha", title: "Alpha", category: "Test", keys: "Ctrl+Alt+Shift+F1", run: () => true });
register({ id: "sc.beta", title: "Beta", category: "Test", run: () => true });
register({ id: "sc.chord", title: "Gamma", category: "Test", keys: "Ctrl+Alt+Shift+F2 G", run: () => true });
register({ id: "sc.hidden", title: "Hidden Alias", category: "Test", keys: "Ctrl+Alt+Shift+F3", hidden: true, run: () => true });
// What registerAllCommands installs in the application.
useStore.subscribe((s, p) => {
  if (s.settings.keybindings !== p.settings.keybindings) setKeyOverrides(s.settings.keybindings);
});

const doc = { id: "sc-doc", kind: "shortcuts" as const, path: null, name: "Keyboard Shortcuts", dirty: false, encoding: "", bom: false, eol: "CRLF" as const, language: "Keyboard Shortcuts", readonly: true, modifiedMs: 0 };
const view = () => <ShortcutsView doc={doc} visible />;
const rowOf = (id: string) => document.querySelector<HTMLElement>(`.shortcut-row[data-command="${id}"]`);
const button = (id: string, label: string) => rowOf(id)!.querySelector<HTMLButtonElement>(`button[aria-label^="${label}"]`)!;
const bindings = () => useStore.getState().settings.keybindings;
const search = () => document.querySelector<HTMLInputElement>('input[aria-label="Search keyboard shortcuts"]')!;
/** Types into a React-controlled input. */
const typeInto = (el: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
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

describe("listedRows / sortKeyRows", () => {
  const rows = [
    { id: "b", title: "Zeta", category: "Edit", keys: "", defaultKeys: "" },
    { id: "a", title: "Alpha", category: "View", keys: "Ctrl+B", defaultKeys: "Ctrl+B" },
    { id: "c", title: "Mid", category: "Edit", keys: "Alt+A", defaultKeys: "Ctrl+M" },
    { id: "h", title: "Hidden", category: "Edit", keys: "F9", defaultKeys: "F9", hidden: true },
  ];
  it("lists every visible command, then the search and Changed only", () => {
    expect(listedRows(rows, "", false).map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(listedRows(rows, "ctrl+b", false).map((r) => r.id)).toEqual(["a"]);
    expect(listedRows(rows, "", true).map((r) => r.id)).toEqual(["c"]);
  });
  it("sorts by category, name or keys (no keys last)", () => {
    expect(sortKeyRows(rows.slice(0, 3), "category").map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect(sortKeyRows(rows.slice(0, 3), "name").map((r) => r.id)).toEqual(["a", "c", "b"]);
    expect(sortKeyRows(rows.slice(0, 3), "keys").map((r) => r.id)).toEqual(["c", "a", "b"]);
  });
});

describe("ShortcutsView", () => {
  it("lists every command with its keys, never an untouched hidden one, and narrows to Changed only", async () => {
    await render(view());
    expect(rowOf("sc.alpha")!.textContent).toContain("Alpha");
    expect(rowOf("sc.alpha")!.querySelector(".kbd")!.textContent).toBe("Ctrl+Alt+Shift+F1");
    expect(rowOf("sc.beta")!.textContent).toContain("None");
    expect(rowOf("sc.hidden")).toBeNull();
    await fire.click(byText(document.body, "button", "Changed only")[0]);
    expect(rowOf("sc.alpha")).toBeNull();
    expect(document.body.textContent).toContain("No shortcuts changed");
  });

  it("the search finds commands by name or keys, and Settings' filter can fill it", async () => {
    await render(view());
    await typeInto(search(), "gamma");
    expect(rowOf("sc.chord")).not.toBeNull();
    expect(rowOf("sc.alpha")).toBeNull();
    expect(rowOf("sc.chord")!.querySelector("mark")!.textContent).toBe("Gamma");
    await typeInto(search(), "ctrl+alt+shift+f1");
    expect(rowOf("sc.alpha")).not.toBeNull();
    expect(rowOf("sc.chord")).toBeNull();
    await act(async () => bus.emit("shortcuts.query", "beta"));
    expect(search().value).toBe("beta");
    expect(rowOf("sc.beta")).not.toBeNull();
  });

  it("opens one tab, reused with a new search", async () => {
    await act(async () => openShortcuts("alpha"));
    await act(async () => openShortcuts());
    const tabs = useStore.getState().docs.filter((d) => d.kind === "shortcuts");
    expect(tabs).toHaveLength(1);
    expect(useStore.getState().activeId).toBe(tabs[0].id);
    await render(<ShortcutsView doc={tabs[0]} visible />);
    expect(search().value).toBe("alpha");
    await act(async () => useStore.getState().removeDoc(tabs[0].id));
  });

  it("records new keys and assigns them on Enter", async () => {
    await render(view());
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

  it("a double-click on a row starts recording, and leaving the tab ends it", async () => {
    const m = await render(view());
    await act(async () => { rowOf("sc.beta")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    expect(getKeyCapture()).not.toBeNull();
    await m.rerender(<ShortcutsView doc={doc} visible={false} />);
    expect(getKeyCapture()).toBeNull();
  });

  it("says whose keys they are and takes them away on Assign", async () => {
    await render(view());
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
    await render(view());
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
    await render(view());
    await fire.click(button("sc.beta", "Change"));
    await F(2);
    await press("b", { code: "KeyB" });
    await press("Enter");
    expect(bindings()).toEqual({ "sc.beta": "Ctrl+Alt+Shift+F2 B" });
  });

  it("removes a shortcut, shows a hidden command that lost its keys, and Restore all asks first", async () => {
    await render(view());
    await act(async () => useStore.getState().updateSettings({ keybindings: { "sc.hidden": "" } }));
    expect(rowOf("sc.hidden")).not.toBeNull();
    await fire.click(button("sc.alpha", "Remove"));
    expect(bindings()).toEqual({ "sc.hidden": "", "sc.alpha": "" });
    expect(runs("Ctrl+Alt+Shift+F1")).toBe("none");
    expect(document.querySelector(".shortcuts-foot")!.textContent).toContain("2 changed");
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
