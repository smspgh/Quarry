import { describe, expect, it } from "vitest";
import { Chunk } from "@codemirror/merge";
import { Text } from "@codemirror/state";
import { describeLines, discardText, hunkAt, hunksOf, picksForSelection, selectionApplies, textHash, type Pick } from "../lib/gitHunks";

// Partial staging, the pure part (STAGE-001..004, 006): changes and selections as line ranges.
const text = (s: string) => Text.of(s.split("\n"));
const hunks = (a: string, b: string) => hunksOf(Chunk.build(text(a), text(b)), text(a), text(b));
const lines = (n: number, edit: (l: string[]) => void = () => {}) => {
  const l = Array.from({ length: n }, (_, i) => `line ${i + 1}`);
  edit(l);
  return l.join("\n") + "\n";
};
const pick = (oldStart: number, oldCount: number, newStart: number, newCount: number): Pick => ({ oldStart, oldCount, newStart, newCount });

/** What Rust does with picks (staging.rs `splice`), on editor lines: the left text with the picked pieces of the right. */
function apply(a: string, b: string, picks: Pick[]): string {
  const [old, now] = [a.split("\n"), b.split("\n")];
  const out: string[] = [];
  let at = 0;
  for (const p of picks) {
    out.push(...old.slice(at, p.oldStart - 1), ...now.slice(p.newStart - 1, p.newStart - 1 + p.newCount));
    at = p.oldStart - 1 + p.oldCount;
  }
  return [...out, ...old.slice(at)].join("\n");
}

describe("hunksOf: the changes of a comparison as line ranges", () => {
  it("three separate changes (STAGE-001.2)", () => {
    const a = lines(50);
    const b = lines(50, (l) => { l[2] = "THREE"; l[19] = "TWENTY"; l[39] = "FORTY"; });
    expect(hunks(a, b)).toEqual([pick(3, 1, 3, 1), pick(20, 1, 20, 1), pick(40, 1, 40, 1)]);
  });

  it("added lines are a place in the old text; removed lines a place in the new one", () => {
    const a = lines(30);
    expect(hunks(a, lines(30, (l) => l.splice(9, 0, "a", "b", "c")))).toEqual([pick(10, 0, 10, 3)]);
    expect(hunks(a, lines(30, (l) => l.splice(19, 4)))).toEqual([pick(20, 4, 20, 0)]);
  });

  it("a line the editor's chunk takes in, but that is the same on both sides, is not part of the change", () => {
    // "line 20".."line 23" removed: the character diff ends inside "line 2|4", so the chunk
    // covers "line 24" on both sides too.
    const a = lines(30);
    const b = lines(30, (l) => l.splice(19, 4));
    const chunk = Chunk.build(text(a), text(b))[0];
    expect(text(a).lineAt(chunk.toA - 1).number).toBe(24);
    expect(chunk.toB).toBeGreaterThan(chunk.fromB);
    expect(hunks(a, b)).toEqual([pick(20, 4, 20, 0)]);
    // The same the other way round: 4 added lines are 4 added lines, not "1 line replaced by 5".
    expect(hunks(b, a)).toEqual([pick(20, 0, 20, 4)]);
    // Staging only the first of them must not drop "line 24" from the staged text.
    expect(apply(b, a, picksForSelection(hunks(b, a), 20, 20, 31)).split("\n").slice(18, 22)).toEqual(["line 19", "line 20", "line 24", "line 25"]);
  });

  it("the ends of the file: applying every change gives the right text", () => {
    const cases: [string, string][] = [
      ["a\nb\n", "a\nb\nc\n"],
      ["a\nb", "a\nb\nc"],
      ["a\nb", "a\nb\n"], // a final newline added (STAGE-006.5)
      ["a\nb\n", "a\nb"], // ...and removed
      ["a\nb\nc", "a\nb\nX"], // last line, no final newline (STAGE-006.4)
      ["a\nb\nc\n", "x\nb\nc\n"], // first line (STAGE-006.7)
      ["", "a\nb\n"],
      ["a\nb\n", ""],
      ["a\nb", "b"],
      ["b", "a\nb"],
      ["a\nb\nc\nd\ne\nf\n", "a\nB\nc\nd\nE\nf\ng\n"],
    ];
    for (const [a, b] of cases) expect(apply(a, b, hunks(a, b)), JSON.stringify([a, b])).toBe(b);
  });
});

describe("hunkAt: the change at a line of the right side", () => {
  const h = [pick(3, 1, 3, 1), pick(10, 0, 10, 3), pick(20, 4, 23, 0)];
  it("a changed or added line is in its change; an unchanged line in none (STAGE-008.7)", () => {
    expect(hunkAt(h, 3, 40)).toBe(0);
    expect(hunkAt(h, 10, 40)).toBe(1);
    expect(hunkAt(h, 12, 40)).toBe(1);
    expect(hunkAt(h, 13, 40)).toBe(-1);
    expect(hunkAt(h, 1, 40)).toBe(-1);
  });
  it("removed lines count as the line they were removed before, or the last line at the end", () => {
    expect(hunkAt(h, 23, 40)).toBe(2);
    expect(hunkAt(h, 22, 40)).toBe(-1);
    expect(hunkAt([pick(5, 2, 5, 0)], 4, 4)).toBe(0);
  });
});

describe("picksForSelection: what a selection takes (STAGE-004)", () => {
  const added = [pick(10, 0, 10, 6)]; // lines 10–15 added
  it("some of the added lines, one by one (.1)", () => {
    expect(picksForSelection(added, 11, 12, 40)).toEqual([pick(10, 0, 11, 2)]);
    expect(picksForSelection(added, 15, 30, 40)).toEqual([pick(10, 0, 15, 1)]);
  });
  it("one line of a block changed line for line (.2)", () => {
    expect(picksForSelection([pick(20, 3, 20, 3)], 21, 21, 40)).toEqual([pick(21, 1, 21, 1)]);
    // The pairing follows the offset inside the block, also when the two sides are at different lines.
    expect(picksForSelection([pick(20, 3, 26, 3)], 27, 28, 40)).toEqual([pick(21, 2, 27, 2)]);
  });
  it("a block replaced by a different number of lines: the selected lines replace the whole old block (.3)", () => {
    expect(picksForSelection([pick(30, 2, 30, 5)], 30, 31, 40)).toEqual([pick(30, 2, 30, 2)]);
  });
  it("changes the selection covers are taken whole, the others not at all (.4, .10)", () => {
    const three = [pick(3, 1, 3, 1), pick(20, 2, 20, 3), pick(40, 1, 41, 1)];
    expect(picksForSelection(three, 1, 25, 60)).toEqual([three[0], three[1]]);
    expect(picksForSelection(three, 20, 22, 60)).toEqual([three[1]]);
  });
  it("removed lines only when the selection spans the place (.5)", () => {
    const gone = [pick(20, 4, 20, 0)]; // 4 lines removed between lines 19 and 20
    expect(picksForSelection(gone, 19, 20, 40)).toEqual(gone);
    expect(picksForSelection(gone, 19, 19, 40)).toEqual([]);
    expect(picksForSelection(gone, 20, 20, 40)).toEqual([]);
    // At the very start or end of the file there is only one neighbour.
    expect(picksForSelection([pick(1, 2, 1, 0)], 1, 1, 40)).toEqual([pick(1, 2, 1, 0)]);
    expect(picksForSelection([pick(39, 2, 41, 0)], 40, 40, 40)).toEqual([pick(39, 2, 41, 0)]);
  });
  it("a selection or cursor on unchanged lines takes nothing (.8)", () => {
    expect(selectionApplies(added, 1, 9, 40)).toBe(false);
    expect(selectionApplies(added, 16, 16, 40)).toBe(false);
    expect(selectionApplies(added, 12, 12, 40)).toBe(true);
  });
  it("the picked pieces applied to the old text stage exactly those lines", () => {
    const a = lines(30);
    const b = lines(30, (l) => { l.splice(24, 2, "w1", "w2", "w3", "w4", "w5"); l.splice(19, 3, "P", "Q", "R"); l.splice(9, 0, "a1", "a2", "a3", "a4", "a5", "a6"); });
    const h = hunks(a, b);
    expect(h).toEqual([pick(10, 0, 10, 6), pick(20, 3, 26, 3), pick(25, 2, 31, 5)]);
    const staged = apply(a, b, picksForSelection(h, 11, 12, 39)).split("\n");
    expect(staged.slice(8, 12)).toEqual(["line 9", "a2", "a3", "line 10"]);
    expect(apply(a, b, picksForSelection(h, 27, 27, 39)).split("\n").slice(19, 22)).toEqual(["line 20", "Q", "line 22"]);
    expect(apply(a, b, picksForSelection(h, 31, 32, 39)).split("\n").slice(23, 27)).toEqual(["line 24", "w1", "w2", "line 27"]);
  });
});

describe("the Discard question's words (STAGE-003)", () => {
  it("names one line, a range, several ranges", () => {
    expect(describeLines([pick(20, 1, 20, 1)])).toBe("Line 20");
    expect(describeLines([pick(20, 3, 20, 3)])).toBe("Lines 20–22");
    expect(describeLines([pick(3, 1, 3, 1), pick(20, 3, 20, 3), pick(40, 1, 44, 2)])).toBe("Lines 3, 20–22 and 44–45");
    // Adjacent pieces read as one range.
    expect(describeLines([pick(10, 0, 11, 1), pick(10, 0, 12, 1)])).toBe("Lines 11–12");
    expect(describeLines([])).toBe("");
  });
  it("lines that go back to the last commit or the staged version (.1, .5)", () => {
    expect(discardText([pick(20, 3, 20, 3)], "app.ts", "the last commit")).toBe("Lines 20–22 of app.ts go back to the last commit. Your edits to those lines will be lost.");
    expect(discardText([pick(20, 1, 20, 1)], "app.ts", "the staged version")).toBe("Line 20 of app.ts goes back to the staged version. Your edits to that line will be lost.");
  });
  it("removed lines are put back (.6)", () => {
    expect(discardText([pick(20, 4, 20, 0)], "app.ts", "the last commit")).toBe("The 4 lines removed after line 19 of app.ts are put back.");
    expect(discardText([pick(20, 1, 20, 0)], "app.ts", "the last commit")).toBe("The line removed after line 19 of app.ts is put back.");
    expect(discardText([pick(1, 2, 1, 0)], "app.ts", "the last commit")).toBe("The 2 lines removed at the start of app.ts are put back.");
    expect(discardText([pick(3, 1, 3, 1), pick(20, 4, 20, 0)], "app.ts", "the last commit")).toBe(
      "Line 3 of app.ts goes back to the last commit. Your edits to that line will be lost. The 4 lines removed after line 19 are put back.",
    );
  });
});

describe("textHash", () => {
  it("matches text_hash in src-tauri/src/git/staging.rs", () => {
    expect(textHash("")).toBe("0:811c9dc5:1505");
    expect(textHash("héllo\n😀")).toBe("8:ba263d42:8a1c51e4");
  });
  it("tells texts apart", () => {
    expect(textHash("a\nb\n")).not.toBe(textHash("a\nb"));
    expect(textHash("ab")).not.toBe(textHash("ba"));
  });
});
