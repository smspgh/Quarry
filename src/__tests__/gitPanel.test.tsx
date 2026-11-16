import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitStatus } from "../lib/gitApi";

// The Source Control panel rendered from state put straight into useGit, with the Tauri side
// replaced: the "Merge or Rebase" button (MERGE-003) and the status line after pushed commits were
// rewritten (MERGE-009). Commands started from the panel are spies.
const spy = vi.hoisted(() => ({ runCommand: vi.fn() }));
const calls = vi.hoisted(() => [] as { cmd: string; args: Record<string, unknown> }[]);
const answers = vi.hoisted(() => ({ status: undefined as unknown }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args });
    if (cmd === "git_status") return answers.status;
    if (cmd === "git_log" || cmd === "git_unpushed") return [];
    if (cmd === "git_available") return "git version 2.53.0";
    if (cmd === "git_force_push_preview") return { branch: "main", upstream: "origin/main", lost: 3, commits: [{ sha: "a".repeat(40), short: "aaaaaaa", summary: "Old commit" }] };
    return undefined;
  },
}));
vi.mock("../lib/commands", async (orig) => ({ ...(await orig<typeof import("../lib/commands")>()), runCommand: spy.runCommand }));

const { render, cleanup, flush, fire, act } = await import("./helpers/render");
const { GitPanel } = await import("../components/panels/GitPanel");
const { useGit } = await import("../lib/git");
const { useStore } = await import("../lib/store");

const ROOT = "C:\\work\\proj";
const KEY = ROOT.toLowerCase();
const repo = (extra: Partial<GitStatus> = {}): GitStatus => ({ root: ROOT, branch: "main", head: "9f2c0aa", upstream: "origin/main", upstreamGone: false, ahead: 0, behind: 0, files: [], operation: null, operationMessage: null, operationStep: null, remotes: [{ name: "origin", url: "C:\\remotes\\proj.git" }], ...extra });

const mergeButton = () => document.querySelector<HTMLButtonElement>('button[aria-label="Merge or Rebase"]')!;
const menuItems = () => [...document.querySelectorAll<HTMLButtonElement>(".scm-merge-menu [role=menuitem]")];
const sync = () => document.querySelector<HTMLElement>(".scm-sync")!;
const syncButtons = () => [...sync().querySelectorAll<HTMLButtonElement>("button.btn")].map((b) => b.textContent?.trim());

async function show(status: GitStatus, extra: Partial<ReturnType<typeof useGit.getState>> = {}) {
  answers.status = status;
  // The remote was checked just now, so the panel does not start a background check of its own.
  useGit.setState({ available: true, repos: { [KEY]: status }, current: KEY, busy: null, rewrotePushed: {}, remoteCheck: { [KEY]: { at: Date.now(), checking: false, error: null } }, history: null, ...extra });
  await render(<GitPanel />);
  await flush();
}

describe("Source Control panel: Merge or Rebase", () => {
  beforeEach(() => {
    calls.length = 0;
    spy.runCommand.mockClear();
    useStore.setState({ folder: ROOT, docs: [], dialog: null, toasts: [] });
  });
  afterEach(async () => {
    useStore.getState().dialog?.actions.find((a) => a.cancel)?.run();
    await cleanup();
  });

  it("sits right after the branch button and offers the two commands", async () => {
    await show(repo());
    const row = document.querySelector(".scm-branch")!;
    expect([...row.children].indexOf(mergeButton())).toBe(1); // the branch button is first
    expect(mergeButton().disabled).toBe(false);
    expect(menuItems()).toHaveLength(0);
    await fire.click(mergeButton());
    expect(menuItems().map((b) => b.textContent)).toEqual(["Merge Branch…", "Rebase onto Branch…"]);
    await fire.click(menuItems()[0]);
    expect(spy.runCommand).toHaveBeenCalledWith("git.mergeBranch");
    expect(menuItems()).toHaveLength(0);
    await fire.click(mergeButton());
    await fire.click(menuItems()[1]);
    expect(spy.runCommand).toHaveBeenLastCalledWith("git.rebaseBranch");
  });

  it("its menu closes on Escape without starting anything", async () => {
    await show(repo());
    await fire.click(mergeButton());
    expect(menuItems()).toHaveLength(2);
    await fire.keyDown(window, "Escape");
    expect(menuItems()).toHaveLength(0);
    expect(spy.runCommand).not.toHaveBeenCalled();
  });

  it("is disabled with the reason while an operation is stopped, before the operation badge", async () => {
    await show(repo({ operation: "merge", files: [{ path: `${ROOT}\\notes.txt`, origPath: null, index: "U", worktree: "U", conflicted: true, untracked: false }] }));
    expect(mergeButton().disabled).toBe(true);
    expect(mergeButton().title).toBe("Finish or abort the merge first");
    const row = [...document.querySelector(".scm-branch")!.children];
    expect(row.indexOf(mergeButton())).toBeLessThan(row.indexOf(document.querySelector(".scm-op")!));
  });

  // Seen live: `.btn:disabled { pointer-events: none }` made WebView2 show no tooltip on the disabled
  // button, so the reason was never seen. Disabled buttons keep pointer events everywhere (open issue 2)
  // and the hover highlight skips them.
  it("the disabled button's tooltip is reachable: no disabled button switches pointer events off", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/styles/app.css", "utf8");
    for (const sel of ["\\.btn", "\\.icon-btn", "\\.diff-toolbar \\.icon-btn", "\\.claude-input-foot \\.icon-btn"]) {
      const rule = new RegExp(`(^|\\n)${sel}:disabled\\s*\\{([^}]*)\\}`).exec(css);
      expect(rule, sel).not.toBeNull();
      expect(rule![2]).not.toMatch(/pointer-events:\s*none/);
    }
    expect(css).toMatch(/\.btn:hover:not\(:disabled\)/);
    expect(css).toMatch(/\.icon-btn:hover:not\(:disabled\)/);
  });

  it("is disabled while another git action is running", async () => {
    await show(repo(), { busy: "Pulling…" });
    expect(mergeButton().disabled).toBe(true);
    expect(mergeButton().title).toBe("Another git action is running");
  });

  it("on a detached HEAD only the rebase entry is greyed out", async () => {
    await show(repo({ branch: null, upstream: null }));
    expect(mergeButton().disabled).toBe(false);
    await fire.click(mergeButton());
    expect(menuItems().map((b) => [b.textContent, b.disabled, b.title.startsWith("Switch to a branch first")])).toEqual([["Merge Branch…", false, false], ["Rebase onto Branch…", true, true]]);
  });
});

describe("Source Control panel: status line after a rewrite", () => {
  beforeEach(() => {
    calls.length = 0;
    useStore.setState({ folder: ROOT, docs: [], dialog: null, toasts: [] });
  });
  afterEach(async () => {
    useStore.getState().dialog?.actions.find((a) => a.cancel)?.run();
    await cleanup();
  });

  it("offers Force Push instead of the pulls, and Force Push asks before anything is sent", async () => {
    await show(repo({ ahead: 5, behind: 3 }), { rewrotePushed: { [KEY]: "main" } });
    expect(sync().className).toContain("warn");
    expect(sync().textContent).toContain("main was rewritten: origin/main still has the 3 old commits. Force Push replaces them with yours.");
    expect(sync().textContent).not.toContain("Pull first");
    expect(syncButtons()).toEqual(["Force Push…"]);
    await fire.click(sync().querySelector<HTMLButtonElement>("button.btn")!);
    await flush();
    const dialog = useStore.getState().dialog;
    expect(dialog?.title).toBe("Replace origin/main with your main?");
    expect(dialog?.actions.map((a) => [a.label, a.kind, !!a.default])).toEqual([["Force Push", "danger", false], ["Cancel", undefined, true]]);
    expect(calls.some((c) => c.cmd === "git_remote" && c.args.op === "push-force")).toBe(false);
    // Cancelled: still offered.
    await act(async () => dialog!.actions.find((a) => a.cancel)!.run());
    await flush();
    expect(calls.some((c) => c.cmd === "git_remote" && c.args.op === "push-force")).toBe(false);
    expect(syncButtons()).toEqual(["Force Push…"]);
  });

  it("a branch that differs from its remote for another reason gets the ordinary line", async () => {
    await show(repo({ ahead: 2, behind: 1 }));
    expect(sync().textContent).toContain("Diverged from origin/main: 2 commits to push, 1 to pull. Pull first, then push.");
    expect(syncButtons()).toEqual(["Pull (Merge)", "Pull (Rebase)"]);
  });

  it("a mark for another branch, or with nothing left on the remote to replace, does not count", async () => {
    await show(repo({ branch: "feature", upstream: "origin/feature", ahead: 2, behind: 1 }), { rewrotePushed: { [KEY]: "main" } });
    expect(syncButtons()).toEqual(["Pull (Merge)", "Pull (Rebase)"]);
    expect(useGit.getState().rewrotePushed).toEqual({});
    await cleanup();
    await show(repo({ ahead: 5, behind: 0 }), { rewrotePushed: { [KEY]: "main" } });
    expect(sync().textContent).toContain("5 commits to push to origin/main.");
    expect(syncButtons()).toEqual(["Push"]);
  });
});

// Seen live: after Abort Merge the box still held "Merge branch 'clash'", and it was still there
// when another repository was opened, ready to be used for an unrelated commit.
describe("Source Control panel: the message git prepared for a stopped merge", () => {
  const box = () => document.querySelector<HTMLTextAreaElement>("textarea.scm-message")!;
  const merging = () => repo({ operation: "merge", operationMessage: "Merge branch 'clash'", files: [{ path: `${ROOT}\notes.txt`, origPath: null, index: "U", worktree: "U", conflicted: true, untracked: false }] });
  const setStatus = async (status: GitStatus) => {
    answers.status = status;
    await act(async () => useGit.setState({ repos: { [KEY]: status } }));
    await flush();
  };
  const type = (text: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box(), text);
      box().dispatchEvent(new Event("input", { bubbles: true }));
    });

  beforeEach(() => {
    useStore.setState({ folder: ROOT, docs: [], dialog: null, toasts: [] });
  });
  afterEach(cleanup);

  it("is offered in the empty box and goes again when the merge ends without a commit", async () => {
    await show(merging());
    expect(box().value).toBe("Merge branch 'clash'");
    await setStatus(repo()); // Abort: no operation any more
    expect(box().value).toBe("");
  });

  it("stays when it was edited", async () => {
    await show(merging());
    await type("Merge branch 'clash' (kept both lines)");
    await setStatus(repo());
    expect(box().value).toBe("Merge branch 'clash' (kept both lines)");
  });

  it("each repository keeps its own message: typed text never shows in another repository's box", async () => {
    const OTHER = "C:\\work\\other";
    const other = { ...repo(), root: OTHER };
    await show(repo());
    await type("for proj only");
    // Another folder is opened (a refresh then shows its repository).
    answers.status = other;
    await act(async () => {
      useStore.setState({ folder: OTHER });
      useGit.setState({ repos: { [KEY]: repo(), [OTHER.toLowerCase()]: other }, current: OTHER.toLowerCase() });
    });
    await flush();
    expect(useGit.getState().current).toBe(OTHER.toLowerCase());
    expect(box().value).toBe("");
    answers.status = repo();
    await act(async () => {
      useStore.setState({ folder: ROOT });
      useGit.setState({ repos: { [KEY]: repo(), [OTHER.toLowerCase()]: other }, current: KEY });
    });
    await flush();
    expect(box().value).toBe("for proj only");
  });

  it("a message typed before the merge is never replaced or cleared", async () => {
    await show(repo());
    await type("my own message");
    await setStatus(merging());
    expect(box().value).toBe("my own message");
    await setStatus(repo());
    expect(box().value).toBe("my own message");
  });

  // Seen live: "Current" on a file the other branch deleted leaves the tree as it was. The panel then
  // said "Abort to end it." with the button off, so the merge could not be finished in Quarry.
  it("a merge that changes no file can still be committed", async () => {
    calls.length = 0;
    await show(repo({ operation: "merge", operationMessage: "Merge branch 'feature'" }));
    const button = document.querySelector<HTMLButtonElement>(".scm-top .btn-primary.grow")!;
    expect(button.textContent).toBe("Commit Merge");
    expect(button.disabled).toBe(false);
    expect(document.querySelector(".panel-note")!.textContent).toBe("The merge changes none of your files: what it brings is already on the branch. Commit to record the merge, or Abort.");
    await fire.click(button);
    await flush();
    expect(useStore.getState().dialog).toBeNull(); // no "Nothing is staged" question
    expect(calls.find((c) => c.cmd === "git_commit")?.args).toMatchObject({ message: "Merge branch 'feature'" });
  });

  it("a cherry-pick with nothing left still points at Skip, and cannot be committed", async () => {
    await show(repo({ operation: "cherry-pick", operationMessage: "Add the parser" }));
    expect(document.querySelector<HTMLButtonElement>(".scm-top .btn-primary.grow")!.disabled).toBe(true);
    expect(document.querySelector(".panel-note")!.textContent).toBe("Nothing is left to commit for this cherry-pick: its changes are already on the branch. Press Skip to move on, or Abort.");
  });
});
