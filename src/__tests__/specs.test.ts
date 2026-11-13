/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";

// specs/*.md hold the user stories and acceptance criteria; specs/index.json maps them to files and
// commands. This fails when a story is malformed, lists a file that is gone, a source file or command
// has no story, or the index was not rebuilt (`pnpm specs`).
describe("specs", () => {
  it("stories are well formed and the index is current", () => {
    const run = spawnSync(process.execPath, ["scripts/specs-index.mjs", "--check"], { encoding: "utf8" });
    expect(run.stderr.trim()).toBe("");
    expect(run.status).toBe(0);
  });
});
