import { beforeEach, describe, expect, it, vi } from "vitest";

// installServer (src/lib/lspInstall.ts): the install command runs in a terminal tab; its exit code
// decides the message and whether the servers restart.
const restarts = vi.fn(async () => {});
vi.mock("../lib/lsp", () => ({ restartServers: () => restarts() }));
const invoke = vi.fn(async (_cmd: string, _args?: unknown): Promise<unknown> => undefined);
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string, args?: unknown) => invoke(cmd, args) }));

const { installServer, resolveInstall } = await import("../lib/lspInstall");
const { commandFinished } = await import("../lib/terminal");
const { useStore } = await import("../lib/store");
const { SERVERS } = await import("../lib/lspServers");

const pyright = SERVERS.find((d) => d.id === "python")!;
const typescript = SERVERS.find((d) => d.id === "typescript")!;
const lastToast = () => { const t = useStore.getState().toasts; return t[t.length - 1]; };

describe("installing a language server", () => {
  beforeEach(() => {
    restarts.mockClear();
    useStore.setState({ docs: [], activeId: null, toasts: [], folder: null });
  });

  it("runs the install command in a terminal tab, in the open folder or C:\\", () => {
    installServer(pyright);
    const doc = useStore.getState().docs[0];
    expect(doc).toMatchObject({ kind: "terminal", name: "Install · Python (Pyright)", terminal: { cwd: "C:\\", command: "npm install -g pyright" } });
    expect(useStore.getState().activeId).toBe(doc.id);
    useStore.setState({ folder: "D:\\work" });
    installServer(pyright);
    expect(useStore.getState().docs[1].terminal?.cwd).toBe("D:\\work");
  });

  it("success says so and restarts the servers", () => {
    installServer(pyright);
    commandFinished(useStore.getState().docs[0].id, 0);
    expect(lastToast()).toMatchObject({ kind: "success", message: "Python (Pyright) support is installed" });
    expect(restarts).toHaveBeenCalledTimes(1);
  });

  it("failure (or a command that could not start) names what is needed and restarts nothing", () => {
    installServer(pyright);
    commandFinished(useStore.getState().docs[0].id, 1);
    expect(lastToast()).toMatchObject({ kind: "error", message: "Installing Python (Pyright) support failed (it needs Node.js). See the terminal tab for details." });
    installServer(pyright);
    commandFinished(useStore.getState().docs[1].id, null);
    expect(lastToast()?.kind).toBe("error");
    expect(restarts).not.toHaveBeenCalled();
  });

  it("runs the command it is given (TypeScript's depends on what is installed)", () => {
    installServer(typescript, "npm install -g typescript-language-server");
    expect(useStore.getState().docs[0].terminal?.command).toBe("npm install -g typescript-language-server");
  });
});

describe("choosing the TypeScript install command", () => {
  beforeEach(() => invoke.mockReset());

  it("installs only typescript-language-server when TypeScript is there, both when it is not", async () => {
    invoke.mockResolvedValueOnce(true);
    expect(await resolveInstall(typescript, "D:\\work")).toBe("npm install -g typescript-language-server");
    expect(invoke).toHaveBeenLastCalledWith("lsp_typescript_found", { root: "D:\\work" });
    invoke.mockResolvedValueOnce(false);
    expect(await resolveInstall(typescript, "")).toBe("npm install -g typescript-language-server typescript");
  });

  it("never offers npm install -g typescript alone, even when the check fails", async () => {
    invoke.mockRejectedValueOnce(new Error("no"));
    const cmd = await resolveInstall(typescript, "");
    expect(cmd).toBe("npm install -g typescript-language-server typescript");
    expect(cmd).not.toBe("npm install -g typescript");
  });

  it("other servers keep their own command without asking", async () => {
    expect(await resolveInstall(pyright, "D:\\work")).toBe("npm install -g pyright");
    expect(invoke).not.toHaveBeenCalled();
  });
});
