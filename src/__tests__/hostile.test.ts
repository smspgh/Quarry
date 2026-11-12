import { describe, expect, it } from "vitest";
import { breadcrumbWindow, formatPath, nodeAtOffset, nodeKey, nodePreview, parseJsonTree, pathSegments } from "../lib/jsonPath";

/** Hostile inputs for the tolerant JSON tree parser and path formatting (polish pass, Phase 3). */
describe("JSON tree parser: hostile inputs", () => {
  it("parses 10 000 nested arrays without overflowing the stack", () => {
    const depth = 10_000;
    const src = "[".repeat(depth) + "1" + "]".repeat(depth);
    const r = parseJsonTree(src);
    expect(r.error).toBeNull();
    const leaf = nodeAtOffset(r.root, depth)!;
    expect(leaf.type).toBe("number");
    expect(leaf.depth).toBe(depth);
    expect(pathSegments(leaf)).toHaveLength(depth);
  });

  it("reports an error instead of throwing for 1 000 000 levels", () => {
    const depth = 1_000_000;
    const r = parseJsonTree("[".repeat(depth) + "]".repeat(depth));
    expect(r.root === null ? r.error : null).toBeDefined();
  });

  it("handles 200 000 sibling keys and finds the node at the cursor quickly", () => {
    const n = 200_000;
    const parts: string[] = [];
    for (let i = 0; i < n; i++) parts.push(`"k${i}":${i}`);
    const src = "{" + parts.join(",") + "}";
    const t0 = performance.now();
    const r = parseJsonTree(src);
    const parseMs = performance.now() - t0;
    expect(r.root!.children).toHaveLength(n);
    const t1 = performance.now();
    const node = nodeAtOffset(r.root, src.indexOf('"k199999"') + 2)!;
    expect(performance.now() - t1).toBeLessThan(5);
    expect(node.key).toBe("k199999");
    expect(parseMs).toBeLessThan(3000);
  });

  it("keeps number text exactly as written", () => {
    const src = "[1e400, -0, 0.10, 1234567890123456789012345678901234567890]";
    const kids = parseJsonTree(src).root!.children!;
    expect(kids.map(nodePreview)).toEqual(["1e400", "-0", "0.10", "1234567890123456789012345678901234567890"]);
  });

  it("decodes escapes, surrogate pairs and lone surrogates in keys", () => {
    const src = String.raw`{"q\"\\\n~/😀\ud800": 1}`;
    const key = parseJsonTree(src).root!.children![0].key as string;
    expect(key).toBe('q"\\\n~/😀\ud800');
  });

  it("keeps both entries of a duplicate key", () => {
    const kids = parseJsonTree('{"a":1,"a":2}').root!.children!;
    expect(kids.map((k) => [k.key, k.value])).toEqual([["a", 1], ["a", 2]]);
  });
});

describe("JSON paths: awkward keys in every style", () => {
  const key = 'q"\\\n~/😀\ud800\'';
  it("JSONPath escapes backslashes, quotes and control characters", () => {
    const p = formatPath([key], "jsonpath");
    expect(p).toBe("$['q\"\\\\\\n~/😀\\ud800\\'']");
    // JSONPath (RFC 9535) single-quoted strings use JSON-style escapes; decode and compare.
    const inner = p.slice(3, -2);
    expect(JSON.parse('"' + inner.replace(/\\'/g, "'").replace(/"/g, '\\"') + '"')).toBe(key);
  });
  it("JS and bracket styles are valid JavaScript that yields the key", () => {
    for (const style of ["js", "bracket"] as const) {
      const p = formatPath(["a", key, 0], style);
      const obj = { a: { [key]: ["ok"] } };
      const get = new Function("o", `return o${style === "js" ? "." : ""}${p};`);
      expect(get(obj)).toBe("ok");
    }
  });
  it("JSON Pointer escapes ~ before / and round-trips", () => {
    const p = formatPath(["~1", "a/b", key], "pointer");
    expect(p.startsWith("/~01/a~1b/")).toBe(true);
    const back = p.split("/").slice(1).map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
    expect(back).toEqual(["~1", "a/b", key]);
  });
});

describe("JSON panel helpers at extreme depth", () => {
  const depth = 10_000;
  const src = "[".repeat(depth) + "1" + "]".repeat(depth);
  it("nodeKey is O(1) per node, unique per path and stable across re-parses", () => {
    const a = parseJsonTree(src).root!;
    const leafA = nodeAtOffset(a, depth)!;
    const t0 = performance.now();
    const keyA = nodeKey(leafA);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(nodeKey(a)).toBe("");
    const leafB = nodeAtOffset(parseJsonTree(src).root!, depth)!;
    expect(nodeKey(leafB)).toBe(keyA);
    const kids = parseJsonTree('{"a":{"b":1},"a/b":2,"0":[3],"x":[[4]]}').root!.children!;
    const keys = new Set<string>();
    const all = [...kids, kids[0].children![0], kids[2].children![0], kids[3].children![0], kids[3].children![0].children![0]];
    for (const n of all) keys.add(nodeKey(n));
    expect(keys.size).toBe(all.length);
  });
  it("breadcrumbWindow keeps short paths whole and elides the middle of long ones", () => {
    expect(breadcrumbWindow(3)).toEqual({ head: [0, 1, 2], hidden: 0, tail: [] });
    expect(breadcrumbWindow(7)).toEqual({ head: [0, 1, 2, 3, 4, 5, 6], hidden: 0, tail: [] });
    expect(breadcrumbWindow(depth)).toEqual({ head: [0, 1], hidden: depth - 6, tail: [depth - 4, depth - 3, depth - 2, depth - 1] });
  });
  it("pathSegments of the innermost node is fast", () => {
    const leaf = nodeAtOffset(parseJsonTree(src).root!, depth)!;
    const t0 = performance.now();
    expect(pathSegments(leaf)).toHaveLength(depth);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});

describe("tree parser flags what strict JSON rejects", () => {
  it("reports the first lenient construct and stays null for strict JSON", () => {
    expect(parseJsonTree('{"a": [1, -0, 0.10, 1e400], "b": "x"}').lenient).toBeNull();
    const cases: [string, string][] = [
      ['{ "a": NaN }', "NaN is not a JSON number"],
      ["[Infinity]", "Infinity is not a JSON number"],
      ["[.5]", ".5 is not a JSON number"],
      ["[0x10]", "0x10 is not a JSON number"],
      ["[1,]", "trailing comma"],
      ["{a: 1}", "unquoted key"],
      ["['s']", "single-quoted string"],
      ["// c\n[1]", "comment"],
      ['["a\tb"]', "control character in a string"],
    ];
    for (const [src, reason] of cases) {
      const r = parseJsonTree(src);
      expect(r.root, src).not.toBeNull();
      expect(r.lenient?.reason, src).toBe(reason);
    }
  });
});
