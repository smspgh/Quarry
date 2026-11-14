import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitCommitFile, GitFile, GitStash, GitStatus } from "../lib/gitApi";

// The Stashes section of the Source Control panel in jsdom, with the Tauri side replaced.
const calls = vi.hoisted(() => [] as { cmd: string; args: Record<string, unknown> }[]);
const answers = vi.hoisted(() => ({ status: null as unknown, list: [] as unknown[], files: [] as unknown[], push: "ok" as "ok" | "fail", op: "ok" as string, exists: true }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args });
    if (cmd === "git_available") return "git version 2.53.0";
    if (cmd === "git_status") return answers.status;
    if (cmd === "git_stash_list") return answers.list;
    if (cmd === "git_stash_files") return answers.files;
    if (cmd === "git_stash_push") {
      if (answers.push === "fail") throw "error: could not write index\nhint: try again";
      return "f".repeat(40);
    }
    if (cmd === "git_stash_op") return answers.op;
    if (cmd === "git_show") return { text: `${args.rev}:${args.rel}`, binary: String(args.rel).endsWith(".png"), encoding: "UTF-8" };
    if (cmd === "fs_exists") return answers.exists;
    return undefined;
  },
}));

const { render, cleanup, flush, fire, byText, act } = await import("./helpers/render");
const { StashesSection } = await import("../components/panels/StashSection");
const { useGit, showStashes } = await import("../lib/git");
const { useStore } = await import("../lib/store");
const { useDiff } = await import("../lib/diff");
const { dismissDialog } = await import("../lib/dialogs");

const ROOT = "C:\\work\\proj";
const KEY = ROOT.toLowerCase();
const sha = (c: string) => c.repeat(40);
const file = (name: string, extra: Partial<GitFile> = {}): GitFile => ({ path: `${ROOT}\\${name}`, origPath: null, index: ".", worktree: "M", conflicted: false, untracked: false, ...extra });
const untracked = (name: string) => file(name, { index: "?", worktree: "?", untracked: true });
const status = (extra: Partial<GitStatus> = {}): GitStatus => ({ root: ROOT, branch: "main", head: "1a2b3c4", upstream: null, upstreamGone: false, ahead: 0, behind: 0, files: [], operation: null, operationMessage: null, operationStep: null, remotes: [], stash: null, stashCount: 0, ...extra });
const hoursAgo = (h: number) => Math.floor(Date.now() / 1000) - h * 3600;
const stash = (c: string, subject: string, time: number, extra: Partial<GitStash> = {}): GitStash => ({ sha: sha(c), short: c.repeat(7), base: sha("b"), author: "Ada", email: "ada@example.com", time, subject, untracked: false, ...extra });
const THREE = [stash("a", "On main: WIP parser", hoursAgo(2)), stash("c", "On feature: try new layout", hoursAgo(26)), stash("d", "WIP on main: 1a2b3c4 Fix tab order", hoursAgo(50))];
const held = (rel: string, st: string): GitCommitFile => ({ path: `${ROOT}\\${rel.replace(/\//g, "\\")}`, rel, status: st, origRel: null });

const section = () => document.querySelector<HTMLElement>('[aria-label="Stashes"]');
const newButton = () => document.querySelector<HTMLButtonElement>(".scm-stash-new")!;
const form = () => document.querySelector<HTMLElement>(".scm-stash-form");
const input = () => form()!.querySelector<HTMLInputElement>("input.input")!;
const box = () => form()!.querySelector<HTMLInputElement>("input[type=checkbox]");
const formButton = (label: string) => byText(form()!, "button", label)[0] as HTMLButtonElement;
const rows = () => [...document.querySelectorAll<HTMLElement>(".scm-stash")];
const rowButton = (row: HTMLElement, label: string) => byText(row, "button", label)[0] as HTMLButtonElement;
const stashFiles = () => [...document.querySelectorAll<HTMLElement>(".scm-commit-file")];
const toasts = () => useStore.getState().toasts.map((t) => t.message);
const called = (cmd: string) => calls.filter((c) => c.cmd === cmd);
const type = (el: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

async function show(repo: GitStatus, list: GitStash[] | undefined = []) {
  answers.status = repo;
  answers.list = list ?? [];
  useGit.setState({ available: true, current: KEY, repos: { [KEY]: repo }, stashes: list ? { [KEY]: list } : {} });
  const m = await render(<StashesSection repo={repo} />);
  await flush();
  return m;
}

describe("Stashes section", () => {
  beforeEach(() => {
    for (let i = 0; i < 5; i++) dismissDialog();
    calls.length = 0;
    Object.assign(answers, { status: null, list: [], files: [], push: "ok", op: "ok", exists: true });
    useStore.setState({ folder: ROOT, docs: [], toasts: [], dialog: null });
    useGit.setState({ busy: null, stashForm: false, stashPending: null, stashes: {} });
  });
  afterEach(cleanup);

  it("is not there before the first commit", async () => {
    await show(status({ head: null, files: [untracked("a.ts")] }));
    expect(section()).toBeNull();
  });

  it("says so when there are no stashes, with no count", async () => {
    await show(status({ files: [file("app.ts")] }));
    expect(section()?.querySelector(".panel-note")?.textContent).toBe("No stashes. Stash Changes puts your uncommitted work aside to bring back later.");
    expect(section()?.querySelector(".scm-count")).toBeNull();
    expect(newButton().disabled).toBe(false);
  });

  it("lists the stashes newest first, with the count, the branch and the age", async () => {
    await show(status(), THREE);
    expect(section()?.querySelector(".scm-count")?.textContent).toBe("3");
    expect(rows().map((r) => r.querySelector(".truncate")?.textContent)).toEqual(["WIP parser", "try new layout", "WIP at 1a2b3c4 Fix tab order"]);
    expect(rows()[0].querySelector(".scm-commit-meta")?.textContent).toBe("main · 2 hours ago");
    expect(rows()[1].querySelector(".scm-commit-meta")?.textContent).toContain("feature · ");
    expect(rows()[0].title).toContain("WIP parser");
    expect(rows()[0].title).toContain("on main");
    expect(rows()[0].title).toContain(`On commit ${"b".repeat(7)}`);
    expect(["Apply", "Pop", "Drop"].map((l) => !!rowButton(rows()[0], l))).toEqual([true, true, true]);
  });

  it("follows the repository it is given", async () => {
    const m = await show(status(), THREE);
    const tools = status({ root: "C:\\work\\tools" });
    useGit.setState((g) => ({ repos: { ...g.repos, "c:\\work\\tools": tools }, stashes: { ...g.stashes, "c:\\work\\tools": [] } }));
    await m.rerender(<StashesSection repo={tools} />);
    expect(rows()).toHaveLength(0);
    expect(section()?.querySelector(".panel-note")?.textContent).toContain("No stashes.");
  });

  it("collapses and opens on its heading", async () => {
    await show(status(), THREE);
    await fire.click(section()!.querySelector(".scm-section-head")!);
    expect(rows()).toHaveLength(0);
    await fire.click(section()!.querySelector(".scm-section-head")!);
    expect(rows()).toHaveLength(3);
  });

  it("disables Stash Changes with the reason as its tooltip", async () => {
    const m = await show(status());
    expect(newButton().disabled).toBe(true);
    expect(newButton().title).toBe("There are no uncommitted changes to stash");
    await m.rerender(<StashesSection repo={status({ operation: "rebase", files: [file("a.ts", { conflicted: true })] })} />);
    expect(newButton().title).toBe("Finish or abort the rebase first");
    await m.rerender(<StashesSection repo={status({ files: [file("a.ts", { conflicted: true })] })} />);
    expect(newButton().disabled).toBe(true);
    expect(newButton().title).toBe("Resolve the conflicts first");
    await m.rerender(<StashesSection repo={status({ files: [file("a.ts")] })} />);
    expect(newButton().disabled).toBe(false);
    await act(async () => useGit.setState({ busy: "Pulling…" }));
    expect(newButton().disabled).toBe(true);
  });

  it("opens the form with an empty, focused message box", async () => {
    await show(status({ files: [file("a.ts"), file("b.ts"), file("c.ts")] }));
    expect(form()).toBeNull();
    await fire.click(newButton());
    expect(input().value).toBe("");
    expect(input().placeholder).toBe("Stash message (optional)");
    expect(document.activeElement).toBe(input());
    expect(formButton("Stash").disabled).toBe(false);
    expect(formButton("Cancel")).toBeTruthy();
    expect(box()).toBeNull(); // no untracked files, no option
  });

  it("stashes with the message on Stash, closing the form", async () => {
    await show(status({ files: [file("a.ts"), file("b.ts"), file("c.ts", { index: "M", worktree: "." })] }));
    await fire.click(newButton());
    await type(input(), "WIP parser");
    answers.list = [stash("f", "On main: WIP parser", hoursAgo(0))];
    await fire.click(formButton("Stash"));
    await flush(6);
    expect(called("git_stash_push").map((c) => c.args)).toEqual([{ root: ROOT, message: "WIP parser", untracked: false }]);
    expect(toasts()).toContain("Stashed 3 files: WIP parser");
    expect(form()).toBeNull();
    expect(rows()[0].querySelector(".truncate")?.textContent).toBe("WIP parser");
  });

  it("Enter stashes, Escape and Cancel close the form without stashing", async () => {
    await show(status({ files: [file("a.ts")] }));
    await fire.click(newButton());
    await type(input(), "WIP parser");
    await fire.keyDown(input(), "Escape");
    expect(form()).toBeNull();
    await fire.click(newButton());
    expect(input().value).toBe(""); // a fresh form
    await fire.click(formButton("Cancel"));
    expect(form()).toBeNull();
    expect(called("git_stash_push")).toHaveLength(0);

    await fire.click(newButton());
    await type(input(), "WIP parser");
    await fire.keyDown(input(), "Enter");
    await flush(6);
    expect(called("git_stash_push").map((c) => c.args.message)).toEqual(["WIP parser"]);
  });

  it("Escape closes the form from the checkbox too, and another repository closes it", async () => {
    const m = await show(status({ files: [file("a.ts"), untracked("notes.txt")] }));
    await fire.click(newButton());
    await fire.click(box()!);
    await fire.keyDown(box()!, "Escape");
    expect(form()).toBeNull();

    await fire.click(newButton());
    await type(input(), "for proj");
    const tools = status({ root: "C:\\work\\tools", files: [file("b.ts")] });
    useGit.setState((g) => ({ repos: { ...g.repos, "c:\\work\\tools": tools }, stashes: { ...g.stashes, "c:\\work\\tools": [] } }));
    await m.rerender(<StashesSection repo={tools} />);
    expect(form()).toBeNull();
    expect(called("git_stash_push")).toHaveLength(0);
  });

  it("keeps the form and the message when git refuses", async () => {
    answers.push = "fail";
    await show(status({ files: [file("a.ts")] }));
    await fire.click(newButton());
    await type(input(), "WIP parser");
    await fire.click(formButton("Stash"));
    await flush(6);
    expect(toasts()).toContain("error: could not write index");
    expect(input().value).toBe("WIP parser");
  });

  it("offers untracked files, ticked every time, and passes the choice on", async () => {
    await show(status({ files: [file("a.ts"), file("b.ts"), untracked("notes.txt"), untracked("draft.ts")] }));
    await fire.click(newButton());
    expect(box()!.checked).toBe(true);
    expect(box()!.parentElement!.textContent).toBe("Include untracked files (2)");
    await fire.click(box()!);
    expect(box()!.checked).toBe(false);
    await fire.click(formButton("Stash"));
    await flush(6);
    expect(called("git_stash_push")[0].args).toMatchObject({ untracked: false });
    expect(toasts()).toContain("Stashed 2 files");
    // The next time the form opens the box is ticked again.
    await fire.click(newButton());
    expect(box()!.checked).toBe(true);
    await fire.click(formButton("Stash"));
    await flush(6);
    expect(called("git_stash_push")[1].args).toMatchObject({ untracked: true });
    expect(toasts()).toContain("Stashed 4 files");
  });

  it("cannot stash only untracked files with the option off", async () => {
    await show(status({ files: [untracked("notes.txt"), untracked("draft.ts")] }));
    await fire.click(newButton());
    expect(formButton("Stash").disabled).toBe(false);
    await fire.click(box()!);
    expect(formButton("Stash").disabled).toBe(true);
    expect(form()!.querySelector(".scm-hint")?.textContent).toBe("Only untracked files have changed: tick the box to stash them.");
    await fire.keyDown(input(), "Enter");
    await flush();
    expect(called("git_stash_push")).toHaveLength(0);
  });

  it("the form's Stash button is off while git is busy", async () => {
    await show(status({ files: [file("a.ts")] }));
    await fire.click(newButton());
    await act(async () => useGit.setState({ busy: "Fetching…" }));
    expect(formButton("Stash").disabled).toBe(true);
  });

  it("opens a stash to the files it holds, untracked ones with U", async () => {
    answers.files = [held("app.ts", "M"), held("src/lexer.ts", "A"), held("old.ts", "D"), held("notes.txt", "?")];
    await show(status({ files: [file("mine.ts")] }), THREE);
    await fire.click(rows()[0]);
    await flush();
    expect(called("git_stash_files")[0].args).toEqual({ root: ROOT, sha: sha("a") });
    expect(stashFiles().map((f) => `${f.querySelector(".scm-letter")?.textContent} ${f.querySelector(".scm-name")?.textContent}`)).toEqual(["M app.ts", "A lexer.ts", "D old.ts", "U notes.txt"]);
    expect(rows()[0].getAttribute("aria-expanded")).toBe("true");
    // Looking changes nothing.
    expect(called("git_stash_op")).toHaveLength(0);
    expect(called("git_stash_push")).toHaveLength(0);
    await fire.click(rows()[0]);
    expect(stashFiles()).toHaveLength(0);
  });

  it("a file opens a read-only preview comparison of the base commit and the stash", async () => {
    answers.files = [held("app.ts", "M"), held("src/lexer.ts", "A"), held("notes.txt", "?"), held("logo.png", "M")];
    await show(status({ operation: "rebase", files: [file("x.ts", { conflicted: true })] }), THREE); // looking works while actions are off
    await fire.click(rows()[0]);
    await flush();
    const sides = () => {
      const doc = useStore.getState().docs.find((d) => d.kind === "diff")!;
      const s = useDiff.getState().sessions[doc.id];
      return { preview: doc.preview, left: [s.left.label, s.left.text], right: [s.right.label, s.right.text], count: useStore.getState().docs.filter((d) => d.kind === "diff").length };
    };
    await fire.click(stashFiles()[0]);
    await flush(6);
    expect(sides()).toEqual({ preview: true, left: [`app.ts @ ${"b".repeat(7)}`, `${sha("b")}:app.ts`], right: [`app.ts @ stash ${"a".repeat(7)}`, `${sha("a")}:app.ts`], count: 1 });
    // A new file: nothing on the left. The next click replaces the preview tab.
    await fire.click(stashFiles()[1]);
    await flush(6);
    expect(sides()).toMatchObject({ left: [`lexer.ts @ ${"b".repeat(7)}`, ""], right: [`lexer.ts @ stash ${"a".repeat(7)}`, `${sha("a")}:src/lexer.ts`], count: 1 });
    // An untracked file is read from the stash's third parent.
    await fire.click(stashFiles()[2]);
    await flush(6);
    expect(sides()).toMatchObject({ left: [`notes.txt @ ${"b".repeat(7)}`, ""], right: [`notes.txt @ stash ${"a".repeat(7)}`, `${sha("a")}^3:notes.txt`] });
    // A binary file opens nothing.
    const before = useStore.getState().docs.length;
    await fire.click(stashFiles()[3]);
    await flush(6);
    expect(toasts()).toContain("This file is binary.");
    expect(useStore.getState().docs).toHaveLength(before);
  });

  it("Apply and Pop act on the row's stash by its commit id", async () => {
    await show(status(), THREE);
    await fire.click(rowButton(rows()[2], "Pop"));
    await flush(6);
    expect(called("git_stash_op").map((c) => c.args)).toEqual([{ root: ROOT, sha: sha("d"), op: "pop" }]);
    expect(useStore.getState().dialog).toBeNull(); // pop does not ask
    expect(toasts()).toContain("Popped stash: WIP at 1a2b3c4 Fix tab order");
    await fire.click(rowButton(rows()[0], "Apply"));
    await flush(6);
    expect(called("git_stash_op")[1].args).toEqual({ root: ROOT, sha: sha("a"), op: "apply" });
    expect(toasts()).toContain("Applied stash: WIP parser. It is still in the list.");
    // A row button does not also open the row.
    expect(called("git_stash_files")).toHaveLength(0);
  });

  it("Apply and Pop are off during a stopped operation or with conflicts; Drop is not", async () => {
    const m = await show(status({ operation: "cherry-pick", files: [file("a.ts", { conflicted: true })] }), THREE);
    const state = () => ["Apply", "Pop", "Drop"].map((l) => [rowButton(rows()[0], l).disabled, rowButton(rows()[0], l).title]);
    expect(state().slice(0, 2)).toEqual([[true, "Finish or abort the cherry-pick first"], [true, "Finish or abort the cherry-pick first"]]);
    expect(state()[2][0]).toBe(false);
    await m.rerender(<StashesSection repo={status({ files: [file("a.ts", { conflicted: true })] })} />);
    expect(state().slice(0, 2)).toEqual([[true, "Resolve the conflicts first"], [true, "Resolve the conflicts first"]]);
    expect(state()[2][0]).toBe(false);
    await m.rerender(<StashesSection repo={status()} />);
    expect(state().map((s) => s[0])).toEqual([false, false, false]);
    await act(async () => useGit.setState({ busy: "Pushing…" }));
    expect(state().map((s) => s[0])).toEqual([true, true, true]);
  });

  it("Drop and the Delete key ask first, with Cancel as the default", async () => {
    answers.files = [held("a.ts", "M"), held("b.ts", "M"), held("c.ts", "M")];
    await show(status(), THREE);
    await fire.click(rowButton(rows()[0], "Drop"));
    await flush(6);
    const d = useStore.getState().dialog!;
    expect(d.title).toBe("Drop this stash?");
    expect(d.message).toContain('"WIP parser" (3 files, made on main 2 hours ago) will be deleted');
    expect(d.actions.map((a) => [a.label, !!a.default, !!a.cancel])).toEqual([["Drop Stash", false, false], ["Cancel", true, true]]);
    await act(async () => d.actions[1].run());
    await flush();
    expect(called("git_stash_op")).toHaveLength(0);

    await fire.keyDown(rows()[1], "Delete");
    await flush(6);
    expect(useStore.getState().dialog?.message).toContain('"try new layout"');
    await act(async () => useStore.getState().dialog!.actions[0].run());
    await flush(6);
    expect(called("git_stash_op").map((c) => c.args)).toEqual([{ root: ROOT, sha: sha("c"), op: "drop" }]);
    expect(toasts()).toContain("Dropped stash: try new layout");
  });

  it("marks the stash that came back with conflicts", async () => {
    await show(status({ files: [file("a.ts", { conflicted: true })] }), THREE);
    expect(document.querySelector(".scm-stash-mark")).toBeNull();
    await act(async () => useGit.setState({ stashPending: { root: ROOT, sha: sha("a"), title: "WIP parser", pop: true } }));
    expect(rows()[0].querySelector(".scm-stash-mark")?.textContent).toContain("applied with conflicts");
    expect(rows()[1].querySelector(".scm-stash-mark")).toBeNull();
  });

  it("Show Stashes opens the list and focuses its first row", async () => {
    await show(status(), THREE);
    await fire.click(section()!.querySelector(".scm-section-head")!); // closed
    await act(async () => showStashes());
    await flush();
    expect(rows()).toHaveLength(3);
    expect(document.activeElement).toBe(rows()[0]);
  });

  it("double-click opens the file as it is now, when it is in the folder", async () => {
    answers.files = [held("app.ts", "M"), held("old.ts", "D")];
    answers.exists = false;
    await show(status(), THREE);
    await fire.click(rows()[0]);
    await flush();
    await act(async () => { stashFiles()[0].dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    await flush();
    expect(called("fs_exists").map((c) => c.args.path)).toEqual([`${ROOT}\\app.ts`]);
    expect(useStore.getState().docs.filter((d) => d.kind === "text")).toHaveLength(0);
    // A file the stash deleted is never opened.
    await act(async () => { stashFiles()[1].dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    await flush();
    expect(called("fs_exists")).toHaveLength(1);
  });
});
