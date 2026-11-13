import { describe, expect, it } from "vitest";
import { parseConflicts, resolveAll, resolvedLines, sideLabel } from "../lib/conflicts";

const text = ["top", "<<<<<<< HEAD", "main one", "main two", "=======", "theirs one", ">>>>>>> 18bc71d (Experiment B)", "middle", "<<<<<<< HEAD", "=======", "added", ">>>>>>> other", "end"].join("\n");

describe("conflict blocks", () => {
  it("finds each block with its labels", () => {
    const blocks = parseConflicts(text.split("\n"));
    expect(blocks).toEqual([
      { start: 1, base: null, mid: 4, end: 6, currentLabel: "HEAD", incomingLabel: "18bc71d (Experiment B)" },
      { start: 8, base: null, mid: 9, end: 11, currentLabel: "HEAD", incomingLabel: "other" },
    ]);
  });

  it("reads diff3 blocks (with the common ancestor) and CRLF lines", () => {
    const lines = ["<<<<<<< HEAD\r", "mine\r", "||||||| parent of 1234\r", "old\r", "=======\r", "theirs\r", ">>>>>>> 1234\r", ""];
    const [b] = parseConflicts(lines);
    expect(b).toMatchObject({ start: 0, base: 2, mid: 4, end: 6, currentLabel: "HEAD", incomingLabel: "1234" });
    // The ancestor is not part of either side.
    expect(resolvedLines(lines, b, "current")).toEqual(["mine\r"]);
    expect(resolvedLines(lines, b, "incoming")).toEqual(["theirs\r"]);
    expect(resolvedLines(lines, b, "both")).toEqual(["mine\r", "theirs\r"]);
  });

  it("ignores lookalikes and unfinished blocks", () => {
    expect(parseConflicts(["Heading", "=======", "text"])).toEqual([]);
    expect(parseConflicts(["<<<<<<< HEAD", "a", "======="])).toEqual([]);
    expect(parseConflicts(["a <<<<<<< b", "=======", ">>>>>>> c"])).toEqual([]);
    expect(parseConflicts(["<<<<<<<< eight", "=======", ">>>>>>>> eight"])).toEqual([]);
    expect(parseConflicts([">>>>>>> stray", "=======", "x"])).toEqual([]);
    // A second start restarts the block: only the complete one counts.
    expect(parseConflicts(["<<<<<<< one", "x", "<<<<<<< two", "a", "=======", "b", ">>>>>>> end"])).toEqual([{ start: 2, base: null, mid: 4, end: 6, currentLabel: "two", incomingLabel: "end" }]);
  });

  it("resolves every block one way, leaving the rest of the text alone", () => {
    expect(resolveAll(text, "current")).toBe(["top", "main one", "main two", "middle", "end"].join("\n"));
    expect(resolveAll(text, "incoming")).toBe(["top", "theirs one", "middle", "added", "end"].join("\n"));
    expect(resolveAll(text, "both")).toBe(["top", "main one", "main two", "theirs one", "middle", "added", "end"].join("\n"));
    expect(resolveAll("no conflicts here\n", "both")).toBe("no conflicts here\n");
    expect(parseConflicts(resolveAll(text, "both").split("\n"))).toEqual([]);
  });

  it("labels the sides", () => {
    expect(sideLabel("current", "HEAD")).toBe("Current (HEAD)");
    expect(sideLabel("incoming", "")).toBe("Incoming");
    expect(sideLabel("incoming", "x".repeat(60))).toBe(`Incoming (${"x".repeat(47)}…)`);
  });
});
