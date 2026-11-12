/**
 * Find bar Replace / Replace All with Preserve Case. CodeMirror's `replaceNext` / `replaceAll`
 * have no hook for adjusting each replacement, so these mirror them (same matching, same `$`
 * rules, same selection behaviour) and pass every replacement through `preserveCase`.
 */
import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";
import type { SearchQuery } from "@codemirror/search";
import { preserveCase } from "../lib/replace";

interface Match {
  from: number;
  to: number;
  match?: RegExpExecArray;
}

/** CodeMirror's replacement text for one match (`\n`/`\t` unquoting, `$&` / `$$` / `$n` in regex mode). */
export function cmReplacement(q: SearchQuery, m: Match): string {
  const text = q.literal ? q.replace : q.replace.replace(/\\([nrt\\])/g, (_, ch: string) => (ch === "n" ? "\n" : ch === "r" ? "\r" : ch === "t" ? "\t" : "\\"));
  if (!q.regexp || !m.match) return text;
  const groups = m.match;
  return text.replace(/\$([$&]|\d+)/g, (tok, i: string) => {
    if (i === "&") return groups[0];
    if (i === "$") return "$";
    for (let l = i.length; l > 0; l--) {
      const n = +i.slice(0, l);
      if (n > 0 && n < groups.length) return groups[n] + i.slice(l);
    }
    return tok;
  });
}

const withCase = (state: EditorState, q: SearchQuery, m: Match) => preserveCase(state.sliceDoc(m.from, m.to), cmReplacement(q, m));

/** First match at or after `from`, wrapping to the start of the document. */
function nextMatch(state: EditorState, q: SearchQuery, from: number): Match | null {
  const at = Math.min(from, state.doc.length);
  const after = q.getCursor(state, at).next();
  if (!after.done) return after.value;
  const first = q.getCursor(state, 0, at).next();
  return first.done ? null : first.value;
}

/** Replace All: one transaction (one undo step). `null` when nothing matches. */
export function replaceAllSpec(state: EditorState, q: SearchQuery): { spec: TransactionSpec; count: number } | null {
  if (!q.valid) return null;
  const changes: { from: number; to: number; insert: string }[] = [];
  const cursor = q.getCursor(state);
  for (let r = cursor.next(); !r.done; r = cursor.next()) changes.push({ from: r.value.from, to: r.value.to, insert: withCase(state, q, r.value) });
  if (!changes.length) return null;
  return { spec: { changes, userEvent: "input.replace.all" }, count: changes.length };
}

/**
 * Replace: when the selection is the next match it is replaced and the following match is
 * selected; otherwise the next match is just selected (as CodeMirror's `replaceNext` does).
 */
export function replaceNextSpec(state: EditorState, q: SearchQuery): TransactionSpec | null {
  if (!q.valid) return null;
  const { from, to } = state.selection.main;
  const m = nextMatch(state, q, from);
  if (!m) return null;
  if (m.from !== from || m.to !== to) return { selection: EditorSelection.single(m.from, m.to), scrollIntoView: true };
  const changes = state.changes({ from: m.from, to: m.to, insert: withCase(state, q, m) });
  // The next match is looked for in the text as it was, after this one (wrapping).
  const after = nextMatch(state, q, m.to === m.from ? m.to + 1 : m.to);
  const next = after && after.from !== m.from ? after : null;
  return {
    changes,
    selection: next ? EditorSelection.single(next.from, next.to).map(changes) : EditorSelection.cursor(changes.mapPos(m.to)),
    scrollIntoView: true,
    userEvent: "input.replace",
  };
}
