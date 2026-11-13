import { beforeEach, describe, expect, it, vi } from "vitest";

// The per-tab session plumbing of src/lib/claude.ts and the terminal registry of src/lib/terminal.ts,
// over a fake Tauri backend: invoke calls are recorded, events are pushed by the test.
const calls: { cmd: string; args: Record<string, unknown> }[] = [];
const handlers = new Map<string, (e: { payload: unknown }) => void>();
let nextProc = 1;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args });
    if (cmd === "claude_start") return nextProc++;
    return undefined;
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, cb: (e: { payload: unknown }) => void) => {
    handlers.set(name, cb);
    return () => handlers.delete(name);
  },
}));
vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);

const claude = await import("../lib/claude");
const terminal = await import("../lib/terminal");
const { useStore } = await import("../lib/store");
claude.installClaudeEvents();

const last = <T,>(a: T[]): T => a[a.length - 1];
const tick = () => new Promise((r) => setTimeout(r, 5));
const started = () => calls.filter((c) => c.cmd === "claude_start").map((c) => c.args.args as Record<string, unknown>);
const session = (docId: string) => claude.useClaude.getState().sessions[docId];
const out = (id: number, msg: unknown) => handlers.get("claude:out")!({ payload: { id, line: JSON.stringify(msg) } });
const exit = (id: number, code: number | null, stderr = "") => handlers.get("claude:exit")!({ payload: { id, code, stderr } });
const notes = (docId: string) => session(docId).t.items.filter((i) => i.kind === "note").map((i) => (i as { text: string }).text);
const setSettings = (patch: Record<string, unknown>) => useStore.setState((st) => ({ settings: { ...st.settings, ...patch } }));

describe("Claude tab sessions", () => {
  beforeEach(() => {
    calls.length = 0;
    for (const id of Object.keys(claude.useClaude.getState().sessions)) claude.disposeClaude(id);
    useStore.setState({ docs: [], activeId: null, toasts: [] });
    setSettings({ claudePath: "", claudeModel: "sonnet", claudePermissionMode: "acceptEdits" });
  });

  it("starts one process per tab with the model and permission settings", async () => {
    const doc = (await claude.openClaudeTab("C:\\work\\shop"))!;
    await tick();
    expect(doc.name).toBe("Claude · shop");
    expect(started()).toEqual([{ exe: "", cwd: "C:\\work\\shop", model: "sonnet", permissionMode: "acceptEdits", resume: undefined }]);
    expect(session(doc.id).status).toBe("ready");
  });

  it("a folder has one tab: opening it again (other case, slashes) switches to it", async () => {
    const a = (await claude.openClaudeTab("C:\\work\\shop"))!;
    const b = await claude.openClaudeTab("c:/work/shop/");
    expect(b?.id).toBe(a.id);
    expect(useStore.getState().docs.filter((d) => d.kind === "claude")).toHaveLength(1);
  });

  it("a restored conversation is resumed, with the current model setting", async () => {
    setSettings({ claudeModel: "opus" });
    const id = "8a472df2-81a0-47b8-8720-b17e2df22a0d";
    const doc = (await claude.openClaudeTab("C:\\work\\shop", { sessionId: id, activate: false }))!;
    await tick();
    expect(started()[0]).toMatchObject({ resume: id, model: "opus" });
    expect(session(doc.id).t.sessionId).toBe(id);
  });

  it("sends a message to the running process; an empty one is not sent", async () => {
    const doc = (await claude.openClaudeTab("C:\\work\\shop"))!;
    await tick();
    expect(await claude.sendToClaude(doc.id, "   ")).toBe(false);
    expect(await claude.sendToClaude(doc.id, "hello")).toBe(true);
    const sent = calls.filter((c) => c.cmd === "claude_send");
    expect(sent).toHaveLength(1);
    expect(sent[0].args.id).toBe(session(doc.id).procId);
    expect(JSON.parse(sent[0].args.line as string)).toMatchObject({ type: "user", message: { role: "user" } });
    expect(session(doc.id).t.busy).toBe(true);
  });

  it("keeps the session id from system/init on the tab, for the session file", async () => {
    const doc = (await claude.openClaudeTab("C:\\work\\shop"))!;
    await tick();
    out(session(doc.id).procId!, { type: "system", subtype: "init", session_id: "abc-123", model: "claude-sonnet" });
    await tick();
    expect(session(doc.id).t.sessionId).toBe("abc-123");
    expect(useStore.getState().docs.find((d) => d.id === doc.id)?.claude?.sessionId).toBe("abc-123");
  });

  it("an unexpected exit is reported; the next message starts the process again", async () => {
    const doc = (await claude.openClaudeTab("C:\\work\\shop"))!;
    await tick();
    const first = session(doc.id).procId!;
    exit(first, 1, "line one\nboom");
    expect(session(doc.id)).toMatchObject({ procId: null, status: "stopped" });
    expect(last(notes(doc.id))).toBe("Claude Code stopped (exit code 1).\nline one\nboom\nSend a message to start it again.");
    expect(await claude.sendToClaude(doc.id, "again")).toBe(true);
    expect(started()).toHaveLength(2);
    expect(session(doc.id).procId).not.toBe(first);
  });

  it("a resume that fails before init forgets the conversation", async () => {
    const doc = (await claude.openClaudeTab("C:\\work\\shop", { sessionId: "dead-beef" }))!;
    await tick();
    exit(session(doc.id).procId!, 1);
    expect(session(doc.id).t.sessionId).toBeNull();
    expect(useStore.getState().docs.find((d) => d.id === doc.id)?.claude?.sessionId).toBeUndefined();
    expect(last(notes(doc.id))).toMatch(/could not be resumed.*Your next message starts a new conversation\.$/s);
  });

  it("a process stopped on purpose (new conversation) is not reported as a failure", async () => {
    const doc = (await claude.openClaudeTab("C:\\work\\shop"))!;
    await tick();
    const old = session(doc.id).procId!;
    claude.newClaudeSession(doc.id);
    expect(calls.some((c) => c.cmd === "claude_stop" && c.args.id === old)).toBe(true);
    exit(old, 1);
    await tick();
    expect(notes(doc.id).filter((n) => n.startsWith("Claude Code stopped"))).toHaveLength(0);
    expect(started()).toHaveLength(2);
  });

  it("a permission-mode change stops an idle process so the next message uses it", async () => {
    const doc = (await claude.openClaudeTab("C:\\work\\shop"))!;
    await tick();
    const id = session(doc.id).procId!;
    setSettings({ claudePermissionMode: "default" });
    expect(calls.some((c) => c.cmd === "claude_stop" && c.args.id === id)).toBe(true);
    expect(session(doc.id)).toMatchObject({ procId: null, status: "stopped" });
    await claude.sendToClaude(doc.id, "go");
    expect(last(started())).toMatchObject({ permissionMode: "default" });
  });

  it("closing the tab stops its process and drops the session", async () => {
    const doc = (await claude.openClaudeTab("C:\\work\\shop"))!;
    await tick();
    const id = session(doc.id).procId!;
    claude.disposeClaude(doc.id);
    expect(calls.some((c) => c.cmd === "claude_stop" && c.args.id === id)).toBe(true);
    expect(session(doc.id)).toBeUndefined();
  });
});

describe("terminal tabs", () => {
  beforeEach(() => {
    calls.length = 0;
    useStore.setState({ docs: [], activeId: null });
  });

  it("opens a Claude CLI tab named after the folder, with the resume id", () => {
    const doc = terminal.openClaudeTerminal("C:\\work\\shop\\", "8a472df2");
    expect(doc).toMatchObject({ kind: "terminal", name: "Claude CLI · shop", terminal: { cwd: "C:\\work\\shop\\", resume: "8a472df2" } });
    expect(useStore.getState().activeId).toBe(doc.id);
  });

  it("tracks the running program and kills it when the tab closes", () => {
    const doc = terminal.openClaudeTerminal("C:\\a");
    expect(terminal.terminalPty(doc.id)).toBeNull();
    terminal.setTerminalPty(doc.id, 7);
    expect(terminal.terminalPty(doc.id)).toBe(7);
    terminal.disposeTerminal(doc.id);
    expect(terminal.terminalPty(doc.id)).toBeNull();
    expect(calls).toEqual([{ cmd: "pty_kill", args: { id: 7 } }]);
    terminal.disposeTerminal(doc.id);
    expect(calls).toHaveLength(1);
  });

  it("an ended program is no longer running: closing kills nothing", () => {
    const doc = terminal.openClaudeTerminal("C:\\a");
    terminal.setTerminalPty(doc.id, 3);
    terminal.setTerminalPty(doc.id, null);
    terminal.disposeTerminal(doc.id);
    expect(calls).toHaveLength(0);
  });

  it("a one-off command reports its exit code once", () => {
    const done = vi.fn();
    const doc = terminal.openCommandTerminal("Install · Python (Pyright)", "npm install -g pyright", "C:\\", done);
    expect(doc).toMatchObject({ name: "Install · Python (Pyright)", terminal: { cwd: "C:\\", command: "npm install -g pyright" } });
    terminal.commandFinished(doc.id, 0);
    terminal.commandFinished(doc.id, 1);
    expect(done.mock.calls).toEqual([[0]]);
  });

  it("closing a command tab before it finishes never reports", () => {
    const done = vi.fn();
    const doc = terminal.openCommandTerminal("Install", "x", "C:\\", done);
    terminal.disposeTerminal(doc.id);
    terminal.commandFinished(doc.id, 0);
    expect(done).not.toHaveBeenCalled();
  });
});
