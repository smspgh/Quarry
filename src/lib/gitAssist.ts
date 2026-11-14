/**
 * The Claude git helpers (specs/git-claude.md): draft a commit message, explain a conflict and
 * propose its resolution, summarise a branch or a range of commits. Each is one headless, tool-less
 * `claude -p` request through the user's own Claude Code (Rust `claude_oneshot`), started only by a
 * click, one at a time, and nothing it returns is applied without the user: a draft goes into the
 * editable message box, a resolution into a panel with Apply / Discard, a summary into an untitled
 * tab. Wording, prompts, limits and parsing are pure, in gitAi.ts.
 */
import type { EditorView } from "@codemirror/view";
import { create } from "zustand";
import { blockText, conflictsOf, dropSuggestion, redrawConflicts, setConflictHooks, setSuggestion, suggestionsOf, type Suggestion } from "../editor/conflicts";
import { editor } from "../editor/manager";
import { conflictExcerpt, type ConflictBlock } from "./conflicts";
import { choose } from "./dialogs";
import { currentRepo, pickBranch, repoOf, useGit } from "./git";
import {
  assistError,
  assistLabel,
  budgetDiff,
  budgetNote,
  BUSY_ELSEWHERE,
  commitPrompt,
  CONFLICT_CONTEXT,
  CONFLICT_LIMIT,
  conflictPrompt,
  DRAFT_TIMEOUT,
  draftState,
  NOTHING_TO_COMMIT,
  nothingToSummarise,
  parseDraft,
  parseOneshot,
  parseResolution,
  sendNotice,
  SUMMARY_MAX_COMMITS,
  SUMMARY_TIMEOUT,
  summaryDocument,
  summaryName,
  summaryPrompt,
  timeoutMessage,
  tooManyCommits,
  unsavedWarning,
  type AssistFailure,
  type AssistKind,
  type DraftRepo,
  type OneshotResult,
  type SendWhat,
} from "./gitAi";
import { claude, git, type GitStatus } from "./gitApi";
import { getSummarisePick, setSummarisePick } from "./gitRefs";
import { isStashConflict } from "./gitStash";
import { operationWords } from "./gitStatus";
import { isPanelShown } from "./panels";
import { activeDoc, useStore, type Doc } from "./store";

/** The one request that may run at a time. */
export interface Assist {
  id: number;
  kind: AssistKind;
  /** "drafting a commit message", "summarising 12 commits": the status bar's words. */
  label: string;
  startedAt: number;
  /** The repository it is about, and for a conflict the tab it belongs to. */
  root: string | null;
  docId: string | null;
}

interface AssistState {
  assist: Assist | null;
  /** A drafted message waiting for the commit box of that repository to take it. */
  draft: { root: string; text: string } | null;
  /** "Large change: …" under the message box, until the message changes hands. */
  draftNote: { root: string; text: string } | null;
  /** `git.draftMessage` was run: the commit box (which knows the message and Amend) starts the draft. */
  draftAsked: boolean;
}

export const useGitAssist = create<AssistState>(() => ({ assist: null, draft: null, draftNote: null, draftAsked: false }));

const key = (p: string) => p.toLowerCase();
const toast = (m: string, kind: "info" | "success" | "error" | "warning" = "info", ms?: number) => useStore.getState().toast(m, kind, ms);
const settings = () => useStore.getState().settings;
const enabled = () => settings().claudeEnabled;
const running = () => useGitAssist.getState().assist;

// ---------- the request ----------

/** How a request reaches Claude Code and is stopped; tests put a fake in its place. */
export interface AssistBackend {
  run: (args: { id: number; exe: string; model: string; prompt: string; timeoutSecs: number }) => Promise<OneshotResult>;
  cancel: (id: number) => void;
}
const tauriBackend: AssistBackend = { run: (args) => claude.oneshot(args), cancel: (id) => void claude.cancel(id).catch(() => {}) };
let backend = tauriBackend;
export function setAssistBackend(b: AssistBackend | null) {
  backend = b ?? tauriBackend;
}

let seq = 0;

export type AssistAnswer = { ok: true; text: string } | { ok: false; error: AssistFailure };

/**
 * Send one prompt. Resolves with Claude's text or the reason there is none; null when the request
 * was stopped (also when its answer arrives after that: a late answer is dropped by id).
 */
async function request(kind: AssistKind, label: string, prompt: string, ctx: { root?: string | null; docId?: string | null } = {}): Promise<AssistAnswer | null> {
  if (running()) return null;
  const id = ++seq;
  useGitAssist.setState({ assist: { id, kind, label, startedAt: Date.now(), root: ctx.root ?? null, docId: ctx.docId ?? null } });
  const mine = () => running()?.id === id;
  let r: OneshotResult;
  try {
    r = await backend.run({ id, exe: settings().claudePath, model: settings().claudeGitModel, prompt, timeoutSecs: kind === "summary" ? SUMMARY_TIMEOUT : DRAFT_TIMEOUT });
  } catch (e) {
    if (!mine()) return null;
    useGitAssist.setState({ assist: null });
    return { ok: false, error: assistError(e) };
  }
  if (!mine()) return null;
  useGitAssist.setState({ assist: null });
  if (r.cancelled) return null;
  if (r.timedOut) return { ok: false, error: { message: timeoutMessage(kind), action: null } };
  return parseOneshot(r.stdout, r.stderr, r.code);
}

/** Stop the running request, if any: its process ends at once and whatever it answers later is ignored. */
export function cancelAssist(): boolean {
  const a = running();
  if (!a) return false;
  useGitAssist.setState({ assist: null });
  backend.cancel(a.id);
  // A conflict's "Claude is reading…" panel goes with its request.
  if (a.kind === "conflict" && a.docId) dropWorking(a.docId);
  return true;
}

/** Why a helper cannot start now, said as a notification; true when it may. */
function mayStart(): boolean {
  if (!enabled()) return false;
  if (running()) {
    toast(BUSY_ELSEWHERE, "info", 5000);
    return false;
  }
  return true;
}

/** Tell the user why a request failed, with the way out when there is one. Nothing was changed. */
async function showFailure(error: AssistFailure) {
  if (!error.action) {
    toast(error.message, "error", 12000);
    return;
  }
  const settingsWay = error.action === "settings";
  const go = await choose(settingsWay ? "Claude Code was not found" : "Claude Code is not signed in", error.message, [
    { label: settingsWay ? "Open Settings" : "Open Claude Code Terminal", kind: "primary", default: true, value: true },
    { label: "Close", cancel: true, value: false },
  ], false);
  if (!go) return;
  const { runCommand } = await import("./commands");
  void runCommand(settingsWay ? "view.settings" : "claude.openTerminal");
}

/**
 * The question before anything leaves the machine (GITAI-002). "Send and Don't Ask Again" turns it
 * off for all three helpers (`claudeGitConfirm`, back on in Settings › Claude Code).
 */
export async function confirmSend(what: SendWhat): Promise<boolean> {
  if (!settings().claudeGitConfirm) return true;
  const n = sendNotice(what);
  const answer = await choose<"send" | "always" | "cancel">(n.title, n.message, [
    { label: "Send", kind: "primary", default: true, value: "send" },
    { label: "Send and Don't Ask Again", value: "always" },
    { label: "Cancel", cancel: true, value: "cancel" },
  ], "cancel");
  if (answer === "always") {
    useStore.getState().updateSettings({ claudeGitConfirm: false });
    void import("./actions").then((m) => m.persistSettings());
  }
  return answer !== "cancel";
}

// ---------- draft a commit message ----------

/** The repository as the Draft button and `draftState` see it. */
export function draftRepo(repo: Pick<GitStatus, "files" | "operation" | "head">): DraftRepo {
  const open = repo.files.filter((f) => !f.conflicted);
  return {
    staged: open.filter((f) => !f.untracked && f.index !== ".").length,
    changed: open.length,
    untracked: open.filter((f) => f.untracked).length,
    conflicts: repo.files.length - open.length,
    keepsMessages: repo.operation && operationWords(repo.operation).continueLabel ? (repo.operation === "am" ? "am" : "rebase") : null,
    head: !!repo.head,
  };
}

/** Ask the commit box to draft (the command's way in: the box knows the message and Amend). */
export function askForDraft() {
  useGitAssist.setState({ draftAsked: true });
}

export function clearDraftNote(root?: string) {
  const n = useGitAssist.getState().draftNote;
  if (n && (!root || key(n.root) === key(root))) useGitAssist.setState({ draftNote: null });
}

/** The commit box took the drafted message. */
export function takeDraft(root: string): string | null {
  const d = useGitAssist.getState().draft;
  if (!d || key(d.root) !== key(root)) return null;
  useGitAssist.setState({ draft: null });
  return d.text;
}

/**
 * Draft a commit message for what the Commit button would commit. The draft is handed to the commit
 * box through `useGitAssist().draft`; nothing is staged or committed. `message`: what the box holds
 * now (replacing it is asked about first, and it survives a failed or stopped draft).
 */
export async function draftCommitMessage(root: string, opts: { amend: boolean; message: string }): Promise<boolean> {
  if (!enabled()) return false;
  const repo = useGit.getState().repos[key(root)];
  if (!repo) return false;
  const state = draftState(draftRepo(repo), opts.amend, running()?.kind ?? null);
  if (running()) {
    toast(BUSY_ELSEWHERE, "info", 5000);
    return false;
  }
  if (state.disabled) {
    toast(state.disabled, "info", 4000);
    return false;
  }
  if (opts.message.trim()) {
    const replace = await choose("Replace your message?", "The message box already has text. Claude's draft will replace it.", [
      { label: "Replace with Draft", value: true },
      { label: "Keep My Message", kind: "primary", default: true, cancel: true, value: false },
    ], false);
    if (!replace) return false;
  }
  let diff: Awaited<ReturnType<typeof git.commitDiff>>;
  try {
    diff = await git.commitDiff(root, state.counts.scope);
  } catch (e) {
    toast(String(e), "error", 8000);
    return false;
  }
  if (!diff.files.length) {
    toast(NOTHING_TO_COMMIT, "info", 4000);
    return false;
  }
  const budget = budgetDiff(diff.files);
  const note = budgetNote(budget);
  const untracked = diff.files.filter((f) => f.untracked);
  // The numbers in the question are those of what was really read, not of the last status.
  const files = state.counts.scope === "amend" ? state.counts.files : diff.files.length;
  if (!(await confirmSend({ kind: "draft", scope: state.counts.scope, files, untracked: untracked.length, untrackedNames: untracked.map((f) => f.rel), note }))) return false;
  if (!mayStart()) return false;
  const dirty = useStore.getState().docs.filter((d) => d.dirty && d.path && key(d.path).startsWith(key(root) + "\\")).length;
  if (dirty) toast(unsavedWarning(dirty), "warning", 6000);
  useGitAssist.setState({ draftNote: null, draft: null });
  const r = await request("draft", assistLabel("draft"), commitPrompt(budget, diff.subjects, repo.branch, state.counts.scope === "amend"), { root });
  if (!r) return false;
  const text = r.ok ? parseDraft(r.text) : "";
  if (!r.ok || !text) {
    await showFailure(r.ok ? { message: "Claude returned no text. Try again.", action: null } : r.error);
    return false;
  }
  useGitAssist.setState({ draft: { root, text }, draftNote: note ? { root, text: note } : null });
  // Said only when the commit box is not in view; there the draft itself is the news.
  if (!isPanelShown(useStore.getState(), "git")) toast("Claude drafted a commit message.", "success", 5000);
  return true;
}

// ---------- explain a conflict ----------

const TOO_LARGE = `This conflict is too large to send to Claude (limit ${CONFLICT_LIMIT.toLocaleString("en-US")} characters).`;

/** The tab a view shows (the clicked pane's, which need not be the focused one). */
function docOf(view: EditorView): Doc | undefined {
  const s = useStore.getState();
  const ids = [s.activeId, s.split?.otherId].filter((x): x is string => !!x);
  const id = ids.find((i) => editor.viewOf(i) === view) ?? s.activeId;
  return s.docs.find((d) => d.id === id);
}

/** Whose work the sides are: the operation in progress, "stash" for a stash that conflicted, or null. */
function conflictOperation(path: string | null): string | null {
  const repo = repoOf(path) ?? currentRepo();
  if (!repo) return null;
  if (isStashConflict(repo)) return "stash";
  return repo.operation;
}

/** Change the suggestion Claude is still working on (there is at most one), wherever its document is. */
function updateWorking(view: EditorView, docId: string, patch: Partial<Suggestion>) {
  const working = (list: readonly Suggestion[]) => list.find((s) => s.status === "working");
  const here = view.dom.isConnected ? working(suggestionsOf(view.state)) : undefined;
  if (here) {
    view.dispatch({ effects: setSuggestion.of({ ...here, ...patch }) });
    return;
  }
  const state = editor.stateOf(docId);
  const s = state && working(suggestionsOf(state));
  if (s) editor.effectsTo(docId, [setSuggestion.of({ ...s, ...patch })]);
}

/** The pane a conflict request was started in (the same document may also be in the other pane). */
let asking: EditorView | null = null;

function dropWorking(docId: string) {
  const working = (list: readonly Suggestion[]) => list.find((x) => x.status === "working");
  const here = asking?.dom.isConnected ? working(suggestionsOf(asking.state)) : undefined;
  if (asking && here) {
    asking.dispatch({ effects: dropSuggestion.of(here.pos) });
    return;
  }
  const state = editor.stateOf(docId);
  const s = state && working(suggestionsOf(state));
  if (s) editor.effectsTo(docId, [dropSuggestion.of(s.pos)]);
}

/**
 * Explain one conflict of the document in `view` and propose a resolution: the answer goes into a
 * panel under that conflict (editor/conflicts.ts). What is sent is the tab's text as it is now.
 */
export async function explainConflict(view: EditorView, block: ConflictBlock): Promise<boolean> {
  if (!mayStart()) return false;
  const doc = docOf(view);
  if (!doc) return false;
  const lines: string[] = [];
  for (const l of view.state.doc.iterLines()) lines.push(l);
  const excerpt = conflictExcerpt(lines, block, CONFLICT_CONTEXT, CONFLICT_LIMIT);
  if (!excerpt) {
    toast(TOO_LARGE, "warning", 7000);
    return false;
  }
  const asked = blockText(view.state.doc, block);
  const repo = repoOf(doc.path);
  const path = doc.path && repo ? doc.path.slice(repo.root.length).replace(/^\\/, "") : doc.name;
  if (!(await confirmSend({ kind: "conflict", path, fromLine: excerpt.fromLine, toLine: excerpt.toLine }))) return false;
  if (!mayStart()) return false;
  // The question took a moment: the conflict must still be the one that was asked about.
  const now = conflictsOf(view.state).find((b) => blockText(view.state.doc, b) === asked);
  if (!now || docOf(view)?.id !== doc.id) {
    toast("The conflict changed. Click Explain to ask again.", "info", 5000);
    return false;
  }
  const pos = view.state.doc.line(now.start + 1).from;
  const prompt = conflictPrompt(excerpt, { path: path.replace(/\\/g, "/"), language: doc.language, currentLabel: block.currentLabel, incomingLabel: block.incomingLabel, operation: conflictOperation(doc.path) });
  asking = view;
  view.dispatch({ effects: setSuggestion.of({ pos, status: "working", startedAt: Date.now(), asked, explanation: "", resolution: null, note: "", error: "", changed: false }) });
  const r = await request("conflict", assistLabel("conflict"), prompt, { root: repo?.root ?? null, docId: doc.id });
  if (!r) return false;
  if (!r.ok) {
    updateWorking(view, doc.id, { status: "error", error: r.error.message });
    return false;
  }
  const res = parseResolution(r.text);
  if (!res.explanation && res.resolution === null) {
    updateWorking(view, doc.id, { status: "error", error: "Claude returned no text. Try again." });
    return false;
  }
  updateWorking(view, doc.id, { status: "done", explanation: res.explanation, resolution: res.resolution, note: res.rejected ?? "" });
  return true;
}

// ---------- summarise a branch or a range ----------

export interface SummaryRange {
  /** `git log from..to`; "" = from the very start. */
  from: string;
  to: string;
  /** "feature-x", "18bc71d..main": the heading and the tab's name. */
  title: string;
  /** "main..feature-x": the line under the heading. */
  range: string;
  /** For "nothing to summarise": the two branch names. */
  branch?: string;
  base?: string;
}

/** Summarise a run of commits into a new untitled Markdown tab. Nothing in the repository changes. */
export async function summarise(root: string, r: SummaryRange): Promise<boolean> {
  if (!mayStart()) return false;
  const name = summaryName(r.title);
  const actions = await import("./actions");
  const { makeRoom } = await import("./tabLimit");
  let log: Awaited<ReturnType<typeof git.rangeLog>>;
  let files: Awaited<ReturnType<typeof git.rangeDiff>>;
  try {
    log = await git.rangeLog(root, r.from, r.to, SUMMARY_MAX_COMMITS);
    if (log.count === 0) {
      toast(r.branch && r.base ? nothingToSummarise(r.branch, r.base) : "There are no commits in this range.", "info", 6000);
      return false;
    }
    if (log.count > SUMMARY_MAX_COMMITS) {
      toast(tooManyCommits(log.count), "warning", 9000);
      return false;
    }
    // The tab limit is settled before anything is sent (it may ask to close an unchanged tab).
    if ((await makeRoom([name], (id) => actions.closeDocument(id))) === 0) return false;
    files = await git.rangeDiff(root, r.from, r.to);
  } catch (e) {
    toast(String(e), "error", 8000);
    return false;
  }
  const budget = budgetDiff(files);
  const note = budgetNote(budget, "");
  if (!(await confirmSend({ kind: "summary", commits: log.count, files: files.length, note: budgetNote(budget) }))) return false;
  if (!mayStart()) return false;
  const answer = await request("summary", assistLabel("summary", log.count), summaryPrompt(log.commits, budget, r.title), { root });
  if (!answer) return false;
  if (!answer.ok) {
    await showFailure(answer.error);
    return false;
  }
  await actions.newDocument(summaryDocument(r.title, r.range, log.count, answer.text, note), name);
  return true;
}

/**
 * Summarise a branch against a base. Without `base` the branch picker asks for it (the remote's
 * default branch first); without `branch` the current one is taken, and on a detached HEAD the
 * picker asks for that first. A picked row comes back here through `git.summariseBranch`.
 */
export async function summariseBranch(root: string, branch?: string | null, base?: string | null): Promise<boolean> {
  if (!mayStart()) return false;
  const repo = useGit.getState().repos[key(root)];
  const subject = branch ?? repo?.branch ?? null;
  if (subject && base) return summarise(root, { from: base, to: subject, title: subject, range: `${base}..${subject}`, branch: subject, base });
  // The picker lists the branches of the panel's repository: make it this one.
  if (useGit.getState().current !== key(root)) useGit.setState({ current: key(root) });
  const remoteDefault = subject ? await git.defaultBranch(root).catch(() => null) : null;
  setSummarisePick({ root, branch: subject, remoteDefault });
  await pickBranch(subject ? "summarise-base" : "summarise");
  return true;
}

/** A row of a summary picker was chosen. */
export function summarisePicked(name: string): Promise<boolean> {
  const pick = getSummarisePick();
  if (!pick.root) return Promise.resolve(false);
  return pick.branch ? summariseBranch(pick.root, pick.branch, name) : summariseBranch(pick.root, name);
}

// ---------- start-up ----------

/** Redraw the conflict bars and panels of every open document that has conflicts (after this turn: never inside an editor update). */
function redrawConflictBars() {
  setTimeout(() => {
    for (const d of useStore.getState().docs) {
      if (d.kind !== "text") continue;
      const state = editor.stateOf(d.id);
      if (state && conflictsOf(state).length) editor.effectsTo(d.id, [redrawConflicts.of(null)]);
    }
  }, 0);
}

function wireConflictHooks() {
  setConflictHooks({
    explain: enabled() ? (view, block) => void explainConflict(view, block) : null,
    explainBlocked: () => (running() ? BUSY_ELSEWHERE : null),
    stopExplain: () => void cancelAssist(),
  });
}

/** Which side-notes the bars and panels show: changes when an operation starts or ends. */
const notesKey = () =>
  Object.values(useGit.getState().repos)
    .map((r) => `${r.root}|${r.operation ?? ""}|${isStashConflict(r)}`)
    .join("\n");

/** Wire the helpers to the editor and keep them in step with the setting, the tabs and the repository. Call after `installGit`. */
export function installGitAssist(): () => void {
  wireConflictHooks();
  const offStore = useStore.subscribe((s, prev) => {
    if (s.settings.claudeEnabled !== prev.settings.claudeEnabled) {
      wireConflictHooks();
      if (!s.settings.claudeEnabled) {
        // Off: what is running stops, and open suggestions go without touching the files.
        cancelAssist();
        useGitAssist.setState({ draft: null, draftNote: null, draftAsked: false });
        for (const d of s.docs) {
          const state = d.kind === "text" ? editor.stateOf(d.id) : null;
          if (state && suggestionsOf(state).length) editor.effectsTo(d.id, [dropSuggestion.of(null)]);
        }
      }
      redrawConflictBars();
    }
    if (s.docs !== prev.docs) {
      // The tab a conflict request belongs to was closed.
      const a = running();
      if (a?.docId && !s.docs.some((d) => d.id === a.docId)) cancelAssist();
    }
  });
  let notes = notesKey();
  const offGit = useGit.subscribe((g, prev) => {
    // Another repository in the panel, or the folder closed: a draft for the old one is dropped.
    const a = running();
    if (a?.kind === "draft" && a.root && g.current !== prev.current && g.current !== key(a.root)) cancelAssist();
    if (g.repos !== prev.repos) {
      const next = notesKey();
      if (next !== notes) {
        notes = next;
        redrawConflictBars();
      }
    }
  });
  // The Explain buttons are disabled while any request runs.
  const offAssist = useGitAssist.subscribe((a, prev) => {
    if (!!a.assist !== !!prev.assist) redrawConflictBars();
  });
  return () => {
    offStore();
    offGit();
    offAssist();
  };
}

/** The conflict the command acts on in the focused editor: at the cursor, else the next one below. */
export function explainAtCursor(): boolean {
  const view = editor.view;
  if (!view || activeDoc(useStore.getState())?.kind !== "text") return false;
  const blocks = conflictsOf(view.state);
  if (!blocks.length) {
    toast("There are no conflicts in this file.", "info", 1800);
    return true;
  }
  const line = view.state.doc.lineAt(view.state.selection.main.head).number - 1;
  const block = blocks.find((b) => line >= b.start && line <= b.end) ?? blocks.find((b) => b.start > line) ?? blocks[0];
  void explainConflict(view, block);
  return true;
}
