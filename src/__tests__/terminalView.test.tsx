import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc } from "../lib/store";

// TerminalView with xterm.js replaced by a fake terminal (jsdom has no canvas / layout), and the
// pty commands and events by in-memory ones.
const h = vi.hoisted(() => ({
  calls: [] as { cmd: string; args: Record<string, unknown> }[],
  listeners: new Map<string, (e: { payload: unknown }) => void>(),
  clipboard: { written: [] as string[], text: "" },
  terms: [] as FakeTerminal[],
}));

interface KeyLike { type: string; key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; preventDefault: () => void }
interface FakeTerminal {
  cols: number;
  rows: number;
  written: string[];
  pasted: string[];
  resets: number;
  selection: string;
  data?: (d: string) => void;
  key?: (e: KeyLike) => boolean;
}

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    written: string[] = [];
    pasted: string[] = [];
    resets = 0;
    selection = "";
    options: Record<string, unknown> = {};
    data?: (d: string) => void;
    key?: (e: KeyLike) => boolean;
    constructor() {
      h.terms.push(this);
    }
    loadAddon() {}
    open() {}
    focus() {}
    dispose() {}
    write(s: string) { this.written.push(s); }
    paste(s: string) { this.pasted.push(s); }
    reset() { this.resets++; this.written = []; }
    onData(cb: (d: string) => void) { this.data = cb; }
    onResize() {}
    attachCustomKeyEventHandler(cb: (e: KeyLike) => boolean) { this.key = cb; }
    hasSelection() { return this.selection !== ""; }
    getSelection() { return this.selection; }
    clearSelection() { this.selection = ""; }
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: async (s: string) => { h.clipboard.written.push(s); },
  readText: async () => h.clipboard.text,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    h.calls.push({ cmd, args });
    if (cmd === "pty_start") return 7;
    return undefined;
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, cb: (e: { payload: unknown }) => void) => {
    h.listeners.set(name, cb);
    return () => h.listeners.delete(name);
  },
}));

const { render, cleanup, flush, act } = await import("./helpers/render");
const { TerminalView } = await import("../components/TerminalView");

/** A one-off command tab with `command`, else a PowerShell tab. */
const doc = (command?: string) => ({ id: "term-1", kind: "terminal", name: "PowerShell · proj", terminal: { cwd: "C:\\work\\proj", command, shell: command ? undefined : { name: "PowerShell", argv: ["pwsh.exe"] } } }) as unknown as Doc;
const term = () => h.terms[h.terms.length - 1];
const screen = () => term().written.join("");
const writes = () => h.calls.filter((c) => c.cmd === "pty_write").map((c) => c.args);
const starts = () => h.calls.filter((c) => c.cmd === "pty_start");
const emit = (name: string, payload: unknown) => act(async () => h.listeners.get(name)?.({ payload }));
/** Runs the terminal's key handler; true = xterm passes the key on to the program. */
function key(k: string, mods: { shift?: boolean; ctrl?: boolean } = {}) {
  const e: KeyLike = { type: "keydown", key: k, ctrlKey: mods.ctrl ?? true, shiftKey: mods.shift ?? false, altKey: false, preventDefault: vi.fn() };
  return { passed: term().key!(e), prevented: (e.preventDefault as ReturnType<typeof vi.fn>).mock.calls.length > 0 };
}

async function mount(command?: string) {
  await render(<TerminalView doc={doc(command)} visible />);
  await flush();
}

describe("TerminalView", () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.listeners.clear();
    h.clipboard.written.length = 0;
    h.clipboard.text = "";
    h.terms.length = 0;
  });
  afterEach(cleanup);

  it("starts the shell in the tab's folder and sends keystrokes to pty_write", async () => {
    await mount();
    expect(starts()).toHaveLength(1);
    expect(starts()[0].args).toMatchObject({ cwd: "C:\\work\\proj", cols: 80, rows: 24 });
    await act(async () => term().data!("l"));
    await act(async () => term().data!("\x1b"));
    expect(writes()).toEqual([{ id: 7, data: "l" }, { id: 7, data: "\x1b" }]);
  });

  it("shows the program's output for its own pty only", async () => {
    await mount();
    await emit("pty:data", { id: 7, data: "hello" });
    await emit("pty:data", { id: 8, data: "other tab" });
    expect(screen()).toBe("hello");
  });

  it("Ctrl+C copies a selection instead of interrupting", async () => {
    await mount();
    term().selection = "some output";
    const r = key("c");
    await flush(1);
    expect(r).toEqual({ passed: false, prevented: true });
    expect(h.clipboard.written).toEqual(["some output"]);
    expect(term().selection).toBe("");
  });

  it("Ctrl+C without a selection goes to the program", async () => {
    await mount();
    expect(key("c").passed).toBe(true);
    await flush(1);
    expect(h.clipboard.written).toEqual([]);
  });

  it("Ctrl+Shift+C copies a selection, and without one sends nothing and leaves the clipboard alone", async () => {
    await mount();
    term().selection = "abc";
    expect(key("C", { shift: true }).passed).toBe(false);
    await flush(1);
    expect(h.clipboard.written).toEqual(["abc"]);
    expect(key("C", { shift: true })).toEqual({ passed: false, prevented: true });
    await flush(1);
    expect(h.clipboard.written).toEqual(["abc"]);
    expect(writes()).toEqual([]);
  });

  it("Ctrl+V and Ctrl+Shift+V paste the clipboard text; an empty clipboard pastes nothing", async () => {
    await mount();
    expect(key("v").passed).toBe(false); // handled here, not by xterm
    await flush(1);
    expect(term().pasted).toEqual([]);
    h.clipboard.text = "npm test";
    key("v");
    key("V", { shift: true });
    await flush(1);
    expect(term().pasted).toEqual(["npm test", "npm test"]);
  });

  it("other Ctrl keys and plain keys go to the program", async () => {
    await mount();
    expect(key("w").passed).toBe(true);
    expect(key("r").passed).toBe(true);
    expect(key("a", { ctrl: false }).passed).toBe(true);
  });

  it("a failed exit prints the exit line with its code; other keys do nothing and Enter starts the shell again", async () => {
    await mount();
    await emit("pty:exit", { id: 7, code: 1 });
    expect(screen()).toContain("[PowerShell ended (exit code 1). Press Enter to start it again.]");
    await act(async () => term().data!("x"));
    expect(writes()).toEqual([]);
    expect(starts()).toHaveLength(1);
    await act(async () => term().data!("\r"));
    await flush();
    expect(term().resets).toBe(1);
    expect(starts()).toHaveLength(2);
    await act(async () => term().data!("y"));
    expect(writes()).toEqual([{ id: 7, data: "y" }]);
  });

  it("a one-off command reports Done / Failed and does not restart", async () => {
    await mount("npm install -g typescript");
    expect(screen()).toContain("> npm install -g typescript");
    await emit("pty:exit", { id: 7, code: 2 });
    expect(screen()).toContain("[Failed (exit code 2). You can close this tab.]");
    await act(async () => term().data!("\r"));
    await flush();
    expect(starts()).toHaveLength(1);
  });
});

// Shell tabs (specs/terminal.md TERM-010).
describe("TerminalView with a shell", () => {
  const SHELL = { name: "Git Bash", argv: ["C:\\Program Files\\Git\\bin\\bash.exe", "--login", "-i"] };
  const shellDoc = () => ({ id: "term-sh", kind: "terminal", name: "Git Bash · proj", terminal: { cwd: "C:\\work\\proj", shell: SHELL } }) as unknown as Doc;
  const open = async () => {
    const { useStore } = await import("../lib/store");
    useStore.setState({ docs: [shellDoc()], activeId: "term-sh" });
    await render(<TerminalView doc={shellDoc()} visible />);
    await flush();
    return useStore;
  };
  beforeEach(() => {
    h.calls.length = 0;
    h.listeners.clear();
    h.terms.length = 0;
  });
  afterEach(cleanup);

  it("starts the shell with its arguments in the tab's folder", async () => {
    await open();
    expect(starts()).toHaveLength(1);
    expect(starts()[0].args).toMatchObject({ cwd: "C:\\work\\proj", shell: SHELL.argv, command: undefined });
  });

  it("closes the tab when the shell exits normally", async () => {
    const useStore = await open();
    await emit("pty:exit", { id: 7, code: 0 });
    await flush();
    expect(useStore.getState().docs).toEqual([]);
  });

  it("keeps the tab and offers a restart when the shell fails", async () => {
    const useStore = await open();
    await emit("pty:exit", { id: 7, code: 3 });
    await flush();
    expect(useStore.getState().docs).toHaveLength(1);
    expect(screen()).toContain("[Git Bash ended (exit code 3). Press Enter to start it again.]");
    await act(async () => term().data!("\r"));
    await flush();
    expect(starts()).toHaveLength(2);
    expect(starts()[1].args).toMatchObject({ shell: SHELL.argv });
  });
});
