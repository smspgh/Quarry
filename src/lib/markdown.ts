/**
 * A small Markdown parser for Claude's replies: headings, paragraphs, fenced code, lists (nested by
 * indentation), quotes, rules and GFM tables, with inline code / bold / italic / strike / links.
 * It returns a tree that components/Markdown.tsx renders as React elements, so no HTML from the
 * model ever reaches the page. Pure (unit-tested).
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong" | "em" | "del"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] }
  | { t: "br" };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; level: number; c: Inline[] }
  | { t: "code"; lang: string; v: string; open: boolean }
  | { t: "list"; ordered: boolean; start: number; items: Block[][] }
  | { t: "quote"; c: Block[] }
  | { t: "hr" }
  | { t: "table"; align: ("left" | "center" | "right" | null)[]; head: Inline[][]; rows: Inline[][][] };

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
// A closing run of # only counts after a space ("## Using C#" keeps its #).
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const HR = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

export function parseMarkdown(src: string): Block[] {
  return blocks(src.replace(/\r\n?/g, "\n").split("\n"));
}

function blocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ t: "p", c: inline(para.join("\n")) });
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      flush();
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const marker = fence[1];
      const body: string[] = [];
      i++;
      let open = true;
      while (i < lines.length) {
        if (lines[i].trim().startsWith(marker[0].repeat(marker.length)) && /^ {0,3}[`~]+\s*$/.test(lines[i])) {
          open = false;
          i++;
          break;
        }
        body.push(lines[i]);
        i++;
      }
      out.push({ t: "code", lang: fence[2].toLowerCase(), v: body.join("\n"), open });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flush();
      out.push({ t: "h", level: h[1].length, c: inline(h[2]) });
      i++;
      continue;
    }
    if (HR.test(line) && !para.length) {
      out.push({ t: "hr" });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      flush();
      const body: string[] = [];
      while (i < lines.length && lines[i].trim()) {
        const q = QUOTE.exec(lines[i]);
        body.push(q ? q[1] : lines[i]);
        i++;
      }
      out.push({ t: "quote", c: blocks(body) });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      flush();
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : null));
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(cells(lines[i]).map(inline));
        i++;
      }
      out.push({ t: "table", align, head: head.map(inline), rows });
      continue;
    }
    const li = LIST.exec(line);
    if (li && (!para.length || /^[-*+]$/.test(li[2]) || li[2].startsWith("1"))) {
      flush();
      const [block, next] = list(lines, i);
      out.push(block);
      i = next;
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flush();
  return out;
}

/** A list starting at `start`; items run until a line indented no deeper than the marker that is
 *  not a sibling item, or a blank line followed by unindented text. */
function list(lines: string[], start: number): [Block, number] {
  const first = LIST.exec(lines[start])!;
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items: Block[][] = [];
  let cur: string[] | null = null;
  let contentIndent = indent + first[2].length + 1;
  let i = start;
  const close = () => {
    if (cur) items.push(blocks(cur));
  };
  while (i < lines.length) {
    const line = lines[i];
    const m = LIST.exec(line);
    if (m && m[1].length === indent && /\d/.test(m[2]) === ordered) {
      close();
      cur = [m[3]];
      contentIndent = indent + m[2].length + 1;
      i++;
      continue;
    }
    if (!line.trim()) {
      const nextLine = lines[i + 1];
      if (nextLine === undefined || (!nextLine.startsWith(" ".repeat(indent + 1)) && !(LIST.exec(nextLine)?.[1].length === indent))) break;
      cur?.push("");
      i++;
      continue;
    }
    const lead = line.length - line.trimStart().length;
    if (lead > indent || (cur && !m && lead >= indent && !HEADING.test(line) && !FENCE.test(line))) {
      cur?.push(line.slice(Math.min(lead, contentIndent)));
      i++;
      continue;
    }
    break;
  }
  close();
  return [{ t: "list", ordered, start: ordered ? parseInt(first[2], 10) || 1 : 1, items }, i];
}

function cells(row: string): string[] {
  let r = row.trim();
  if (r.startsWith("|")) r = r.slice(1);
  if (r.endsWith("|") && !r.endsWith("\\|")) r = r.slice(0, -1);
  const out: string[] = [];
  let cell = "";
  let code = false;
  for (let k = 0; k < r.length; k++) {
    const ch = r[k];
    if (ch === "\\" && r[k + 1] === "|") {
      cell += "|";
      k++;
    } else if (ch === "`") {
      code = !code;
      cell += ch;
    } else if (ch === "|" && !code) {
      out.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

// ---------- inline ----------

export function inline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const emit = (n: Inline) => {
    if (text) out.push({ t: "text", v: text });
    text = "";
    out.push(n);
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\" && i + 1 < src.length && /[\\`*_{}[\]()#+\-.!|~>]/.test(src[i + 1])) {
      text += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "\n") {
      // Hard break after two spaces or a backslash; otherwise a soft break (kept as a newline,
      // which the renderer shows as a line break: Claude's line breaks are deliberate).
      text = text.replace(/ +$/, "");
      emit({ t: "br" });
      i++;
      continue;
    }
    if (ch === "`") {
      const run = /^`+/.exec(src.slice(i))![0];
      const end = src.indexOf(run, i + run.length);
      if (end > 0) {
        emit({ t: "code", v: src.slice(i + run.length, end).replace(/^ (.*) $/, "$1") });
        i = end + run.length;
        continue;
      }
      text += run;
      i += run.length;
      continue;
    }
    if ((ch === "*" || ch === "_") && src[i + 1] === ch) {
      const end = findClose(src, i + 2, ch + ch);
      if (end > i + 2) {
        emit({ t: "strong", c: inline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && src[i + 1] !== ch && src[i + 1] !== " " && (ch === "*" || !/\w/.test(src[i - 1] ?? ""))) {
      const end = findClose(src, i + 1, ch);
      if (end > i + 1 && src[end - 1] !== " " && (ch === "*" || !/\w/.test(src[end + 1] ?? ""))) {
        emit({ t: "em", c: inline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "~" && src[i + 1] === "~") {
      const end = findClose(src, i + 2, "~~");
      if (end > i + 2) {
        emit({ t: "del", c: inline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (ch === "[") {
      // Destination: <with spaces> or a run without spaces that may hold balanced (parentheses).
      const m = /^\[([^\]]*)\]\(\s*(?:<([^<>\n]*)>|((?:[^()\s]|\([^()\s]*\))+))(?:\s+"[^"]*")?\s*\)/.exec(src.slice(i));
      if (m) {
        emit({ t: "link", href: m[2] ?? m[3], c: inline(m[1]) });
        i += m[0].length;
        continue;
      }
    }
    if (ch === "h" && (i === 0 || /[\s(]/.test(src[i - 1]))) {
      const m = /^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/.exec(src.slice(i));
      if (m) {
        emit({ t: "link", href: m[0], c: [{ t: "text", v: m[0] }] });
        i += m[0].length;
        continue;
      }
    }
    text += ch;
    i++;
  }
  if (text) out.push({ t: "text", v: text });
  return out;
}

/** Index of the closing `marker` after `from`, skipping inline code spans. */
function findClose(src: string, from: number, marker: string): number {
  for (let k = from; k < src.length; k++) {
    if (src[k] === "`") {
      const end = src.indexOf("`", k + 1);
      if (end < 0) return -1;
      k = end;
      continue;
    }
    if (src[k] === "\\") {
      k++;
      continue;
    }
    if (src.startsWith(marker, k)) return k;
  }
  return -1;
}

/** Plain text of inline nodes (for titles and tests). */
export function plain(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === "text" || n.t === "code" ? n.v : n.t === "br" ? "\n" : "c" in n ? plain(n.c) : "")).join("");
}
