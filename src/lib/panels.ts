/**
 * Side panel visibility. Pinned panels dock beside the editor, left to right in the order they
 * were pinned, and stay open (until the brand icon or Ctrl+B collapses them). At most one other
 * panel "floats" to the right of the docked ones (it pushes the editor over too, but closes when the
 * user clicks back into the document): that is `sidebarPanel` while `sidebarVisible` is set and the
 * panel is not docked.
 *
 * While Find in Files has results (`searchDocked`), the Search panel docks too, after the pinned
 * ones, so documents opened from the results are not hidden behind it. Closing it, or clearing
 * the results, ends that.
 */
import { bus } from "./bus";
import { useStore, type SidebarPanel } from "./store";

type State = ReturnType<typeof useStore.getState>;

export const DEFAULT_PANEL_WIDTH = 300;
/** Settings always opens at this share of the window width, so its labels and hints are readable. */
export const SETTINGS_SHARE = 0.35;

/** Bottom panel: starting height, lowest height, and the room it always leaves above it. */
export const BOTTOM_DEFAULT_HEIGHT = 220;
export const BOTTOM_MIN_HEIGHT = 80;
export const BOTTOM_ROOM_ABOVE = 200;

/**
 * A bottom-panel height that fits a window `windowHeight` px high: between BOTTOM_MIN_HEIGHT and
 * the window less BOTTOM_ROOM_ABOVE. Anything that is not a number (a missing or damaged session
 * value) gives the default.
 */
export function clampBottomHeight(h: unknown, windowHeight: number): number {
  if (typeof h !== "number" || !Number.isFinite(h)) return BOTTOM_DEFAULT_HEIGHT;
  return Math.round(Math.max(BOTTOM_MIN_HEIGHT, Math.min(windowHeight - BOTTOM_ROOM_ABOVE, h)));
}

export const isPinned = (s: State, p: SidebarPanel) => s.pinnedPanels.includes(p);

/** Docked only because Find in Files has results (not pinned by the user). */
export const isAutoDocked = (s: State, p: SidebarPanel) => p === "search" && s.searchDocked && !isPinned(s, p);

/** Stays open while the user works in the editor: pinned, or Search with results. */
export const isDocked = (s: State, p: SidebarPanel) => isPinned(s, p) || isAutoDocked(s, p);

/** The floating panel being shown, if any. */
export const floatingPanel = (s: State): SidebarPanel | null => (s.sidebarVisible && !isDocked(s, s.sidebarPanel) ? s.sidebarPanel : null);

export function isPanelShown(s: State, p: SidebarPanel): boolean {
  return isDocked(s, p) ? !s.pinnedHidden : floatingPanel(s) === p;
}

export const anyPanelShown = (s: State) => (!s.pinnedHidden && (s.pinnedPanels.length > 0 || s.searchDocked)) || floatingPanel(s) !== null;

/** Narrowest a panel can be dragged. Search needs room for its search box and five buttons. */
export const minPanelWidth = (p: SidebarPanel) => (p === "search" ? 280 : 200);

export const panelWidth = (s: State, p: SidebarPanel) => Math.max(minPanelWidth(p), s.panelWidths[p] ?? s.sidebarWidth ?? DEFAULT_PANEL_WIDTH);

/** Show a panel (pinned ones are revealed in the dock, others float). */
export function showPanel(p: SidebarPanel) {
  const s = useStore.getState();
  // Search with results on screen docks again when it is reopened.
  const dock = p === "search" && s.search.files.length > 0 ? { searchDocked: true } : {};
  s.set({ sidebarVisible: true, sidebarPanel: p, pinnedHidden: false, ...dock });
  if (p === "search") bus.emit("search.focus");
}

/** Rail icon / View menu: open a panel, or close it when it is the floating one. A shown pinned panel stays. */
export function togglePanel(p: SidebarPanel) {
  const s = useStore.getState();
  if (floatingPanel(s) === p) s.set({ sidebarVisible: false });
  else if (isAutoDocked(s, p) && !s.pinnedHidden) closePanel(p);
  else if (isPinned(s, p) && !s.pinnedHidden) focusPanel(p);
  else showPanel(p);
}

/** Move keyboard focus into a shown panel. */
export function focusPanel(p: SidebarPanel) {
  const el = document.querySelector<HTMLElement>(`.sidebar[data-panel="${p}"]`);
  el?.querySelector<HTMLElement>("input, textarea, button:not(.sidebar-pin):not(.sidebar-close), [tabindex='0']")?.focus();
}

/** Collapse every open panel (pinned ones stay pinned and come back with Ctrl+B or their icon). */
export function collapsePanels() {
  useStore.getState().set({ pinnedHidden: true, sidebarVisible: false });
}

/** Ctrl+B and the brand icon: collapse what is open, or bring the panels back. */
export function toggleAllPanels() {
  const s = useStore.getState();
  if (anyPanelShown(s)) collapsePanels();
  else if (s.pinnedPanels.length > 0 || s.searchDocked) s.set({ pinnedHidden: false });
  else showPanel(s.sidebarPanel);
}

export function setPinned(p: SidebarPanel, pinned: boolean) {
  const s = useStore.getState();
  if (pinned) {
    if (!isPinned(s, p)) s.set({ pinnedPanels: [...s.pinnedPanels, p], pinnedHidden: false });
  } else {
    // Unpinning keeps the panel in view, floating, until the user clicks away.
    s.set({ pinnedPanels: s.pinnedPanels.filter((x) => x !== p), sidebarVisible: true, sidebarPanel: p });
  }
}

/** A panel's close button: a floating panel closes; a pinned one is unpinned and closed. */
export function closePanel(p: SidebarPanel) {
  const s = useStore.getState();
  if (isAutoDocked(s, p)) s.set({ searchDocked: false, ...(s.sidebarPanel === p ? { sidebarVisible: false } : {}) });
  else if (isPinned(s, p)) s.set({ pinnedPanels: s.pinnedPanels.filter((x) => x !== p), ...(s.sidebarPanel === p ? { sidebarVisible: false } : {}) });
  else if (floatingPanel(s) === p) s.set({ sidebarVisible: false });
}

/**
 * What a mousedown on `target` does to the floating panel: "now" (a click back into the document,
 * the tabs, the title bar, the status bar or a docked panel closes it), "after-click" (on a button
 * there, e.g. a conflict bar's Accept Current: closing moves the editor, so it waits until the
 * click has landed), or null (leave it open).
 */
export function floatCloseOn(target: Element | null): "now" | "after-click" | null {
  if (!target?.closest?.(".editor-area, .titlebar, .tabbar, .statusbar, .sidebar.docked")) return null;
  return target.closest("button, a[href], [role='button'], [role='menuitem'], input, label, select") ? "after-click" : "now";
}
