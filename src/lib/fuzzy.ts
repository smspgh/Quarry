/**
 * Pure fuzzy scorer shared by the command palette and Quick Open.
 *
 * Scoring (higher = better):
 *  - every matched char: +1; contiguous with the previous match: +3 more
 *  - match at a word start (after space / slash / dot / dash / underscore) or at a camel hump: +4
 *  - a match at index 0 of the text: +3 more
 *  - length penalty: -0.01 per char so shorter candidates win ties
 *
 * `fuzzyPath` additionally scores the basename on its own and, when the whole query fits in the
 * basename, prefers that match with a flat bonus. So for "cmpal", "CommandPalette.tsx" beats
 * "BottomPanel.tsx" (c-m-p-a-l spread across the path) because C, P are humps and "al" is contiguous.
 *
 * Sanity expectations (covered by src/__tests__/text.test.ts):
 *   fuzzyPath("cmpal", "src/components/CommandPalette.tsx")!.score > fuzzyPath("cmpal", "src/components/BottomPanel.tsx")!.score
 *   fuzzy("abc", "xyz") === null
 *   fuzzy("", "anything") → { score: 0, idx: [] }
 *   fuzzy("store", "store.ts")!.idx → [0,1,2,3,4]
 */

export interface FuzzyMatch {
  score: number;
  /** Indices into `text` of the matched characters. */
  idx: number[];
}

const SEPARATORS = /[\s/\\._\-:]/;

function isHump(text: string, i: number): boolean {
  if (i === 0) return false;
  const c = text[i];
  const p = text[i - 1];
  // lower→Upper transition or letter→digit transition
  return (c >= "A" && c <= "Z" && p >= "a" && p <= "z") || (c >= "0" && c <= "9" && !(p >= "0" && p <= "9"));
}

/**
 * Greedy left-to-right subsequence match with a second pass that tries to start at a word
 * boundary; the better of the two is returned.
 */
export function fuzzy(query: string, text: string): FuzzyMatch | null {
  if (!query) return { score: 0, idx: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q.length > t.length) return null;

  const attempt = (start: number): FuzzyMatch | null => {
    let qi = 0;
    let score = 0;
    const idx: number[] = [];
    let last = -2;
    for (let i = start; i < t.length && qi < q.length; i++) {
      if (t[i] !== q[qi]) continue;
      idx.push(i);
      score += 1;
      if (last === i - 1) score += 3;
      if (i === 0) score += 7;
      else if (SEPARATORS.test(text[i - 1]) || isHump(text, i)) score += 4;
      last = i;
      qi++;
    }
    if (qi < q.length) return null;
    score -= text.length * 0.01;
    return { score, idx };
  };

  let best = attempt(0);
  // Try again from each later word start / hump that matches the first query char; the greedy
  // pass can latch onto a stray early character ("c" in "src") and miss a better anchor.
  for (let i = 1; i < t.length; i++) {
    if (t[i] !== q[0]) continue;
    if (!(SEPARATORS.test(text[i - 1]) || isHump(text, i))) continue;
    const m = attempt(i);
    if (m && (!best || m.score > best.score)) best = m;
  }
  return best;
}

/** Score a relative or absolute path, favouring matches that sit in the basename. */
export function fuzzyPath(query: string, path: string): FuzzyMatch | null {
  const whole = fuzzy(query, path);
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1;
  if (cut === 0) return whole;
  const base = fuzzy(query, path.slice(cut));
  if (base) {
    const shifted: FuzzyMatch = { score: base.score + 10 - path.length * 0.005, idx: base.idx.map((i) => i + cut) };
    if (!whole || shifted.score >= whole.score) return shifted;
  }
  return whole;
}

/** Map `idx` (indices into `text`) to indices into `text.slice(offset)`, dropping the rest. */
export function shiftIndices(idx: number[], offset: number): number[] {
  const out: number[] = [];
  for (const i of idx) if (i >= offset) out.push(i - offset);
  return out;
}

/**
 * Command title without its "JSON: " / "Macro: " / "Script: " / "Large File: " prefix. Menus and the
 * palette already show the group or category, so the prefix would repeat it.
 */
export function bareTitle(title: string): string {
  return title.replace(/^(JSON|Macro|Script|Large File): /, "");
}

/** Bonus that lifts any title match above every category-only match. */
const TITLE_BONUS = 1000;

/**
 * Score a palette command against its displayed label `category + ": " + bareTitle(title)`. A query that fits
 * in the title alone ranks above one that needs the category ("json" finds JSON commands, but a
 * command whose title says "JSON" comes first). `idx` always indexes the displayed label.
 */
export function fuzzyCommand(query: string, category: string, fullTitle: string): FuzzyMatch | null {
  const title = bareTitle(fullTitle);
  const offset = category.length + 2;
  const inTitle = fuzzy(query, title);
  if (inTitle && query) return { score: inTitle.score + TITLE_BONUS, idx: inTitle.idx.map((i) => i + offset) };
  return fuzzy(query, `${category}: ${title}`);
}
