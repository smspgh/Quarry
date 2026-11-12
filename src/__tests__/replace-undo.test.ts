import { describe, expect, it } from "vitest";
import { undoEntriesOf } from "../lib/replaceUndo";

describe("Replace in Files undo record", () => {
  it("keeps only files that were changed and backed up", () => {
    const entries = undoEntriesOf([
      { path: "a", replaced: 2, error: null, backup: "0.bak", digest: "d0" },
      { path: "b", replaced: 0, error: null, backup: null, digest: null },
      { path: "c", replaced: 0, error: "Access is denied", backup: null, digest: null },
      { path: "d", replaced: 1, error: null, backup: null, digest: "d3" }, // over the backup budget
    ]);
    expect(entries).toEqual([{ path: "a", backup: "0.bak", digest: "d0" }]);
  });
});
