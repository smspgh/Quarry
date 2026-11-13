/**
 * Installing a language server: its install command runs in a terminal tab, so the user sees what
 * happens; when it succeeds the servers restart and the open files connect.
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { restartServers } from "./lsp";
import { installCommand, type ServerDef } from "./lspServers";
import { openCommandTerminal } from "./terminal";
import { useStore } from "./store";

/** The command that installs `def` for the project at `root` ("" = none): for TypeScript it depends
 *  on whether any TypeScript is installed already. */
export async function resolveInstall(def: ServerDef, root: string): Promise<string> {
  if (def.id !== "typescript") return def.install;
  const found = await invoke<boolean>("lsp_typescript_found", { root }).catch(() => null);
  return installCommand(def, typeof found === "boolean" ? found : null);
}

/** `resolveInstall` for a component (the default command until it is known); `again` re-checks. */
export function useInstallCommand(def: ServerDef | undefined, root: string, again: unknown = null): string {
  const [cmd, setCmd] = useState(def?.install ?? "");
  useEffect(() => {
    if (!def) return;
    let live = true;
    setCmd(def.install);
    void resolveInstall(def, root).then((c) => live && setCmd(c));
    return () => { live = false; };
  }, [def, root, again]);
  return cmd;
}

export function installServer(def: ServerDef, command: string = def.install) {
  const s = useStore.getState();
  const cwd = s.folder ?? "C:\\";
  openCommandTerminal(`Install · ${def.name}`, command, cwd, (code) => {
    const st = useStore.getState();
    if (code === 0) {
      st.toast(`${def.name} support is installed`, "success", 4000);
      void restartServers();
    } else {
      st.toast(`Installing ${def.name} support failed${def.needs ? ` (it needs ${def.needs})` : ""}. See the terminal tab for details.`, "error", 8000);
    }
  });
}
