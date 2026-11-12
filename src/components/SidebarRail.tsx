import { Braces, Clapperboard, FileCode2, FolderTree, GitBranch, Search, Settings } from "lucide-react";
import { isPanelShown, togglePanel } from "../lib/panels";
import { useStore, type SidebarPanel } from "../lib/store";

export const PANEL_TITLES: Record<SidebarPanel, string> = {
  search: "Search",
  explorer: "Explorer",
  git: "Source Control",
  json: "JSON Tools",
  scripts: "Scripts",
  macros: "Macros",
  settings: "Settings",
};

const ICONS: Record<SidebarPanel, typeof Search> = {
  search: Search,
  explorer: FolderTree,
  git: GitBranch,
  json: Braces,
  scripts: FileCode2,
  macros: Clapperboard,
  settings: Settings,
};

const TOP: SidebarPanel[] = ["search", "explorer", "git", "json","scripts", "macros"];

/** Always-visible strip of panel icons on the left edge. Each panel has its own colour (tokens.css). */
export function SidebarRail() {
  const pinned = useStore((s) => s.pinnedPanels);
  // Re-render when what is shown changes.
  useStore((s) => `${s.sidebarVisible}:${s.sidebarPanel}:${s.pinnedHidden}:${s.searchDocked}:${s.pinnedPanels.join()}`);

  const button = (id: SidebarPanel) => {
    const Icon = ICONS[id];
    const open = isPanelShown(useStore.getState(), id);
    const tip = `${PANEL_TITLES[id]} Panel`;
    return (
      <button
        key={id}
        className={`rail-btn panel-${id} ${open ? "open" : ""}`}
        data-tip={tip}
        aria-label={tip}
        aria-pressed={open}
        onClick={() => togglePanel(id)}
      >
        <Icon size={19} strokeWidth={1.8} />
        {pinned.includes(id) && <span className="rail-pin-dot" aria-hidden />}
      </button>
    );
  };

  return (
    <nav className="sidebar-rail" aria-label="Panels">
      {TOP.map(button)}
      <span className="grow" />
      {button("settings")}
    </nav>
  );
}
