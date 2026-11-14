import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { GitFile, GitStatus } from "../lib/gitApi";
import type { DiffFile, OneshotResult } from "../lib/gitAi";

// The Claude git helpers end to end with a fake Claude Code (specs/git-claude.md): the question
// before sending, one request at a time, Stop and late answers, the time limit, errors with their
// way out, and where each result goes. Nothing here starts the real CLI.
const calls = vi.hoisted(() => [] as { cmd: string; args: Record<string, unknown> }[]);
const answers = vi.hoisted(() => ({ diff: { files: [] as unknown[], subjects: [] as string[] }, log: { count: 0, commits: [] as unknown[] }, rangeDiff: [] as unknown[], branches: [] as unknown[], defaultBranch: null as string | null }));
const docsOpened = vi.hoisted(() => [] as { text: string; name?: string }[]);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args });
    if (cmd === "git_commit_diff") return answers.diff;
    if (cmd === "git_range_log") return answers.log;
    if (cmd === "git_range_diff") return answers.rangeDiff;
    if (cmd === "git_branches") return answers.branches;
    if (cmd === "git_default_branch") return answers.defaultBranch;
    if (cmd === "git_stash_list" || cmd === "git_log" || cmd === "git_unpushed") return [];
    return undefined;
  },
}));
vi.mock("../lib/actions", () => ({
  newDocument: async (text: string, name?: string) => void docsOpened.push({ text, name }),
  closeDocument: async () => true,
  persistSettings: () => {},
}));

const { useStore } = await import("../lib/store");
const { useGit } = await import("../lib/git");
const { allCommands, getCommand, runCommand } = await import("../lib/commands");
const { registerGitCommands } = await import("../lib/gitCommands");
const assist = await import("../lib/gitAssist");
const { useGitAssist } = assist;
const { conflictExtensions, conflictsOf, suggestionsOf, applySuggestion } = await import("../editor/conflicts");
const { getSummarisePick } = await import("../lib/gitRefs");
const { DEFAULT_SETTINGS } = await import("../lib/types");

const ROOT = "C:\\work\\proj";
const KEY = ROOT.toLowerCase();
const gf = (name: string, extra: Partial<GitFile> = {}): GitFile => ({ path: `${ROOT}\\${name}`, origPath: null, index: "M", worktree: ".", conflicted: false, untracked: false, ...extra });
const repo = (extra: Partial<GitStatus> = {}): GitStatus => ({ root: ROOT, branch: "main", head: "9f2c0aa", upstream: null, upstreamGone: false, ahead: 0, behind: 0, files: [gf("a.ts"), gf("b.ts"), gf("c.ts")], operation: null, operationMessage: null, operationStep: null, remotes: [], ...extra });
const df = (rel: string, body = "+changed\n", extra: Partial<DiffFile> = {}): DiffFile => {
  const patch = `diff --git a/${rel} b/${rel}\n${body}`;
  return { rel, added: 1, removed: 0, binary: false, untracked: false, patch, size: patch.length, ...extra };
};
const ok = (result: string): OneshotResult => ({ stdout: JSON.stringify({ type: "result", subtype: "success", is_error: false, result }), stderr: "", code: 0, timedOut: false, cancelled: false });

/** A Claude Code that answers when the test says so. */
function fakeClaude() {
  const runs: { id: number; exe: string; model: string; prompt: string; timeoutSecs: number; answer: (r: OneshotResult) => void; fail: (e: unknown) => void }[] = [];
  const cancelled: number[] = [];
  assist.setAssistBackend({
    run: (args) => new Promise<OneshotResult>((answer, fail) => runs.push({ ...args, answer, fail })),
    cancel: (id) => void cancelled.push(id),
  });
  return { runs, cancelled };
}

const tick = async (n = 4) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
const dialog = () => useStore.getState().dialog;
const press = async (label: string) => {
  const a = dialog()?.actions.find((x) => x.label === label);
  if (!a) throw new Error(`no "${label}" button in ${dialog()?.title ?? "(no dialog)"}`);
  a.run();
  await tick();
};
const toasts = () => useStore.getState().toasts.map((t) => t.message);
const setSettings = (patch: Partial<typeof DEFAULT_SETTINGS>) => useStore.setState({ settings: { ...useStore.getState().settings, ...patch } });

let claude: ReturnType<typeof fakeClaude>;
let uninstall: () => void = () => {};

beforeEach(() => {
  calls.length = 0;
  docsOpened.length = 0;
  answers.diff = { files: [df("a.ts"), df("b.ts"), df("c.ts")], subjects: ["Fix tab order", "Tabs: Close All"] };
  answers.log = { count: 0, commits: [] };
  answers.rangeDiff = [];
  answers.branches = [];
  answers.defaultBranch = null;
  useStore.setState({ settings: { ...DEFAULT_SETTINGS }, docs: [], activeId: null, toasts: [], dialog: null, folder: ROOT });
  useGit.setState({ available: true, repos: { [KEY]: repo() }, current: KEY, busy: null });
  useGitAssist.setState({ assist: null, draft: null, draftNote: null, draftAsked: false });
  claude = fakeClaude();
  uninstall = assist.installGitAssist();
});
afterEach(async () => {
  // Close whatever dialog a test left open, so the next test's first dialog is its own.
  for (let i = 0; i < 5 && dialog(); i++) {
    (dialog()!.actions.find((a) => a.cancel) ?? dialog()!.actions[0]).run();
    await tick(1);
  }
  uninstall();
  assist.cancelAssist();
  assist.setAssistBackend(null);
});

describe("the question before anything is sent (GITAI-002)", () => {
  it("asks first, names what goes, and Cancel sends nothing", async () => {
    void assist.draftCommitMessage(ROOT, { amend: false, message: "" });
    await tick();
    expect(dialog()?.title).toBe("Send these changes to Claude?");
    expect(dialog()?.message).toContain("Quarry sends the diff of the 3 staged files and the first lines of the last 10 commit messages to Claude, through your Claude Code installation and account. This leaves your computer.");
    expect(dialog()?.actions.map((a) => a.label)).toEqual(["Send", "Send and Don't Ask Again", "Cancel"]);
    expect(claude.runs).toHaveLength(0);
    await press("Cancel");
    expect(claude.runs).toHaveLength(0);
    expect(useGitAssist.getState().assist).toBeNull();
    expect(useGitAssist.getState().draft).toBeNull();
  });

  it("Send asks again next time; Don't Ask Again covers every helper and turns the setting off", async () => {
    void assist.draftCommitMessage(ROOT, { amend: false, message: "" });
    await tick();
    await press("Send");
    expect(claude.runs).toHaveLength(1);
    claude.runs[0].answer(ok("Fix it"));
    await tick();
    expect(useStore.getState().settings.claudeGitConfirm).toBe(true);

    void assist.draftCommitMessage(ROOT, { amend: false, message: "" });
    await tick();
    expect(dialog()?.title).toBe("Send these changes to Claude?");
    await press("Send and Don't Ask Again");
    expect(useStore.getState().settings.claudeGitConfirm).toBe(false);
    expect(claude.runs).toHaveLength(2);
    claude.runs[1].answer(ok("Fix it again"));
    await tick();

    // No question any more: a draft and a summary start at once.
    void assist.draftCommitMessage(ROOT, { amend: false, message: "" });
    await tick();
    expect(dialog()).toBeNull();
    expect(claude.runs).toHaveLength(3);
    claude.runs[2].answer(ok("Third"));
    await tick();
    answers.log = { count: 2, commits: [{ sha: "a".repeat(40), short: "aaaaaaa", author: "Ann", time: 1_700_000_000, message: "One", stat: "" }] };
    answers.rangeDiff = [df("x.ts")];
    void assist.summarise(ROOT, { from: "main", to: "feature-x", title: "feature-x", range: "main..feature-x" });
    await tick();
    expect(dialog()).toBeNull();
    expect(claude.runs).toHaveLength(4);
  });

  it("only the described text is in the request, and it asks for the git helpers' own model", async () => {
    setSettings({ claudeModel: "opus", claudeGitConfirm: false });
    void assist.draftCommitMessage(ROOT, { amend: false, message: "" });
    await tick();
    const run = claude.runs[0];
    expect(calls.find((c) => c.cmd === "git_commit_diff")?.args).toEqual({ root: ROOT, scope: "staged" });
    expect(run.model).toBe("haiku"); // the default, not the Claude tabs' Opus
    expect(run.timeoutSecs).toBe(120);
    expect(run.prompt).toContain("diff --git a/a.ts b/a.ts\n+changed");
    expect(run.prompt).toContain("- Fix tab order\n- Tabs: Close All");
    expect(run.prompt).toContain("Files changed (3):");
    run.answer(ok("x"));
    await tick();

    setSettings({ claudeGitModel: "sonnet" });
    void assist.draftCommitMessage(ROOT, { amend: false, message: "" });
    await tick();
    expect(claude.runs[1].model).toBe("sonnet");
    claude.runs[1].answer(ok("x"));
    await tick();
    setSettings({ claudeGitModel: "" });
    void assist.draftCommitMessage(ROOT, { amend: false, message: "" });
    await tick();
    expect(claude.runs[2].model).toBe(""); // Default: no model is asked for
    expect(useStore.getState().settings.claudeModel).toBe("opus");
  });

  it("nothing staged: all changes, the untracked files named in the question", async () => {
    useGit.setState({ repos: { [KEY]: repo({ files: [gf("a.ts", { index: ".", worktree: "M" }), gf("notes.txt", { index: "?", worktree: "?", untracked: true })] }) } });
    answers.diff = { files: [df("a.ts"), df("notes.txt", "+whole file\n", { untracked: true })], subjects: [] };
    void assist.draftCommitMessage(ROOT, { amend: false, message: "" });
    await tick();
    expect(calls.find((c) => c.cmd === "git_commit_diff")?.args).toEqual({ root: ROOT, scope: "all" });
    expect(dialog()?.message).toContain("Nothing is staged, so Quarry sends the diff of all 2 changed files, including the full text of 1 untracked file (notes.txt), and the first lines");
    await press("Send");
    expect(claude.runs[0].prompt).toContain("notes.txt (+1 -0, new file)");
    expect(claude.runs[0].prompt).toContain("+whole file");
  });
});

describe("draft a commit message (GITAI-003, GITAI-004)", () => {
  beforeEach(() => setSettings({ claudeGitConfirm: false }));

  it("hands the cleaned draft to the commit box and commits nothing", async () => {
    void assist.draftCommitMessage(ROOT, { amend: false, message: "" });
    await tick();
    expect(useGitAssist.getState().assist).toMatchObject({ kind: "draft", label: "drafting a commit message", root: ROOT });
    claude.runs[0].answer(ok("Here is a commit message:\n\n```\nFix tab order\n\nThe list skipped hidden rows.\n```\n\nCo-Authored-By: Claude <noreply@anthropic.com>"));
    await tick();
    expect(useGitAssist.getState().assist).toBeNull();
    expect(useGitAssist.getState().draft).toEqual({ root: ROOT, text: "Fix tab order\n\nThe list skipped hidden rows." });
    expect(assist.takeDraft(ROOT)).toBe("Fix tab order\n\nThe list skipped hidden rows.");
    expect(assist.takeDraft(ROOT)).toBeNull();
    // Reading and asking only: no commit, stage or unstage command ran.
    expect(calls.map((c) => c.cmd).filter((c) => /commit$|stage|checkout|reset/.test(c))).toEqual([]);
    // The Source Control panel is not in view: the user is told.
    expect(toasts()).toContain("Claude drafted a commit message.");
  });

  it("an existing message is asked about first, Keep My Message being the default", async () => {
    void assist.draftCommitMessage(ROOT, { amend: false, message: "WIP parser" });
    await tick();
    expect(dialog()?.title).toBe("Replace your message?");
    expect(dialog()?.message).toBe("The message box already has text. Claude's draft will replace it.");
    expect(dialog()?.actions.map((a) => a.label)).toEqual(["Replace with Draft", "Keep My Message"]);
    expect(dialog()?.actions.find((a) => a.default)?.label).toBe("Keep My Message");
    expect(dialog()?.actions.find((a) => a.cancel)?.label).toBe("Keep My Message");
    await press("Keep My Message");
    expect(calls.some((c) => c.cmd === "git_commit_diff")).toBe(false);
    expect(claude.runs).toHaveLength(0);

    void assist.draftCommitMessage(ROOT, { amend: false, message: "WIP parser" });
    await tick();
    await press("Replace with Draft");
    expect(claude.runs).toHaveLength(1);
  });

  it("amend asks for the last commit with what is staged", async () => {
    void assist.draftCommitMessage(ROOT, { amend: true, message: "" });
    await tick();
    expect(calls.find((c) => c.cmd === "git_commit_diff")?.args).toEqual({ root: ROOT, scope: "amend" });
    expect(claude.runs[0].prompt).toContain("it replaces the last commit");
  });

  it("nothing to commit, a rebase and conflicts send nothing and say why", async () => {
    useGit.setState({ repos: { [KEY]: repo({ files: [] }) } });
    expect(await assist.draftCommitMessage(ROOT, { amend: false, message: "" })).toBe(false);
    useGit.setState({ repos: { [KEY]: repo({ operation: "rebase" }) } });
    expect(await assist.draftCommitMessage(ROOT, { amend: false, message: "" })).toBe(false);
    useGit.setState({ repos: { [KEY]: repo({ files: [gf("a.ts", { conflicted: true, index: "U", worktree: "U" })] }) } });
    expect(await assist.draftCommitMessage(ROOT, { amend: false, message: "" })).toBe(false);
    expect(toasts()).toEqual(["There is nothing to commit.", "A rebase keeps each commit's own message.", "Resolve the conflicts first."]);
    expect(calls.some((c) => c.cmd === "git_commit_diff")).toBe(false);
    expect(claude.runs).toHaveLength(0);
  });

  it("a large change is cut, and the note is in the question and under the box", async () => {
    setSettings({ claudeGitConfirm: true });
    const big = "x".repeat(20_000);
    answers.diff = { files: [df("a.ts"), { ...df("data/fixtures.json"), patch: big, size: 300_000 }, df("z.ts")], subjects: [] };
    void assist.draftCommitMessage(ROOT, { amend: false, message: "" });
    await tick();
    const note = "Large change: Claude saw only the start of 1 file (data\\fixtures.json).";
    expect(dialog()?.message).toContain(note);
    await press("Send");
    const prompt = claude.runs[0].prompt;
    expect(prompt).toContain("[The rest of this file's diff was left out: 280,000 more characters.]");
    expect(prompt).toContain("data/fixtures.json (+1 -0)");
    expect(prompt.length).toBeLessThan(125_000);
    claude.runs[0].answer(ok("Update fixtures"));
    await tick();
    expect(useGitAssist.getState().draftNote).toEqual({ root: ROOT, text: note });
    // Until the message changes hands.
    assist.clearDraftNote(ROOT);
    expect(useGitAssist.getState().draftNote).toBeNull();
  });

  it("warns about unsaved tabs of the repository, which Claude did not see", async () => {
    useStore.setState({ docs: [{ id: "d1", kind: "text", path: `${ROOT}\\a.ts`, name: "a.ts", dirty: true }, { id: "d2", kind: "text", path: `${ROOT}\\b.ts`, name: "b.ts", dirty: true }, { id: "d3", kind: "text", path: "C:\\else\\c.ts", name: "c.ts", dirty: true }] as never });
    void assist.draftCommitMessage(ROOT, { amend: false, message: "" });
    await tick();
    expect(toasts()).toContain("2 open files have unsaved changes that Claude did not see.");
  });
});

describe("one request at a time, Stop, time limit (GITAI-005)", () => {
  beforeEach(() => setSettings({ claudeGitConfirm: false }));

  it("a second request is refused while one runs", async () => {
    void assist.draftCommitMessage(ROOT, { amend: false, message: "" });
    await tick();
    expect(await assist.draftCommitMessage(ROOT, { amend: false, message: "" })).toBe(false);
    expect(await assist.summarise(ROOT, { from: "main", to: "x", title: "x", range: "main..x" })).toBe(false);
    expect(toasts().filter((t) => t === "Claude is busy with another git request. Stop it in the status bar.")).toHaveLength(2);
    expect(claude.runs).toHaveLength(1);
  });

  it("Stop ends the process at once, shows no error, and a late answer is ignored", async () => {
    void assist.draftCommitMessage(ROOT, { amend: false, message: "" });
    await tick();
    const id = useGitAssist.getState().assist!.id;
    expect(assist.cancelAssist()).toBe(true);
    expect(claude.cancelled).toEqual([id]);
    expect(useGitAssist.getState().assist).toBeNull();
    // The stopped request answers after all.
    claude.runs[0].answer(ok("Too late"));
    await tick();
    expect(useGitAssist.getState().draft).toBeNull();
    expect(toasts()).toEqual([]);
    expect(dialog()).toBeNull();
    expect(assist.cancelAssist()).toBe(false);
    // A new one may start, and the old answer does not end it either.
    void assist.draftCommitMessage(ROOT, { amend: false, message: "" });
    await tick();
    expect(useGitAssist.getState().assist?.id).not.toBe(id);
  });

  it("the time limit is reported and changes nothing", async () => {
    void assist.draftCommitMessage(ROOT, { amend: false, message: "" });
    await tick();
    claude.runs[0].answer({ stdout: "", stderr: "", code: null, timedOut: true, cancelled: false });
    await tick();
    expect(toasts()).toEqual(["Claude did not answer within 2 minutes. Nothing was changed."]);
    expect(useGitAssist.getState().draft).toBeNull();
    expect(useGitAssist.getState().assist).toBeNull();
  });

  it("switching the panel to another repository stops a draft", async () => {
    void assist.draftCommitMessage(ROOT, { amend: false, message: "" });
    await tick();
    useGit.setState({ current: "c:\\other" });
    expect(useGitAssist.getState().assist).toBeNull();
    expect(claude.cancelled).toHaveLength(1);
  });
});

describe("why Claude could not answer (GITAI-006)", () => {
  beforeEach(() => setSettings({ claudeGitConfirm: false }));

  it("Claude Code not found: the reason with Open Settings", async () => {
    void assist.draftCommitMessage(ROOT, { amend: false, message: "WIP" });
    await tick();
    await press("Replace with Draft");
    claude.runs[0].fail("Claude Code was not found. Install it, or set its location in Settings › Claude Code.");
    await tick();
    expect(dialog()?.title).toBe("Claude Code was not found");
    expect(dialog()?.message).toBe("Claude Code was not found. Install it, or set its location in Settings › Claude Code.");
    expect(dialog()?.actions.map((a) => a.label)).toEqual(["Open Settings", "Close"]);
    expect(useGitAssist.getState().assist).toBeNull();
    expect(useGitAssist.getState().draft).toBeNull();
  });

  it("not signed in: Open Claude Code Terminal", async () => {
    void assist.draftCommitMessage(ROOT, { amend: false, message: "" });
    await tick();
    claude.runs[0].answer({ stdout: JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login" }), stderr: "", code: 1, timedOut: false, cancelled: false });
    await tick();
    expect(dialog()?.message).toBe("Claude Code is not signed in. Open a Claude Code terminal, run /login, then try again.");
    expect(dialog()?.actions.map((a) => a.label)).toEqual(["Open Claude Code Terminal", "Close"]);
  });

  it("a refusal, a failed process and an empty answer are said plainly", async () => {
    const cases: [OneshotResult, string][] = [
      [{ stdout: JSON.stringify({ type: "result", is_error: true, result: "Usage limit reached" }), stderr: "", code: 1, timedOut: false, cancelled: false }, "Claude Code: Usage limit reached"],
      [{ stdout: "", stderr: "boom", code: 1, timedOut: false, cancelled: false }, "Claude Code stopped (exit code 1).\nboom"],
      [ok("   "), "Claude returned no text. Try again."],
      [ok("```\n```"), "Claude returned no text. Try again."],
    ];
    for (const [result, message] of cases) {
      useStore.setState({ toasts: [] });
      void assist.draftCommitMessage(ROOT, { amend: false, message: "" });
      await tick();
      claude.runs[claude.runs.length - 1].answer(result);
      await tick();
      expect(toasts()).toEqual([message]);
      expect(useGitAssist.getState().draft).toBeNull();
    }
  });
});

describe("summaries (GITAI-009)", () => {
  const commits = Array.from({ length: 12 }, (_, i) => ({ sha: `${i}`.padStart(40, "a"), short: `c${i}`.padEnd(7, "0"), author: "Ann", time: 1_700_000_000 + i * 3600, message: `Commit ${i}`, stat: "1 file changed" }));
  const range = { from: "main", to: "feature-x", title: "feature-x", range: "main..feature-x", branch: "feature-x", base: "main" };

  it("asks, runs with the longer time limit, and opens an untitled Markdown tab", async () => {
    answers.log = { count: 12, commits };
    answers.rangeDiff = Array.from({ length: 9 }, (_, i) => df(`f${i}.ts`));
    void assist.summarise(ROOT, range);
    await tick();
    expect(dialog()?.title).toBe("Send these commits to Claude?");
    expect(dialog()?.message).toContain("the messages, authors and dates of the 12 commits and the diff of the 9 files they changed");
    expect(claude.runs).toHaveLength(0);
    await press("Send");
    expect(useGitAssist.getState().assist).toMatchObject({ kind: "summary", label: "summarising 12 commits" });
    expect(claude.runs[0].timeoutSecs).toBe(300);
    expect(claude.runs[0].prompt).toContain("Commit 11");
    expect(claude.runs[0].prompt).toContain("diff --git a/f8.ts b/f8.ts");
    expect(calls.find((c) => c.cmd === "git_range_log")?.args).toEqual({ root: ROOT, from: "main", to: "feature-x", limit: 300 });
    expect(docsOpened).toEqual([]);
    claude.runs[0].answer(ok("This branch adds a tokenizer.\n\n## Parser\n- Splits on spaces"));
    await tick();
    expect(docsOpened).toHaveLength(1);
    expect(docsOpened[0].name).toBe("Summary of feature-x.md");
    expect(docsOpened[0].text.split("\n").slice(0, 5)).toEqual(["# Summary of feature-x", "", "12 commits, main..feature-x", "", "Written by Claude from the commit messages and diffs. Check it before relying on it."]);
    expect(docsOpened[0].text).toContain("## Parser\n- Splits on spaces");
  });

  it("nothing to summarise and too many commits send nothing", async () => {
    setSettings({ claudeGitConfirm: false });
    answers.log = { count: 0, commits: [] };
    expect(await assist.summarise(ROOT, range)).toBe(false);
    answers.log = { count: 1240, commits: [] };
    expect(await assist.summarise(ROOT, range)).toBe(false);
    expect(toasts()).toEqual(["feature-x has no commits that main does not have.", "This range has 1,240 commits. Claude summaries are limited to 300; pick a smaller range."]);
    expect(claude.runs).toHaveLength(0);
    expect(calls.some((c) => c.cmd === "git_range_diff")).toBe(false);
  });

  it("stopping or failing opens no tab; a cut diff is stated in the document", async () => {
    setSettings({ claudeGitConfirm: false });
    answers.log = { count: 12, commits };
    answers.rangeDiff = [df("a.ts"), { ...df("big.json"), patch: "y".repeat(20_000), size: 90_000 }];
    void assist.summarise(ROOT, range);
    await tick();
    assist.cancelAssist();
    claude.runs[0].answer(ok("late"));
    await tick();
    void assist.summarise(ROOT, range);
    await tick();
    claude.runs[1].answer({ stdout: "", stderr: "", code: null, timedOut: true, cancelled: false });
    await tick();
    expect(docsOpened).toEqual([]);
    expect(toasts()).toEqual(["Claude did not answer within 5 minutes."]);
    void assist.summarise(ROOT, range);
    await tick();
    claude.runs[2].answer(ok("Text."));
    await tick();
    expect(docsOpened[0].text).toContain("relying on it.\n\nClaude saw only the start of 1 file (big.json).\n\nText.");
  });

  it("Summarise Branch opens the one branch picker for the base, the picked row runs the same command", async () => {
    setSettings({ claudeGitConfirm: false });
    registerGitCommands();
    answers.defaultBranch = "origin/main";
    answers.branches = [{ name: "feature-x", remote: false, current: true, upstream: null, sha: "s", time: 0, summary: "" }, { name: "main", remote: false, current: false, upstream: null, sha: "s", time: 0, summary: "" }];
    useGit.setState({ repos: { [KEY]: repo({ branch: "feature-x" }) } });
    await runCommand("git.summariseBranch");
    await tick();
    expect(useStore.getState().palette).toBe("branch");
    expect(useGit.getState().branchPick).toBe("summarise-base");
    expect(getSummarisePick()).toEqual({ root: ROOT, branch: "feature-x", remoteDefault: "origin/main" });
    expect(claude.runs).toHaveLength(0);
    // The palette runs the purpose's command with the picked name.
    answers.log = { count: 12, commits };
    answers.rangeDiff = [df("a.ts")];
    await runCommand("git.summariseBranch", "main");
    await tick();
    expect(calls.find((c) => c.cmd === "git_range_log")?.args).toEqual({ root: ROOT, from: "main", to: "feature-x", limit: 300 });
    expect(claude.runs).toHaveLength(1);

    // A detached HEAD asks which branch first.
    assist.cancelAssist();
    useGit.setState({ repos: { [KEY]: repo({ branch: null }) } });
    await runCommand("git.summariseBranch");
    await tick();
    expect(useGit.getState().branchPick).toBe("summarise");
    await runCommand("git.summariseBranch", "feature-x");
    await tick();
    expect(useGit.getState().branchPick).toBe("summarise-base");
    expect(getSummarisePick().branch).toBe("feature-x");
  });
});

describe("explain a conflict (GITAI-007, GITAI-008)", () => {
  const filler = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `line ${from + i}`);
  // Conflict 1 at lines 3 to 7; conflict 2 at lines 120 to 126.
  const text = [...filler(1, 2), "<<<<<<< HEAD", "first mine", "=======", "first theirs", ">>>>>>> feature", ...filler(8, 119), "<<<<<<< HEAD", "const a = 1;", "SECOND-CURRENT", "=======", "const a = 2;", "SECOND-INCOMING", ">>>>>>> 18bc71d (Add tokenizer)", ...filler(127, 200)].join("\n");
  let view: EditorView;

  beforeEach(() => {
    view = new EditorView({ state: EditorState.create({ doc: text, extensions: conflictExtensions() }), parent: document.body });
    useStore.setState({ docs: [{ id: "d1", kind: "text", path: `${ROOT}\\src\\app.ts`, name: "app.ts", dirty: true, language: "TypeScript" }] as never, activeId: "d1" });
  });
  afterEach(() => view.destroy());

  const second = () => conflictsOf(view.state)[1];
  const panel = () => suggestionsOf(view.state);

  it("asks, sends only that conflict with 30 lines around it, and shows the result without changing the file", async () => {
    void assist.explainConflict(view, second());
    await tick();
    expect(dialog()?.title).toBe("Send this conflict to Claude?");
    expect(dialog()?.message).toContain('both sides of this conflict (lines 120 to 126), up to 30 lines above and below it, and the file name "src\\app.ts"');
    expect(panel()).toHaveLength(0);
    await press("Send");
    expect(panel()).toMatchObject([{ status: "working" }]);
    expect(useGitAssist.getState().assist).toMatchObject({ kind: "conflict", docId: "d1" });
    const prompt = claude.runs[0].prompt;
    expect(prompt).toContain("in the file src/app.ts (TypeScript)");
    expect(prompt).toContain("----- BEGIN CURRENT -----\nconst a = 1;\nSECOND-CURRENT\n----- END CURRENT -----");
    expect(prompt).toContain("----- BEGIN INCOMING -----\nconst a = 2;\nSECOND-INCOMING\n----- END INCOMING -----");
    // Lines 90 to 119 above and 127 to 156 below, and nothing else of the file.
    expect(prompt).toContain("line 90\n");
    expect(prompt).toContain("line 156\n");
    expect(prompt).not.toContain("line 89\n");
    expect(prompt).not.toContain("line 157");
    expect(prompt).not.toContain("first mine");
    // No operation is known: only the labels, no claim about whose work each side is.
    expect(prompt).toContain('Current (git labels it "HEAD") and Incoming (git labels it "18bc71d (Add tokenizer)")');
    expect(prompt).toContain("Nothing is known about whose work each side is");

    claude.runs[0].answer(ok("<explanation>Current kept 1, Incoming set 2.</explanation>\n<resolution>\nconst a = 2;\nMERGED\n</resolution>"));
    await tick();
    expect(panel()).toMatchObject([{ status: "done", explanation: "Current kept 1, Incoming set 2.", resolution: "const a = 2;\nMERGED", changed: false }]);
    expect(view.state.doc.toString()).toBe(text);

    // Applied only when asked: the whole block goes, the other conflict stays.
    expect(applySuggestion(view, second())).toBe(true);
    expect(view.state.doc.toString()).toContain("line 119\nconst a = 2;\nMERGED\nline 127");
    expect(conflictsOf(view.state)).toHaveLength(1);
    expect(panel()).toHaveLength(0);
  });

  it("tells Claude whose side is whose during a rebase", async () => {
    setSettings({ claudeGitConfirm: false });
    useGit.setState({ repos: { [KEY]: repo({ operation: "rebase", files: [gf("src\\app.ts", { conflicted: true, index: "U", worktree: "U" })] }) } });
    void assist.explainConflict(view, second());
    await tick();
    expect(claude.runs[0].prompt).toContain("is the branch being rebased onto");
    expect(claude.runs[0].prompt).toContain("is the user's own commit being replayed");
  });

  it("an edit inside the conflict while Claude is reading stops the request", async () => {
    setSettings({ claudeGitConfirm: false });
    void assist.explainConflict(view, second());
    await tick();
    const at = view.state.doc.line(second().start + 2).from;
    view.dispatch({ changes: { from: at, insert: "edited " } });
    await tick();
    expect(panel()).toMatchObject([{ status: "stale" }]);
    expect(claude.cancelled).toHaveLength(1);
    expect(useGitAssist.getState().assist).toBeNull();
    claude.runs[0].answer(ok("<explanation>old</explanation><resolution>\nold\n</resolution>"));
    await tick();
    expect(panel()).toMatchObject([{ status: "stale", resolution: null }]);
  });

  it("Stop removes the working panel; a failure shows in the panel; a proposal with markers is not offered", async () => {
    setSettings({ claudeGitConfirm: false });
    void assist.explainConflict(view, second());
    await tick();
    assist.cancelAssist();
    expect(panel()).toHaveLength(0);

    void assist.explainConflict(view, second());
    await tick();
    claude.runs[1].answer({ stdout: "", stderr: "", code: null, timedOut: true, cancelled: false });
    await tick();
    expect(panel()).toMatchObject([{ status: "error", error: "Claude did not answer within 2 minutes. Nothing was changed." }]);
    expect(toasts()).toEqual([]);

    void assist.explainConflict(view, second());
    await tick();
    claude.runs[2].answer(ok("<explanation>Both changed it.</explanation><resolution>\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> z\n</resolution>"));
    await tick();
    expect(panel()).toMatchObject([{ status: "done", resolution: null, note: "Claude's proposal still contained conflict markers, so it is not offered." }]);
    expect(view.state.doc.toString()).toBe(text);
  });

  it("a conflict too large to send is refused before the question", async () => {
    const huge = ["<<<<<<< HEAD", "x".repeat(61_000), "=======", "y", ">>>>>>> b"].join("\n");
    view.setState(EditorState.create({ doc: huge, extensions: conflictExtensions() }));
    expect(await assist.explainConflict(view, conflictsOf(view.state)[0])).toBe(false);
    expect(toasts()).toEqual(["This conflict is too large to send to Claude (limit 60,000 characters)."]);
    expect(dialog()).toBeNull();
    expect(claude.runs).toHaveLength(0);
  });

  it("closing the tab stops its request", async () => {
    setSettings({ claudeGitConfirm: false });
    void assist.explainConflict(view, second());
    await tick();
    useStore.setState({ docs: [], activeId: null });
    expect(useGitAssist.getState().assist).toBeNull();
    expect(claude.cancelled).toHaveLength(1);
  });
});

describe("exists only while Claude Code is switched on (GITAI-001)", () => {
  const ids = ["git.draftMessage", "git.explainConflict", "git.summariseBranch", "git.stopClaude"];
  const listed = () => allCommands().map((c) => c.id).filter((id) => ids.includes(id));

  it("the commands are in the palette while on, by context, and gone while off", async () => {
    registerGitCommands();
    expect(listed()).toEqual(["git.draftMessage", "git.summariseBranch"]);
    expect(allCommands().find((c) => c.id === "git.draftMessage")?.title).toBe("Draft Commit Message with Claude");
    expect(getCommand("git.explainConflict")?.title).toBe("Explain Conflict at Cursor with Claude");
    expect(getCommand("git.summariseBranch")?.title).toBe("Summarise Branch with Claude…");
    expect(getCommand("git.stopClaude")?.title).toBe("Stop Claude Request");
    // Stop is offered only while a request runs.
    setSettings({ claudeGitConfirm: false });
    void assist.draftCommitMessage(ROOT, { amend: false, message: "" });
    await tick();
    expect(listed()).toContain("git.stopClaude");
    await runCommand("git.stopClaude");
    expect(useGitAssist.getState().assist).toBeNull();
    expect(listed()).not.toContain("git.stopClaude");
    // No repository: the two repository commands are unavailable.
    useGit.setState({ repos: {}, current: null });
    expect(listed()).toEqual([]);
    useGit.setState({ repos: { [KEY]: repo() }, current: KEY });

    setSettings({ claudeEnabled: false });
    expect(listed()).toEqual([]);
    expect(allCommands().some((c) => /with Claude|Stop Claude Request/.test(c.title))).toBe(false);
    setSettings({ claudeEnabled: true });
    expect(listed()).toEqual(["git.draftMessage", "git.summariseBranch"]);
  });

  it("the palette command opens Source Control and asks the commit box to draft, or says why not", async () => {
    registerGitCommands();
    await runCommand("git.draftMessage");
    expect(useGitAssist.getState().draftAsked).toBe(true);
    expect(useStore.getState().sidebarPanel).toBe("git");
    useGitAssist.setState({ draftAsked: false });
    useGit.setState({ repos: { [KEY]: repo({ files: [] }) } });
    await runCommand("git.draftMessage");
    expect(useGitAssist.getState().draftAsked).toBe(false);
    expect(toasts()).toEqual(["There is nothing to commit."]);
  });

  it("switching it off stops the running request and removes open suggestions without touching the file", async () => {
    setSettings({ claudeGitConfirm: false });
    void assist.draftCommitMessage(ROOT, { amend: false, message: "" });
    await tick();
    setSettings({ claudeEnabled: false });
    expect(useGitAssist.getState().assist).toBeNull();
    expect(claude.cancelled).toHaveLength(1);
    claude.runs[0].answer(ok("late"));
    await tick();
    expect(useGitAssist.getState().draft).toBeNull();
    // And nothing starts while it is off.
    expect(await assist.draftCommitMessage(ROOT, { amend: false, message: "" })).toBe(false);
    expect(await assist.summarise(ROOT, { from: "a", to: "b", title: "b", range: "a..b" })).toBe(false);
    expect(claude.runs).toHaveLength(1);
  });
});
