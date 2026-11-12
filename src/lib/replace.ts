/**
 * Replace for Find in Files on open documents (the disk path is `replace_in_files` in search.rs;
 * both follow the same rules): Preserve Case, and matches the user left out of the replace.
 */

/** `replacement` in the case of `matched`: all capitals, all lower case, or a leading capital.
 *  Anything else (mixed case, no letters) leaves the replacement as typed. */
export function preserveCase(matched: string, replacement: string): string {
  const letters = [...matched].filter((c) => c.toLowerCase() !== c.toUpperCase());
  if (letters.length === 0) return replacement;
  const upper = (c: string) => c !== c.toLowerCase();
  const lower = (c: string) => c !== c.toUpperCase();
  if (letters.length > 1 && !letters.some(lower)) return replacement.toUpperCase();
  if (!letters.some(upper)) return replacement.toLowerCase();
  if (upper(letters[0])) {
    const [first = "", ...rest] = [...replacement];
    return first.toUpperCase() + rest.join("");
  }
  return replacement;
}

/** JavaScript's `$` replacement patterns ($$, $&, $`, $', $1–$99, $<name>) for one match. */
export function expandReplacement(rep: string, m: RegExpExecArray): string {
  if (!rep.includes("$")) return rep;
  const input = m.input;
  return rep.replace(/\$(\$|&|`|'|\d{1,2}|<([^>]*)>)/g, (tok, t: string, name: string | undefined) => {
    if (t === "$") return "$";
    if (t === "&") return m[0];
    if (t === "`") return input.slice(0, m.index);
    if (t === "'") return input.slice(m.index + m[0].length);
    if (name !== undefined) return m.groups ? (m.groups[name] ?? "") : tok;
    const n = Number(t);
    if (n >= 1 && n < m.length) return m[n] ?? "";
    // "$12" with fewer groups: "$1" followed by "2".
    const n1 = Number(t[0]);
    if (t.length === 2 && n1 >= 1 && n1 < m.length) return (m[n1] ?? "") + t[1];
    return tok;
  });
}

export interface ReplaceOptions {
  /** Expand `$1`-style references (regex mode); otherwise the replacement is literal. */
  isRegex: boolean;
  preserveCase?: boolean;
  /** Matches to leave alone, as `line:col` (1-based line, 0-based UTF-16 column). */
  skip?: ReadonlySet<string>;
}

/** Replace every match of the global regex `re` in `text`, except those in `skip`. */
export function replaceMatches(text: string, re: RegExp, replacement: string, opts: ReplaceOptions): { text: string; count: number } {
  const skip = opts.skip && opts.skip.size > 0 ? opts.skip : null;
  let out = "";
  let last = 0;
  let count = 0;
  let line = 1;
  let lineStart = 0;
  let scanned = 0;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[0].length === 0) re.lastIndex++;
    if (skip) {
      for (let i = text.indexOf("\n", scanned); i >= 0 && i < m.index; i = text.indexOf("\n", i + 1)) {
        line++;
        lineStart = i + 1;
      }
      scanned = m.index;
      if (skip.has(`${line}:${m.index - lineStart}`)) continue;
    }
    let rep = opts.isRegex ? expandReplacement(replacement, m) : replacement;
    if (opts.preserveCase) rep = preserveCase(m[0], rep);
    out += text.slice(last, m.index) + rep;
    last = m.index + m[0].length;
    count++;
  }
  return { text: count ? out + text.slice(last) : text, count };
}
