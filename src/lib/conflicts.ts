/**
 * Git conflict blocks in a text (pure, unit-tested):
 *
 *   <<<<<<< HEAD              start     "current": what the branch you are on has
 *   ...
 *   ||||||| base              base      (only with merge.conflictStyle = diff3 / zdiff3)
 *   ...
 *   =======                   mid
 *   ...                                 "incoming": what is being merged / picked in
 *   >>>>>>> 18bc71d (Message) end
 */

export interface ConflictBlock {
  /** Line indexes (0-based) of the marker lines. */
  start: number;
  /** The `|||||||` line, when the common ancestor is shown. */
  base: number | null;
  mid: number;
  end: number;
  /** What follows the markers: "HEAD", "18bc71d (Message)". */
  currentLabel: string;
  incomingLabel: string;
}

export type ConflictChoice = "current" | "incoming" | "both";

const START = /^<{7}(?: (.*))?$/;
const BASE = /^\|{7}(?: .*)?$/;
const MID = /^={7}$/;
const END = /^>{7}(?: (.*))?$/;

/** The conflict blocks in `lines`. Anything malformed (a marker without its partners) is left alone. */
export function parseConflicts(lines: readonly string[]): ConflictBlock[] {
  const blocks: ConflictBlock[] = [];
  let open: { start: number; base: number | null; mid: number | null; label: string } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].endsWith("\r") ? lines[i].slice(0, -1) : lines[i];
    // Cheap reject: every marker starts with one of four characters.
    const c = line.charCodeAt(0);
    if (c !== 60 && c !== 61 && c !== 62 && c !== 124) continue;
    const s = START.exec(line);
    if (s) {
      // A new start before the previous block closed: the earlier one was not a conflict.
      open = { start: i, base: null, mid: null, label: s[1] ?? "" };
      continue;
    }
    if (!open) continue;
    if (open.mid === null && open.base === null && BASE.test(line)) open.base = i;
    else if (open.mid === null && MID.test(line)) open.mid = i;
    else if (open.mid !== null) {
      const e = END.exec(line);
      if (e) {
        blocks.push({ start: open.start, base: open.base, mid: open.mid, end: i, currentLabel: open.label, incomingLabel: e[1] ?? "" });
        open = null;
      }
    }
  }
  return blocks;
}

/** The lines a block is replaced with for a choice ("both": current, then incoming). */
export function resolvedLines(lines: readonly string[], b: ConflictBlock, choice: ConflictChoice): string[] {
  const current = lines.slice(b.start + 1, b.base ?? b.mid);
  const incoming = lines.slice(b.mid + 1, b.end);
  return choice === "current" ? current : choice === "incoming" ? incoming : [...current, ...incoming];
}

/** The whole text with every conflict resolved one way. */
export function resolveAll(text: string, choice: ConflictChoice): string {
  const lines = text.split("\n");
  const blocks = parseConflicts(lines);
  if (!blocks.length) return text;
  const out: string[] = [];
  let at = 0;
  for (const b of blocks) {
    out.push(...lines.slice(at, b.start), ...resolvedLines(lines, b, choice));
    at = b.end + 1;
  }
  out.push(...lines.slice(at));
  return out.join("\n");
}

/** "Current (HEAD)" / "Incoming (18bc71d Message)": the side's name with git's label, shortened. */
export function sideLabel(side: "current" | "incoming", label: string): string {
  const name = side === "current" ? "Current" : "Incoming";
  const l = label.trim();
  return l ? `${name} (${l.length > 48 ? l.slice(0, 47) + "…" : l})` : name;
}
