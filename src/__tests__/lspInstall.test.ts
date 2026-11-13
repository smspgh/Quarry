import { beforeEach, describe, expect, it, vi } from "vitest";

// installServer (src/lib/lspInstall.ts): the install command runs in a terminal tab; its exit code
// decides the message and whether the servers restart.
const restarts = vi.fn(async () => {});
vi.mock("../lib/lsp", () => ({ restartServers: () => restarts() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => undefined }));

const { installServer } = await import("../lib/lspInstall");
const { commandFinished } = await import("../lib/terminal");
const { useStore } = await import("../lib/store");
const { SERVERS } = await import("../lib/lspServers");

const pyright = SERVERS.find((d) => d.id === "python")!;
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
});
