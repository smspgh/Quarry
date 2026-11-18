/**
 * Recently closed file tabs, for Reopen Closed Tab (Ctrl+Shift+T). Pure: actions.ts keeps the stack
 * and opens the entry; untitled, terminal, Compare and commit-graph tabs never get here.
 */

export interface ClosedTab {
  path: string;
  /** Cursor offset and scroll position of a text tab when it was closed. */
  cursor?: number;
  scrollTop?: number;
}

export const CLOSED_TABS_MAX = 20;

const same = (a: string, b: string) => a.replace(/\//g, "\\").toLowerCase() === b.replace(/\//g, "\\").toLowerCase();

/** The stack after closing `entry`: newest last, one entry per path, at most `max`. */
export function pushClosed(stack: ClosedTab[], entry: ClosedTab, max = CLOSED_TABS_MAX): ClosedTab[] {
  const out = stack.filter((e) => !same(e.path, entry.path));
  out.push(entry);
  return out.length > max ? out.slice(out.length - max) : out;
}

/**
 * Take the most recent entry that can be reopened: `usable` says no for a file that is open again
 * or no longer exists. Entries skipped on the way are dropped. Returns the entry and the rest.
 */
export async function popClosed(stack: ClosedTab[], usable: (path: string) => boolean | Promise<boolean>): Promise<{ entry: ClosedTab | null; rest: ClosedTab[] }> {
  const rest = stack.slice();
  while (rest.length > 0) {
    const entry = rest.pop()!;
    if (await usable(entry.path)) return { entry, rest };
  }
  return { entry: null, rest };
}
