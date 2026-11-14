/**
 * Partial staging, the pure part (specs/git-staging.md): the changes of a Compare tab and a
 * selection as line ranges. Only ranges cross to Rust (`git_apply_lines` in
 * src-tauri/src/git/staging.rs builds the patch from git's own bytes); no text is sent to be
 * written.
 */
import type { Text } from "@codemirror/state";

/**
 * One piece to stage, unstage or discard: lines `newStart .. newStart + newCount` of the right
 * side stand in for lines `oldStart .. oldStart + oldCount` of the left side. 1-based editor
 * lines; a count of 0 is the place before that line (which may be one past the last line).
 */
export interface Pick {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

/** A change as @codemirror/merge reports it (`Chunk`): document positions in the two sides. */
export interface ChunkLike {
  fromA: number;
  toA: number;
  fromB: number;
  toB: number;
}

function span(doc: Text, from: number, to: number): [number, number] {
  const start = from > doc.length ? doc.lines + 1 : doc.lineAt(from).number;
  if (to <= from) return [start, 0];
  return [start, doc.lineAt(Math.min(to - 1, doc.length)).number - start + 1];
}

/**
 * The line ranges of each change ("Change 2 of 5") between the left text `a` and the right `b`,
 * one per chunk, in order. The editor compares characters, so a chunk often takes in a line that
 * is the same on both sides (lines added before an equally indented line: the chunk ends inside
 * that line). Such lines are dropped from the ends of the range: they are not part of the change,
 * and counting them would turn "3 added lines" into "1 line replaced by 4".
 */
export function hunksOf(chunks: readonly ChunkLike[], a: Text, b: Text): Pick[] {
  return chunks.map((c) => {
    let [oldStart, oldCount] = span(a, c.fromA, c.toA);
    let [newStart, newCount] = span(b, c.fromB, c.toB);
    while (oldCount && newCount && a.line(oldStart + oldCount - 1).text === b.line(newStart + newCount - 1).text) {
      oldCount--;
      newCount--;
    }
    while (oldCount && newCount && a.line(oldStart).text === b.line(newStart).text) {
      oldStart++;
      newStart++;
      oldCount--;
      newCount--;
    }
    return { oldStart, oldCount, newStart, newCount };
  });
}

/**
 * Where the block widget of a change goes in the side by side layout (the bar in the right
 * editor, the equally high gap in the left one), so the two sides stay level. `from`/`to` are the
 * change's range in this editor's document, `otherFrom`/`otherTo` its range in the other one.
 *
 * @codemirror/merge levels the two editors at the first line after each change, and it measures
 * that line together with the block widgets drawn above it. A widget above the first line of a
 * change is inside the change and is counted; but a change with no lines on this side (lines only
 * removed, or only added on the other side) has no first line, and a widget above the line that
 * follows it would be measured as part of that line: the line itself would end up one bar lower
 * than its twin. So there the widget hangs below the line before the change instead (`side` 1).
 * At the very start of the document there is no line before it: the widget stays above the first
 * line (after the spacer the merge view puts there), and the other editor puts its widget above
 * its own first line after the change, so both are measured alike.
 */
export function barPlace(doc: Text, from: number, to: number, otherFrom: number, otherTo: number): { pos: number; side: number } {
  if (to <= from) {
    if (from > doc.length) return { pos: doc.length, side: 1 };
    const line = doc.lineAt(from);
    return line.number > 1 ? { pos: line.from - 1, side: 1 } : { pos: 0, side: -0.5 };
  }
  if (otherTo <= otherFrom && otherFrom === 0) return to > doc.length ? { pos: doc.length, side: 1 } : { pos: doc.lineAt(to).from, side: -2 };
  return { pos: doc.lineAt(Math.min(from, doc.length)).from, side: -2 };
}

/**
 * Index of the change at a line of the right side (-1: none). Removed lines have no line of their
 * own there: they count as the line they were removed before (the last line, at the end).
 */
export function hunkAt(hunks: readonly Pick[], line: number, lines: number): number {
  return hunks.findIndex((h) => (h.newCount > 0 ? line >= h.newStart && line < h.newStart + h.newCount : line === Math.min(h.newStart, lines)));
}

/**
 * What a selection of right-side lines `from..to` (inclusive) takes from the changes:
 * - a change it covers completely, whole;
 * - added lines one by one;
 * - a block replaced line for line (N lines by N lines): the selected lines, each with its old one;
 * - a block replaced by a different number of lines: the selected new lines replace the whole old block;
 * - removed lines only when the selection spans the place they were removed from (the line before
 *   and the line after; at the start or end of the file, the first or last line).
 */
export function picksForSelection(hunks: readonly Pick[], from: number, to: number, lines: number): Pick[] {
  const out: Pick[] = [];
  for (const h of hunks) {
    if (h.newCount === 0) {
      const before = Math.max(1, h.newStart - 1);
      const after = Math.min(lines, h.newStart);
      if (from <= before && to >= after) out.push({ ...h });
      continue;
    }
    const a = Math.max(from, h.newStart);
    const b = Math.min(to, h.newStart + h.newCount - 1);
    if (a > b) continue;
    const n = b - a + 1;
    if (n === h.newCount) out.push({ ...h });
    else if (h.oldCount === 0) out.push({ oldStart: h.oldStart, oldCount: 0, newStart: a, newCount: n });
    else if (h.oldCount === h.newCount) out.push({ oldStart: h.oldStart + (a - h.newStart), oldCount: n, newStart: a, newCount: n });
    else out.push({ oldStart: h.oldStart, oldCount: h.oldCount, newStart: a, newCount: n });
  }
  return out;
}

/** Does the selection touch anything that can be staged, unstaged or discarded? */
export const selectionApplies = (hunks: readonly Pick[], from: number, to: number, lines: number) => picksForSelection(hunks, from, to, lines).length > 0;

const list = (parts: string[]) => (parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

/**
 * The right-side lines of some picks in words: "Line 20", "Lines 20–22", "Lines 3–5 and 20–22";
 * for removed lines alone, "The 4 lines removed after line 19". "" when there are none.
 */
export function describeLines(picks: readonly Pick[]): string {
  const ranges: [number, number][] = [];
  for (const p of picks) {
    if (!p.newCount) continue;
    const last = ranges[ranges.length - 1];
    if (last && p.newStart <= last[1] + 1) last[1] = Math.max(last[1], p.newStart + p.newCount - 1);
    else ranges.push([p.newStart, p.newStart + p.newCount - 1]);
  }
  if (ranges.length) {
    const one = ranges.length === 1 && ranges[0][0] === ranges[0][1];
    return `${one ? "Line" : "Lines"} ${list(ranges.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)))}`;
  }
  const gone = picks.filter((p) => !p.newCount && p.oldCount);
  if (gone.length === 1) return removedWords(gone[0]);
  return gone.length ? `The lines removed in ${gone.length} places` : "";
}

function removedWords(p: Pick): string {
  const what = p.oldCount === 1 ? "The line" : `The ${p.oldCount} lines`;
  return p.newStart <= 1 ? `${what} removed at the start` : `${what} removed after line ${p.newStart - 1}`;
}

/**
 * The Discard question's text: which lines of `name` go back to `base` ("the last commit" or
 * "the staged version"), and which removed lines are put back.
 */
export function discardText(picks: readonly Pick[], name: string, base: string): string {
  const kept = picks.filter((p) => p.newCount > 0);
  const gone = picks.filter((p) => !p.newCount && p.oldCount);
  const out: string[] = [];
  if (kept.length) {
    const words = describeLines(kept);
    const one = words.startsWith("Line ");
    out.push(`${words} of ${name} ${one ? "goes" : "go"} back to ${base}. Your edits to ${one ? "that line" : "those lines"} will be lost.`);
  }
  if (gone.length) {
    const words = describeLines(gone);
    const one = gone.length === 1 && gone[0].oldCount === 1;
    out.push(`${words}${kept.length ? "" : ` of ${name}`} ${one ? "is" : "are"} put back.`);
  }
  return out.join(" ");
}

/**
 * A short fingerprint of a text (its length and two 32-bit hashes over its UTF-16 code units), so
 * Rust can tell that the index and the file are still what the comparison shows (`text_hash` in
 * staging.rs computes the same).
 */
export function textHash(text: string): string {
  let a = 0x811c9dc5;
  let b = 5381;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = (Math.imul(b, 33) + c) | 0;
  }
  return `${text.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
}
