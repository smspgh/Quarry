/**
 * The shells a terminal tab can run (specs/terminal.md TERM-010): the list comes from Rust
 * (`pty_shells`: PowerShell 7, Windows PowerShell, Command Prompt, Git Bash, as installed); the
 * choice is `settings.terminalShell` ("" = the first one found, a shell id, or "custom" with
 * `settings.terminalCustom` as the command line).
 */
import { invoke } from "@tauri-apps/api/core";
import { splitCommand } from "./lspServers";

export interface Shell {
  id: string;
  name: string;
  program: string;
  args: string[];
}

/** What a terminal tab starts: a display name and the program with its arguments. */
export interface ShellChoice {
  name: string;
  argv: string[];
}

export const CUSTOM_SHELL = "custom";

let found: Shell[] | null = null;

/** The shells installed on this computer (asked once; `force` asks again). Empty when that fails. */
export async function loadShells(force = false): Promise<Shell[]> {
  if (found && !force) return found;
  try {
    found = (await invoke<Shell[] | undefined>("pty_shells")) ?? [];
  } catch {
    found = [];
  }
  return found;
}

/** The list as last loaded (menus are built synchronously). */
export const knownShells = (): Shell[] => found ?? [];

const stem = (program: string) => (program.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? program).replace(/\.(exe|cmd|bat)$/i, "");

/**
 * Pure: the shell to start for this setting. An id that is no longer installed falls back to the
 * first shell found, like "" (Automatic).
 */
export function pickShell(shells: Shell[], setting: string, custom: string): ShellChoice | { error: string } {
  if (setting === CUSTOM_SHELL) {
    const argv = splitCommand(custom);
    if (!argv.length) return { error: "Type the shell's command line in Settings › Terminal first." };
    return { name: stem(argv[0]), argv };
  }
  const shell = shells.find((s) => s.id === setting) ?? shells[0];
  if (!shell) return { error: "No shell was found on this computer. Set one in Settings › Terminal." };
  return { name: shell.name, argv: [shell.program, ...shell.args] };
}

/** Pure: the options of Settings › Terminal › Shell. */
export function shellOptions(shells: Shell[]): { value: string; label: string }[] {
  return [{ value: "", label: shells[0] ? `Automatic (${shells[0].name})` : "Automatic" }, ...shells.map((s) => ({ value: s.id, label: s.name })), { value: CUSTOM_SHELL, label: "Custom…" }];
}

/** Pure: the tab title, "PowerShell 7 · project". */
export function terminalTitle(shellName: string, folder: string): string {
  const name = folder.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || folder;
  return `${shellName} · ${name}`;
}
