/**
 * Edit History (specs/git-history-edit.md): pure rules and wording.
 * Which history edits a commit allows and why not (`editAllowed`), the plan model of the Edit
 * History list (rows, reorder, actions, problems), what a plan turns into for git (`planTodo`),
 * and what the confirmations and notifications say. The actions are in git.ts (`undoLastCommit`,
 * `rewordCommit`, `dropCommit`, `squashCommit`, `openHistoryEdit`, `runHistoryEdit`), the git work
 * in src-tauri/src/git/history.rs.
 */
import type { Choice } from "./dialogs";
import type { GitHistoryCommit, GitHistoryRange, GitHistoryStep } from "./gitApi";
import { LISTED } from "./gitMerge";
import { finishFirst } from "./gitStatus";

/** The list takes at most this many commits. */
export const MAX_PLAN = 100;

/** Start of the error Rust gives when the branch is not where the question saw it (git/history.rs `MOVED`). */
export const MOVED = "quarry-moved";

/** The single-commit entries and "Edit History from Here…". */
export type EditAction = "undo" | "reword" | "squash" | "drop" | "list";

/** What `editAllowed` needs to know about a commit and the repository. */
export interface EditContext {
  /** The checked-out branch; null on a detached HEAD. */
  branch: string | null;
  operation: string | null;
  busy: string | null;
  /** The commit is the tip of the branch or one of its ancestors. */
  onBranch: boolean;
  /** Short id of a merge commit between the commit and the tip (the commit itself not counted). */
  mergeAfter: string | null;
  /** The commit's parent is a merge commit. */
  parentMerge: boolean;
}

/**
 * Why a history edit of `commit` cannot run (the entry's tooltip while it is greyed out), or null.
 * Uncommitted changes and pushed commits are not in here: they do not grey anything out, the
 * action itself refuses or warns.
 */
export function editAllowed(action: EditAction, commit: { parents: string[] }, ctx: EditContext): string | null {
  if (ctx.busy) return "Another git action is running";
  if (ctx.operation) return finishFirst(ctx.operation);
  if (!ctx.branch) return "You are not on a branch. Switch to a branch to edit its history.";
  if (!ctx.onBranch) return `Only commits on ${ctx.branch} can be edited. Switch to the commit's branch first.`;
  const root = commit.parents.length === 0;
  if (action === "undo") {
    if (root) return "This is the first commit: there is nothing to go back to.";
    if (commit.parents.length > 1) return "The last commit is a merge commit. Use Revert This Commit… to undo it.";
    return null;
  }
  if (commit.parents.length > 1) return "A merge commit can't be edited here. Use Revert This Commit… to undo it.";
  if (ctx.mergeAfter) return `The merge commit ${ctx.mergeAfter} comes after this commit. Quarry does not rewrite across a merge.`;
  if (action === "squash" && root) return "This is the first commit: it has no parent.";
  if (action === "drop" && root) return "The first commit can't be dropped.";
  if (action === "squash" && ctx.parentMerge) return "The parent is a merge commit: nothing can be squashed into it.";
  return null;
}

/**
 * Why "Undo Last Commit…" / "Edit History…" (the commands) are greyed out, or null: no repository
 * or commit, a detached HEAD, a stopped operation, a running action, and for Undo a tip that is the
 * first commit or a merge (`GitStatus.headParents`).
 */
export function commandBlocked(action: "undo" | "list", repo: { branch: string | null; head: string | null; operation: string | null; headParents?: number | null } | null | undefined, busy: string | null): string | null {
  if (!repo) return "The open folder is not in a git repository";
  if (!repo.head) return "This repository has no commits yet";
  const parents = new Array<string>(action === "undo" ? (repo.headParents ?? 1) : 1).fill("");
  return editAllowed(action, { parents }, { branch: repo.branch, operation: repo.operation, busy, onBranch: true, mergeAfter: null, parentMerge: false });
}

/** A loaded row of the graph, as far as these rules look at it. */
export interface GraphCommitLike {
  sha: string;
  short: string;
  parents: string[];
  refs: string[];
  stash?: boolean;
}

/**
 * Where `sha` stands relative to the checked-out commit, from the graph's loaded rows (children
 * come before parents there, so every commit between an ancestor and the tip is loaded too).
 */
export function graphEditContext(commits: GraphCommitLike[], sha: string, repo: { branch: string | null; operation: string | null } | null | undefined, busy: string | null): EditContext {
  const ctx: EditContext = { branch: repo?.branch ?? null, operation: repo?.operation ?? null, busy, onBranch: false, mergeAfter: null, parentMerge: false };
  const by = new Map<string, GraphCommitLike>();
  for (const c of commits) if (!c.stash) by.set(c.sha, c);
  const head = commits.find((c) => !c.stash && c.refs.includes("HEAD"));
  const self = by.get(sha);
  if (!head || !self) return ctx;
  const parent = self.parents.length === 1 ? by.get(self.parents[0]) : undefined;
  ctx.parentMerge = !!parent && parent.parents.length > 1;
  const reach = (from: string, stop?: Set<string>) => {
    const seen = new Set<string>();
    const todo = [from];
    while (todo.length) {
      const id = todo.pop()!;
      if (seen.has(id) || stop?.has(id)) continue;
      seen.add(id);
      for (const p of by.get(id)?.parents ?? []) todo.push(p);
    }
    return seen;
  };
  const below = reach(sha); // the commit and its ancestors
  if (head.sha !== sha) {
    // On the branch: walking back from the tip reaches the commit.
    const up = reach(head.sha);
    if (!up.has(sha)) return ctx;
    ctx.onBranch = true;
    // The commits after it: reachable from the tip, not from the commit. The merge nearest to the
    // commit is the last such row.
    for (const c of commits) if (!c.stash && up.has(c.sha) && !below.has(c.sha) && c.parents.length > 1) ctx.mergeAfter = c.short;
  } else ctx.onBranch = true;
  return ctx;
}

/**
 * The same question answered from a fresh `history_range` whose oldest commit is the one asked
 * about (right before the confirmation; the graph's rows may be stale).
 */
export function rangeEditContext(range: Pick<GitHistoryRange, "branch" | "operation" | "onBranch" | "commits">, busy: string | null, parent?: { parents: string[] } | null): EditContext {
  const after = range.commits.slice(0, -1);
  const merges = after.filter((c) => c.parents.length > 1);
  return { branch: range.branch, operation: range.operation, busy, onBranch: range.onBranch, mergeAfter: merges.length ? merges[merges.length - 1].short : null, parentMerge: !!parent && parent.parents.length > 1 };
}

// ---------- the plan (Edit History list) ----------

export type RowAction = "pick" | "reword" | "squash" | "fixup" | "drop";

export const ROW_ACTIONS: { value: RowAction; label: string; key: string; hint: string }[] = [
  { value: "pick", label: "Pick", key: "p", hint: "Keep the commit as it is" },
  { value: "reword", label: "Reword", key: "r", hint: "Keep the commit, change its message" },
  { value: "squash", label: "Squash", key: "s", hint: "Fold into the commit below and join the messages" },
  { value: "fixup", label: "Fixup", key: "f", hint: "Fold into the commit below and discard this message" },
  { value: "drop", label: "Drop", key: "d", hint: "Remove the commit and its changes" },
];

/** Why Squash / Fixup is not offered on the bottom row. */
export const NO_FOLD = "There is no commit below to fold into";

/** One row of the list. Rows are kept newest first, like the graph. */
export interface PlanRow {
  commit: GitHistoryCommit;
  action: RowAction;
  /** The message typed for a reword (null: not typed, the commit's own). */
  reword: string | null;
  /** The message typed for this row and the rows squashed into it (null: not typed, `groupMessage`). */
  joined: string | null;
  /** Which squashed rows `joined` was typed for; it is dropped when they change. */
  joinedFor: string;
}

/** Every commit "Pick", in the order given (newest first). */
export function initialPlan(commits: GitHistoryCommit[]): PlanRow[] {
  return commits.map((commit) => ({ commit, action: "pick", reword: null, joined: null, joinedFor: "" }));
}

/**
 * Where "Edit History…" starts when no commit was chosen: the oldest of the commits no remote has,
 * counting from the tip, stopping before a merge commit and at `MAX_PLAN`. `unpushed`: the range
 * `history_range` gives without a commit (newest first). Null when there is none to edit.
 */
export function defaultBase(unpushed: Pick<GitHistoryRange, "tip" | "commits">): string | null {
  let want = unpushed.tip;
  let found: string | null = null;
  let n = 0;
  for (const c of unpushed.commits) {
    if (c.sha !== want || c.parents.length > 1 || n === MAX_PLAN) break;
    found = c.sha;
    n++;
    if (!c.parents.length) break;
    want = c.parents[0];
  }
  return found;
}

const isFold = (r: PlanRow) => r.action === "squash" || r.action === "fixup";
const isBase = (r: PlanRow) => r.action === "pick" || r.action === "reword";

/** The row a squash / fixup row folds into: the nearest row below that is kept as a commit; -1 when there is none. */
export function squashTarget(rows: PlanRow[], i: number): number {
  for (let k = i + 1; k < rows.length; k++) if (isBase(rows[k])) return k;
  return -1;
}

/** The rows folded into row `i`, nearest (oldest) first. */
export function foldedInto(rows: PlanRow[], i: number): number[] {
  const out: number[] = [];
  if (!rows[i] || !isBase(rows[i])) return out;
  for (let k = i - 1; k >= 0 && !isBase(rows[k]); k--) if (isFold(rows[k])) out.push(k);
  return out;
}

const squashedInto = (rows: PlanRow[], i: number) => foldedInto(rows, i).filter((k) => rows[k].action === "squash");
const ownMessage = (r: PlanRow) => (r.action === "reword" && r.reword !== null ? r.reword : r.commit.message);

/** The message a row gets by default with what is squashed into it: its own, then each squashed row's, oldest first, a blank line between. */
export function groupMessage(rows: PlanRow[], i: number): string {
  return [ownMessage(rows[i]), ...squashedInto(rows, i).map((k) => rows[k].commit.message)].map((m) => m.trim()).join("\n\n");
}

/** Does row `i` show a message box for itself and the rows squashed into it? */
export function hasGroupBox(rows: PlanRow[], i: number): boolean {
  return squashedInto(rows, i).length > 0;
}

/** What the message box of row `i` holds: the group's message, or the reword text. */
export function boxMessage(rows: PlanRow[], i: number): string {
  const r = rows[i];
  return hasGroupBox(rows, i) ? (r.joined ?? groupMessage(rows, i)) : ownMessage(r);
}

/** The message row `i` ends up with when it differs from its own; null: the commit keeps its message. */
export function finalMessage(rows: PlanRow[], i: number): string | null {
  const r = rows[i];
  if (!isBase(r)) return null;
  const text = boxMessage(rows, i).replace(/\r/g, "").trim();
  if (hasGroupBox(rows, i)) return text;
  return r.action === "reword" && text !== r.commit.message.replace(/\r/g, "").trim() ? text : null;
}

/** A typed group message only stands for the rows it was typed over: forget it when they change. */
function settle(rows: PlanRow[]): PlanRow[] {
  return rows.map((r, i) => {
    const sig = squashedInto(rows, i).map((k) => rows[k].commit.sha).join(" ");
    return r.joined !== null && r.joinedFor !== sig ? { ...r, joined: null, joinedFor: "" } : r;
  });
}

/** Move the row at `from` to index `to` (both in the list's order); out-of-range moves change nothing. */
export function moveRow(rows: PlanRow[], from: number, to: number): PlanRow[] {
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return rows;
  const next = rows.slice();
  const [r] = next.splice(from, 1);
  next.splice(to, 0, r);
  return settle(next);
}

/** Set a row's action. Squash / Fixup on the bottom row is not offered and changes nothing. */
export function setAction(rows: PlanRow[], i: number, action: RowAction): PlanRow[] {
  if (!rows[i] || rows[i].action === action) return rows;
  if ((action === "squash" || action === "fixup") && i === rows.length - 1) return rows;
  return settle(rows.map((r, k) => (k === i ? { ...r, action } : r)));
}

/** Type into the message box of row `i` (see `boxMessage`). */
export function setMessage(rows: PlanRow[], i: number, text: string): PlanRow[] {
  if (!rows[i]) return rows;
  const group = hasGroupBox(rows, i);
  const sig = squashedInto(rows, i).map((k) => rows[k].commit.sha).join(" ");
  return rows.map((r, k) => (k !== i ? r : group ? { ...r, joined: text, joinedFor: sig } : { ...r, reword: text }));
}

export const NOTHING_BELOW = "Nothing below to fold into: choose Pick or move it up";
export const NEEDS_MESSAGE = "A commit needs a message";

/** What is wrong with each row (index → message); Run is off while there is any. */
export function planProblems(rows: PlanRow[]): Map<number, string> {
  const out = new Map<number, string>();
  rows.forEach((r, i) => {
    if (isFold(r) && squashTarget(rows, i) < 0) out.set(i, NOTHING_BELOW);
    else if (isBase(r) && (hasGroupBox(rows, i) || r.action === "reword") && !boxMessage(rows, i).trim()) out.set(i, NEEDS_MESSAGE);
  });
  return out;
}

/** Every row is dropped: that is a reset, not a history edit. */
export function allDropped(rows: PlanRow[]): boolean {
  return rows.length > 0 && rows.every((r) => r.action === "drop");
}

/** Has row `i` (list order) a different commit than at the start, or does it not stay as it is? */
function rowChanged(rows: PlanRow[], original: GitHistoryCommit[], i: number): boolean {
  const r = rows[i];
  return r.commit.sha !== original[i]?.sha || r.action === "drop" || isFold(r) || finalMessage(rows, i) !== null || foldedInto(rows, i).length > 0;
}

/** Index (list order) of the lowest row that changes; -1 when the plan changes nothing. */
export function lowestChanged(rows: PlanRow[], original: GitHistoryCommit[]): number {
  for (let i = rows.length - 1; i >= 0; i--) if (rowChanged(rows, original, i)) return i;
  return -1;
}

/** Does running the plan change anything? (A reword with the message left as it was does not.) */
export function planChanged(rows: PlanRow[], original: GitHistoryCommit[]): boolean {
  return lowestChanged(rows, original) >= 0;
}

/** What happens to one commit of a rewrite, for the confirmation's list. */
export interface RewriteLine {
  commit: GitHistoryCommit;
  /** "kept": only a new id. */
  what: "kept" | "moved" | "reworded" | "takes" | "squashed" | "fixup" | "dropped";
  /** "reworded": the new subject; "squashed" / "fixup": the short id it is folded into. */
  detail?: string;
}

export interface PlanTodo {
  /** The commit the rebase starts on (everything up to it is untouched); null: from the first commit. */
  base: string | null;
  /** Oldest first. */
  steps: GitHistoryStep[];
  /** The commits the plan touches (the lowest changed row and every row above it), oldest first. */
  lines: RewriteLine[];
}

/**
 * The plan as git steps, starting at the lowest changed row: rows below it keep their ids.
 * `original`: the commits as the list opened (newest first); `baseSha`: the commit below the
 * list's bottom row (null: the bottom row is the first commit). Null when nothing changes.
 */
export function planTodo(rows: PlanRow[], original: GitHistoryCommit[], baseSha: string | null): PlanTodo | null {
  const low = lowestChanged(rows, original);
  if (low < 0) return null;
  const base = low === rows.length - 1 ? baseSha : rows[low + 1].commit.sha;
  const steps: GitHistoryStep[] = [];
  const lines: RewriteLine[] = [];
  const place = new Map(original.map((c, i) => [c.sha, i]));
  for (let i = low; i >= 0; i--) {
    const r = rows[i];
    const commit = r.commit;
    if (r.action === "drop") {
      steps.push({ sha: commit.sha, action: "drop", message: null });
      lines.push({ commit, what: "dropped" });
    } else if (isFold(r)) {
      steps.push({ sha: commit.sha, action: "fixup", message: null });
      lines.push({ commit, what: r.action === "squash" ? "squashed" : "fixup", detail: rows[squashTarget(rows, i)]?.commit.short });
    } else {
      const message = finalMessage(rows, i);
      steps.push({ sha: commit.sha, action: "pick", message });
      const subject = message?.split("\n")[0] ?? "";
      if (message !== null && subject !== commit.summary) lines.push({ commit, what: "reworded", detail: subject });
      else if (message !== null || foldedInto(rows, i).length) lines.push({ commit, what: message !== null && !foldedInto(rows, i).length ? "reworded" : "takes", detail: message !== null && !foldedInto(rows, i).length ? subject : undefined });
      else lines.push({ commit, what: place.get(commit.sha) === i ? "kept" : "moved" });
    }
  }
  return { base, steps, lines };
}

/** A one-commit plan over a fresh range (newest first, the edited commit or its parent at the bottom). */
export function singlePlan(kind: "reword" | "drop" | "squash", commits: GitHistoryCommit[], message = ""): PlanRow[] {
  let rows = initialPlan(commits);
  const last = rows.length - 1;
  if (kind === "reword") rows = setMessage(setAction(rows, last, "reword"), last, message);
  else if (kind === "drop") rows = setAction(rows, last, "drop");
  else rows = setMessage(setAction(rows, last - 1, "squash"), last, message);
  return rows;
}

/** The message box of Squash into Parent starts with both messages: the parent's, a blank line, the commit's. */
export function squashMessage(parent: string, child: string): string {
  return `${parent.trim()}\n\n${child.trim()}`;
}

// ---------- dialogs and notifications ----------

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const quoted = (c: { short: string; summary: string }) => `${c.short} "${c.summary}"`;

/** One line of the confirmation's list. */
export function rewriteLineText(l: RewriteLine): string {
  const what =
    l.what === "kept" ? "new id"
    : l.what === "moved" ? "moved, new id"
    : l.what === "reworded" ? `reworded to "${l.detail ?? ""}"`
    : l.what === "takes" ? "takes in the commits folded into it"
    : l.what === "squashed" ? `folded into ${l.detail}`
    : l.what === "fixup" ? `folded into ${l.detail}, its message discarded`
    : "dropped";
  return `${l.commit.short}  ${l.commit.summary} (${what})`;
}

/** The lines, oldest change first, at most `LISTED` then "and N more". */
export function rewriteList(lines: RewriteLine[]): string {
  const shown = lines.slice(0, LISTED).map(rewriteLineText);
  return shown.join("\n") + (lines.length > LISTED ? `\nand ${lines.length - LISTED} more` : "");
}

export type HistoryKind = "undo" | "reword" | "drop" | "squash" | "plan";

export interface HistoryInfo {
  branch: string;
  /** Short id of the branch's tip now. */
  tip: string;
  /** The commit the action is about (undo: the tip; squash: the commit folded in); not for "plan". */
  commit?: { short: string; summary: string };
  /** Squash: the parent it is folded into. */
  parent?: { short: string; summary: string };
  /** Every commit touched, oldest first (empty for undo). */
  lines: RewriteLine[];
  /** The commit below the lowest touched one (it and earlier ones are not changed); null: none. */
  below: { short: string } | null;
  /** A remote branch holding the pushed commits. */
  pushedOn: string | null;
}

export interface HistoryDialog {
  title: string;
  text: string;
  choices: Choice<boolean>[];
  /** Commits already pushed are rewritten (the danger dialog was shown). */
  pushed: boolean;
}

const CANCEL: Choice<boolean> = { label: "Cancel", cancel: true, default: true, value: false };

/**
 * The question before a history edit: every commit that gets a new id, and the tip to go back to.
 * With pushed commits among them it is the danger dialog instead (never both). Cancel is always
 * the default button.
 */
export function historyConfirm(kind: HistoryKind, info: HistoryInfo): HistoryDialog {
  const { branch, lines } = info;
  // Dropped commits get no new id: they are gone.
  const renewed = lines.filter((l) => l.what !== "dropped");
  const pushed = kind === "undo" ? (info.pushedOn && info.commit ? [info.commit] : []) : lines.filter((l) => l.commit.pushed).map((l) => l.commit);
  const back = `${branch} is now at ${info.tip}: Reset ${branch} to Here on that commit puts it back.`;
  const untouched = info.below ? `${info.below.short} and earlier commits are not changed.` : "";
  const list = (ls: RewriteLine[]) => `${count(ls.length, "commit")} on ${branch} ${ls.length === 1 ? "gets a new id" : "get new ids"}:\n\n${rewriteList(ls)}`;
  const c = info.commit ? quoted(info.commit) : "";
  let title: string;
  let what: string;
  let ok: string;
  let danger = false;
  if (kind === "undo") {
    title = "Undo the last commit?";
    what = `${c} leaves ${branch}. Its changes stay staged and your files are not touched.`;
    ok = "Undo Commit";
  } else if (kind === "reword") {
    title = "Reword this commit?";
    what = lines.length <= 1 ? `${info.commit?.short} gets the new message and a new id. No other commit changes.` : list(lines);
    ok = "Reword";
  } else if (kind === "drop") {
    title = "Drop this commit?";
    what = `${c} and its changes are removed from ${branch}. They are not kept anywhere in your files.\n\n${renewed.length ? list(renewed) : "No other commit changes."}`;
    ok = "Drop Commit";
    danger = true;
  } else if (kind === "squash") {
    title = "Squash into the parent?";
    what = `${c} is folded into ${info.parent ? quoted(info.parent) : "its parent"}.\n\n${list(lines)}`;
    ok = "Squash";
  } else {
    title = `Rewrite ${count(lines.length, "commit")} on ${branch}?`;
    what = rewriteList(lines);
    ok = `Rewrite ${lines.length} Commit${lines.length === 1 ? "" : "s"}`;
  }
  const tail = [kind === "undo" ? "" : back, kind === "undo" || kind === "drop" && !renewed.length ? "" : untouched].filter(Boolean).join("\n");
  const stop = kind === "undo" || (kind === "reword" && lines.length <= 1) ? "" : "\n\nIf a commit conflicts while it is replayed, the rewrite stops and Source Control shows the files to resolve; Abort there brings everything back.";
  if (pushed.length) {
    const where = info.pushedOn ?? "a remote branch";
    const total = kind === "undo" ? 1 : lines.length;
    const which = total === 1 ? "This commit is" : pushed.length === total ? `All ${total} commits are` : `${pushed.length} of the ${total} commits are`;
    const shown = pushed.slice(0, LISTED).map((p) => `${p.short}  ${p.summary}`).join("\n") + (pushed.length > LISTED ? `\nand ${pushed.length - LISTED} more` : "");
    return {
      title: "Rewrite commits that are already pushed?",
      text:
        `${which} already on ${where}:\n\n${shown}\n\n` +
        `Anyone who has pulled ${pushed.length === 1 ? "it" : "them"} will have to repair their copy. A normal Push will be refused afterwards and Quarry will then offer Force Push. Revert This Commit… is the safe way to undo a pushed commit.\n\n` +
        `${what}${tail ? `\n\n${tail}` : ""}${stop}`,
      choices: [{ label: kind === "undo" ? "Undo Pushed Commit" : "Rewrite Pushed Commits", kind: "danger", value: true }, CANCEL],
      pushed: true,
    };
  }
  return { title, text: `${what}${tail ? `\n\n${tail}` : ""}${stop}`, choices: [{ label: ok, kind: danger ? "danger" : "primary", value: true }, CANCEL], pushed: false };
}

/**
 * The notification after a history edit that finished. `was`: the tip's short id before it.
 * `stale`: pushed commits were rewritten; the upstream (or, without one, the remote branch that has
 * them) still holds the old commits.
 */
export function historyDone(kind: HistoryKind, info: { branch: string; was: string; commit?: { summary: string }; parent?: { summary: string }; count?: number }, stale: { upstream: string | null; on: string | null } | null = null): string {
  const was = `${info.branch} was at ${info.was}.`;
  const text =
    kind === "undo" ? `Undid the last commit: its changes are staged. ${was}`
    : kind === "reword" ? `Reworded the commit. ${was}`
    : kind === "drop" ? `Dropped "${info.commit?.summary ?? ""}". ${was}`
    : kind === "squash" ? `Squashed "${info.commit?.summary ?? ""}" into "${info.parent?.summary ?? ""}". ${was}`
    : `Rewrote ${count(info.count ?? 0, "commit")} on ${info.branch}. It was at ${info.was}.`;
  if (!stale) return text;
  if (stale.upstream) return `${text} ${stale.upstream} still has the old commits: use Force Push… in Source Control to replace them.`;
  return stale.on ? `${text} ${stale.on} still has the old commits.` : text;
}

/** The error when the branch moved between the question and the answer. */
export function movedText(branch: string, list: boolean): string {
  return `${branch} has changed since ${list ? "this list was opened" : "you started"}. Nothing was rewritten.`;
}

export function tooMany(n: number): string {
  return `That is ${n} commits. The list takes at most ${MAX_PLAN}: pick a more recent commit.`;
}

export function allPushed(branch: string): string {
  return `Every commit on ${branch} is already pushed. To rewrite pushed commits, right-click a commit in the graph and choose Edit History from Here…`;
}

/** The list's heading, the line under its rows and its pushed warning. */
export function listWords(range: Pick<GitHistoryRange, "branch" | "commits" | "base" | "pushedOn">): { head: string; foot: string; warning: string | null } {
  const n = range.commits.length;
  const branch = range.branch ?? "the branch";
  const pushed = range.commits.filter((c) => c.pushed).length;
  return {
    head: `Edit history of ${branch}: ${count(n, "commit")}${range.base ? ` since ${range.base.short}` : ""}`,
    foot: range.base ? `${range.base.short} ${range.base.summary} and earlier commits are not changed` : `This is the whole history of ${branch}`,
    warning: pushed ? `${pushed} of these commits ${pushed === 1 ? "is" : "are"} already pushed. Changing ${pushed === 1 ? "it" : "them"} or anything below a change rewrites pushed history.` : null,
  };
}
