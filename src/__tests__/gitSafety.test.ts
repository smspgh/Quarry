import { describe, expect, it } from "vitest";
import { afterPhrase, asksAboutTabs, discardText, keptNotice, listPaths, localName, lostEditsSentence, missingNotice, nameList, needsCleanState, notSavedNotice, operationPhrase, ownerRoot, reloadedNotice, tabsAtRisk, tabsOfPaths, unsavedPrompt, type OpenTab, type SafetyKind } from "../lib/gitSafety";
import { actionConfirm } from "../lib/gitGraph";

// Unsaved tabs and git operations (specs/git-safety.md): the pure rules and wording.

const ROOT = "C:\\work\\app";
const text = (id: string, path: string | null, dirty = true, extra: Partial<OpenTab> = {}): OpenTab => ({ id, kind: "text", path, dirty, ...extra });
const rels = (tabs: { rel: string }[]) => tabs.map((t) => t.rel);

describe("which tabs count (SAFE-001)", () => {
  it("lists unsaved text tabs of the repository by path inside it, in tab order", () => {
    const tabs = [text("1", `${ROOT}\\src\\store.ts`), text("2", `${ROOT}\\clean.ts`, false), text("3", `${ROOT}\\README.md`)];
    const risk = tabsAtRisk(tabs, ROOT, [ROOT]);
    expect(rels(risk)).toEqual(["src\\store.ts", "README.md"]);
    expect(risk[0]).toMatchObject({ path: `${ROOT}\\src\\store.ts`, name: "store.ts", docs: [{ id: "1" }] });
  });
  it("never counts untitled tabs, files outside the repository or other repositories' files", () => {
    const tabs = [text("u", null), text("n", "C:\\notes\\todo.txt"), text("o", "C:\\work\\other\\main.rs"), text("p", "C:\\work\\application\\x.ts")];
    expect(tabsAtRisk(tabs, ROOT, [ROOT, "C:\\work\\other"])).toEqual([]);
  });
  it("gives a file in a nested repository to the nested one", () => {
    const nested = `${ROOT}\\vendor\\lib`;
    const tabs = [text("1", `${nested}\\util.c`)];
    expect(tabsAtRisk(tabs, ROOT, [ROOT, nested])).toEqual([]);
    expect(rels(tabsAtRisk(tabs, nested, [ROOT, nested]))).toEqual(["util.c"]);
    expect(ownerRoot(`${nested}\\util.c`, [ROOT, nested])).toBe(nested);
    expect(ownerRoot("D:\\x.txt", [ROOT])).toBeNull();
  });
  it("counts the repository even when it is not among the known ones, and ignores case and slashes", () => {
    expect(rels(tabsAtRisk([text("1", "c:/WORK/app/src/a.ts")], ROOT, []))).toEqual(["src\\a.ts"]);
  });
  it("counts large-file tabs", () => {
    expect(rels(tabsAtRisk([{ id: "b", kind: "big", path: `${ROOT}\\data\\big.csv`, dirty: true }], ROOT, [ROOT]))).toEqual(["data\\big.csv"]);
  });
  it("counts a Compare tab's edited file side, never its snapshots or read-only sides", () => {
    const diff = (sides: OpenTab["sides"]): OpenTab => ({ id: "d", kind: "diff", path: null, dirty: true, sides });
    const api = `${ROOT}\\src\\api.ts`;
    expect(tabsAtRisk([diff([{ which: "left", path: null, dirty: false, editable: false }, { which: "right", path: api, dirty: true, editable: true }])], ROOT, [ROOT])).toMatchObject([{ rel: "src\\api.ts", docs: [{ id: "d", side: "right" }] }]);
    // Git versions, another tab's text (it has the tab's path but is not editable), an unedited file side.
    expect(tabsAtRisk([diff([{ which: "left", path: null, dirty: false, editable: false }, { which: "right", path: api, dirty: false, editable: false }])], ROOT, [ROOT])).toEqual([]);
    expect(tabsAtRisk([diff([{ which: "left", path: api, dirty: true, editable: false }, { which: "right", path: api, dirty: false, editable: true }])], ROOT, [ROOT])).toEqual([]);
  });
  it("lists a file once however many tabs hold it, and keeps every tab to save", () => {
    const p = `${ROOT}\\src\\store.ts`;
    const tabs: OpenTab[] = [text("1", p), { id: "d", kind: "diff", path: null, dirty: true, sides: [{ which: "right", path: p.toUpperCase(), dirty: true, editable: true }] }];
    const risk = tabsAtRisk(tabs, ROOT, [ROOT]);
    expect(risk).toHaveLength(1);
    expect(risk[0].docs).toEqual([{ id: "1" }, { id: "d", side: "right" }]);
  });
  it("does not count a tab that is only marked unsaved because its file is missing", () => {
    expect(tabsAtRisk([text("1", `${ROOT}\\old.ts`, true, { missingOnly: true })], ROOT, [ROOT])).toEqual([]);
    expect(rels(tabsAtRisk([text("1", `${ROOT}\\old.ts`, true, { missingOnly: false })], ROOT, [ROOT]))).toEqual(["old.ts"]);
  });
  it("never counts terminal or graph tabs", () => {
    const tabs: OpenTab[] = ["terminal", "graph"].map((kind) => ({ id: kind, kind, path: null, dirty: true }));
    expect(tabsAtRisk(tabs, ROOT, [ROOT])).toEqual([]);
  });
  it("tabsOfPaths keeps to the files named", () => {
    const tabs = [text("a", `${ROOT}\\a.ts`), text("b", `${ROOT}\\b.ts`), text("n", `${ROOT}\\notes.md`), text("c", `${ROOT}\\c.ts`, false)];
    expect(tabsOfPaths(tabs, [`${ROOT}\\A.ts`, `${ROOT}\\b.ts`, `${ROOT}\\c.ts`], ROOT).map((t) => t.name)).toEqual(["a.ts", "b.ts"]);
  });
});

describe("which operations ask (SAFE-003)", () => {
  const kinds = (how: string, list: SafetyKind[]) => it(`${how}: ${list.join(", ")}`, () => {
    for (const k of list) expect([k, asksAboutTabs(k)]).toEqual([k, how]);
  });
  kinds("dialog", ["switch", "checkout", "pull", "merge", "rebase", "history", "cherry-pick", "revert", "stash", "stash-apply", "continue"]);
  kinds("sentence", ["discard", "reset-hard", "abort", "take-side"]);
  kinds("never", ["fetch", "push", "force-push", "commit", "stage", "unstage", "resolve", "reset-soft", "reset-mixed", "undo", "reword-tip", "branch", "tag", "ref", "stash-drop"]);
  it("merge, rebase and history edits start from a clean state", () => {
    expect((["merge", "rebase", "history"] as const).map(needsCleanState)).toEqual([true, true, true]);
    expect((["switch", "pull", "stash", "cherry-pick", "continue"] as const).map(needsCleanState)).toEqual([false, false, false, false, false]);
  });
  it("words each operation", () => {
    expect(operationPhrase({ kind: "switch", name: "feature" })).toBe("Switching to feature");
    expect(operationPhrase({ kind: "checkout", name: "18bc71d" })).toBe("Checking out 18bc71d");
    expect(operationPhrase({ kind: "pull" })).toBe("Pulling");
    expect(operationPhrase({ kind: "merge", name: "feature", branch: "main" })).toBe("Merging feature into main");
    expect(operationPhrase({ kind: "rebase", name: "feature", branch: "main" })).toBe("Rebasing main onto feature");
    expect(operationPhrase({ kind: "history" })).toBe("Rewriting commits");
    expect(operationPhrase({ kind: "cherry-pick", name: "18bc71d" })).toBe("Cherry-picking 18bc71d");
    expect(operationPhrase({ kind: "revert", name: "18bc71d" })).toBe("Reverting 18bc71d");
    expect(operationPhrase({ kind: "stash-apply" })).toBe("Applying the stash");
    expect(operationPhrase({ kind: "continue", noun: "the rebase" })).toBe("Continuing the rebase");
    expect(afterPhrase({ kind: "switch", name: "feature" })).toBe("after switching to feature");
    expect(afterPhrase({ kind: "pull" })).toBe("after the pull");
    expect(afterPhrase({ kind: "reset-hard" })).toBe("after the reset");
  });
  it("names a remote branch by the local branch it becomes", () => {
    expect(localName("origin/topic", ["origin"])).toBe("topic");
    expect(localName("origin/feature/x", ["origin", "origin/feature"])).toBe("x");
    expect(localName("feature/x", ["origin"])).toBe("feature/x");
  });
});

describe("the unsaved-changes dialog (SAFE-001, SAFE-002)", () => {
  const tab = (rel: string) => ({ rel, name: rel.slice(rel.lastIndexOf("\\") + 1) });
  it("names the files, with Save All as the default and Cancel on Escape", () => {
    const d = unsavedPrompt({ kind: "switch", name: "feature" }, [tab("src\\store.ts"), tab("README.md")]);
    expect(d.title).toBe("Unsaved changes in 2 open files");
    expect(d.text).toBe("Switching to feature can rewrite files in this repository, and these open files have unsaved changes:\n\nsrc\\store.ts\nREADME.md\n\nSave them first, or continue and keep the unsaved text in their tabs.");
    expect(d.choices.map((c) => c.label)).toEqual(["Save All", "Continue Without Saving", "Cancel"]);
    expect(d.choices.find((c) => c.default)?.value).toBe("save");
    expect(d.choices.find((c) => c.cancel)?.value).toBe("cancel");
    expect(d.choices.filter((c) => c.default || c.cancel)).toHaveLength(2);
  });
  it("one file: its name in the title and a Save button", () => {
    const d = unsavedPrompt({ kind: "pull" }, [tab("src\\store.ts")]);
    expect(d.title).toBe("Unsaved changes in store.ts");
    expect(d.choices[0].label).toBe("Save");
    expect(d.text).toBe("Pulling can rewrite files in this repository, and this open file has unsaved changes:\n\nsrc\\store.ts\n\nSave it first, or continue and keep the unsaved text in its tab.");
  });
  it("cuts a long list after 10", () => {
    const d = unsavedPrompt({ kind: "switch", name: "feature" }, Array.from({ length: 14 }, (_, i) => tab(`src\\f${i + 1}.ts`)));
    expect(d.title).toBe("Unsaved changes in 14 open files");
    const lines = d.text.split("\n\n")[1].split("\n");
    expect(lines).toHaveLength(11);
    expect(lines.slice(0, 2)).toEqual(["src\\f1.ts", "src\\f2.ts"]);
    expect(lines[10]).toBe("and 4 more");
    expect(listPaths(["a", "b"])).toBe("a\nb");
  });
  it("says what a stash would leave out", () => {
    const d = unsavedPrompt({ kind: "stash" }, [tab("src\\store.ts"), tab("b.ts")]);
    expect(d.text.startsWith("A stash takes the files as they are on disk, so the unsaved changes in these open files would not be in it:\n\nsrc\\store.ts\nb.ts")).toBe(true);
    expect(unsavedPrompt({ kind: "stash" }, [tab("b.ts")]).text).toContain("in this open file would not be in it:");
  });
  it("words the notices afterwards", () => {
    expect(notSavedNotice({ kind: "switch", name: "feature" }, ["README.md"])).toBe("Not switched: README.md could not be saved.");
    expect(notSavedNotice({ kind: "pull" }, ["a.ts", "b.ts"])).toBe("Not pulled: a.ts and b.ts could not be saved.");
    expect(keptNotice(["store.ts"])).toBe("store.ts changed on disk; its tab keeps your unsaved text. Saving it overwrites the file.");
    expect(keptNotice(["a.ts", "b.ts"])).toBe("a.ts and b.ts changed on disk; their tabs keep your unsaved text. Saving one overwrites its file.");
    expect(reloadedNotice(["store.ts"])).toBe("store.ts changed on disk and was reloaded.");
    expect(reloadedNotice(["store.ts", "README.md"])).toBe("2 open files changed on disk and were reloaded.");
    expect(missingNotice({ kind: "switch", name: "feature" }, ["old.ts", "legacy.ts"])).toBe("old.ts and legacy.ts are not in the folder after switching to feature. Their tabs stay open; saving one recreates the file.");
    expect(missingNotice({ kind: "pull" }, ["old.ts"])).toBe("old.ts is not in the folder after the pull. Its tab stays open; saving it recreates the file.");
    expect(missingNotice(null, ["notes.txt"])).toBe("notes.txt was deleted or moved on disk. Saving will recreate it.");
    expect(missingNotice(null, ["a", "b", "c", "d", "e"])).toBe("a, b, c and 2 more were deleted or moved on disk. Their tabs stay open; saving one recreates the file.");
    expect(nameList(["a", "b", "c"])).toBe("a, b and c");
  });
});

describe("operations that throw work away (SAFE-004, SAFE-007)", () => {
  const tab = (rel: string) => ({ rel, name: rel.slice(rel.lastIndexOf("\\") + 1) });
  it("Discard changes? names the unsaved tabs, and reads as before without any", () => {
    expect(discardText("b.ts", 1, 0, [])).toBe("Your changes to b.ts will be lost. Open tabs reload the committed text.");
    expect(discardText("b.ts", 1, 0, [tab("b.ts")])).toBe("Your changes to b.ts will be lost, including the unsaved edits in its open tab. Open tabs reload the committed text.");
    expect(discardText("4 files", 4, 0, [tab("src\\a.ts"), tab("b.ts")])).toBe("Your changes to 4 files will be lost. Unsaved edits in 2 open tabs are lost too: a.ts, b.ts. Open tabs reload the committed text.");
    expect(discardText("4 files", 4, 1, [])).toBe("Your changes to 4 files will be lost (1 untracked file goes to the Recycle Bin). Open tabs reload the committed text.");
    expect(discardText("notes.txt", 1, 1, [])).toBe("notes.txt is not tracked by git and will be moved to the Recycle Bin.");
    expect(discardText("notes.txt", 1, 1, [tab("notes.txt")])).toBe("notes.txt is not tracked by git and will be moved to the Recycle Bin. The unsaved edits in its open tab are lost.");
    expect(discardText("2 files", 2, 2, [tab("notes.txt")])).toBe("2 files are not tracked by git and will be moved to the Recycle Bin. Unsaved edits in 1 open tab are lost too: notes.txt.");
  });
  it("hard reset and abort say which tabs lose their edits where the file is rewritten", () => {
    expect(lostEditsSentence("reset-hard", [tab("src\\store.ts"), tab("README.md")])).toBe("Unsaved edits in open tabs are lost too where the reset rewrites the file: src\\store.ts, README.md.");
    expect(lostEditsSentence("abort", [tab("src\\store.ts")])).toBe("Unsaved edits in open tabs are lost too where the abort rewrites the file: src\\store.ts.");
    expect(lostEditsSentence("abort", [])).toBe("");
  });
  it("the hard-reset confirmation carries the sentence; soft and mixed never mention tabs", () => {
    const c = { short: "18bc71d", summary: "Add the parser" };
    const tabs = [tab("src\\store.ts"), tab("README.md")];
    const hard = actionConfirm("reset-hard", c, "main", 0, tabs)!;
    expect(hard.title).toBe("Reset (hard) and discard changes?");
    expect(hard.text).toContain("The commits after it leave the branch. Unsaved edits in open tabs are lost too where the reset rewrites the file: src\\store.ts, README.md. This can't be undone from Quarry.");
    expect(hard.kind).toBe("danger");
    expect(actionConfirm("reset-hard", c, "main", 2, [])!.text).toBe(actionConfirm("reset-hard", c, "main", 2)!.text);
    expect(actionConfirm("reset-hard", c, "main", 2)!.text).not.toContain("open tabs");
    for (const a of ["reset-soft", "reset-mixed"] as const) expect(actionConfirm(a, c, "main", 0, tabs)!.text).not.toContain("tabs");
  });
});
