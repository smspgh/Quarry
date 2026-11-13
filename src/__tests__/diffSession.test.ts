import { beforeEach, describe, expect, it, vi } from "vitest";

// Compare tabs over an in-memory disk: openCompare / saveDiff / reloadDiff (src/lib/diff.ts).
interface FakeFile { content: string; encoding: string; bom: boolean; readonly: boolean; modifiedMs: number; binary?: boolean; dir?: boolean }
const disk = new Map<string, FakeFile>();
const writes: { path: string; content: string; options?: { encoding?: string; bom?: boolean } }[] = [];
let clock = 1000;
const answers: unknown[] = [];

vi.mock("../lib/ipc", () => ({
  fs: {
    stat: async (path: string) => {
      const f = disk.get(path);
      if (!f) throw new Error(`${path} not found`);
      return { path, name: path, size: f.content.length, isDir: !!f.dir, modifiedMs: f.modifiedMs, readonly: f.readonly, isLarge: false };
    },
    readText: async (path: string) => {
      const f = disk.get(path);
      if (!f) throw new Error(`${path} not found`);
      const eol = f.content.includes("\r\n") ? "CRLF" : "LF";
      return { path, content: f.content, encoding: f.encoding, hasBom: f.bom, eol, size: f.content.length, modifiedMs: f.modifiedMs, hadDecodeErrors: false, looksBinary: !!f.binary };
    },
    writeText: async (path: string, content: string, options?: { encoding?: string; bom?: boolean }) => {
      writes.push({ path, content, options });
      const f = disk.get(path)!;
      f.content = content;
      f.modifiedMs = ++clock;
      return { path, name: path, size: content.length, isDir: false, modifiedMs: f.modifiedMs, readonly: false, isLarge: false };
    },
  },
}));
vi.mock("../lib/dialogs", () => ({ choose: async () => answers.shift() }));
vi.mock("../lib/actions", () => ({ checkExternalChanges: async () => {} }));

const { diffOf, markSideEdited, openCompare, reloadDiff, saveDiff, swapDiff } = await import("../lib/diff");
const { useStore } = await import("../lib/store");

const put = (path: string, content: string, extra: Partial<FakeFile> = {}) => disk.set(path, { content, encoding: "UTF-8", bom: false, readonly: false, modifiedMs: ++clock, ...extra });
const lastToast = () => { const t = useStore.getState().toasts; return t[t.length - 1]; };

describe("compare sessions", () => {
  beforeEach(() => {
    disk.clear();
    writes.length = 0;
    answers.length = 0;
    useStore.setState({ docs: [], activeId: null, toasts: [] });
  });

  it("opens two files: file sides are editable, line endings normalised, tab named after them", async () => {
    put("C:\\p\\a.ts", "one\r\ntwo\r\n");
    put("C:\\p\\b.ts", "one\nthree\n", { readonly: true });
    const doc = await openCompare({ kind: "file", path: "C:\\p\\a.ts" }, { kind: "file", path: "C:\\p\\b.ts" });
    expect(doc?.name).toBe("a.ts ↔ b.ts");
    const s = diffOf(doc!.id);
    expect(s.left).toMatchObject({ text: "one\ntwo\n", eol: "CRLF", editable: true, dirty: false });
    expect(s.right).toMatchObject({ text: "one\nthree\n", eol: "LF", editable: false });
    expect(useStore.getState().activeId).toBe(doc!.id);
  });

  it("snapshots are read-only and identical texts are reported", async () => {
    put("C:\\p\\a.ts", "same");
    const doc = await openCompare({ kind: "text", label: "Clipboard", text: "same" }, { kind: "file", path: "C:\\p\\a.ts" });
    expect(diffOf(doc!.id).left.editable).toBe(false);
    expect(lastToast()?.message).toBe("The two are identical.");
  });

  it("refuses large, binary and folder sides, and opens nothing", async () => {
    useStore.setState({ settings: { ...useStore.getState().settings, largeFileThresholdMb: 1 } });
    put("C:\\p\\a.ts", "x");
    put("C:\\p\\big.log", "x".repeat(2 * 1048576));
    put("C:\\p\\logo.png", "\0", { binary: true });
    put("C:\\p\\dir", "", { dir: true });
    expect(await openCompare({ kind: "file", path: "C:\\p\\a.ts" }, { kind: "file", path: "C:\\p\\big.log" })).toBeNull();
    expect(lastToast()?.message).toMatch(/^Can't compare: big\.log is too large to compare \(2 MB/);
    expect(await openCompare({ kind: "file", path: "C:\\p\\logo.png" }, { kind: "file", path: "C:\\p\\a.ts" })).toBeNull();
    expect(lastToast()?.message).toBe("Can't compare: logo.png looks like a binary file");
    expect(await openCompare({ kind: "file", path: "C:\\p\\dir" }, { kind: "file", path: "C:\\p\\a.ts" })).toBeNull();
    expect(lastToast()?.message).toBe("Can't compare: C:\\p\\dir is a folder");
    expect(await openCompare({ kind: "file", path: "C:\\p\\a.ts" }, { kind: "file", path: "C:\\p\\gone.ts" })).toBeNull();
    expect(useStore.getState().docs).toHaveLength(0);
  });

  it("a preview comparison replaces the previous clean preview, never an ordinary one", async () => {
    put("C:\\p\\a.ts", "a");
    put("C:\\p\\b.ts", "b");
    const plain = await openCompare({ kind: "file", path: "C:\\p\\a.ts" }, { kind: "file", path: "C:\\p\\b.ts" });
    const p1 = await openCompare({ kind: "text", label: "x", text: "1" }, { kind: "text", label: "y", text: "2" }, { preview: true });
    const p2 = await openCompare({ kind: "text", label: "x", text: "3" }, { kind: "text", label: "y", text: "4" }, { preview: true });
    const ids = useStore.getState().docs.map((d) => d.id);
    expect(ids).toEqual([plain!.id, p2!.id]);
    expect(diffOf(p1!.id)).toBeUndefined();
  });

  it("saves an edited side in its own encoding, BOM and line endings", async () => {
    put("C:\\p\\a.ts", "one\r\ntwo\r\n", { encoding: "UTF-16LE", bom: true });
    put("C:\\p\\b.ts", "one\n");
    const doc = (await openCompare({ kind: "file", path: "C:\\p\\a.ts" }, { kind: "file", path: "C:\\p\\b.ts" }))!;
    // No editor in this test: the side's text is what saveDiff writes.
    markSideEdited(doc.id, "left");
    expect(useStore.getState().docs.find((d) => d.id === doc.id)?.dirty).toBe(true);
    expect(await saveDiff(doc.id)).toBe(true);
    expect(writes).toEqual([{ path: "C:\\p\\a.ts", content: "one\r\ntwo\r\n", options: { encoding: "UTF-16LE", bom: true } }]);
    expect(diffOf(doc.id).left.dirty).toBe(false);
    expect(useStore.getState().docs.find((d) => d.id === doc.id)?.dirty).toBe(false);
    expect(lastToast()?.message).toBe("Saved");
  });

  it("asks before overwriting a file changed on disk; Cancel keeps the side edited", async () => {
    put("C:\\p\\a.ts", "one");
    put("C:\\p\\b.ts", "two");
    const doc = (await openCompare({ kind: "file", path: "C:\\p\\a.ts" }, { kind: "file", path: "C:\\p\\b.ts" }))!;
    markSideEdited(doc.id, "right");
    disk.get("C:\\p\\b.ts")!.modifiedMs = ++clock;
    answers.push(false);
    expect(await saveDiff(doc.id)).toBe(false);
    expect(writes).toHaveLength(0);
    expect(diffOf(doc.id).right.dirty).toBe(true);
    answers.push(true);
    expect(await saveDiff(doc.id)).toBe(true);
    expect(writes.map((w) => w.path)).toEqual(["C:\\p\\b.ts"]);
  });

  it("reload reads files again, keeps snapshot text and folder labels", async () => {
    put("C:\\p\\old\\s.ts", "a");
    put("C:\\p\\new\\s.ts", "b");
    const doc = (await openCompare({ kind: "file", path: "C:\\p\\old\\s.ts" }, { kind: "file", path: "C:\\p\\new\\s.ts" }))!;
    disk.get("C:\\p\\new\\s.ts")!.content = "a";
    await reloadDiff(doc.id);
    const s = diffOf(doc.id);
    expect(s.right.text).toBe("a");
    expect([s.left.label, s.right.label]).toEqual(["old\\s.ts", "new\\s.ts"]);
    expect(s.version).toBe(1);
    expect(lastToast()?.message).toBe("Reloaded: the two are identical.");

    const clip = (await openCompare({ kind: "text", label: "Clipboard", text: "x" }, { kind: "file", path: "C:\\p\\old\\s.ts" }))!;
    disk.get("C:\\p\\old\\s.ts")!.content = "y";
    await reloadDiff(clip.id);
    expect(diffOf(clip.id).left.text).toBe("x");
    expect(diffOf(clip.id).right.text).toBe("y");
    expect(lastToast()?.message).toBe("Reloaded");

    disk.delete("C:\\p\\old\\s.ts");
    await reloadDiff(clip.id);
    expect(lastToast()?.message).toMatch(/^Can't reload:/);
    expect(diffOf(clip.id).right.text).toBe("y");
  });

  it("swap exchanges the sides and renames the tab", async () => {
    put("C:\\p\\a.ts", "a");
    put("C:\\p\\b.ts", "b");
    const doc = (await openCompare({ kind: "file", path: "C:\\p\\a.ts" }, { kind: "file", path: "C:\\p\\b.ts" }))!;
    swapDiff(doc.id);
    expect(diffOf(doc.id).left.label).toBe("b.ts");
    expect(useStore.getState().docs.find((d) => d.id === doc.id)?.name).toBe("b.ts ↔ a.ts");
  });
});
