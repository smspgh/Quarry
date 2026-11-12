import { describe, expect, it } from "vitest";
import { planRoom } from "../lib/tabLimit";

const d = (id: string, used: number, dirty = false) => ({ id, used, dirty });

describe("planRoom (open-tab limit)", () => {
  const tabs = [d("a", 3), d("b", 1), d("c", 2, true), d("e", 5)];

  it("closes nothing while there is room", () => {
    expect(planRoom(tabs, 5, 1)).toEqual({ close: [], fit: 1 });
    expect(planRoom(tabs, 4, 0)).toEqual({ close: [], fit: 0 });
  });
  it("closes the least recently used tabs without unsaved changes", () => {
    expect(planRoom(tabs, 4, 1)).toEqual({ close: ["b"], fit: 1 });
    expect(planRoom(tabs, 4, 2)).toEqual({ close: ["b", "a"], fit: 2 });
  });
  it("opens only what can fit when too many tabs have changes", () => {
    // 3 closable tabs (b, a, e) and a limit of 4: at most 3 of 5 new files fit (c stays).
    expect(planRoom(tabs, 4, 5)).toEqual({ close: ["b", "a", "e"], fit: 3 });
    expect(planRoom([d("x", 1, true), d("y", 2, true)], 2, 1)).toEqual({ close: [], fit: 0 });
  });
  it("respects tabs it must keep, and a limit lowered below what is open", () => {
    expect(planRoom(tabs, 4, 1, new Set(["b"]))).toEqual({ close: ["a"], fit: 1 });
    expect(planRoom(tabs, 2, 1)).toEqual({ close: ["b", "a", "e"], fit: 1 });
  });
});
