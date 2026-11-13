import { describe, expect, it } from "vitest";
import { closeManyQuestion } from "../lib/actions";

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
