/**
 * Tolerant JSON parser that records source offsets for every node, so the UI can
 * map tree nodes <-> editor positions and compute the path at any cursor offset.
 * It accepts comments, trailing commas and unquoted keys (JSON5-ish) so the tree
 * still renders while the user is mid-edit; strict validation is done in Rust.
 */

export type JsonNodeType = "object" | "array" | "string" | "number" | "boolean" | "null";

export interface JsonNode {
  type: JsonNodeType;
  /** Key in parent object, or index in parent array. */
  key: string | number | null;
  from: number;
  to: number;
  /** Offsets of the key token, when inside an object. */
  keyFrom?: number;
  keyTo?: number;
  value?: string | number | boolean | null;
  children?: JsonNode[];
  parent: JsonNode | null;
  depth: number;
}

export interface ParseOutcome {
  root: JsonNode | null;
  error: { offset: number; message: string } | null;
  /** First construct the tolerant parser accepted that strict JSON (and Validate / Format) rejects. */
  lenient?: { offset: number; reason: string } | null;
}

const STRICT_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?$/;

export function parseJsonTree(text: string, maxNodes = 2_000_000): ParseOutcome {
  let i = 0;
  const n = text.length;
  let count = 0;
  let lenient: { offset: number; reason: string } | null = null;
  const loose = (offset: number, reason: string) => {
    if (!lenient) lenient = { offset, reason };
  };

  const fail = (msg: string): never => {
    throw { offset: i, message: msg };
  };

  const skipWs = () => {
    for (;;) {
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 32 || c === 9 || c === 10 || c === 13 || c === 0xfeff) i++;
        else break;
      }
      if (text.startsWith("//", i)) {
        loose(i, "comment");
        while (i < n && text.charCodeAt(i) !== 10) i++;
        continue;
      }
      if (text.startsWith("/*", i)) {
        loose(i, "comment");
        const end = text.indexOf("*/", i + 2);
        i = end < 0 ? n : end + 2;
        continue;
      }
      break;
    }
  };

  const parseString = (): string => {
    const quote = text[i];
    if (quote === "'") loose(i, "single-quoted string");
    i++;
    let out = "";
    let segStart = i;
    while (i < n) {
      const c = text[i];
      if (c === quote) {
        out += text.slice(segStart, i);
        i++;
        return out;
      }
      if (c === "\\") {
        out += text.slice(segStart, i);
        i++;
        const e = text[i++];
        switch (e) {
          case "n": out += "\n"; break;
          case "t": out += "\t"; break;
          case "r": out += "\r"; break;
          case "b": out += "\b"; break;
          case "f": out += "\f"; break;
          case "u": {
            const hex = text.slice(i, i + 4);
            out += String.fromCharCode(parseInt(hex, 16) || 0);
            i += 4;
            break;
          }
          default: out += e ?? "";
        }
        segStart = i;
        continue;
      }
      if (c === "\n") fail("Unterminated string");
      if (c < " ") loose(i, "control character in a string");
      i++;
    }
    return fail("Unterminated string");
  };

  /** One value at `i`. Containers come back open (children still to read) unless they are empty. */
  const readValue = (key: string | number | null, parent: JsonNode | null, depth: number, keyFrom?: number, keyTo?: number): { node: JsonNode; open: boolean } => {
    if (++count > maxNodes) fail("Document too large for tree view");
    skipWs();
    if (i >= n) fail("Unexpected end of input");
    const c = text[i];
    const node: JsonNode = { type: "null", key, from: i, to: i, parent, depth, keyFrom, keyTo };
    if (c === "{" || c === "[") {
      node.type = c === "{" ? "object" : "array";
      node.children = [];
      i++;
      skipWs();
      if (text[i] === (c === "{" ? "}" : "]")) {
        i++;
        node.to = i;
        return { node, open: false };
      }
      return { node, open: true };
    }
    if (c === '"' || c === "'") {
      node.type = "string";
      node.value = parseString();
      node.to = i;
      return { node, open: false };
    }
    const lit = /^(?:true|false|null|NaN|-?Infinity|0[xX][0-9a-fA-F]+|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/.exec(text.slice(i, i + 64));
    if (!lit) fail("Unexpected token");
    const tok = lit![0];
    i += tok.length;
    node.to = i;
    if (tok === "true" || tok === "false") {
      node.type = "boolean";
      node.value = tok === "true";
    } else if (tok === "null") {
      node.type = "null";
      node.value = null;
    } else {
      node.type = "number";
      node.value = Number(tok);
      if (!STRICT_NUMBER.test(tok)) loose(node.from, `${tok} is not a JSON number`);
      // Keep the raw text for precision-sensitive display.
      (node as JsonNode & { raw?: string }).raw = tok;
    }
    return { node, open: false };
  };

  /** Object member key (quoted, single-quoted or bare identifier) and its colon. */
  const readKey = (): { k: string; kFrom: number; kTo: number } => {
    skipWs();
    const kFrom = i;
    let k: string;
    if (text[i] === '"' || text[i] === "'") k = parseString();
    else {
      const m = /^[A-Za-z_$][\w$]*/.exec(text.slice(i, i + 256));
      if (!m) fail("Expected property name");
      loose(i, "unquoted key");
      k = m![0];
      i += k.length;
    }
    const kTo = i;
    skipWs();
    if (text[i] !== ":") fail("Expected ':'");
    i++;
    return { k, kFrom, kTo };
  };

  // Iterative walk: open containers live on `stack`, so nesting depth costs heap, not call stack.
  const parseDocument = (): JsonNode => {
    const stack: JsonNode[] = [];
    let root: JsonNode | null = null;
    let wantValue = true;
    for (;;) {
      if (wantValue) {
        const parent = stack.length ? stack[stack.length - 1] : null;
        let res: { node: JsonNode; open: boolean };
        if (parent?.type === "object") {
          const { k, kFrom, kTo } = readKey();
          res = readValue(k, parent, stack.length, kFrom, kTo);
        } else {
          res = readValue(parent ? parent.children!.length : null, parent, stack.length);
        }
        if (parent) parent.children!.push(res.node);
        else root = res.node;
        if (res.open) stack.push(res.node);
        else wantValue = false;
        continue;
      }
      const top = stack.length ? stack[stack.length - 1] : null;
      if (!top) return root!;
      const close = top.type === "object" ? "}" : "]";
      skipWs();
      if (text[i] === ",") {
        i++;
        skipWs();
        if (text[i] !== close) {
          wantValue = true;
          continue;
        }
        loose(i - 1, "trailing comma");
      }
      if (text[i] === close) {
        i++;
        top.to = i;
        stack.pop();
        continue;
      }
      fail(top.type === "object" ? "Expected ',' or '}'" : "Expected ',' or ']'");
    }
  };

  try {
    const root = parseDocument();
    skipWs();
    if (i < n) fail("Unexpected trailing content");
    return { root, error: null, lenient };
  } catch (e) {
    const err = e as { offset: number; message: string };
    return { root: null, error: { offset: err.offset ?? i, message: err.message ?? String(e) } };
  }
}

/** Deepest node whose span contains `offset`. */
export function nodeAtOffset(root: JsonNode | null, offset: number): JsonNode | null {
  if (!root) return null;
  let node = root;
  if (offset < node.from || offset > node.to) return null;
  for (;;) {
    const kids = node.children;
    if (!kids || kids.length === 0) return node;
    // Binary search since children are ordered by offset.
    let lo = 0;
    let hi = kids.length - 1;
    let found: JsonNode | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const k = kids[mid];
      const start = k.keyFrom ?? k.from;
      if (offset < start) hi = mid - 1;
      else if (offset > k.to) lo = mid + 1;
      else {
        found = k;
        break;
      }
    }
    if (!found) return node;
    node = found;
  }
}

export function pathSegments(node: JsonNode): (string | number)[] {
  const segs: (string | number)[] = [];
  let cur: JsonNode | null = node;
  while (cur && cur.parent) {
    segs.push(cur.key as string | number);
    cur = cur.parent;
  }
  return segs.reverse();
}

export type PathStyle = "dot" | "bracket" | "jsonpath" | "pointer" | "js";

const IDENT = /^[A-Za-z_$][\w$]*$/;

/** Body of a single-quoted JSONPath name (RFC 9535): JSON escapes, with ' escaped instead of ". */
function jsonPathQuote(s: string): string {
  return JSON.stringify(s).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'");
}

export function formatPath(segs: (string | number)[], style: PathStyle): string {
  switch (style) {
    case "dot":
      return segs.map((s) => (typeof s === "number" ? `[${s}]` : s)).join(".").replace(/\.\[/g, "[") || "$";
    case "js":
      return (
        segs
          .map((s) => (typeof s === "number" ? `[${s}]` : IDENT.test(s) ? `.${s}` : `[${JSON.stringify(s)}]`))
          .join("")
          .replace(/^\./, "") || "$"
      );
    case "bracket":
      return segs.map((s) => (typeof s === "number" ? `[${s}]` : `[${JSON.stringify(s)}]`)).join("") || "$";
    case "jsonpath":
      return "$" + segs.map((s) => (typeof s === "number" ? `[${s}]` : IDENT.test(s) ? `.${s}` : `['${jsonPathQuote(s)}']`)).join("");
    case "pointer":
      // RFC 6901: the whole document is the empty pointer.
      return segs.map((s) => "/" + String(s).replace(/~/g, "~0").replace(/\//g, "~1")).join("");
  }
}

/** Human-readable toast text for a copied path (the root pointer is the empty string). */
export function describeCopiedPath(text: string, style: PathStyle): string {
  if (text === "" && style === "pointer") return 'Copied root pointer: "" (empty string)';
  return `Copied path: ${text}`;
}

/**
 * Text to put on the clipboard for a node: strings copy unquoted, everything else copies the raw
 * JSON source with the source's surrounding indentation removed (continuation lines are dedented by
 * the smallest common indent so a nested object pastes as a well-formed top-level value).
 */
export function valueClipboardText(source: string, node: JsonNode): string {
  if (node.type === "string") return String(node.value ?? "");
  const raw = source.slice(node.from, node.to);
  const lines = raw.split("\n");
  if (lines.length < 2) return raw;
  const indentOf = (l: string) => /^[ \t]*/.exec(l)![0].length;
  let min = Infinity;
  for (const l of lines.slice(1)) if (l.trim()) min = Math.min(min, indentOf(l));
  if (!isFinite(min) || min === 0) return raw;
  return [lines[0], ...lines.slice(1).map((l) => l.slice(Math.min(min, indentOf(l))))].join("\n");
}

export function nodePreview(node: JsonNode): string {
  switch (node.type) {
    case "object":
      return `{${node.children!.length}}`;
    case "array":
      return `[${node.children!.length}]`;
    case "string":
      return JSON.stringify(node.value);
    case "number":
      return (node as JsonNode & { raw?: string }).raw ?? String(node.value);
    case "boolean":
      return String(node.value);
    case "null":
      return "null";
  }
}

const keyCache = new WeakMap<JsonNode, string>();

/** 53-bit string hash (cyrb53); `seed` chains it with the parent's key. */
function hash53(s: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Stable row identity for a node: a hash of its path, chained from the parent's key, so it survives
 * re-parses (same path, same key) and costs O(1) per node at any depth. The root's key is "".
 */
export function nodeKey(node: JsonNode): string {
  const cached = keyCache.get(node);
  if (cached !== undefined) return cached;
  const chain: JsonNode[] = [];
  let cur: JsonNode | null = node;
  while (cur && !keyCache.has(cur)) {
    chain.push(cur);
    cur = cur.parent;
  }
  let key = cur ? keyCache.get(cur)! : "";
  for (let k = chain.length - 1; k >= 0; k--) {
    const n = chain[k];
    if (!n.parent) key = "";
    else {
      const seg = typeof n.key === "number" ? `#${n.key}` : `$${n.key}`;
      key = hash53(seg, hash53(key, 7) >>> 0).toString(36);
    }
    keyCache.set(n, key);
  }
  return key;
}

/** Which breadcrumb segments to show for a path of `len` segments: the first `head`, an ellipsis, the last `tail`. */
export function breadcrumbWindow(len: number, head = 2, tail = 4): { head: number[]; hidden: number; tail: number[] } {
  if (len <= head + tail + 1) return { head: Array.from({ length: len }, (_, i) => i), hidden: 0, tail: [] };
  return {
    head: Array.from({ length: head }, (_, i) => i),
    hidden: len - head - tail,
    tail: Array.from({ length: tail }, (_, i) => len - tail + i),
  };
}
