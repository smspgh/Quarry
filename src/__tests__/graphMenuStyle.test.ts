import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Seen live: the graph's commit menu (23 entries) is a `.palette`, a flex column limited to 60vh with
// hidden overflow, so in an 816 px high window its rows were squashed to 19 px and its heading was
// clipped. It may use the window's height and its rows never shrink (it scrolls instead).
it("the graph's context menu is not limited to the palette's 60vh and does not squash its rows", () => {
  const css = readFileSync("src/styles/app.css", "utf8");
  expect(css).toMatch(/\.palette\s*\{[^}]*max-height:\s*60vh/);
  expect(css).toMatch(/\.graph-menu\s*\{[^}]*max-height:\s*calc\(100vh - 8px\)[^}]*overflow-y:\s*auto/);
  expect(css).toMatch(/\.graph-menu > \*\s*\{[^}]*flex-shrink:\s*0/);
});
