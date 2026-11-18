/** Pure helper (testable): `text` split around the case-insensitive matches of `query` (odd items are matches). */
export function splitMatches(text: string, query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [text];
  const out: string[] = [];
  const low = text.toLowerCase();
  let at = 0;
  for (let i = low.indexOf(q); i >= 0; i = low.indexOf(q, at)) {
    out.push(text.slice(at, i), text.slice(i, i + q.length));
    at = i + q.length;
  }
  out.push(text.slice(at));
  return out;
}

/** Text with the parts matching a filter highlighted. */
export function MatchText({ text, query }: { text: string; query: string }) {
  const parts = splitMatches(text, query);
  if (parts.length === 1) return <>{text}</>;
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i} className="match-hl">{p}</mark> : p))}</>;
}
