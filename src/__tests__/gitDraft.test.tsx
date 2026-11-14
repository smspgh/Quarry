import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitFile, GitStatus } from "../lib/gitApi";
import type { OneshotResult } from "../lib/gitAi";

// The commit box's Draft button and the status-bar item, rendered with a fake Claude Code
// (specs/git-claude.md, GITAI-001 / 003 / 004 / 005).
const spy = vi.hoisted(() => ({ runCommand: vi.fn() }));
const calls = vi.hoisted(() => [] as { cmd: string; args: Record<string, unknown> }[]);
const answers = vi.hoisted(() => ({ status: undefined as unknown, diff: { files: [] as unknown[], subjects: [] as string[] } }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args });
    if (cmd === "git_status") return answers.status;
    if (cmd === "git_commit_diff") return answers.diff;
    if (cmd === "git_log" || cmd === "git_unpushed" || cmd === "git_stash_list") return [];
    if (cmd === "git_available") return "git version 2.53.0";
    return undefined;
  },
}));
vi.mock("../lib/commands", async (orig) => ({ ...(await orig<typeof import("../lib/commands")>()), runCommand: spy.runCommand }));

const { render, cleanup, flush, fire, act } = await import("./helpers/render");
const { GitPanel } = await import("../components/panels/GitPanel");
const { GitAssistStatusItem } = await import("../components/GitAssistStatus");
const { useGit } = await import("../lib/git");
const { useStore } = await import("../lib/store");
const assist = await import("../lib/gitAssist");
const { useGitAssist } = assist;
const { DEFAULT_SETTINGS } = await import("../lib/types");

const ROOT = "C:\\work\\proj";
const KEY = ROOT.toLowerCase();
const gf = (name: string, extra: Partial<GitFile> = {}): GitFile => ({ path: `${ROOT}\\${name}`, origPath: null, index: "M", worktree: ".", conflicted: false, untracked: false, ...extra });
const repo = (extra: Partial<GitStatus> = {}): GitStatus => ({ root: ROOT, branch: "main", head: "9f2c0aa", upstream: "origin/main", upstreamGone: false, ahead: 0, behind: 0, files: [gf("a.ts"), gf("b.ts"), gf("c.ts")], operation: null, operationMessage: null, operationStep: null, remotes: [{ name: "origin", url: "C:\\remotes\\proj.git" }], ...extra });
const patch = (rel: string) => ({ rel, added: 1, removed: 0, binary: false, untracked: false, patch: `diff --git a/${rel} b/${rel}\n+x\n`, size: 30 });
const ok = (result: string): OneshotResult => ({ stdout: JSON.stringify({ type: "result", subtype: "success", is_error: false, result }), stderr: "", code: 0, timedOut: false, cancelled: false });

const runs: { answer: (r: OneshotResult) => void }[] = [];
const cancelled: number[] = [];

const draftButton = () => document.querySelector<HTMLButtonElement>("button.scm-draft");
const box = () => document.querySelector<HTMLTextAreaElement>("textarea.scm-message")!;
const commitButton = () => document.querySelector<HTMLButtonElement>(".scm-commit .btn-primary, button.btn-primary.grow")!;
const dialog = () => useStore.getState().dialog;

async function type(text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box(), text);
    box().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function show(status: GitStatus) {
  answers.status = status;
  useGit.setState({ available: true, repos: { [KEY]: status }, current: KEY, busy: null, rewrotePushed: {}, remoteCheck: { [KEY]: { at: Date.now(), checking: false, error: null } }, history: null });
  await render(<GitPanel />);
  await flush();
}

describe("Source Control: Draft a commit message with Claude", () => {
  beforeEach(() => {
    calls.length = 0;
    runs.length = 0;
    cancelled.length = 0;
    spy.runCommand.mockClear();
    answers.diff = { files: [patch("a.ts"), patch("b.ts"), patch("c.ts")], subjects: ["Fix tab order"] };
    useStore.setState({ folder: ROOT, docs: [], dialog: null, toasts: [], settings: { ...DEFAULT_SETTINGS, claudeGitConfirm: false } });
    useGitAssist.setState({ assist: null, draft: null, draftNote: null, draftAsked: false });
    assist.setAssistBackend({ run: () => new Promise<OneshotResult>((answer) => runs.push({ answer })), cancel: (id) => void cancelled.push(id) });
  });
  afterEach(async () => {
    for (let i = 0; i < 4 && dialog(); i++) await act(async () => (dialog()!.actions.find((a) => a.cancel) ?? dialog()!.actions[0]).run());
    assist.cancelAssist();
    assist.setAssistBackend(null);
    await cleanup();
  });

  it("sits beside the Commit button and says what it sends", async () => {
    await show(repo());
    expect(draftButton()?.textContent).toContain("Draft");
    expect(draftButton()!.disabled).toBe(false);
    expect(draftButton()!.title).toBe("Draft a commit message with Claude from the 3 staged files. Their diff is sent to Claude through your Claude Code account.");
    expect(draftButton()!.parentElement).toBe(commitButton().parentElement);
  });

  it("is not there while Claude Code is switched off", async () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, claudeEnabled: false } });
    await show(repo());
    expect(draftButton()).toBeNull();
    expect(document.body.textContent).not.toContain("Draft");
  });

  it("is disabled with the reason: nothing to commit, a rebase, conflicts", async () => {
    await show(repo({ files: [] }));
    expect(draftButton()!.disabled).toBe(true);
    expect(draftButton()!.title).toBe("There is nothing to commit.");
    await cleanup();
    await show(repo({ operation: "rebase", operationStep: [2, 5] }));
    expect(draftButton()!.disabled).toBe(true);
    expect(draftButton()!.title).toBe("A rebase keeps each commit's own message.");
    await cleanup();
    await show(repo({ files: [gf("a.ts", { conflicted: true, index: "U", worktree: "U" })] }));
    expect(draftButton()!.title).toBe("Resolve the conflicts first.");
  });

  it("nothing staged: the tooltip counts every changed file and the untracked ones", async () => {
    await show(repo({ files: [gf("a.ts", { index: ".", worktree: "M" }), gf("b.ts", { index: ".", worktree: "M" }), gf("new.txt", { index: "?", worktree: "?", untracked: true })] }));
    expect(draftButton()!.title).toBe("Draft a commit message with Claude from all 3 changed files, 1 of them untracked (nothing is staged). Their diff is sent to Claude through your Claude Code account.");
  });

  it("while drafting the box is read-only and says so, Commit is off, and the draft lands in the box", async () => {
    await show(repo());
    await fire.click(draftButton()!);
    await flush();
    expect(runs).toHaveLength(1);
    expect(box().placeholder).toBe("Claude is drafting a message…");
    expect(box().value).toBe("");
    expect(box().readOnly).toBe(true);
    expect(draftButton()!.title).toBe("Stop drafting");
    expect(draftButton()!.querySelector(".spin")).not.toBeNull();
    expect(commitButton().disabled).toBe(true);
    // Typing meanwhile enters nothing.
    await type("typed meanwhile");
    expect(box().value).toBe("");

    await act(async () => runs[0].answer(ok("Fix tab order in the palette\n\nThe list skipped hidden rows.")));
    await flush();
    expect(box().value).toBe("Fix tab order in the palette\n\nThe list skipped hidden rows.");
    expect(box().readOnly).toBe(false);
    expect(draftButton()!.querySelector(".spin")).toBeNull();
    expect(commitButton().disabled).toBe(false);
    // Nothing was committed or staged by drafting.
    expect(calls.map((c) => c.cmd).filter((c) => c === "git_commit" || c === "git_stage" || c === "git_unstage")).toEqual([]);
    // The draft is ordinary text.
    await type("Fix tab order");
    expect(box().value).toBe("Fix tab order");
  });

  it("my message is asked about, and survives a stopped draft", async () => {
    await show(repo());
    await type("WIP parser");
    await fire.click(draftButton()!);
    await flush();
    expect(dialog()?.title).toBe("Replace your message?");
    expect(runs).toHaveLength(0);
    await act(async () => dialog()!.actions.find((a) => a.label === "Replace with Draft")!.run());
    await flush();
    expect(runs).toHaveLength(1);
    expect(box().value).toBe("");
    // The button is Stop now.
    await fire.click(draftButton()!);
    await flush();
    expect(cancelled).toHaveLength(1);
    expect(box().value).toBe("WIP parser");
    expect(box().readOnly).toBe(false);
    expect(useStore.getState().toasts).toEqual([]);
    // The stopped request answers late: nothing is put in the box.
    await act(async () => runs[0].answer(ok("Too late")));
    await flush();
    expect(box().value).toBe("WIP parser");
  });

  it("Escape in the message box stops the draft", async () => {
    await show(repo());
    await fire.click(draftButton()!);
    await flush();
    await fire.keyDown(box(), "Escape");
    expect(cancelled).toHaveLength(1);
    expect(useGitAssist.getState().assist).toBeNull();
    expect(box().readOnly).toBe(false);
  });

  it("the command's request is picked up by the box, also when the panel opens after it", async () => {
    assist.askForDraft();
    await show(repo());
    await flush();
    expect(useGitAssist.getState().draftAsked).toBe(false);
    expect(runs).toHaveLength(1);
    expect(box().placeholder).toBe("Claude is drafting a message…");
  });

  it("a draft that arrived while the panel was closed is in the box when it opens, with its Large change line", async () => {
    useGitAssist.setState({ draft: { root: ROOT, text: "Drafted elsewhere" }, draftNote: { root: ROOT, text: "Large change: Claude saw only the start of 1 file (data\\fixtures.json)." } });
    await show(repo());
    await flush();
    expect(box().value).toBe("Drafted elsewhere");
    expect(document.querySelector(".scm-draft-note")?.textContent).toBe("Large change: Claude saw only the start of 1 file (data\\fixtures.json).");
    // Clearing the box drops the line.
    await type("");
    expect(document.querySelector(".scm-draft-note")).toBeNull();
  });

  it("another request running: disabled with the busy reason", async () => {
    useGitAssist.setState({ assist: { id: 99, kind: "summary", label: "summarising 12 commits", startedAt: Date.now(), root: ROOT, docId: null } });
    await show(repo());
    expect(draftButton()!.disabled).toBe(true);
    expect(draftButton()!.title).toBe("Claude is busy with another git request. Stop it in the status bar.");
    useGitAssist.setState({ assist: null });
  });
});

describe("status bar: the running Claude git request", () => {
  afterEach(cleanup);

  it("shows what is running with the seconds, and a stop button", async () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS } });
    useGitAssist.setState({ assist: null });
    await render(<GitAssistStatusItem />);
    expect(document.querySelector(".git-assist")).toBeNull();
    await act(async () => useGitAssist.setState({ assist: { id: 1, kind: "draft", label: "drafting a commit message", startedAt: Date.now() - 12_300, root: ROOT, docId: null } }));
    const item = document.querySelector<HTMLElement>(".git-assist")!;
    expect(item.textContent).toBe(" Claude: drafting a commit message… 12s");
    const stop = item.querySelector<HTMLButtonElement>("button")!;
    expect(stop.title).toBe("Stop Claude Request");
    await fire.click(stop);
    expect(spy.runCommand).toHaveBeenCalledWith("git.stopClaude");
    await act(async () => useGitAssist.setState({ assist: null }));
    expect(document.querySelector(".git-assist")).toBeNull();
  });
});
