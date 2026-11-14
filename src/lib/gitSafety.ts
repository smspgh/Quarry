/**
 * Unsaved tabs and git operations (specs/git-safety.md): pure rules and wording. Which open tabs
 * count as "unsaved, in this repository", which operations ask about them (the three-button
 * dialog), which only add a sentence to their own confirmation, and what the dialog and the
 * notices afterwards say. The guard itself is `guardUnsaved` / `syncTabs` in gitTabs.ts, called
 * from the action functions of git.ts.
 */
import type { Choice } from "./dialogs";

// ---------- which tabs count ----------

/** An open tab as the rules need it (built from the store by `openTabs` in gitTabs.ts). */
export interface OpenTab {
  id: string;
  kind: string;
  /** The file of a text or large-file tab (null: untitled, or not a file tab). */
  path: string | null;
  dirty: boolean;
  /** Marked unsaved only because its file went missing; not edited since (FILE-015.4). */
  missingOnly?: boolean;
  /** A Compare tab's sides. */
  sides?: { which: "left" | "right"; path: string | null; dirty: boolean; editable: boolean }[];
}

/** A file with unsaved edits in one or more open tabs. */
export interface RiskTab {
  path: string;
  /** File name. */
  name: string;
  /** Path relative to the repository root, with backslashes (the file name when not under it). */
  rel: string;
  /** The tabs holding the edits (a Compare tab: which side). */
  docs: { id: string; side?: "left" | "right" }[];
}

const norm = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
const baseName = (p: string) => p.slice(Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/")) + 1);
const under = (path: string, root: string) => {
  const [p, r] = [norm(path), norm(root)];
  return p === r || p.startsWith(`${r}\\`);
};

/** The deepest of `roots` that holds `path` (a file of a nested repository belongs to the nested one). */
export function ownerRoot(path: string, roots: string[]): string | null {
  let best: string | null = null;
  for (const r of roots) if (under(path, r) && (!best || norm(r).length > norm(best).length)) best = r;
  return best;
}

/** Every file with unsaved edits the user made, in tab order, each once. */
function unsavedFiles(tabs: OpenTab[], keep: (path: string) => boolean, root: string | null): RiskTab[] {
  const out = new Map<string, RiskTab>();
  const add = (path: string, doc: RiskTab["docs"][number]) => {
    if (!keep(path)) return;
    const k = norm(path);
    const rel = root && under(path, root) ? path.replace(/\//g, "\\").slice(root.replace(/[\\/]+$/, "").length + 1) : baseName(path);
    const t = out.get(k) ?? { path, name: baseName(path), rel, docs: [] };
    t.docs.push(doc);
    out.set(k, t);
  };
  for (const t of tabs) {
    if ((t.kind === "text" || t.kind === "big") && t.path && t.dirty && !t.missingOnly) add(t.path, { id: t.id });
    else if (t.kind === "diff") for (const s of t.sides ?? []) if (s.path && s.dirty && s.editable) add(s.path, { id: t.id, side: s.which });
  }
  return [...out.values()];
}

/**
 * The open tabs an operation on the repository `root` could pull the file from under: text,
 * large-file and editable Compare sides with unsaved edits whose file belongs to `root` (the
 * deepest of `repoRoots` holding it). Never untitled tabs, other repositories' files, other kinds
 * of tab, or a tab that is only marked unsaved because its file is missing.
 */
export function tabsAtRisk(tabs: OpenTab[], root: string, repoRoots: string[]): RiskTab[] {
  const roots = repoRoots.some((r) => norm(r) === norm(root)) ? repoRoots : [...repoRoots, root];
  return unsavedFiles(tabs, (p) => norm(ownerRoot(p, roots) ?? "") === norm(root), root);
}

/** The same, for the files an operation names (discard, take a side). */
export function tabsOfPaths(tabs: OpenTab[], paths: string[], root: string | null = null): RiskTab[] {
  const want = new Set(paths.map(norm));
  return unsavedFiles(tabs, (p) => want.has(norm(p)), root);
}

// ---------- which operations ask ----------

/** Every git action of Quarry, as far as open tabs are concerned. */
export type SafetyKind =
  // may rewrite any file: the three-button dialog
  | "switch"
  | "checkout"
  | "pull"
  | "merge"
  | "rebase"
  | "history"
  | "cherry-pick"
  | "revert"
  | "stash"
  | "stash-apply"
  | "continue"
  // throw work away: a sentence in their own confirmation
  | "discard"
  | "reset-hard"
  | "abort"
  | "take-side"
  // leave the files alone
  | "fetch"
  | "push"
  | "force-push"
  | "commit"
  | "stage"
  | "unstage"
  | "resolve"
  | "reset-soft"
  | "reset-mixed"
  | "undo"
  | "reword-tip"
  | "branch"
  | "tag"
  | "ref"
  | "stash-drop";

const ASK: Record<SafetyKind, "dialog" | "sentence" | "never"> = {
  switch: "dialog",
  checkout: "dialog",
  pull: "dialog",
  merge: "dialog",
  rebase: "dialog",
  history: "dialog",
  "cherry-pick": "dialog",
  revert: "dialog",
  stash: "dialog",
  "stash-apply": "dialog",
  continue: "dialog",
  discard: "sentence",
  "reset-hard": "sentence",
  abort: "sentence",
  "take-side": "sentence",
  fetch: "never",
  push: "never",
  "force-push": "never",
  commit: "never",
  stage: "never",
  unstage: "never",
  resolve: "never",
  "reset-soft": "never",
  "reset-mixed": "never",
  undo: "never",
  "reword-tip": "never",
  branch: "never",
  tag: "never",
  ref: "never",
  "stash-drop": "never",
};

/** "dialog": Save All / Continue Without Saving / Cancel before git runs; "sentence": the
 *  operation's own confirmation names the tabs; "never": the files are not touched. */
export const asksAboutTabs = (kind: SafetyKind) => ASK[kind];

/** Operations that only start from a clean state: the unsaved-tabs dialog comes before their
 *  confirmation, and the clean-state check runs again after Save All. */
export const needsCleanState = (kind: SafetyKind) => kind === "merge" || kind === "rebase" || kind === "history";

/** An operation and the names its wording needs. */
export interface SafetyOp {
  kind: SafetyKind;
  /** switch: the branch; checkout / cherry-pick / revert: the short commit id; merge: what is
   *  merged; rebase: what the branch is rebased onto. */
  name?: string;
  /** merge: the branch merged into; rebase: the branch being rebased. */
  branch?: string | null;
  /** continue / abort: the stopped operation in a sentence ("the rebase"). */
  noun?: string;
}

/** A remote branch is switched to under its local name: "origin/topic" → "topic". */
export function localName(name: string, remotes: string[]): string {
  const hit = remotes.filter((r) => name.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0];
  return hit ? name.slice(hit.length + 1) : name;
}

/** "Switching to feature", "Pulling", "Merging feature into main": the start of the dialog's sentence. */
export function operationPhrase(op: SafetyOp): string {
  switch (op.kind) {
    case "switch":
      return `Switching to ${op.name}`;
    case "checkout":
      return `Checking out ${op.name}`;
    case "pull":
      return "Pulling";
    case "merge":
      return `Merging ${op.name} into ${op.branch ?? "the current commit"}`;
    case "rebase":
      return `Rebasing ${op.branch ?? "the branch"} onto ${op.name}`;
    case "history":
      return "Rewriting commits";
    case "cherry-pick":
      return `Cherry-picking ${op.name}`;
    case "revert":
      return `Reverting ${op.name}`;
    case "stash":
      return "Stashing";
    case "stash-apply":
      return "Applying the stash";
    case "continue":
      return `Continuing ${op.noun ?? "the operation"}`;
    default:
      return "This";
  }
}

/** "after switching to feature", "after the pull": the end of the missing-files warning. */
export function afterPhrase(op: SafetyOp): string {
  switch (op.kind) {
    case "switch":
      return `after switching to ${op.name}`;
    case "checkout":
      return `after checking out ${op.name}`;
    case "pull":
      return "after the pull";
    case "merge":
      return "after the merge";
    case "rebase":
      return "after the rebase";
    case "history":
      return "after rewriting the commits";
    case "cherry-pick":
      return "after the cherry-pick";
    case "revert":
      return "after the revert";
    case "stash":
      return "after stashing";
    case "stash-apply":
      return "after applying the stash";
    case "continue":
      return `after continuing ${op.noun ?? "the operation"}`;
    case "discard":
      return "after the discard";
    case "reset-hard":
      return "after the reset";
    case "abort":
      return `after aborting ${op.noun ?? "the operation"}`;
    default:
      return "now";
  }
}

const NOT_DONE: Partial<Record<SafetyKind, string>> = {
  switch: "Not switched",
  checkout: "Not checked out",
  pull: "Not pulled",
  merge: "Not merged",
  rebase: "Not rebased",
  history: "Nothing was rewritten",
  "cherry-pick": "Not cherry-picked",
  revert: "Not reverted",
  stash: "Nothing was stashed",
  "stash-apply": "The stash was not applied",
  continue: "Not continued",
};

// ---------- wording ----------

export const LIST_MAX = 10;

/** One path per line, at most 10, then "and N more". */
export function listPaths(paths: string[], max = LIST_MAX): string {
  const shown = paths.slice(0, max);
  if (paths.length > max) shown.push(`and ${paths.length - max} more`);
  return shown.join("\n");
}

/** "a.ts", "a.ts and b.ts", "a.ts, b.ts and c.ts", "a.ts, b.ts, c.ts and 2 more". */
export function nameList(names: string[], max = 3): string {
  if (names.length > max) return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export type UnsavedAnswer = "save" | "continue" | "cancel";

/** The unsaved-tabs dialog: title, text and its three buttons (Save All answers Enter, Cancel Escape). */
export function unsavedPrompt(op: SafetyOp, tabs: Pick<RiskTab, "rel" | "name">[]): { title: string; text: string; choices: Choice<UnsavedAnswer>[] } {
  const one = tabs.length === 1;
  const title = one ? `Unsaved changes in ${tabs[0].name}` : `Unsaved changes in ${tabs.length} open files`;
  const list = listPaths(tabs.map((t) => t.rel));
  const lead =
    op.kind === "stash"
      ? `A stash takes the files as they are on disk, so the unsaved changes in ${one ? "this open file" : "these open files"} would not be in it:`
      : `${operationPhrase(op)} can rewrite files in this repository, and ${one ? "this open file has" : "these open files have"} unsaved changes:`;
  const end = op.kind === "stash" ? `Save ${one ? "it" : "them"} first to stash ${one ? "it" : "them"} too, or continue and keep the unsaved text in ${one ? "its tab" : "their tabs"}.` : `Save ${one ? "it" : "them"} first, or continue and keep the unsaved text in ${one ? "its tab" : "their tabs"}.`;
  return {
    title,
    text: `${lead}\n\n${list}\n\n${end}`,
    choices: [
      { label: one ? "Save" : "Save All", kind: "primary", default: true, value: "save" },
      { label: "Continue Without Saving", value: "continue" },
      { label: "Cancel", cancel: true, value: "cancel" },
    ],
  };
}

/** After Save All could not save everything: "Not switched: README.md could not be saved." */
export function notSavedNotice(op: SafetyOp, names: string[]): string {
  return `${NOT_DONE[op.kind] ?? "Nothing was done"}: ${nameList(names)} could not be saved.`;
}

/** After Continue Without Saving: the tabs whose file changed underneath them. */
export function keptNotice(names: string[]): string {
  if (names.length === 1) return `${names[0]} changed on disk; its tab keeps your unsaved text. Saving it overwrites the file.`;
  return `${nameList(names)} changed on disk; their tabs keep your unsaved text. Saving one overwrites its file.`;
}

/** Tabs reloaded from disk: one file keeps the familiar wording, several are counted. */
export function reloadedNotice(names: string[]): string {
  return names.length === 1 ? `${names[0]} changed on disk and was reloaded.` : `${names.length} open files changed on disk and were reloaded.`;
}

/** Tabs whose file is gone: after a git operation (`op`), or noticed by the window-focus check (null). */
export function missingNotice(op: SafetyOp | null, names: string[]): string {
  if (!op) {
    if (names.length === 1) return `${names[0]} was deleted or moved on disk. Saving will recreate it.`;
    return `${nameList(names)} were deleted or moved on disk. Their tabs stay open; saving one recreates the file.`;
  }
  if (names.length === 1) return `${names[0]} is not in the folder ${afterPhrase(op)}. Its tab stays open; saving it recreates the file.`;
  return `${nameList(names)} are not in the folder ${afterPhrase(op)}. Their tabs stay open; saving one recreates the file.`;
}

/**
 * What a discarding operation's confirmation adds about unsaved tabs ("" when there are none).
 * "reset-hard" / "abort": only tabs of files the operation rewrites lose their edits, listed by
 * path in the repository. "discard": the tabs of the files being discarded, by name.
 */
export function lostEditsSentence(kind: "discard" | "reset-hard" | "abort", tabs: Pick<RiskTab, "rel" | "name">[]): string {
  if (!tabs.length) return "";
  if (kind === "discard") {
    const names = tabs.map((t) => t.name);
    const shown = names.slice(0, LIST_MAX).join(", ") + (names.length > LIST_MAX ? `, and ${names.length - LIST_MAX} more` : "");
    return `Unsaved edits in ${tabs.length} open tab${tabs.length === 1 ? "" : "s"} are lost too: ${shown}.`;
  }
  const rels = tabs.map((t) => t.rel);
  const shown = rels.slice(0, LIST_MAX).join(", ") + (rels.length > LIST_MAX ? `, and ${rels.length - LIST_MAX} more` : "");
  return `Unsaved edits in open tabs are lost too where the ${kind === "abort" ? "abort" : "reset"} rewrites the file: ${shown}.`;
}

/** The text of "Discard changes?" for `count` files (`untracked` of them not tracked), given the
 *  unsaved tabs among them. Reads as before when there are none. */
export function discardText(name: string, count: number, untracked: number, tabs: Pick<RiskTab, "rel" | "name">[]): string {
  const one = count === 1;
  if (untracked === count) {
    const lost = !tabs.length ? "" : one ? " The unsaved edits in its open tab are lost." : ` ${lostEditsSentence("discard", tabs)}`;
    return `${name} ${one ? "is" : "are"} not tracked by git and will be moved to the Recycle Bin.${lost}`;
  }
  const bin = untracked ? ` (${untracked} untracked file${untracked === 1 ? " goes" : "s go"} to the Recycle Bin)` : "";
  if (one && tabs.length) return `Your changes to ${name} will be lost, including the unsaved edits in its open tab. Open tabs reload the committed text.`;
  return `Your changes to ${name} will be lost${bin}.${tabs.length ? ` ${lostEditsSentence("discard", tabs)}` : ""} Open tabs reload the committed text.`;
}
