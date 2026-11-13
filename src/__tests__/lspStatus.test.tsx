import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Problem } from "../lib/lsp";
import type { Doc } from "../lib/store";

// The status bar's language-server item, rendered from state put straight into useLsp / useStore;
// the actions behind its clicks are spies.
const spy = vi.hoisted(() => ({ runCommand: vi.fn(), installServer: vi.fn(), restartServers: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => undefined }));
vi.mock("../lib/commands", async (orig) => ({ ...(await orig<typeof import("../lib/commands")>()), runCommand: spy.runCommand }));
vi.mock("../lib/lspInstall", async (orig) => ({ ...(await orig<typeof import("../lib/lspInstall")>()), installServer: spy.installServer }));
vi.mock("../lib/lsp", async (orig) => ({ ...(await orig<typeof import("../lib/lsp")>()), restartServers: spy.restartServers }));

const { render, cleanup, fire, act } =await import("./helpers/render");
const { LspStatusItem } = await import("../components/LspStatus");
const { useLsp } = await import("../lib/lsp");
const { useStore } = await import("../lib/store");

const doc = { id: "doc-1", kind: "text", name: "main.ts", path: "C:\\work\\proj\\main.ts" } as unknown as Doc;
const ROOT = "C:\\work\\proj";
type Server = ReturnType<typeof useLsp.getState>["servers"][string];
function server(def: string, patch: Partial<Server>, problems: Problem[] = []) {
  useLsp.setState({ servers: { k: { def, root: ROOT, status: "starting", ...patch } }, docServer: { [doc.id]: "k" }, problems: { [doc.id]: problems } });
}
const problem = (severity: Problem["severity"]): Problem => ({ from: 0, to: 1, line: 1, col: 1, severity, message: "x" });
const items = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>(".status-item")];
const setCommand = (def: string, cmd: string) => useStore.setState((s) => ({ settings: { ...s.settings, lspCommands: { [def]: cmd } } }));

describe("LspStatusItem", () => {
  beforeEach(() => {
    useLsp.setState({ servers: {}, docServer: {}, problems: {} });
    setCommand("typescript", "");
    spy.runCommand.mockClear();
    spy.installServer.mockClear();
    spy.restartServers.mockClear();
  });
  afterEach(cleanup);

  it("off: a file with no language server shows nothing", async () => {
    const { container } = await render(<LspStatusItem doc={doc} />);
    expect(container.innerHTML).toBe("");
  });

  it("starting: a spinner and the short name, with the project in the tooltip", async () => {
    server("python", { status: "starting" });
    const { container } = await render(<LspStatusItem doc={doc} />);
    expect(items(container)).toHaveLength(1);
    const item = items(container)[0];
    expect(item.textContent?.trim()).toBe("Pyright");
    expect(item.querySelector(".spin")).not.toBeNull();
    expect(item.title).toBe(`Starting the Python (Pyright) language server in ${ROOT}`);
  });

  it("running: the name and the file's error and warning counts; the counts open the Problems list", async () => {
    server("typescript", { status: "ready" }, [problem("error"), problem("error"), problem("warning"), problem("info")]);
    const { container } = await render(<LspStatusItem doc={doc} />);
    const counts = container.querySelector<HTMLElement>(".lsp-counts")!;
    expect(counts.textContent?.replace(/\s+/g, " ").trim()).toBe("2 1");
    expect(container.querySelector(".lsp-ready")?.textContent?.trim()).toBe("TypeScript");
    expect(container.querySelector(".lsp-ready .spin")).toBeNull();
    await fire.click(counts);
    expect(spy.runCommand).toHaveBeenCalledWith("view.problems");
  });

  it("running with progress: the progress text and a spinner", async () => {
    server("rust", { status: "ready", progress: "Indexing 40%" });
    const { container } = await render(<LspStatusItem doc={doc} />);
    expect(container.querySelector(".lsp-ready")?.textContent?.trim()).toBe("rust-analyzer: Indexing 40%");
    expect(container.querySelector(".lsp-ready .spin")).not.toBeNull();
  });

  it("missing: offers to install the server", async () => {
    server("python", { status: "missing" });
    const { container } = await render(<LspStatusItem doc={doc} />);
    const btn = container.querySelector<HTMLElement>(".lsp-missing")!;
    expect(btn.textContent?.trim()).toBe("Install Pyright support");
    expect(btn.title).toContain("npm install -g pyright");
    await fire.click(btn);
    expect(spy.installServer).toHaveBeenCalledTimes(1);
    expect(spy.installServer.mock.calls[0][0]).toMatchObject({ id: "python" });
  });

  it("missing with a custom command: says it was not found and opens Settings", async () => {
    setCommand("c", "C:\\tools\\nope.exe");
    server("c", { status: "missing" });
    const { container } = await render(<LspStatusItem doc={doc} />);
    const btn = container.querySelector<HTMLElement>(".lsp-missing")!;
    expect(btn.textContent?.trim()).toBe("clangd command not found");
    expect(btn.title).toContain("C:\\tools\\nope.exe");
    await fire.click(btn);
    expect(spy.runCommand).toHaveBeenCalledWith("view.settings");
    expect(spy.installServer).not.toHaveBeenCalled();
  });

  it("stopped or failed: '<name> stopped' with the error, and a click restarts", async () => {
    server("go", { status: "failed", error: "Exited with code 2: boom" });
    const { container } = await render(<LspStatusItem doc={doc} />);
    const btn = container.querySelector<HTMLElement>(".lsp-missing")!;
    expect(btn.textContent?.trim()).toBe("gopls stopped");
    expect(btn.title).toBe("Exited with code 2: boom\nClick to restart");
    await fire.click(btn);
    expect(spy.restartServers).toHaveBeenCalledTimes(1);
  });

  it("follows the state as it changes", async () => {
    server("typescript", { status: "starting" });
    const { container } = await render(<LspStatusItem doc={doc} />);
    expect(container.textContent?.trim()).toBe("TypeScript");
    await act(async () => useLsp.setState((s) => ({ servers: { k: { ...s.servers.k, status: "ready" } } })));
    expect(container.querySelector(".lsp-ready")).not.toBeNull();
    await act(async () => useLsp.setState({ docServer: {} }));
    expect(container.innerHTML).toBe("");
  });
});
