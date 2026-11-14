/**
 * Open tabs around a git operation that can rewrite files (specs/git-safety.md): the one
 * unsaved-tabs question asked before it (`guardUnsaved`), and the one step after it that brings
 * every open tab in line with the disk (`withTabs`), on success, on a stop and on a failure. Both
 * are called from the action functions of git.ts, never from buttons, so every route passes
 * through them. Pure rules and wording are in gitSafety.ts.
 */
import { choose } from "./dialogs";
import { saveDiff, useDiff } from "./diff";
import { asksAboutTabs, keptNotice, missingNotice, notSavedNotice, reloadedNotice, tabsAtRisk, tabsOfPaths, unsavedPrompt, type OpenTab, type RiskTab, type SafetyOp } from "./gitSafety";
import { fs } from "./ipc";
import { useStore } from "./store";

const norm = (p: string) => p.replace(/\//g, "\\").toLowerCase();

/** The open tabs as the rules of gitSafety.ts see them. */
export async function openTabs(): Promise<OpenTab[]> {
  if (!useStore.getState().docs.some((d) => d.dirty)) return []; // nothing unsaved anywhere: nothing can count
  const { missingOnly } = await import("./actions");
  const sessions = useDiff.getState().sessions;
  return useStore.getState().docs.map((d) => {
    const s = d.kind === "diff" ? sessions[d.id] : undefined;
    return {
      id: d.id,
      kind: d.kind,
      path: d.path,
      dirty: d.dirty,
      missingOnly: d.dirty && (d.kind === "text" || d.kind === "big") && missingOnly(d.id),
      sides: s ? (["left", "right"] as const).map((which) => ({ which, path: s[which].path, dirty: s[which].dirty, editable: s[which].editable && s[which].source.kind === "file" })) : undefined,
    };
  });
}

/** The files of the repository `root` with unsaved edits in open tabs. */
export const riskTabs = async (root: string, repoRoots: string[]) => tabsAtRisk(await openTabs(), root, repoRoots);
/** The files among `paths` with unsaved edits in open tabs. */
export const riskTabsOf = async (paths: string[], root: string | null = null) => tabsOfPaths(await openTabs(), paths, root);

/** What was decided about open tabs before an operation; `withTabs` acts on it afterwards. */
export interface Guarded {
  root: string;
  op: SafetyOp;
  /** Files whose tabs keep their unsaved text ("Continue Without Saving" = "Keep my version", answered up front). */
  kept: string[];
  /** Files whose tabs give up their unsaved edits where the operation rewrites the file (its confirmation said so). */
  lose: string[];
  /** Files the user asked to delete: when they are gone afterwards, their tabs close. */
  closeGone: string[];
  /** How many files Save All wrote. */
  saved: number;
}

export const noTabs = (root: string, op: SafetyOp, lose: RiskTab[] = []): Guarded => ({ root, op, kept: [], lose: lose.map((t) => t.path), closeGone: [], saved: 0 });

const toast = (m: string, kind: "info" | "success" | "error" | "warning" = "info", ms?: number) => useStore.getState().toast(m, kind, ms);

/**
 * Before an operation that can rewrite any file of the repository: when open tabs of that
 * repository have unsaved changes, name them and ask Save All (default) / Continue Without Saving
 * / Cancel. Null: the operation must not run (Cancel, or a file could not be saved, which is said
 * in a notification). Operations that leave the files alone, or say it in their own confirmation,
 * pass straight through.
 */
export async function guardUnsaved(root: string, op: SafetyOp, repoRoots: string[]): Promise<Guarded | null> {
  const g = noTabs(root, op);
  if (asksAboutTabs(op.kind) !== "dialog") return g;
  const tabs = await riskTabs(root, repoRoots);
  if (!tabs.length) return g;
  const d = unsavedPrompt(op, tabs);
  const answer = await choose(d.title, d.text, d.choices, "cancel");
  if (answer === "cancel") return null;
  if (answer === "continue") return { ...g, kept: tabs.map((t) => t.path) };
  // Save All: the listed files only, each of them; one that cannot be saved stops the operation.
  const { saveDocument } = await import("./actions");
  const failed: string[] = [];
  for (const t of tabs) {
    let ok = true;
    for (const doc of t.docs) ok = (await (doc.side ? saveDiff(doc.id, doc.side) : saveDocument(doc.id))) && ok;
    if (ok) g.saved++;
    else failed.push(t.name);
  }
  if (failed.length) {
    toast(notSavedNotice(op, failed), "warning", 8000);
    return null;
  }
  return g;
}

/** The after-operation steps still running (tests wait for them; the app never does). */
let pending: Promise<void> = Promise.resolve();
export const tabsSettled = () => pending;

/**
 * Run a git call that can rewrite files, then bring every open tab in line with the disk, whether
 * it worked, stopped on a conflict or failed part-way: clean tabs whose file changed reload (one
 * notice), tabs kept unsaved are not asked again (one warning names those whose file changed),
 * tabs whose edits the confirmation gave up reload where the file was rewritten, tabs whose file
 * is gone stay open (one warning) unless the user asked for the deletion.
 */
export async function withTabs<T>(g: Guarded, fn: () => Promise<T>): Promise<T> {
  const { answerAhead } = await import("./actions");
  const withdraw = [answerAhead(g.kept, "keep"), answerAhead(g.lose, "lose")];
  try {
    return await fn();
  } finally {
    // Not awaited: a "changed on disk" question from before may still be open, and the check
    // queues behind it (it is never dropped).
    const step = after(g).finally(() => withdraw.forEach((f) => f()));
    pending = Promise.all([pending, step]).then(
      () => {},
      () => {},
    );
  }
}

async function after(g: Guarded) {
  const { checkExternalChanges, closeDocument } = await import("./actions");
  for (const path of g.closeGone) {
    if (await fs.exists(path).catch(() => true)) continue;
    for (const d of useStore.getState().docs.filter((x) => (x.kind === "text" || x.kind === "big") && x.path && norm(x.path) === norm(path))) await closeDocument(d.id, true);
  }
  const r = await checkExternalChanges({ quiet: true });
  if (!r) return;
  if (r.reloaded.length) toast(reloadedNotice(r.reloaded), "info", 4000);
  if (r.missing.length) toast(missingNotice(g.op, r.missing), "warning", 8000);
  if (r.kept.length) toast(keptNotice(r.kept), "warning", 8000);
}
