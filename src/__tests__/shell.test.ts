import { beforeEach, describe, expect, it } from "vitest";
import { eventToKeys, getCommandsForKeys, normalizeKeys, register, resolveStroke } from "../lib/commands";
import { choose, dismissDialog, inform } from "../lib/dialogs";
import { useStore, type DialogAction } from "../lib/store";
import { dialogCancelAction, dialogDefaultAction } from "../components/Toasts";
import { placePopup } from "../components/StatusBar";

const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

describe("normalizeKeys", () => {
  it("orders modifiers Ctrl, Alt, Shift and upper-cases single letters", () => {
    expect(normalizeKeys("shift+ctrl+p")).toBe("Ctrl+Shift+P");
    expect(normalizeKeys("Alt+Ctrl+Shift+f")).toBe("Ctrl+Alt+Shift+F");
    expect(normalizeKeys("Ctrl+Tab")).toBe("Ctrl+Tab");
  });
  it("keeps the two strokes of a chord", () => {
    expect(normalizeKeys("ctrl+k  ctrl+s")).toBe("Ctrl+K Ctrl+S");
  });
});

describe("eventToKeys", () => {
  it("ignores a lone modifier", () => {
    expect(eventToKeys(key({ key: "Control", ctrlKey: true }))).toBeNull();
    expect(eventToKeys(key({ key: "Shift", shiftKey: true }))).toBeNull();
  });
  it("uses the physical key for letters and digits", () => {
    // Shift+Ctrl+P reports "P"; an AZERTY "a" on the Q key still matches by code.
    expect(eventToKeys(key({ key: "P", code: "KeyP", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+P");
    expect(eventToKeys(key({ key: "a", code: "KeyQ", ctrlKey: true }))).toBe("Ctrl+Q");
    expect(eventToKeys(key({ key: "!", code: "Digit1", shiftKey: true }))).toBe("Shift+1");
  });
  it("names Space, arrows and Plus, and treats Meta as Ctrl", () => {
    expect(eventToKeys(key({ key: " ", code: "Space", ctrlKey: true }))).toBe("Ctrl+Space");
    expect(eventToKeys(key({ key: "ArrowUp", altKey: true }))).toBe("Alt+Up");
    expect(eventToKeys(key({ key: "+", code: "Equal", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+Plus");
    expect(eventToKeys(key({ key: "s", code: "KeyS", metaKey: true }))).toBe("Ctrl+S");
  });
});

describe("resolveStroke", () => {
  let allowed = true;
  register({ id: "test.single", title: "Single", category: "Test", keys: "Ctrl+Alt+Shift+F9", run: () => true });
  register({ id: "test.chord", title: "Chord", category: "Test", keys: "Ctrl+Alt+F8 Q", run: () => true });
  register({ id: "test.when", title: "When", category: "Test", keys: "Ctrl+Alt+Shift+F7", run: () => true, when: () => allowed });

  it("runs a single-stroke shortcut", () => {
    const r = resolveStroke("Ctrl+Alt+Shift+F9", null);
    expect(r.kind).toBe("run");
    expect(r.kind === "run" && r.cmds.map((c) => c.id)).toEqual(["test.single"]);
  });
  it("starts a chord on its first stroke and runs it on the second", () => {
    expect(resolveStroke("Ctrl+Alt+F8", null)).toEqual({ kind: "chordStart" });
    const r = resolveStroke("Q", "Ctrl+Alt+F8");
    expect(r.kind === "run" && r.cmds.map((c) => c.id)).toEqual(["test.chord"]);
  });
  it("reports a second stroke that completes no chord", () => {
    expect(resolveStroke("W", "Ctrl+Alt+F8")).toEqual({ kind: "chordMiss", keys: "Ctrl+Alt+F8 W" });
  });
  it("lets an unbound key through", () => {
    expect(resolveStroke("Ctrl+Alt+Shift+F6", null)).toEqual({ kind: "none" });
  });
  it("honours when(): a guarded shortcut falls through", () => {
    allowed = false;
    expect(resolveStroke("Ctrl+Alt+Shift+F7", null)).toEqual({ kind: "none" });
    expect(getCommandsForKeys("Ctrl+Alt+Shift+F7")).toEqual([]);
    allowed = true;
    expect(resolveStroke("Ctrl+Alt+Shift+F7", null).kind).toBe("run");
  });
  it("swallows a chord prefix even though no command has that key alone", () => {
    expect(getCommandsForKeys("Ctrl+Alt+F8")).toHaveLength(1);
  });
});

describe("dialogDefaultAction / dialogCancelAction", () => {
  const a = (label: string, extra: Partial<DialogAction> = {}): DialogAction => ({ label, run: () => {}, ...extra });
  it("Enter runs the marked default, else the first non-danger action, else the first", () => {
    expect(dialogDefaultAction([a("Delete", { kind: "danger" }), a("Cancel"), a("Keep", { default: true })])?.label).toBe("Keep");
    expect(dialogDefaultAction([a("Delete", { kind: "danger" }), a("Cancel")])?.label).toBe("Cancel");
    expect(dialogDefaultAction([a("Delete", { kind: "danger" })])?.label).toBe("Delete");
    expect(dialogDefaultAction([])).toBeUndefined();
  });
  it("Escape runs the marked cancel, else a button labelled Cancel, else nothing", () => {
    expect(dialogCancelAction([a("Cancel"), a("Don't Save", { cancel: true })])?.label).toBe("Don't Save");
    expect(dialogCancelAction([a("Save"), a(" cancel ")])?.label).toBe(" cancel ");
    expect(dialogCancelAction([a("Save"), a("Discard")])).toBeUndefined();
  });
});

describe("placePopup", () => {
  it("right-aligns the popup with its status-bar segment", () => {
    window.innerHeight = 800;
    expect(placePopup({ left: 600, right: 700, top: 780 }, 200, 1200)).toEqual({ left: 500, bottom: 24 });
  });
  it("stays inside the window on both sides", () => {
    window.innerHeight = 800;
    expect(placePopup({ left: 1150, right: 1250, top: 780 }, 200, 1200).left).toBe(992);
    expect(placePopup({ left: 0, right: 50, top: 780 }, 200, 1200).left).toBe(8);
  });
});

describe("dialog queue", () => {
  beforeEach(() => {
    while (useStore.getState().dialog) dismissDialog();
  });
  const press = (label: string) => useStore.getState().dialog!.actions.find((x) => x.label === label)!.run();

  it("shows one dialog at a time and resolves each with the button chosen", async () => {
    const first = choose("First", "", [{ label: "Yes", value: 1 }, { label: "No", value: 2 }], 0);
    const second = choose("Second", "", [{ label: "OK", value: "ok" }], "none");
    expect(useStore.getState().dialog?.title).toBe("First");
    press("No");
    expect(await first).toBe(2);
    expect(useStore.getState().dialog?.title).toBe("Second");
    press("OK");
    expect(await second).toBe("ok");
    expect(useStore.getState().dialog).toBeNull();
  });
  it("dismissing resolves with the dismissed value and moves to the next", async () => {
    const first = choose("First", "", [{ label: "Yes", value: true }], false);
    const second = inform("Second", "Done");
    dismissDialog();
    expect(await first).toBe(false);
    expect(useStore.getState().dialog?.title).toBe("Second");
    expect(useStore.getState().dialog?.actions.map((x) => [x.label, x.default, x.cancel])).toEqual([["OK", true, true]]);
    press("OK");
    await expect(second).resolves.toBeUndefined();
  });
  it("a stale button of a closed dialog does nothing", async () => {
    const first = choose("First", "", [{ label: "Yes", value: 1 }], 0);
    const stale = useStore.getState().dialog!.actions[0];
    const second = choose("Second", "", [{ label: "Yes", value: 2 }], 0);
    stale.run();
    expect(await first).toBe(1);
    stale.run(); // the first dialog is gone; the second must stay open
    expect(useStore.getState().dialog?.title).toBe("Second");
    press("Yes");
    expect(await second).toBe(2);
  });
});
