import { PanelLeftClose, Pin, PinOff } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { editor } from "../editor/manager";
import { saveSession } from "../lib/actions";
import { closePanel, floatingPanel, isDocked, isPanelShown, isPinned, minPanelWidth, panelWidth, setPinned, SETTINGS_SHARE } from "../lib/panels";
import { PANELS, useStore, type SidebarPanel } from "../lib/store";
import { ExplorerPanel } from "./panels/ExplorerPanel";
import { GitPanel } from "./panels/GitPanel";
import { JsonPanel } from "./panels/JsonPanel";
import { MacrosPanel } from "./panels/MacrosPanel";
import { ScriptsPanel } from "./panels/ScriptsPanel";
import { SearchPanel } from "./panels/SearchPanel";
import { SettingsPanel } from "./panels/SettingsPanel";
import { PANEL_TITLES } from "./SidebarRail";

const CONTENT: Record<SidebarPanel, () => React.ReactElement> = {
  search: SearchPanel,
  explorer: ExplorerPanel,
  git: GitPanel,
  json: JsonPanel,
  scripts: ScriptsPanel,
  macros: MacrosPanel,
  settings: SettingsPanel,
};

/** One panel. Every panel stays mounted (hidden when closed) so its state survives. */
function PanelFrame({ id }: { id: SidebarPanel }) {
  const shown = useStore((s) => isPanelShown(s, id));
  const pinned = useStore((s) => isPinned(s, id));
  const docked = useStore((s) => isDocked(s, id));
  // Pinned panels in pin order; an auto-docked Search panel after them.
  const order = useStore((s) => (pinned ? s.pinnedPanels.indexOf(id) : s.pinnedPanels.length));
  const width = useStore((s) => panelWidth(s, id));
  const set = useStore((s) => s.set);
  const [dragging, setDragging] = useState(false);
  const title = PANEL_TITLES[id];
  const Content = CONTENT[id];

  // Every time Settings opens it starts at 35% of the window; resizing afterwards lasts until it closes.
  useLayoutEffect(() => {
    if (shown && id === "settings") set((s) => ({ panelWidths: { ...s.panelWidths, settings: Math.max(200, Math.round(window.innerWidth * SETTINGS_SHARE)) } }));
  }, [shown, id, set]);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    const startX = e.clientX;
    const startW = width;
    const move = (ev: MouseEvent) => {
      const w = Math.max(minPanelWidth(id), Math.min(window.innerWidth * 0.6, startW + (ev.clientX - startX)));
      set((s) => ({ panelWidths: { ...s.panelWidths, [id]: w } }));
    };
    const up = () => {
      setDragging(false);
      saveSession();
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // Escape that no control inside the panel used closes a floating panel and returns to the editor.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented || docked) return;
    set({ sidebarVisible: false });
    editor.focus();
  };

  return (
    <aside
      className={`sidebar panel-${id} ${shown ? "" : "hidden"} ${docked ? "docked" : "floating"}`}
      data-panel={id}
      style={{ width, order: docked ? order : undefined }}
      aria-label={`${title} panel`}
      onKeyDown={onKeyDown}
    >
      {pinned && (
        <span className="panel-pin-badge" title={`${title} panel is pinned`} aria-hidden>
          <Pin size={9} strokeWidth={2.4} />
        </span>
      )}
      <Content />
      <button
        className={`icon-btn xs sidebar-pin ${pinned ? "on" : ""}`}
        title={pinned ? `Unpin ${title} panel (it closes when you click the editor)` : `Pin ${title} panel (keep it open beside the editor)`}
        aria-pressed={pinned}
        onClick={() => {
          setPinned(id, !pinned);
          saveSession();
        }}
      >
        {pinned ? <PinOff size={14} /> : <Pin size={14} />}
      </button>
      <button className="icon-btn xs sidebar-close" title={pinned ? `Close ${title} panel (unpins it)` : `Close ${title} panel`} onClick={() => closePanel(id)}>
        <PanelLeftClose size={15} />
      </button>
      <div className={`sidebar-resizer ${dragging ? "dragging" : ""}`} onMouseDown={startResize} />
    </aside>
  );
}

/**
 * Side panels: pinned ones dock left to right beside the rail; the unpinned ("floating") one opens
 * just to the right of them. All of them push the editor over rather than covering it.
 */
export function Sidebar() {
  const floating = useStore(floatingPanel);
  const set = useStore((s) => s.set);
  const dockRef = useRef<HTMLDivElement>(null);

  // A floating panel closes when the user clicks back into the document, the tabs, the status bar
  // or a pinned panel.
  useEffect(() => {
    if (!floating) return;
    const onDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.(".editor-area, .titlebar, .tabbar, .statusbar, .sidebar.docked")) set({ sidebarVisible: false });
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [floating, set]);

  return (
    <div className="panel-dock" ref={dockRef}>
      {PANELS.map((p) => (
        <PanelFrame key={p} id={p} />
      ))}
    </div>
  );
}
