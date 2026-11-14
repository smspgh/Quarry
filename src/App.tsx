import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { BigFileView } from "./components/BigFileView";
import { BottomPanel } from "./components/BottomPanel";
import { ClaudeView } from "./components/ClaudeView";
import { TerminalView } from "./components/TerminalView";
import { DiffView } from "./components/DiffView";
import { GraphView } from "./components/GraphView";
import { CodeEditor } from "./components/CodeEditor";
import { CommandPalette } from "./components/CommandPalette";
import { Sidebar } from "./components/Sidebar";
import { SidebarRail } from "./components/SidebarRail";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import { Dialog, Toasts } from "./components/Toasts";
import { Welcome } from "./components/Welcome";
import { editor } from "./editor/manager";
import { flushSession, installCloseGuard, loadSettings, openPath, restoreSession, saveSession, installExternalChangeWatch } from "./lib/actions";
import { eventToKeys, getCommandsForKeys, handleKeyEvent, registerAllCommands } from "./lib/commands";
import { appIpc, big } from "./lib/ipc";
import { installClaudeEvents } from "./lib/claude";
import { installLsp } from "./lib/lsp";
import { installGit } from "./lib/git";
import { installGitAssist } from "./lib/gitAssist";
import { bus } from "./lib/bus";
import { useShallow } from "zustand/react/shallow";
import { installRecorderHooks, loadMacros } from "./lib/macros";
import { migrateLegacyScripts } from "./lib/scripting";
import { paneDocId, useStore } from "./lib/store";
import { SplitDivider } from "./components/SplitDivider";
import { MenuBar } from "./components/MenuBar";

function useTheme() {
  const theme = useStore((s) => s.settings.theme);
  const mica = useStore((s) => s.settings.mica);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      getCurrentWindow().setTheme(theme === "system" ? null : theme).catch(() => {});
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.mica = mica ? "on" : "off";
  }, [mica]);
}

let booted = false;

export default function App() {
  const [ready, setReady] = useState(false);
  // What the left pane shows (the whole editor area unless the editor is split).
  const doc = useStore((s) => s.docs.find((d) => d.id === paneDocId(s, 0)));
  const split = useStore((s) => s.split);
  const docsCount = useStore((s) => s.docs.length);
  // Claude tabs stay mounted while hidden, so scroll position and the half-typed message survive tab switches.
  const claudeDocs = useStore(useShallow((s) => s.docs.filter((d) => d.kind === "claude")));
  const terminalDocs = useStore(useShallow((s) => s.docs.filter((d) => d.kind === "terminal")));
  const diffDocs = useStore(useShallow((s) => s.docs.filter((d) => d.kind === "diff")));
  const graphDocs = useStore(useShallow((s) => s.docs.filter((d) => d.kind === "graph")));
  useTheme();

  useEffect(() => {
    // The one-time boot must not run twice, but the listeners below must be (re)installed on
    // every effect run: React.StrictMode runs the effect, its cleanup, then the effect again.
    if (!booted) {
      booted = true;
      (async () => {
        await loadSettings();
        registerAllCommands();
        installClaudeEvents();
        installLsp();
        installGit();
        installGitAssist();
        installRecorderHooks();
        setReady(true);
        await Promise.all([loadMacros(), migrateLegacyScripts()]);
        await restoreSession();
        installCloseGuard();
        if (useStore.getState().settings.autoUpdateCheck) setTimeout(() => void import("./lib/updater").then((m) => m.checkForUpdates(true)), 6000);
        const crash = await appIpc.takeCrashReport().catch(() => null);
        if (crash) useStore.getState().toast(`Quarry closed unexpectedly last time. Details were saved to ${crash}`, "warning", 15000);
      })();
    }

    // Escape then Tab within 2 s leaves the editor (Tab is otherwise the Indent command); Ctrl+M makes it permanent.
    let tabEscapeUntil = 0;
    // Global shortcuts (capture phase so they win over focused inputs for Ctrl/Alt combos).
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) && !target.closest(".cm-content");
      // Escape inside the editor with no overlay to close belongs to CodeMirror: it collapses extra
      // cursors and arms "Escape then Tab" to move focus out of the editor (no keyboard trap).
      const inEditor = !!target?.closest?.(".cm-editor");
      if (e.key === "Tab" && inEditor && !e.ctrlKey && !e.altKey && (useStore.getState().tabMovesFocus || Date.now() <= tabEscapeUntil)) {
        tabEscapeUntil = 0;
        return; // browser default: move focus to the next / previous control
      }
      if (!["Shift", "Control", "Alt", "Meta"].includes(e.key)) tabEscapeUntil = 0;
      // A modal dialog owns the keyboard (Dialog handles Enter / Escape / Tab): no shortcut runs behind it.
      if (useStore.getState().dialog) {
        if (matchesRegistered(e)) e.preventDefault();
        return;
      }
      if (e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey && inEditor) {
        const st = useStore.getState();
        if (!st.palette && !st.findBar.open && !st.dialog) {
          editor.clearResultHighlights(); // Escape also drops Find in Files highlighting
          tabEscapeUntil = Date.now() + 2000; // same window CodeMirror uses
          return;
        }
      }
      // A terminal gets every key (Ctrl+R, Ctrl+L, Ctrl+W, Escape, ... belong to the program) except tab
      // switching, the palette and Ctrl+F4 (close the tab).
      if (target?.closest?.(".terminal-view")) {
        const k = eventToKeys(e);
        if (k !== "Ctrl+Tab" && k !== "Ctrl+Shift+Tab" && k !== "Ctrl+Shift+P" && k !== "Ctrl+F4") return;
      }
      // A focused tab handles its own keys (Delete / Ctrl+W close that tab, not the active one).
      if (target?.closest?.(".tabs [role=tab]") && (e.key === "Delete" || (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "w"))) return;
      // The Explorer tree's Ctrl+C / X / V copy, cut and paste files, not editor text.
      if (target?.closest?.("[data-file-keys]") && e.ctrlKey && !e.shiftKey && !e.altKey && ["c", "x", "v"].includes(e.key.toLowerCase())) return;
      // An open find / replace history list handles its own keys (arrows, Enter, Delete, Escape).
      if (target?.closest?.(".history-menu")) return;
      // Alt+↑/↓ in a text field belongs to the field (Alt+↓ opens find / replace history), not Move Line.
      if (inField && e.altKey && !e.ctrlKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) return;
      // Let plain typing and simple editing keys through to inputs.
      if (inField && !e.ctrlKey && !e.altKey && !/^F\d+$/.test(e.key) && e.key !== "Escape") return;
      if (inField && e.ctrlKey && !e.shiftKey && !e.altKey && ["a", "c", "v", "x", "z", "y"].includes(e.key.toLowerCase())) return;
      handleKeyEvent(e).then((handled) => void handled);
      // Decide synchronously whether to swallow: re-run matcher cheaply.
      if (matchesRegistered(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);

    // Large-file indexing progress → store.
    const unProgress = big.onProgress((p) => {
      const s = useStore.getState();
      const d = s.docs.find((x) => x.bigId === p.id);
      if (!d) return;
      s.updateDoc(d.id, {
        indexProgress: p,
        bigInfo: d.bigInfo ? { ...d.bigInfo, totalLines: p.newlines + (p.complete ? 1 : 0), indexed: p.complete } : d.bigInfo,
      });
    });

    // Drag & drop files from Explorer.
    // Files passed to a second launch arrive here (see single-instance plugin in lib.rs).
    const unOpen = listen<string[]>("open-paths", (ev) => {
      for (const p of ev.payload) void openPath(p);
    });
    const unDrop = getCurrentWebview().onDragDropEvent((ev) => {
      if (ev.payload.type !== "drop") return;
      // Files dropped on a Claude tab go to its message (pictures attached, other files named).
      const { x, y } = ev.payload.position;
      const at = document.elementFromPoint(x / window.devicePixelRatio, y / window.devicePixelRatio);
      if (at?.closest(".claude-view")) bus.emit("claude.drop", ev.payload.paths);
      else for (const p of ev.payload.paths) void openPath(p);
    });

    // Persist session when the tab set changes.
    const unWatch = installExternalChangeWatch();
    const unsub = useStore.subscribe((s, prev) => {
      if (s.docs !== prev.docs || s.activeId !== prev.activeId || s.split !== prev.split || s.folder !== prev.folder || s.explorerExpanded !== prev.explorerExpanded) saveSession();
      // Collapsing (`pinnedHidden`) is not kept: pinned panels always come back expanded on start.
      if (s.pinnedPanels !== prev.pinnedPanels || s.bottomHeight !== prev.bottomHeight) saveSession();
      if (s.recentFiles !== prev.recentFiles || s.recentFolders !== prev.recentFolders) saveSession();
      // Asking for a panel (menu, shortcut, command) also brings back collapsed pinned panels.
      if (s.sidebarVisible && s.pinnedHidden && (!prev.sidebarVisible || s.sidebarPanel !== prev.sidebarPanel)) s.set({ pinnedHidden: false });
    });

    // Block the browser's default context menu outside text fields; keep native cut/copy/paste in inputs.
    const onCtx = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("input, textarea, .cm-content, .selectable, .big-text")) e.preventDefault();
    };
    window.addEventListener("contextmenu", onCtx);

    // Untitled text lives only in the session file, so keep it current while typing: save after a
    // pause, and at least every 10 s during continuous typing.
    let untitledSavedAt = Date.now();
    const unTyping = editor.onDocUpdate((id, u) => {
      if (!u.docChanged) return;
      const doc = useStore.getState().docs.find((d) => d.id === id);
      if (!doc || doc.kind !== "text" || doc.path) return;
      if (Date.now() - untitledSavedAt > 10_000) {
        untitledSavedAt = Date.now();
        void flushSession();
      } else saveSession();
    });

    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("contextmenu", onCtx);
      unProgress.then((f) => f());
      unDrop.then((f) => f());
      unOpen.then((f) => f());
      unsub();
      unWatch();
      unTyping();
    };
  }, []);

  const menuPosition = useStore((s) => s.settings.menuPosition);
  if (!ready) return <div className="app" />;

  return (
    <div className="app">
      <header className="app-top">
        <TitleBar />
        {menuPosition === "top" && <MenuBar />}
        {menuPosition === "hidden" && <MenuBar overlay />}
      </header>
      <div className="app-main">
        <SidebarRail />
        <Sidebar />
        <main className="editor-area">
          <div className={`editor-panes ${split ? "split" : ""}`} style={split ? { gridTemplateColumns: `minmax(0, ${split.ratio}fr) auto minmax(0, ${1 - split.ratio}fr)` } : undefined}>
            <div className={`editor-stack pane ${split?.focused === 0 ? "focused" : ""}`} onMouseDownCapture={() => useStore.getState().focusPane(0)}>
              <CodeEditor pane={0} visible={doc?.kind === "text"} />
              {doc?.kind === "big" && <BigFileView key={`${doc.id}:${doc.bigId}`} doc={doc} />}
              {claudeDocs.map((d) => <ClaudeView key={d.id} doc={d} visible={d.id === doc?.id} />)}
              {terminalDocs.map((d) => <TerminalView key={d.id} doc={d} visible={d.id === doc?.id} />)}
              {diffDocs.map((d) => <DiffView key={d.id} doc={d} visible={d.id === doc?.id} />)}
              {graphDocs.map((d) => <GraphView key={d.id} doc={d} visible={d.id === doc?.id} />)}
              {docsCount === 0 && <Welcome />}
            </div>
            {split && (
              <>
                <SplitDivider />
                <div className={`editor-stack pane ${split.focused === 1 ? "focused" : ""}`} onMouseDownCapture={() => useStore.getState().focusPane(1)}>
                  <CodeEditor pane={1} visible />
                </div>
              </>
            )}
          </div>
          <BottomPanel />
        </main>
      </div>
      <StatusBar />
      <CommandPalette />
      <Dialog />
      <Toasts />
    </div>
  );
}

/** True when the key event is a registered shortcut that should be kept from the page. */
function matchesRegistered(e: KeyboardEvent): boolean {
  const k = eventToKeys(e);
  if (!k) return false;
  const cmds = getCommandsForKeys(k);
  if (!cmds.length) return false;
  // Escape and a few others only apply conditionally; don't swallow them if nothing is open.
  if (k === "Escape") {
    const s = useStore.getState();
    return !!(s.palette || s.findBar.open);
  }
  return true;
}
