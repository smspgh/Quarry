/**
 * Terminal tabs (`kind: "terminal"`): a shell or a one-off command in a pseudo console
 * (src-tauri/src/pty.rs), drawn by xterm.js in components/TerminalView.tsx. They are not kept in
 * the session: a shell starts fresh.
 */
import { invoke } from "@tauri-apps/api/core";
import { terminalTitle, type ShellChoice } from "./shells";
import { newDocId, useStore, type Doc } from "./store";

/** Terminal id (Rust) per tab, while its program runs. */
const running = new Map<string, number>();

export function setTerminalPty(docId: string, ptyId: number | null) {
  if (ptyId === null) running.delete(docId);
  else running.set(docId, ptyId);
}

export const terminalPty = (docId: string) => running.get(docId) ?? null;

/** Open a terminal tab running `shell` in `folder` (specs/terminal.md TERM-010). */
export function openShellTerminal(folder: string, shell: ShellChoice): Doc {
  const doc: Doc = {
    id: newDocId(),
    kind: "terminal",
    path: null,
    name: terminalTitle(shell.name, folder),
    dirty: false,
    encoding: "",
    bom: false,
    eol: "CRLF",
    language: "Terminal",
    readonly: false,
    modifiedMs: 0,
    terminal: { cwd: folder, shell },
  };
  useStore.getState().addDoc(doc, true);
  return doc;
}

/** Run a one-off command line (installing a language server) in a terminal tab; `onDone` gets
 *  its exit code. */
export function openCommandTerminal(title: string, command: string, cwd: string, onDone?: (code: number | null) => void): Doc {
  const doc: Doc = {
    id: newDocId(),
    kind: "terminal",
    path: null,
    name: title,
    dirty: false,
    encoding: "",
    bom: false,
    eol: "CRLF",
    language: "Terminal",
    readonly: false,
    modifiedMs: 0,
    terminal: { cwd, command },
  };
  if (onDone) doneHandlers.set(doc.id, onDone);
  useStore.getState().addDoc(doc, true);
  return doc;
}

const doneHandlers = new Map<string, (code: number | null) => void>();

/** A command tab's program finished. */
export function commandFinished(docId: string, code: number | null) {
  const f = doneHandlers.get(docId);
  doneHandlers.delete(docId);
  f?.(code);
}

/** The tab closed: end the program and whatever it started. */
export function disposeTerminal(docId: string) {
  const id = running.get(docId);
  running.delete(docId);
  doneHandlers.delete(docId);
  if (id !== undefined) void invoke("pty_kill", { id });
}

export const killAllTerminals = () => invoke("pty_kill_all").catch(() => {});
