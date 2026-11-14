import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitFile } from "../lib/gitApi";
import type { Pick } from "../lib/gitHunks";
import type { Doc } from "../lib/store";

// Partial staging end to end in jsdom (specs/git-staging.md): the real DiffView, diff sessions,
// lib/gitStaging.ts and git.ts over a fake repository behind `invoke` (HEAD, index and disk text of
// one file; `git_apply_lines` checks the hashes and moves the picked lines like staging.rs does).
const h = vi.hoisted(() => ({
  repo: { head: "" as string | null, index: "" as string | null, disk: "" as string | null },
  calls: [] as { cmd: string; args: Record<string, unknown> }[],
  applyError: null as string | null,
  tabText: new Map<string, string>(),
  saves: [] as string[],
  reverts: [] as string[],
  saveOk: true,
  saveChanges: null as string | null,
}));

const ROOT = "C:\\r";
const PATH = "C:\\r\\app.ts";

vi.mock("@tauri-apps/api/core", async () => {
  const { textHash } = await import("../lib/gitHunks");
  const splice = (base: string, from: string, picks: [number, number, number, number][]) => {
    const [b, f] = [base.split("\n"), from.split("\n")];
    const out: string[] = [];
    let at = 0;
    for (const [bs, bc, fs, fc] of picks) {
      out.push(...b.slice(at, bs - 1), ...f.slice(fs - 1, fs - 1 + fc));
      at = bs - 1 + bc;
    }
    return [...out, ...b.slice(at)].join("\n");
  };
  const status = () => {
    const { head, index, disk } = h.repo;
    const x = index === head ? "." : index === null ? "D" : head === null ? "A" : "M";
    const y = disk === index ? "." : disk === null ? "D" : "M";
    const files = x === "." && y === "." ? [] : [{ path: PATH, origPath: null, index: x, worktree: y, conflicted: false, untracked: false }];
    return { root: ROOT, branch: "main", head: "abc1234", upstream: null, upstreamGone: false, ahead: 0, behind: 0, operation: null, operationMessage: null, operationStep: null, remotes: [], files };
  };
  const stat = () => ({ path: PATH, name: "app.ts", size: h.repo.disk!.length, isDir: false, modifiedMs: 1, readonly: false, isLarge: false });
  return {
    invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
      h.calls.push({ cmd, args });
      const r = h.repo;
      switch (cmd) {
        case "git_available":
          return "git version 2.47";
        case "git_status":
          return status();
        case "git_show": {
          const t = args.rev === "HEAD" ? r.head : r.index;
          return t === null ? null : { text: t, binary: false, encoding: "UTF-8" };
        }
        case "fs_exists":
          return r.disk !== null;
        case "fs_stat":
          if (r.disk === null) throw new Error("not found");
          return stat();
        case "fs_read_text":
          if (r.disk === null) throw new Error("not found");
          return { path: PATH, content: r.disk, encoding: "UTF-8", hasBom: false, eol: "LF", size: r.disk.length, modifiedMs: 1, hadDecodeErrors: false, looksBinary: false };
        case "fs_write_text":
          r.disk = args.content as string;
          return stat();
        case "git_stage":
          r.index = r.disk;
          return;
        case "git_unstage":
          r.index = r.head;
          return;
        case "git_discard":
          r.disk = r.index;
          return;
        case "git_apply_lines": {
          if (h.applyError) throw h.applyError;
          const expect = args.expect as { left: string; right: string };
          const [left, right] = args.mode === "unstage" ? [r.head ?? "", r.index] : [r.index, r.disk];
          if (left === null || right === null || textHash(left) !== expect.left || textHash(right) !== expect.right) throw "quarry-stale: the file or the index changed";
          const picks = args.picks as Pick[];
          const fwd = picks.map((p): [number, number, number, number] => [p.oldStart, p.oldCount, p.newStart, p.newCount]);
          const back = picks.map((p): [number, number, number, number] => [p.newStart, p.newCount, p.oldStart, p.oldCount]);
          if (args.mode === "stage") r.index = splice(left, right, fwd);
          else if (args.mode === "unstage") r.index = splice(right, left, back);
          else r.disk = splice(right, left, back);
          return;
        }
        default:
          return undefined;
      }
    },
  };
});

// A stand-in for the main editor: the text of open tabs only.
vi.mock("../editor/manager", () => {
  const base: Record<string, unknown> = {
    textOf: (id: string) => h.tabText.get(id) ?? "",
    registerFocus: () => () => {},
    takeKeepFocus: () => false,
    onDocUpdate: () => () => {},
    currentDocId: null,
    view: null,
  };
  return { editor: new Proxy(base, { get: (t, k: string) => (k in t ? t[k] : () => undefined) }) };
});

vi.mock("../lib/actions", async (original) => {
  const { useStore } = await import("../lib/store");
  return {
    ...(await original<typeof import("../lib/actions")>()),
    checkExternalChanges: async () => {},
    openPath: async () => null,
    saveDocument: async (id: string) => {
      h.saves.push(id);
      if (!h.saveOk) return false;
      if (h.saveChanges !== null) h.tabText.set(id, h.saveChanges);
      h.repo.disk = h.tabText.get(id) ?? "";
      useStore.getState().updateDoc(id, { dirty: false });
      return true;
    },
    revertDocument: async (id: string) => {
      h.reverts.push(id);
      h.tabText.set(id, h.repo.disk ?? "");
      return true;
    },
  };
});

// jsdom has no layout: CodeMirror's selection layer measures ranges.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });

const { render, cleanup, flush, fire, byText, act } = await import("./helpers/render");
const { DiffView, changeAtCursor, selectedLines } = await import("../components/DiffView");
const { diffOf, diffViews, markSideEdited, openCompare, reloadDiff, swapDiff, useDiff } = await import("../lib/diff");
const { useStore } = await import("../lib/store");
const { commit, openChange, stage, useGit } = await import("../lib/git");
const { canApply, staleMessage } = await import("../lib/gitStaging");
const { registerGitCommands } = await import("../lib/gitCommands");
const { getCommand, isEnabled, normalizeKeys, getCommandsForKeys, runCommand } = await import("../lib/commands");

registerGitCommands();

const numbered = (n: number, edit: (l: string[]) => void = () => {}) => {
  const l = Array.from({ length: n }, (_, i) => `row ${String.fromCharCode(97 + (i % 26))}${i + 1}`);
  edit(l);
  return l.join("\n") + "\n";
};
const HEAD = numbered(50);
/** Changes at lines 3, 20 and 40. */
const EDITED = numbered(50, (l) => { l[2] = "THREE"; l[19] = "TWENTY"; l[39] = "FORTY"; });
/** Lines 10–15 added. */
const ADDED = numbered(50, (l) => l.splice(9, 0, "new 1", "new 2", "new 3", "new 4", "new 5", "new 6"));

const file = (index = ".", worktree = "M"): GitFile => ({ path: PATH, origPath: null, index, worktree, conflicted: false, untracked: false });
const pick = (oldStart: number, oldCount: number, newStart: number, newCount: number): Pick => ({ oldStart, oldCount, newStart, newCount });

let doc: Doc;
/** Open the file's comparison from Changes (or Staged Changes) and render it. */
async function show(staged = false, inline = false) {
  await openChange(file(staged ? "M" : h.repo.index === h.repo.head ? "." : "M", staged ? "." : "M"), staged);
  doc = useStore.getState().docs.filter((d) => d.kind === "diff").pop()!;
  if (inline) useDiff.setState((st) => ({ sessions: { ...st.sessions, [doc.id]: { ...st.sessions[doc.id], inline: true } } }));
  await render(<DiffView doc={doc} visible />);
  await flush(4);
}
const settle = () => flush(6);
const bars = () => [...document.querySelectorAll<HTMLElement>(".diff-hunk-bar")];
const barButtons = (i: number) => [...bars()[i].querySelectorAll("button")];
const barButton = (i: number, label: string) => barButtons(i).find((b) => b.textContent === label)!;
const toolbar = (label: string) => byText(document.body, ".diff-toolbar button", label)[0] as HTMLButtonElement | undefined;
const count = () => document.querySelector(".diff-count")?.textContent;
const labels = () => [...document.querySelectorAll(".diff-label")].map((l) => l.firstChild?.textContent);
const applied = () => h.calls.filter((c) => c.cmd === "git_apply_lines").map((c) => ({ mode: c.args.mode, picks: c.args.picks }));
const right = () => diffViews.get(doc.id)!.right!;
const selectLines = async (from: number, to = from, view = right()) => {
  await act(async () => view.dispatch({ selection: { anchor: view.state.doc.line(from).from, head: view.state.doc.line(to).to } }));
  await flush(1);
};
const cursorAt = async (line: number) => {
  await act(async () => right().dispatch({ selection: { anchor: right().state.doc.line(line).from } }));
  await flush(1);
};
const dialog = () => useStore.getState().dialog;
const answer = async (label: string) => {
  await act(async () => dialog()!.actions.find((a) => a.label === label)!.run());
  await settle();
};
const toasts = () => useStore.getState().toasts.map((t) => t.message);
const enabled = (id: string) => isEnabled(getCommand(id)!);
const run = (id: string) => act(async () => void (await runCommand(id)));
/** An open text tab of the file. */
const openTab = (text: string, dirty: boolean) => {
  h.tabText.set("tab-1", text);
  const tab = { id: "tab-1", kind: "text", path: PATH, name: "app.ts", dirty, encoding: "UTF-8", bom: false, eol: "LF", language: "TypeScript", readonly: false, modifiedMs: 1 } as Doc;
  useStore.setState((s) => ({ docs: [...s.docs, tab] }));
};

describe("partial staging in a Source Control comparison", () => {
  beforeEach(() => {
    h.repo = { head: HEAD, index: HEAD, disk: EDITED };
    h.calls.length = 0;
    h.applyError = null;
    h.tabText.clear();
    h.saves.length = 0;
    h.reverts.length = 0;
    h.saveOk = true;
    h.saveChanges = null;
    useStore.setState({ docs: [], activeId: null, toasts: [], dialog: null });
    useDiff.setState({ sessions: {} });
    useGit.setState({ busy: null, repos: { "c:\\r": { root: ROOT, files: [file()] } as never }, files: {}, current: "c:\\r", available: true });
  });
  afterEach(async () => {
    await settle();
    await cleanup();
  });

  // ---------- STAGE-001 ----------

  it("STAGE-001.1: every change has a bar with Stage Change and Discard Change", async () => {
    await show();
    expect(labels()).toEqual(["app.ts (HEAD)", "app.ts"]);
    expect(count()).toMatch(/^3 changes$|^Change 1 of 3$/);
    expect(bars()).toHaveLength(3);
    for (let i = 0; i < 3; i++) expect(barButtons(i).map((b) => b.textContent)).toEqual(["Stage Change", "Discard Change"]);
    // The left side has a gap of the same height at each change, so the sides stay level.
    expect(document.querySelectorAll(".cm-merge-a .diff-hunk-gap")).toHaveLength(3);
    expect(document.querySelectorAll(".cm-merge-b .diff-hunk-bar")).toHaveLength(3);
    expect(toolbar("Stage Selected Lines")).toBeDefined();
    expect(toolbar("Discard Selected Lines")).toBeDefined();
    expect(toolbar("Unstage Selected Lines")).toBeUndefined();
  });

  it("STAGE-001.2 / .4 / .9: Stage Change stages that change, asks nothing, and the comparison follows", async () => {
    await show();
    await fire.click(barButton(0, "Stage Change"));
    await settle();
    expect(dialog()).toBeNull();
    expect(applied()).toEqual([{ mode: "stage", picks: [pick(3, 1, 3, 1)] }]);
    expect(h.repo.index).toBe(numbered(50, (l) => { l[2] = "THREE"; }));
    expect(h.repo.disk).toBe(EDITED);
    // The same tab, now against the staged text, with the staged change no longer a difference.
    expect(useStore.getState().docs.filter((d) => d.kind === "diff")).toHaveLength(1);
    expect(labels()).toEqual(["app.ts (staged)", "app.ts"]);
    expect(useStore.getState().docs.find((d) => d.id === doc.id)?.name).toBe("app.ts (staged) ↔ app.ts");
    expect(count()).toBe("2 changes");
    expect(bars()).toHaveLength(2);
    expect(useGit.getState().busy).toBeNull();
  });

  it("STAGE-001.5: staging the last change leaves the tab open with No differences", async () => {
    h.repo.disk = numbered(50, (l) => { l[2] = "THREE"; });
    await show();
    expect(bars()).toHaveLength(1);
    await fire.click(barButton(0, "Stage Change"));
    await settle();
    expect(count()).toBe("No differences");
    expect(bars()).toHaveLength(0);
    expect(useStore.getState().docs.some((d) => d.id === doc.id)).toBe(true);
  });

  it("STAGE-001.6: one staged, one discarded, one left", async () => {
    await show();
    await fire.click(barButton(0, "Stage Change"));
    await settle();
    await fire.click(barButton(0, "Discard Change")); // now the change at line 20
    await settle();
    await answer("Discard Change");
    expect(h.repo.index).toBe(numbered(50, (l) => { l[2] = "THREE"; }));
    expect(h.repo.disk).toBe(numbered(50, (l) => { l[2] = "THREE"; l[39] = "FORTY"; }));
    expect(count()).toBe("1 change");
  });

  it("STAGE-001.7: the inline layout has the same bars, and they stage the same way", async () => {
    await show(false, true);
    expect(document.querySelectorAll(".diff-host.inline .diff-hunk-bar")).toHaveLength(3);
    expect(document.querySelector(".diff-hunk-gap")).toBeNull();
    await fire.click(barButton(1, "Stage Change"));
    await settle();
    expect(applied()).toEqual([{ mode: "stage", picks: [pick(20, 1, 20, 1)] }]);
    expect(bars()).toHaveLength(2);
  });

  it("the cursor and the focus stay where they were across the refresh (STAGE-001.4, STAGE-008.2)", async () => {
    await show();
    await cursorAt(20);
    await act(async () => right().focus());
    expect(changeAtCursor(doc.id)).toBe(1);
    await run("git.stageChange");
    await settle();
    expect(applied()).toEqual([{ mode: "stage", picks: [pick(20, 1, 20, 1)] }]);
    expect(count()).toBe("2 changes");
    expect(right().state.doc.lineAt(right().state.selection.main.head).number).toBe(20);
    expect(right().hasFocus).toBe(true);
  });

  // ---------- STAGE-002 ----------

  it("STAGE-002.1 / .2 / .4: the staged comparison offers Unstage only, and unstaging saves nothing", async () => {
    h.repo.index = EDITED;
    openTab(EDITED + "typing\n", true);
    await show(true);
    expect(labels()).toEqual(["app.ts (HEAD)", "app.ts (staged)"]);
    expect(bars()).toHaveLength(3);
    for (let i = 0; i < 3; i++) expect(barButtons(i).map((b) => b.textContent)).toEqual(["Unstage Change"]);
    expect(toolbar("Unstage Selected Lines")).toBeDefined();
    // STAGE-003.8: no Discard of any kind.
    expect(document.body.textContent).not.toContain("Discard");
    expect(toolbar("Stage Selected Lines")).toBeUndefined();
    await fire.click(barButton(1, "Unstage Change"));
    await settle();
    expect(dialog()).toBeNull();
    expect(h.saves).toEqual([]);
    expect(applied()).toEqual([{ mode: "unstage", picks: [pick(20, 1, 20, 1)] }]);
    expect(h.repo.index).toBe(numbered(50, (l) => { l[2] = "THREE"; l[39] = "FORTY"; }));
    expect(count()).toBe("2 changes");
    expect(useStore.getState().docs.find((d) => d.id === "tab-1")?.dirty).toBe(true);
  });

  it("STAGE-002.3: unstaging the last staged change leaves the tab open with No differences", async () => {
    h.repo.index = numbered(50, (l) => { l[2] = "THREE"; });
    await show(true);
    await fire.click(barButton(0, "Unstage Change"));
    await settle();
    expect(h.repo.index).toBe(HEAD);
    expect(count()).toBe("No differences");
  });

  // ---------- STAGE-003 ----------

  it("STAGE-003.1 / .2: Discard asks first, Cancel is the default and leaves everything alone", async () => {
    h.repo.disk = numbered(50, (l) => { l[19] = "X"; l[20] = "Y"; l[21] = "Z"; });
    await show();
    await fire.click(barButton(0, "Discard Change"));
    await settle();
    const d = dialog()!;
    expect(d.title).toBe("Discard this change?");
    expect(d.message).toBe("Lines 20–22 of app.ts go back to the last commit. Your edits to those lines will be lost.");
    expect(d.actions.map((a) => a.label)).toEqual(["Discard Change", "Cancel"]);
    expect(d.actions.find((a) => a.default)?.label).toBe("Cancel");
    expect(d.actions.find((a) => a.cancel)?.label).toBe("Cancel");
    expect(d.actions[0].kind).toBe("danger");
    await answer("Cancel");
    expect(applied()).toEqual([]);
    expect(h.repo.disk).toContain("X\nY\nZ\n");
    expect(bars()).toHaveLength(1);
  });

  it("STAGE-003.3 / .7: confirming restores those lines only", async () => {
    await show();
    await fire.click(barButton(1, "Discard Change"));
    await settle();
    expect(dialog()!.message).toBe("Line 20 of app.ts goes back to the last commit. Your edits to that line will be lost.");
    await answer("Discard Change");
    expect(applied()).toEqual([{ mode: "discard", picks: [pick(20, 1, 20, 1)] }]);
    expect(h.repo.disk).toBe(numbered(50, (l) => { l[2] = "THREE"; l[39] = "FORTY"; }));
    expect(h.repo.index).toBe(HEAD);
    expect(count()).toBe("2 changes");
  });

  it("STAGE-003.5: with something staged, the lines go back to the staged version", async () => {
    h.repo.index = numbered(50, (l) => { l[2] = "THREE"; });
    await show();
    expect(labels()[0]).toBe("app.ts (staged)");
    await fire.click(barButton(0, "Discard Change"));
    await settle();
    expect(dialog()!.message).toBe("Line 20 of app.ts goes back to the staged version. Your edits to that line will be lost.");
    await answer("Discard Change");
    expect(h.repo.disk).toBe(numbered(50, (l) => { l[2] = "THREE"; l[39] = "FORTY"; }));
    expect(h.repo.index).toBe(numbered(50, (l) => { l[2] = "THREE"; }));
  });

  it("STAGE-003.6: removed lines are put back", async () => {
    h.repo.disk = numbered(50, (l) => l.splice(19, 4));
    await show();
    await fire.click(barButton(0, "Discard Change"));
    await settle();
    expect(dialog()!.message).toBe("The 4 lines removed after line 19 of app.ts are put back.");
    await answer("Discard Change");
    expect(h.repo.disk).toBe(HEAD);
    expect(count()).toBe("No differences");
  });

  it("STAGE-003.4: an open, saved tab of the file shows the restored text without a question", async () => {
    openTab(EDITED, false);
    await show();
    expect(labels()).toEqual(["app.ts (HEAD)", "app.ts"]);
    await fire.click(barButton(0, "Discard Change"));
    await settle();
    await answer("Discard Change");
    expect(h.saves).toEqual([]);
    expect(h.reverts).toEqual(["tab-1"]);
    expect(h.tabText.get("tab-1")).toBe(numbered(50, (l) => { l[19] = "TWENTY"; l[39] = "FORTY"; }));
    expect(count()).toBe("2 changes");
  });

  // ---------- STAGE-004 ----------

  it("STAGE-004.1 / .8 / .9: the selected-lines buttons follow the right side's selection", async () => {
    h.repo.disk = ADDED;
    await show();
    await cursorAt(3);
    expect(toolbar("Stage Selected Lines")!.disabled).toBe(true);
    expect(toolbar("Discard Selected Lines")!.disabled).toBe(true);
    expect(selectedLines(doc.id)).toEqual([]);
    // A selection in the left side changes nothing.
    await selectLines(1, 30, diffViews.get(doc.id)!.left!);
    expect(toolbar("Stage Selected Lines")!.disabled).toBe(true);
    await selectLines(11, 12);
    expect(toolbar("Stage Selected Lines")!.disabled).toBe(false);
    expect(selectedLines(doc.id)).toEqual([pick(10, 0, 11, 2)]);
    await fire.click(toolbar("Stage Selected Lines")!);
    await settle();
    expect(applied()).toEqual([{ mode: "stage", picks: [pick(10, 0, 11, 2)] }]);
    expect(h.repo.index).toBe(numbered(50, (l) => l.splice(9, 0, "new 2", "new 3")));
    // Two smaller changes remain around the staged lines.
    expect(count()).toMatch(/2 changes|of 2/);
    expect(bars()).toHaveLength(2);
  });

  it("STAGE-004.2: a bare cursor counts as its line (one line of a block changed line for line)", async () => {
    h.repo.disk = numbered(50, (l) => { l[19] = "X"; l[20] = "Y"; l[21] = "Z"; });
    await show();
    await cursorAt(21);
    await fire.click(toolbar("Stage Selected Lines")!);
    await settle();
    expect(h.repo.index).toBe(numbered(50, (l) => { l[20] = "Y"; }));
    expect(count()).toMatch(/2 changes|of 2/);
  });

  it("STAGE-004.4 / .10: a selection across changes takes them whole; the bar always takes its whole change", async () => {
    await show();
    await selectLines(1, 25);
    expect(selectedLines(doc.id)).toEqual([pick(3, 1, 3, 1), pick(20, 1, 20, 1)]);
    // The bar of the third change ignores the selection.
    await fire.click(barButton(2, "Stage Change"));
    await settle();
    expect(applied()).toEqual([{ mode: "stage", picks: [pick(40, 1, 40, 1)] }]);
  });

  it("STAGE-004.5: removed lines come along only when the selection spans them", async () => {
    h.repo.disk = numbered(50, (l) => l.splice(19, 4));
    await show();
    await selectLines(19);
    expect(toolbar("Stage Selected Lines")!.disabled).toBe(true);
    await selectLines(19, 20);
    expect(toolbar("Stage Selected Lines")!.disabled).toBe(false);
    await fire.click(toolbar("Stage Selected Lines")!);
    await settle();
    expect(h.repo.index).toBe(h.repo.disk);
  });

  it("STAGE-004.6: Unstage Selected Lines", async () => {
    h.repo.index = ADDED;
    h.repo.disk = ADDED;
    await show(true);
    await selectLines(14, 15);
    await fire.click(toolbar("Unstage Selected Lines")!);
    await settle();
    expect(applied()).toEqual([{ mode: "unstage", picks: [pick(10, 0, 14, 2)] }]);
    expect(h.repo.index).toBe(numbered(50, (l) => l.splice(9, 0, "new 1", "new 2", "new 3", "new 4")));
    expect(h.repo.disk).toBe(ADDED);
  });

  it("STAGE-004.7: Discard Selected Lines asks first, with Cancel as the default", async () => {
    h.repo.disk = ADDED;
    await show();
    await selectLines(11, 12);
    await fire.click(toolbar("Discard Selected Lines")!);
    await settle();
    const d = dialog()!;
    expect(d.title).toBe("Discard the selected lines?");
    expect(d.message).toBe("Lines 11–12 of app.ts go back to the last commit. Your edits to those lines will be lost.");
    expect(d.actions.map((a) => a.label)).toEqual(["Discard Lines", "Cancel"]);
    expect(d.actions.find((a) => a.default)?.label).toBe("Cancel");
    await answer("Cancel");
    expect(h.repo.disk).toBe(ADDED);
    await fire.click(toolbar("Discard Selected Lines")!);
    await settle();
    await answer("Discard Lines");
    expect(h.repo.disk).toBe(numbered(50, (l) => l.splice(9, 0, "new 1", "new 4", "new 5", "new 6")));
  });

  // ---------- STAGE-005 ----------

  it("STAGE-005.1: an unsaved tab is saved first, without a question", async () => {
    h.repo.disk = HEAD; // the edits are only in the tab
    openTab(EDITED, true);
    await show();
    expect(labels()).toEqual(["app.ts (HEAD)", "app.ts (unsaved)"]);
    await fire.click(barButton(0, "Stage Change"));
    await settle();
    expect(dialog()).toBeNull();
    expect(h.saves).toEqual(["tab-1"]);
    const order = h.calls.map((c) => c.cmd);
    expect(applied()).toEqual([{ mode: "stage", picks: [pick(3, 1, 3, 1)] }]);
    expect(order.indexOf("git_apply_lines")).toBeGreaterThan(-1);
    expect(h.repo.index).toBe(numbered(50, (l) => { l[2] = "THREE"; }));
    expect(useStore.getState().docs.find((d) => d.id === "tab-1")?.dirty).toBe(false);
    expect(labels()).toEqual(["app.ts (staged)", "app.ts"]);
  });

  it("STAGE-005.2: a save that fails or is cancelled stages nothing", async () => {
    h.repo.disk = HEAD;
    openTab(EDITED, true);
    h.saveOk = false;
    await show();
    await fire.click(barButton(0, "Stage Change"));
    await settle();
    expect(h.saves).toEqual(["tab-1"]);
    expect(applied()).toEqual([]);
    expect(h.repo.index).toBe(HEAD);
    expect(useStore.getState().docs.find((d) => d.id === "tab-1")?.dirty).toBe(true);
  });

  it("a save that fails cancels a confirmed Discard Change too (SAFE: hunk discard keeps its save-first rule)", async () => {
    h.repo.disk = HEAD;
    openTab(EDITED, true);
    h.saveOk = false;
    await show();
    await fire.click(barButton(0, "Discard Change"));
    await settle();
    await answer("Discard Change");
    expect(h.saves).toEqual(["tab-1"]);
    expect(applied()).toEqual([]);
    expect(h.repo.disk).toBe(HEAD);
    expect(h.reverts).toEqual([]);
    expect(useStore.getState().docs.find((d) => d.id === "tab-1")?.dirty).toBe(true);
  });

  it("STAGE-005.3: edits made in the comparison itself are saved to the file first", async () => {
    await show();
    const v = right();
    await act(async () => v.dispatch({ changes: { from: v.state.doc.line(30).from, to: v.state.doc.line(30).to, insert: "THIRTY" } }));
    await flush(2);
    expect(document.querySelector(".diff-tag.edited")).not.toBeNull();
    expect(bars()).toHaveLength(4);
    await fire.click(barButton(2, "Stage Change"));
    await settle();
    expect(h.repo.disk).toBe(numbered(50, (l) => { l[2] = "THREE"; l[19] = "TWENTY"; l[29] = "THIRTY"; l[39] = "FORTY"; }));
    expect(h.repo.index).toBe(numbered(50, (l) => { l[29] = "THIRTY"; }));
    expect(document.querySelector(".diff-tag.edited")).toBeNull();
    expect(count()).toMatch(/3 changes|of 3/);
  });

  it("STAGE-005.4: Discard says that it will save, and Cancel saves nothing", async () => {
    h.repo.disk = HEAD;
    openTab(EDITED, true);
    await show();
    await fire.click(barButton(1, "Discard Change"));
    await settle();
    expect(dialog()!.message).toBe("Line 20 of app.ts goes back to the last commit. Your edits to that line will be lost.\n\napp.ts has unsaved changes; they are saved first.");
    await answer("Cancel");
    expect(h.saves).toEqual([]);
    expect(h.repo.disk).toBe(HEAD);
    await fire.click(barButton(1, "Discard Change"));
    await settle();
    await answer("Discard Change");
    expect(h.saves).toEqual(["tab-1"]);
    expect(h.reverts).toEqual(["tab-1"]);
    const restored = numbered(50, (l) => { l[2] = "THREE"; l[39] = "FORTY"; });
    expect(h.repo.disk).toBe(restored);
    expect(h.tabText.get("tab-1")).toBe(restored);
    expect(useStore.getState().docs.find((d) => d.id === "tab-1")?.dirty).toBe(false);
  });

  it("STAGE-005.5: typed more in the tab since: nothing is staged or saved, the comparison reloads and says so", async () => {
    h.repo.disk = HEAD;
    openTab(EDITED, true);
    await show();
    h.tabText.set("tab-1", EDITED + "one\ntwo\nthree\n");
    await fire.click(barButton(0, "Stage Change"));
    await settle();
    expect(h.saves).toEqual([]);
    expect(applied()).toEqual([]);
    expect(right().state.doc.toString()).toBe(EDITED + "one\ntwo\nthree\n");
    expect(bars()).toHaveLength(4);
    expect(toasts()).toContain("app.ts changed since this comparison was loaded. It was reloaded: check the change and try again.");
  });

  it("a save that changes the text (a formatter) stops the action after saving", async () => {
    h.repo.disk = HEAD;
    openTab(EDITED, true);
    h.saveChanges = "formatted\n" + EDITED;
    await show();
    await fire.click(barButton(0, "Stage Change"));
    await settle();
    expect(applied()).toEqual([]);
    expect(toasts()).toContain(staleMessage("app.ts"));
    expect(right().state.doc.toString()).toBe("formatted\n" + EDITED);
  });

  it("STAGE-005.6: unsaved edits in other files are left alone", async () => {
    const other = { id: "tab-2", kind: "text", path: "C:\\r\\other.ts", name: "other.ts", dirty: true, encoding: "UTF-8", bom: false, eol: "LF", language: "TypeScript", readonly: false, modifiedMs: 1 } as Doc;
    useStore.setState((s) => ({ docs: [...s.docs, other] }));
    await show();
    await fire.click(barButton(0, "Stage Change"));
    await settle();
    expect(applied()).toHaveLength(1);
    expect(h.saves).toEqual([]);
    expect(useStore.getState().docs.find((d) => d.id === "tab-2")?.dirty).toBe(true);
  });

  // ---------- STAGE-007 ----------

  it("STAGE-007.1: other comparisons have no staging controls and the commands are off", async () => {
    const d = (await openCompare({ kind: "text", label: "app.ts (HEAD)", text: HEAD }, { kind: "file", path: PATH }))!;
    doc = d;
    await render(<DiffView doc={d} visible />);
    await flush(4);
    expect(count()).toMatch(/3 changes|of 3/);
    expect(bars()).toHaveLength(0);
    expect(document.querySelector(".diff-hunk-gap")).toBeNull();
    expect(toolbar("Stage Selected Lines")).toBeUndefined();
    for (const id of ["git.stageChange", "git.unstageChange", "git.discardChange", "git.stageLines", "git.unstageLines", "git.discardLines"]) expect(enabled(id), id).toBe(false);
  });

  it("STAGE-007.2 / .3: conflicted and untracked files open as files, not as comparisons", async () => {
    await openChange({ ...file(), conflicted: true }, false);
    await openChange({ ...file("?", "?"), untracked: true }, false);
    await flush(2);
    expect(useStore.getState().docs.filter((d) => d.kind === "diff")).toHaveLength(0);
  });

  it("STAGE-007.4: a staged new file that was edited again compares its staged text with the working copy", async () => {
    h.repo = { head: null, index: "a\nb\nc\n", disk: "a\nB\nc\nd\n" };
    await openChange(file("A", "M"), false);
    doc = useStore.getState().docs.find((d) => d.kind === "diff")!;
    await render(<DiffView doc={doc} visible />);
    await flush(4);
    expect(labels()).toEqual(["app.ts (staged)", "app.ts"]);
    expect(bars()).toHaveLength(2);
    expect(barButtons(0).map((b) => b.textContent)).toEqual(["Stage Change", "Discard Change"]);
  });

  it("STAGE-007.5: a deleted file: the change buttons do what the row's do", async () => {
    h.repo.disk = null;
    await openChange(file(".", "D"), false);
    doc = useStore.getState().docs.find((d) => d.kind === "diff")!;
    await render(<DiffView doc={doc} visible />);
    await flush(4);
    expect(labels()).toEqual(["app.ts (HEAD)", "app.ts (deleted)"]);
    expect(bars()).toHaveLength(1);
    await selectLines(1);
    expect(toolbar("Stage Selected Lines")!.disabled).toBe(true);
    expect(toolbar("Discard Selected Lines")!.disabled).toBe(true);
    // Discard asks the file-level question (GIT-012) and puts the file back.
    await fire.click(barButton(0, "Discard Change"));
    await settle();
    expect(dialog()!.title).toBe("Discard changes?");
    await answer("Cancel");
    expect(h.calls.some((c) => c.cmd === "git_discard")).toBe(false);
    // Stage Change stages the deletion, like + on the row.
    await fire.click(barButton(0, "Stage Change"));
    await settle();
    expect(applied()).toEqual([]);
    expect(h.calls.filter((c) => c.cmd === "git_stage").map((c) => c.args.paths)).toEqual([[PATH]]);
  });

  it("STAGE-007.6: swapped sides hide the controls; swapping back brings them back", async () => {
    await show();
    await act(async () => swapDiff(doc.id));
    await flush(4);
    expect(bars()).toHaveLength(0);
    expect(document.querySelector(".diff-hunk-gap")).toBeNull();
    expect(toolbar("Stage Selected Lines")).toBeUndefined();
    expect(enabled("git.stageChange")).toBe(false);
    expect(canApply(doc.id, "stage", "change")).toBe(false);
    await act(async () => swapDiff(doc.id));
    await flush(4);
    expect(bars()).toHaveLength(3);
    expect(toolbar("Stage Selected Lines")).toBeDefined();
  });

  it("STAGE-007.7: while git is busy the buttons are disabled, and a double click stages once", async () => {
    await show();
    await selectLines(3);
    await act(async () => useGit.setState({ busy: "Pulling…" }));
    await flush(1);
    expect(barButtons(0).every((b) => b.disabled)).toBe(true);
    expect(toolbar("Stage Selected Lines")!.disabled).toBe(true);
    expect(enabled("git.stageChange")).toBe(false);
    await run("git.stageChange");
    await settle();
    expect(applied()).toEqual([]);
    await act(async () => useGit.setState({ busy: null }));
    await flush(1);
    expect(barButtons(0).every((b) => !b.disabled)).toBe(true);
    // Two clicks before the first one has finished.
    const b = barButton(0, "Stage Change");
    await act(async () => {
      b.click();
      b.click();
    });
    await settle();
    expect(applied()).toHaveLength(1);
  });

  it("STAGE-007.8: nothing left to act on: all six commands are off", async () => {
    h.repo.disk = HEAD;
    await show();
    expect(count()).toBe("No differences");
    for (const id of ["git.stageChange", "git.unstageChange", "git.discardChange", "git.stageLines", "git.unstageLines", "git.discardLines"]) expect(enabled(id), id).toBe(false);
  });

  it("STAGE-007.9: the copy arrows still edit the side and stage nothing", async () => {
    await show();
    const arrow = document.querySelector<HTMLButtonElement>(".cm-merge-revert button")!;
    await fire.mouseDown(arrow);
    await flush(2);
    expect(applied()).toEqual([]);
    expect(h.repo.disk).toBe(EDITED);
    expect(document.querySelector(".diff-tag.edited")).not.toBeNull();
    expect(bars()).toHaveLength(2);
  });

  // ---------- STAGE-008 ----------

  it("STAGE-008.1 / .5 / .10: six commands; four chords of their own; Discard has no shortcut", async () => {
    const ids = ["git.stageChange", "git.unstageChange", "git.discardChange", "git.stageLines", "git.unstageLines", "git.discardLines"];
    expect(ids.map((id) => getCommand(id)?.title)).toEqual(["Stage Change at Cursor", "Unstage Change at Cursor", "Discard Change at Cursor…", "Stage Selected Lines", "Unstage Selected Lines", "Discard Selected Lines…"]);
    expect(ids.map((id) => getCommand(id)?.keys)).toEqual(["Ctrl+K S", "Ctrl+K U", undefined, "Ctrl+K L", "Ctrl+K N", undefined]);
    for (const [keys, id] of [["Ctrl+K S", "git.stageChange"], ["Ctrl+K U", "git.unstageChange"], ["Ctrl+K L", "git.stageLines"], ["Ctrl+K N", "git.unstageLines"]]) {
      expect(getCommandsForKeys(normalizeKeys(keys)).map((c) => c.id)).toEqual([id]);
    }
  });

  it("STAGE-008.4 / .6 / .7: the commands act on the cursor with the same guards as the buttons", async () => {
    await show();
    await cursorAt(10); // an unchanged line
    expect(enabled("git.stageChange")).toBe(false);
    expect(enabled("git.stageLines")).toBe(false);
    await run("git.stageChange");
    await settle();
    expect(applied()).toEqual([]);
    await cursorAt(20);
    expect(["git.stageChange", "git.discardChange", "git.stageLines", "git.discardLines"].map(enabled)).toEqual([true, true, true, true]);
    // A comparison from Changes: the Unstage commands are off.
    expect(["git.unstageChange", "git.unstageLines"].map(enabled)).toEqual([false, false]);
    // Discard from the palette / menu asks the same question.
    await run("git.discardChange");
    await settle();
    expect(dialog()!.title).toBe("Discard this change?");
    expect(dialog()!.actions.find((a) => a.default)?.label).toBe("Cancel");
    await answer("Cancel");
    expect(applied()).toEqual([]);
    await run("git.stageLines");
    await settle();
    expect(applied()).toEqual([{ mode: "stage", picks: [pick(20, 1, 20, 1)] }]);
  });

  it("STAGE-008.3 / .6: in a staged comparison only the Unstage commands are available", async () => {
    h.repo.index = EDITED;
    await show(true);
    await cursorAt(3);
    expect(["git.stageChange", "git.discardChange", "git.stageLines", "git.discardLines"].map(enabled)).toEqual([false, false, false, false]);
    expect(["git.unstageChange", "git.unstageLines"].map(enabled)).toEqual([true, true]);
    await run("git.unstageChange");
    await settle();
    expect(applied()).toEqual([{ mode: "unstage", picks: [pick(3, 1, 3, 1)] }]);
  });

  it("STAGE-008.8: not on a Compare tab: the six commands are off", async () => {
    openTab(EDITED, false);
    useStore.setState({ activeId: "tab-1" });
    for (const id of ["git.stageChange", "git.unstageChange", "git.discardChange", "git.stageLines", "git.unstageLines", "git.discardLines"]) expect(enabled(id), id).toBe(false);
  });

  it("STAGE-008.9: a command saves the tab first, exactly as the button does", async () => {
    h.repo.disk = HEAD;
    openTab(EDITED, true);
    await show();
    await cursorAt(3);
    await run("git.stageChange");
    await settle();
    expect(h.saves).toEqual(["tab-1"]);
    expect(applied()).toHaveLength(1);
  });

  // ---------- STAGE-009 ----------

  it("STAGE-009.1: the index changed outside Quarry: nothing is applied, the comparison reloads and says so", async () => {
    await show();
    h.repo.index = EDITED; // git add app.ts in a terminal
    await fire.click(barButton(0, "Stage Change"));
    await settle();
    expect(h.repo.index).toBe(EDITED);
    expect(toasts()).toContain("app.ts changed since this comparison was loaded. It was reloaded: check the change and try again.");
    expect(labels()[0]).toBe("app.ts (staged)");
    expect(count()).toBe("No differences");
  });

  it("STAGE-009.2 / .9: the file changed or was deleted on disk: it is not touched", async () => {
    await show();
    const rewritten = numbered(50, (l) => { l[9] = "TEN"; });
    h.repo.disk = rewritten;
    await fire.click(barButton(1, "Discard Change"));
    await settle();
    await answer("Discard Change");
    expect(h.repo.disk).toBe(rewritten);
    expect(toasts()).toContain(staleMessage("app.ts"));
    expect(bars()).toHaveLength(1);
    h.repo.disk = null;
    useStore.setState({ toasts: [] });
    await fire.click(barButton(0, "Stage Change"));
    await settle();
    expect(h.repo.index).toBe(HEAD);
    expect(toasts()).toContain(staleMessage("app.ts"));
    expect(labels()[1]).toBe("app.ts (deleted)");
  });

  it("STAGE-009.3 / .7: staging from the panel refreshes the comparison, but not one with unsaved edits", async () => {
    await show();
    await act(async () => void (await stage(ROOT, [PATH])));
    await settle();
    expect(labels()).toEqual(["app.ts (staged)", "app.ts"]);
    expect(count()).toBe("No differences");
    // Unsaved text typed in the comparison is kept.
    h.repo.index = HEAD;
    await act(async () => reloadDiff(doc.id));
    await settle();
    expect(bars()).toHaveLength(3);
    await act(async () => right().dispatch({ changes: { from: 0, insert: "mine\n" } }));
    await flush(2);
    await act(async () => void (await stage(ROOT, [PATH])));
    await settle();
    expect(right().state.doc.toString()).toBe("mine\n" + EDITED);
    expect(document.querySelector(".diff-tag.edited")).not.toBeNull();
    expect(labels()[0]).toBe("app.ts (HEAD)");
  });

  it("STAGE-009.4 / .5: both comparisons of a file stay in step, also after a commit", async () => {
    h.repo.index = numbered(50, (l) => { l[2] = "THREE"; });
    await openChange(file("M", "M"), true);
    await show();
    const [stagedDoc, changesDoc] = useStore.getState().docs.filter((d) => d.kind === "diff");
    expect(changesDoc.id).toBe(doc.id);
    expect(diffOf(stagedDoc.id).right.text).toBe(h.repo.index);
    await fire.click(barButton(0, "Stage Change")); // the change at line 20
    await settle();
    expect(diffOf(stagedDoc.id).right.text).toBe(numbered(50, (l) => { l[2] = "THREE"; l[19] = "TWENTY"; }));
    // Clicking the row again shows the open comparison instead of opening another.
    await openChange(file("M", "M"), false);
    expect(useStore.getState().docs.filter((d) => d.kind === "diff")).toHaveLength(2);
    // A commit: HEAD takes the index.
    h.repo.head = h.repo.index;
    useGit.setState({ repos: { "c:\\r": { root: ROOT, files: [file("M", "M")] } as never } });
    await act(async () => void (await commit(ROOT, "msg")));
    await settle();
    expect(diffOf(stagedDoc.id).left.text).toBe(diffOf(stagedDoc.id).right.text);
    expect(diffOf(changesDoc.id).left.label).toBe("app.ts (HEAD)");
    expect(count()).toBe("1 change");
  });

  it("STAGE-009.6: Reload reads git again", async () => {
    await show();
    h.repo.index = numbered(50, (l) => { l[2] = "THREE"; });
    await fire.click(document.querySelector('[aria-label="Reload"]')!);
    await settle();
    expect(labels()[0]).toBe("app.ts (staged)");
    expect(count()).toBe("2 changes");
    expect(toasts()).toContain("Reloaded");
  });

  it("STAGE-009.8: a failure stages nothing, shows git's error without hint lines, and reloads", async () => {
    await show();
    h.applyError = "error: patch failed: app.ts:3\nhint: try something else\nerror: app.ts: patch does not apply";
    await selectLines(1, 45);
    await fire.click(toolbar("Stage Selected Lines")!);
    await settle();
    expect(h.repo.index).toBe(HEAD);
    expect(toasts()).toContain("error: patch failed: app.ts:3\nerror: app.ts: patch does not apply");
    expect(bars()).toHaveLength(3);
    expect(useGit.getState().busy).toBeNull();
  });

  it("an edited side marks the comparison as its own source of truth for saving", async () => {
    await show();
    markSideEdited(doc.id, "right");
    expect(useStore.getState().docs.find((d) => d.id === doc.id)?.dirty).toBe(true);
  });
});
