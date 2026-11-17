import { describe, expect, it, vi } from "vitest";

const answer = vi.hoisted(() => ({ shells: [] as unknown, fail: false, asked: 0 }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
    if (cmd !== "pty_shells") return undefined;
    answer.asked++;
    if (answer.fail) throw "no";
    return answer.shells;
  },
}));

const { CUSTOM_SHELL, knownShells, loadShells, pickShell, shellOptions, terminalTitle } = await import("../lib/shells");
const { sanitizeSettings } = await import("../lib/actions");
const { DEFAULT_SETTINGS } = await import("../lib/types");

const PWSH = { id: "pwsh", name: "PowerShell 7", program: "C:\\Program Files\\PowerShell\\7\\pwsh.exe", args: ["-NoLogo"] };
const CMD = { id: "cmd", name: "Command Prompt", program: "C:\\Windows\\System32\\cmd.exe", args: [] };
const BASH = { id: "gitbash", name: "Git Bash", program: "C:\\Program Files\\Git\\bin\\bash.exe", args: ["--login", "-i"] };
const ALL = [PWSH, CMD, BASH];

describe("pickShell", () => {
  it("Automatic is the first shell found", () => {
    expect(pickShell(ALL, "", "")).toEqual({ name: "PowerShell 7", argv: [PWSH.program, "-NoLogo"] });
    expect(pickShell([CMD, BASH], "", "")).toEqual({ name: "Command Prompt", argv: [CMD.program] });
  });
  it("a chosen shell is started with its arguments", () => {
    expect(pickShell(ALL, "gitbash", "")).toEqual({ name: "Git Bash", argv: [BASH.program, "--login", "-i"] });
  });
  it("a shell that is no longer installed falls back to the first", () => {
    expect(pickShell([CMD], "pwsh", "")).toEqual({ name: "Command Prompt", argv: [CMD.program] });
  });
  it("Custom splits the command line and names the tab after the program", () => {
    expect(pickShell(ALL, CUSTOM_SHELL, '"C:\\msys64\\usr\\bin\\bash.exe" --login -i')).toEqual({ name: "bash", argv: ["C:\\msys64\\usr\\bin\\bash.exe", "--login", "-i"] });
    expect(pickShell(ALL, CUSTOM_SHELL, "wsl.exe")).toEqual({ name: "wsl", argv: ["wsl.exe"] });
  });
  it("says what is missing", () => {
    expect(pickShell(ALL, CUSTOM_SHELL, "  ")).toEqual({ error: "Type the shell's command line in Settings › Terminal first." });
    expect(pickShell([], "", "")).toEqual({ error: "No shell was found on this computer. Set one in Settings › Terminal." });
  });
});

describe("shellOptions / terminalTitle", () => {
  it("lists Automatic with the shell it means, the shells, and Custom", () => {
    expect(shellOptions([CMD, BASH])).toEqual([
      { value: "", label: "Automatic (Command Prompt)" },
      { value: "cmd", label: "Command Prompt" },
      { value: "gitbash", label: "Git Bash" },
      { value: "custom", label: "Custom…" },
    ]);
    expect(shellOptions([])[0]).toEqual({ value: "", label: "Automatic" });
  });
  it("titles a tab with the shell and the folder's name", () => {
    expect(terminalTitle("Git Bash", "C:\\work\\proj\\")).toBe("Git Bash · proj");
    expect(terminalTitle("PowerShell 7", "C:\\")).toBe("PowerShell 7 · C:");
  });
});

describe("loadShells", () => {
  it("asks once, and again only when forced; a failure is an empty list", async () => {
    answer.shells = ALL;
    expect(knownShells()).toEqual([]);
    expect(await loadShells()).toEqual(ALL);
    await loadShells();
    expect(answer.asked).toBe(1);
    expect(knownShells()).toEqual(ALL);
    answer.fail = true;
    expect(await loadShells(true)).toEqual([]);
    expect(answer.asked).toBe(2);
  });
});

describe("terminal settings", () => {
  it("defaults to Automatic and repairs bad values", () => {
    expect(DEFAULT_SETTINGS.terminalShell).toBe("");
    const s = sanitizeSettings({ ...DEFAULT_SETTINGS, terminalShell: 3 as never, terminalCustom: " bash.exe\n-i " });
    expect(s.terminalShell).toBe("");
    expect(s.terminalCustom).toBe("bash.exe -i");
  });
});
