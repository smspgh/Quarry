import { describe, expect, it } from "vitest";
import { closeManyQuestion } from "../lib/actions";
import { CLOSED_TABS_MAX, popClosed, pushClosed, type ClosedTab } from "../lib/closedTabs";

describe("closeManyQuestion", () => {
  it("names the one file", () => {
    const q = closeManyQuestion(["a.txt"]);
    expect(q.title).toBe("Save changes to a.txt?");
    expect(q.save).toBe("Save");
  });
  it("counts several files and lists them", () => {
    const q = closeManyQuestion(["a.txt", "b.txt", "c.txt"]);
    expect(q.title).toBe("Save changes to 3 files?");
    expect(q.save).toBe("Save All");
    expect(q.message.startsWith("a.txt, b.txt, c.txt.")).toBe(true);
  });
  it("lists at most 8 names", () => {
    const names = Array.from({ length: 11 }, (_, i) => `f${i}.txt`);
    const q = closeManyQuestion(names);
    expect(q.message).toContain("f7.txt and 3 more.");
    expect(q.message).not.toContain("f8.txt");
  });
});

describe("closed tab stack", () => {
  it("keeps the newest last, one entry per path (case-insensitive)", () => {
    let st = pushClosed([], { path: "C:\\a.txt" });
    st = pushClosed(st, { path: "C:\\b.txt" });
    st = pushClosed(st, { path: "c:/A.TXT", cursor: 5 });
    expect(st.map((e) => e.path)).toEqual(["C:\\b.txt", "c:/A.TXT"]);
    expect(st[1].cursor).toBe(5);
  });
  it("is bounded", () => {
    let st: ClosedTab[] = [];
    for (let i = 0; i < 25; i++) st = pushClosed(st, { path: `f${i}` });
    expect(st.length).toBe(CLOSED_TABS_MAX);
    expect(st[0].path).toBe("f5");
    expect(st[st.length - 1].path).toBe("f24");
  });
  it("pops the most recent usable entry and drops the skipped ones", async () => {
    const st = [{ path: "a" }, { path: "b" }, { path: "gone" }];
    const r = await popClosed(st, (p) => p !== "gone");
    expect(r.entry?.path).toBe("b");
    expect(r.rest.map((e) => e.path)).toEqual(["a"]);
    expect(st.length).toBe(3);
  });
  it("returns null when nothing is usable", async () => {
    const r = await popClosed([{ path: "x" }], async () => false);
    expect(r.entry).toBeNull();
    expect(r.rest).toEqual([]);
  });
});
