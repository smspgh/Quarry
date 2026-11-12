/**
 * Installing a language server: its install command runs in a terminal tab, so the user sees what
 * happens; when it succeeds the servers restart and the open files connect.
 */
import { restartServers } from "./lsp";
import type { ServerDef } from "./lspServers";
import { openCommandTerminal } from "./terminal";
import { useStore } from "./store";

export function installServer(def: ServerDef) {
  const s = useStore.getState();
  const cwd = s.folder ?? "C:\\";
  openCommandTerminal(`Install · ${def.name}`, def.install, cwd, (code) => {
    const st = useStore.getState();
    if (code === 0) {
      st.toast(`${def.name} support is installed`, "success", 4000);
      void restartServers();
    } else {
      st.toast(`Installing ${def.name} support failed${def.needs ? ` (it needs ${def.needs})` : ""}. See the terminal tab for details.`, "error", 8000);
    }
  });
}
