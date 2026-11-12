import { getCurrentWindow } from "@tauri-apps/api/window";
import { Braces, Columns2, Copy, FileCode2, FileText, FolderOpen, FolderTree, FileDiff, HardDrive, History, Minus, Square, SquareTerminal, X } from "lucide-react";
import { useEffect, useState } from "react";
import { closeDocument, closeOthers, showInExplorerPanel, showInWindowsExplorer } from "../lib/actions";
import { anyPanelShown, toggleAllPanels } from "../lib/panels";
import { BrandIcon } from "./BrandIcon";
import { useStore, type Doc } from "../lib/store";
import { MenuBar } from "./MenuBar";
import { ClaudeMark } from "./ClaudeView";
import { useClaudeBadge } from "../lib/claude";
import { compareCandidate, compareWithSelected, openCompare, selectForCompare } from "../lib/diff";
import { runCommand } from "../lib/commands";
import { openToSide } from "../lib/split";
import { compareWithHead, fileStatus, repoOf, showHistory } from "../lib/git";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

function DocIcon({ doc }: { doc: Doc }) {
  if (doc.kind === "big") return <HardDrive className="tab-icon" />;
  if (doc.kind === "claude") return <ClaudeMark className="tab-icon accent" />;
  if (doc.kind === "terminal") return <SquareTerminal className="tab-icon" />;
  if (doc.kind === "diff") return <FileDiff className="tab-icon" />;
  if (doc.language === "JSON") return <Braces className="tab-icon" />;
  if (doc.language === "Plain Text") return <FileText className="tab-icon" />;
  return <FileCode2 className="tab-icon" />;
}

export type TabKeyAction = { kind: "focus"; index: number } | { kind: "activate" } | { kind: "close" } | { kind: "menu" } | null;

/** What a key press on a focused tab does: arrows/Home/End move focus, Enter/Space activate, Delete/Ctrl+W close. */
export function tabStripKey(key: string, ctrl: boolean, index: number, count: number): TabKeyAction {
  if (count <= 0) return null;
  if (ctrl && key.toLowerCase() === "w") return { kind: "close" };
  if (ctrl) return null;
  switch (key) {
    case "ArrowLeft": return { kind: "focus", index: (index - 1 + count) % count };
    case "ArrowRight": return { kind: "focus", index: (index + 1) % count };
    case "Home": return { kind: "focus", index: 0 };
    case "End": return { kind: "focus", index: count - 1 };
    case "Enter":
    case " ": return { kind: "activate" };
    case "Delete": return { kind: "close" };
    case "ContextMenu": return { kind: "menu" };
    default: return null;
  }
}

function focusTabAt(index: number) {
  const tabs = document.querySelectorAll<HTMLElement>(".tabs [role=tab]");
  if (tabs.length) tabs[Math.max(0, Math.min(index, tabs.length - 1))].focus();
}

function Tab({ doc, active, index, count }: { doc: Doc; active: boolean; index: number; count: number }) {
  const setActive = useStore((s) => s.setActive);
  // Shown in the pane of the split editor that doesn't have the keyboard.
  const inOtherPane = useStore((s) => !!s.split && s.split.otherId === doc.id);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [menu]);
  return (
    <>
      <div
        className={`tab ${active ? "active" : ""} ${inOtherPane ? "other-pane" : ""} ${doc.dirty ? "dirty" : ""} ${doc.preview ? "preview" : ""}`}
        title={(doc.preview ?`${doc.path ?? doc.name}\nPreview: the next file you click in the Explorer replaces this tab. Double-click (or edit the file) to keep it open.` : doc.path ?? doc.name) + (inOtherPane ? "\nShown in the other pane" : "")}
        role="tab"
        aria-selected={active}
        aria-label={`${doc.name}${doc.dirty ? ", unsaved changes" : ""}`}
        data-doc-id={doc.id}
        tabIndex={active ? 0 : -1}
        onKeyDown={(e) => {
          const a = tabStripKey(e.key, e.ctrlKey, index, count);
          if (!a) return;
          e.preventDefault();
          e.stopPropagation();
          if (a.kind === "focus") focusTabAt(a.index);
          else if (a.kind === "activate") setActive(doc.id);
          else if (a.kind === "close") void closeDocument(doc.id).then(() => setTimeout(() => focusTabAt(index), 0));
          else {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: r.left, y: r.bottom });
          }
        }}
        onMouseDown={(e) => {
          if (e.button === 0) setActive(doc.id);
          if (e.button === 1) {
            e.preventDefault();
            void closeDocument(doc.id);
          }
        }}
        onDoubleClick={() => doc.preview && useStore.getState().updateDoc(doc.id, { preview: false })}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <DocIcon doc={doc} />
        <span className="tab-title">{doc.name}</span>
        {doc.dirty && <span className="tab-dirty" />}
        {doc.kind === "claude" && !active && <ClaudeBadge docId={doc.id} />}
        <button
          className="tab-close"
          title="Close (Ctrl+W)"
          aria-label={`Close ${doc.name}`}
          tabIndex={-1}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            void closeDocument(doc.id);
          }}
        >
          <X size={13} />
        </button>
      </div>
      {menu && (
        <div className="palette ctx-menu" style={{ position: "fixed", left: Math.min(menu.x, window.innerWidth - 228), top: menu.y, width: 220, zIndex: 300, padding: 4 }} onMouseDown={(e) => e.stopPropagation()}>
          <button className="palette-item" autoFocus onClick={() => { setMenu(null); void closeDocument(doc.id); }}><span className="title">Close</span><span className="kbd">Ctrl+W</span></button>
          <button className="palette-item" onClick={() => { setMenu(null); void closeOthers(doc.id); }}><span className="title">Close Others</span></button>
          {doc.kind === "text" && (
            <>
              <button className="palette-item" onClick={() => { setMenu(null); openToSide(doc.id); }}><Columns2 size={13} /><span className="title">Open to the Side</span></button>
              <div className="menu-sep" />
              {doc.path && doc.dirty && <button className="palette-item" onClick={() => { setMenu(null); void openCompare({ kind: "file", path: doc.path! }, { kind: "tab", docId: doc.id }); }}><FileDiff size={13} /><span className="title">Compare with Saved</span></button>}
              {doc.path && compareCandidate() && compareCandidate()!.toLowerCase() !== doc.path.toLowerCase() && (
                <button className="palette-item" onClick={() => { setMenu(null); compareWithSelected(doc.path!); }}><FileDiff size={13} /><span className="title">Compare with Selected</span></button>
              )}
              {doc.path && <button className="palette-item" onClick={() => { setMenu(null); selectForCompare(doc.path!); }}><FileDiff size={13} /><span className="title">Select for Compare</span></button>}
              <button className="palette-item" onClick={() => { setMenu(null); void runCommand("compare.withClipboard"); }}><FileDiff size={13} /><span className="title">Compare with Clipboard</span></button>
              {doc.path && repoOf(doc.path) && !fileStatus(doc.path)?.untracked && (
                <>
                  <button className="palette-item" onClick={() => { setMenu(null); void compareWithHead(doc.path!); }}><FileDiff size={13} /><span className="title">Compare with Last Commit</span></button>
                  <button className="palette-item" onClick={() => { setMenu(null); void showHistory(doc.path!); }}><History size={13} /><span className="title">Show File History</span></button>
                </>
              )}
            </>
          )}
          {doc.path && (
            <>
              <div className="menu-sep" />
              <button className="palette-item" onClick={() => { setMenu(null); void writeText(doc.path!); useStore.getState().toast("Path copied", "success", 1200); }}><Copy size={13} /><span className="title">Copy Path</span></button>
              <button className="palette-item" onClick={() => { setMenu(null); void showInExplorerPanel(doc.path!); }}><FolderTree size={13} /><span className="title">Show in Quarry Explorer</span></button>
              <button className="palette-item" onClick={() => { setMenu(null); void showInWindowsExplorer(doc.path!); }}><FolderOpen size={13} /><span className="title">Show in Windows Explorer</span></button>
            </>
          )}
        </div>
      )}
    </>
  );
}

/** The Quarry mark. Clicking it collapses the side panels (or brings pinned ones back). */
function Brand() {
  const open = useStore(anyPanelShown);
  const pinned = useStore((s) => s.pinnedPanels.length > 0 || s.searchDocked);
  const label = open ? "Collapse side panels" : pinned ? "Show pinned panels" : "Quarry";
  return (
    <button className="brand" title={label} aria-label={label} onClick={() => { if (open || pinned) toggleAllPanels(); }}>
      <BrandIcon size={20} />
    </button>
  );
}

function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const win = getCurrentWindow();
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    win.isMaximized().then(setMaximized).catch(() => {});
    win.onResized(() => win.isMaximized().then(setMaximized).catch(() => {})).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);
  return (
    <div className="win-controls">
      <button className="win-btn" title="Minimize" onClick={() => win.minimize()}>
        <Minus size={14} strokeWidth={1.5} />
      </button>
      <button className="win-btn" title={maximized ? "Restore" : "Maximize"} aria-label={maximized ? "Restore" : "Maximize"} onClick={() => win.toggleMaximize()}>
        {maximized ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="2.5" y="3.5" width="6" height="6" rx="1" />
            <path d="M4.5 3.5V2.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1" />
          </svg>
        ) : (
          <Square size={11} strokeWidth={1.4} />
        )}
      </button>
      <button className="win-btn close" title="Close" onClick={() => win.close()}>
        <X size={16} strokeWidth={1.4} />
      </button>
    </div>
  );
}

/**
 * Window chrome. With the menu in the title bar (the default) the title bar holds the Quarry mark
 * and the menus, and open documents get their own tab row above it. With the menu bar on top or
 * hidden, the tabs share the title bar.
 */
export function TitleBar() {
  const docs = useStore((s) => s.docs);
  const activeId = useStore((s) => s.activeId);
  const inlineMenu = useStore((s) => s.settings.menuPosition === "titlebar");
  const win = getCurrentWindow();

  useEffect(() => {
    const doc = docs.find((d) => d.id === activeId);
    win.setTitle(doc ? `${doc.dirty ? "● " : ""}${doc.name} — Quarry` : "Quarry").catch(() => {});
  }, [docs, activeId]);

  const onDouble = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".tab, .win-controls, .brand, .menubar")) return;
    void win.toggleMaximize();
  };
  const tabs = (
    // Tabs that don't fit on one row wrap onto more rows (every tab stays visible).
    <div className="tabs" role="tablist" aria-label="Open documents" data-tauri-drag-region>
      {docs.map((d, i) => (
        <Tab key={d.id} doc={d} active={d.id === activeId} index={i} count={docs.length} />
      ))}
    </div>
  );

  if (inlineMenu) {
    const tabRow = docs.length > 0;
    return (
      <>
        {tabRow && (
          <div className="tabbar" data-tauri-drag-region onDoubleClick={onDouble}>
            {tabs}
            <WindowControls />
          </div>
        )}
        <div className={`titlebar ${tabRow ? "under-tabs" : ""}`} data-tauri-drag-region onDoubleClick={onDouble}>
          <Brand />
          <MenuBar inline />
          <span className="titlebar-fill" data-tauri-drag-region />
          {!tabRow && <WindowControls />}
        </div>
      </>
    );
  }
  return (
    <div className="titlebar" data-tauri-drag-region onDoubleClick={onDouble}>
      <Brand />
      {tabs}
      <WindowControls />
    </div>
  );
}

const BADGE = {
  ask: "Claude is waiting for your answer",
  busy: "Claude is working",
  done: "Claude finished",
} as const;

/** Background Claude tab: waiting for an answer, working, or finished since you last looked. */
function ClaudeBadge({ docId }: { docId: string }) {
  const badge = useClaudeBadge(docId);
  if (!badge) return null;
  return <span className={`tab-badge ${badge}`} title={BADGE[badge]} role="img" aria-label={BADGE[badge]} />;
}
