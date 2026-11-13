import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useEffect, useRef } from "react";
import { useStore, type Doc } from "../lib/store";
import { commandFinished, setTerminalPty } from "../lib/terminal";
import { editor } from "../editor/manager";

/** xterm colours from the theme tokens (--term-*), so the terminal follows light / dark. */
function themeFromCss(): ITheme {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    background: v("--term-bg"),
    foreground: v("--term-fg"),
    cursor: v("--cursor"),
    cursorAccent: v("--term-bg"),
    selectionBackground: v("--sel-bg"),
  };
}

/** A terminal tab: the `claude` command line in the tab's folder. Stays mounted while hidden, like
 *  Claude tabs, so switching tabs keeps the screen and the running program. */
export function TerminalView({ doc, visible }: { doc: Doc; visible: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  useEffect(() => editor.registerFocus(doc.id, () => term.current?.focus()), [doc.id]);
  const fit = useRef<FitAddon | null>(null);
  const fontFamily = useStore((s) => s.settings.fontFamily);
  const fontSize = useStore((s) => s.settings.fontSize);

  useEffect(() => {
    const el = host.current;
    if (!el || !doc.terminal) return;
    const { cwd, resume, command } = doc.terminal;
    const settings = useStore.getState().settings;
    const t = new Terminal({ fontFamily: settings.fontFamily, fontSize: settings.fontSize, cursorBlink: true, scrollback: 10_000, theme: themeFromCss() });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(el);
    term.current = t;
    fit.current = f;
    try {
      f.fit();
    } catch {
      /* hidden: fitted when shown */
    }

    let pty: number | null = null;
    let disposed = false;
    let first = true;
    const start = async () => {
      try {
        if (command && first) t.write(`\x1b[2m> ${command}\x1b[0m\r\n`);
        const id = await invoke<number>("pty_start", { exe: useStore.getState().settings.claudePath, cwd, cols: t.cols, rows: t.rows, resume: first ? resume : undefined, command });
        first = false;
        if (disposed) {
          void invoke("pty_kill", { id });
          return;
        }
        pty = id;
        setTerminalPty(doc.id, id);
      } catch (e) {
        if (command) {
          // A one-off command (an install) reports its result to whoever started it; it doesn't restart.
          t.write(`\x1b[31m${String(e)}\x1b[0m\r\n\x1b[2m[Could not start the command. You can close this tab.]\x1b[0m\r\n`);
          commandFinished(doc.id, null);
        } else {
          t.write(`\x1b[31m${String(e)}\x1b[0m\r\n\x1b[2mPress Enter to try again.\x1b[0m\r\n`);
        }
      }
    };
    const unData = listen<{ id: number; data: string }>("pty:data", (e) => {
      if (e.payload.id === pty) t.write(e.payload.data);
    });
    const unExit = listen<{ id: number; code: number }>("pty:exit", (e) => {
      if (e.payload.id !== pty) return;
      pty = null;
      setTerminalPty(doc.id, null);
      const code = e.payload.code ? ` (exit code ${e.payload.code})` : "";
      if (command) {
        t.write(`\r\n\x1b[2m[${e.payload.code ? `Failed${code}` : "Done"}. You can close this tab.]\x1b[0m\r\n`);
        commandFinished(doc.id, e.payload.code);
        return;
      }
      t.write(`\r\n\x1b[2m[Claude Code ended${code}. Press Enter to start it again.]\x1b[0m\r\n`);
    });
    t.onData((d) => {
      if (pty !== null) void invoke("pty_write", { id: pty, data: d }).catch(() => {});
      else if (d === "\r" && !command) {
        t.reset();
        void start();
      }
    });
    t.onResize(({ cols, rows }) => {
      if (pty !== null) void invoke("pty_resize", { id: pty, cols, rows }).catch(() => {});
    });
    // Windows Terminal keys: Ctrl+C copies when text is selected (else it goes to the program),
    // Ctrl+V and Ctrl+Shift+V paste text, Ctrl+Shift+C copies.
    t.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown" || !e.ctrlKey || e.altKey) return true;
      const k = e.key.toLowerCase();
      if (k === "c" && (e.shiftKey || t.hasSelection())) {
        if (t.hasSelection()) void writeText(t.getSelection());
        t.clearSelection();
        e.preventDefault();
        return false;
      }
      if (k === "v") {
        e.preventDefault();
        void readText().then((text) => text && t.paste(text)).catch(() => {});
        return false;
      }
      return true;
    });
    const ro = new ResizeObserver(() => {
      if (!el.offsetParent) return;
      try {
        f.fit();
      } catch {
        /* not laid out */
      }
    });
    ro.observe(el);
    const mo = new MutationObserver(() => { t.options.theme = themeFromCss(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    void start();

    return () => {
      disposed = true;
      unData.then((u) => u());
      unExit.then((u) => u());
      ro.disconnect();
      mo.disconnect();
      t.dispose();
      term.current = null;
    };
    // One terminal per tab for its lifetime.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = term.current;
    if (!t) return;
    t.options.fontFamily = fontFamily;
    t.options.fontSize = fontSize;
    try {
      fit.current?.fit();
    } catch {
      /* hidden */
    }
  }, [fontFamily, fontSize]);

  useEffect(() => {
    if (!visible) return;
    requestAnimationFrame(() => {
      try {
        fit.current?.fit();
      } catch {
        /* not laid out */
      }
      term.current?.focus();
    });
  }, [visible]);

  return (
    <div className="terminal-view" hidden={!visible}>
      <div ref={host} className="terminal-host" />
    </div>
  );
}
