/** Go to Line: parse "line[:col]" / "line,col". Returns null when there is no leading number. */
export function parseGoto(q: string): { line: number; col: number } | null {
  const m = /^\s*(\d+)(?:\s*[:,]\s*(\d+))?/.exec(q);
  if (!m) return null;
  return { line: Number(m[1]), col: m[2] ? Number(m[2]) : 1 };
}
