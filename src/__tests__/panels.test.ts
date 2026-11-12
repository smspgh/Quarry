import { beforeEach, describe, expect, it } from "vitest";
import { anyPanelShown, closePanel, floatingPanel, isDocked, isPanelShown, showPanel, toggleAllPanels, togglePanel } from "../lib/panels";
import { useStore } from "../lib/store";

const st = () => useStore.getState();
const withResults = () => st().setSearch({ files: [{ path: "a.txt", matches: [] }] });

beforeEach(() => {
  st().set({ pinnedPanels: [], pinnedHidden: false, searchDocked: false, sidebarVisible: false, sidebarPanel: "explorer" });
  st().setSearch({ files: [] });
});

describe("side panels", () => {
  it("an unpinned panel floats and the rail toggles it", () => {
    togglePanel("json");
    expect(floatingPanel(st())).toBe("json");
    togglePanel("json");
    expect(isPanelShown(st(), "json")).toBe(false);
  });
  it("the Explorer opens floating like the other panels", () => {
    togglePanel("explorer");
    expect(st().pinnedPanels).toEqual([]);
    expect(floatingPanel(st())).toBe("explorer");
    closePanel("explorer");
    expect(isPanelShown(st(), "explorer")).toBe(false);
  });
  it("pinned panels stay shown while another one floats", () => {
    st().set({ pinnedPanels: ["explorer"] });
    showPanel("json");
    expect(isPanelShown(st(), "explorer")).toBe(true);
    expect(floatingPanel(st())).toBe("json");
  });
  it("collapse hides everything and brings pinned panels back", () => {
    st().set({ pinnedPanels: ["explorer"] });
    showPanel("json");
    toggleAllPanels();
    expect(anyPanelShown(st())).toBe(false);
    toggleAllPanels();
    expect(isPanelShown(st(), "explorer")).toBe(true);
    expect(floatingPanel(st())).toBe(null);
  });
  it("Search docks while it has results, and docks again when reopened", () => {
    showPanel("search");
    st().set({ searchDocked: true });
    withResults();
    expect(isDocked(st(), "search")).toBe(true);
    expect(floatingPanel(st())).toBe(null);
    closePanel("search");
    expect(isPanelShown(st(), "search")).toBe(false);
    showPanel("search");
    expect(isDocked(st(), "search")).toBe(true);
    expect(isPanelShown(st(), "search")).toBe(true);
  });
  it("Search without results floats", () => {
    showPanel("search");
    expect(isDocked(st(), "search")).toBe(false);
    expect(floatingPanel(st())).toBe("search");
  });
});
