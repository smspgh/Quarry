import { describe, expect, it } from "vitest";
import { flattenRows } from "../components/panels/BigJsonTree";
import type { BigJsonNode } from "../lib/ipc";

const node = (start: number, kind: BigJsonNode["kind"], key: string | null, index: number, count: number | null = null): BigJsonNode => ({ key, index, kind, preview: "", start, end: start + 1, count });

describe("flattenRows (large-file JSON tree)", () => {
  const root = node(0, "object", null, 0);
  const users = node(10, "array", "users", 0, 3);
  const name = node(20, "string", "name", 1);
  const u0 = node(30, "object", null, 0, 1);
  const kids = new Map([
    [0, { nodes: [users, name], next: null }],
    [10, { nodes: [u0], next: 40 }],
    [30, { nodes: [node(35, "number", "id", 0)], next: null }],
  ]);

  it("lists expanded children in order, with a Load more row after a partial page", () => {
    const rows = flattenRows(root, new Set([0, 10]), kids);
    expect(rows.map((r) => (r.type === "more" ? `more(${r.shown})` : r.key))).toEqual(["0", "10", "30", "more(1)", "20"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 2, 1]);
  });

  it("carries each node's path for Copy Path, and hides collapsed or unloaded branches", () => {
    const rows = flattenRows(root, new Set([0, 10, 30]), kids);
    const id = rows.find((r) => r.type === "node" && r.node.start === 35);
    expect(id?.type === "node" && id.path).toEqual(["users", 0, "id"]);
    expect(flattenRows(root, new Set([0]), kids).length).toBe(3);
    expect(flattenRows(root, new Set([0, 20]), kids).length).toBe(3);
  });
});
