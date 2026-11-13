import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiffSession, Side } from "../lib/diff";
import type { Doc } from "../lib/store";

// DiffView rendered in jsdom over a session put straight into the store, with the real
// @codemirror/merge editors (jsdom does no layout, but the editors, chunks and arrows exist).
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => undefined }));

const { render, cleanup, flush, fire, byText } = await import("./helpers/render");
const { DiffView } = await import("../components/DiffView");
const { useDiff, diffViews } = await import("../lib/diff");

const LEFT = "one\ntwo\nthree\nfour\n";
const RIGHT = "one\nTWO\nthree\nfour\nfive\n";
const side = (label: string, text: string, editable: boolean): Side => ({
  label,
  path: editable ? `C:\\work\\${label}` : null,
  text,
  editable,
  encoding: "utf-8",
  bom: false,
  eol: "LF",
  dirty: false,
  source: editable ? { kind: "file", path: `C:\\work\\${label}` } : { kind: "text", label, text },
});
const doc = { id: "diff-1", kind: "diff", name: "Compare" } as unknown as Doc;
const open = (patch: Partial<DiffSession> = {}) =>
  useDiff.setState({ sessions: { [doc.id]: { left: side("a.txt", LEFT, false), right: side("b.txt", RIGHT, true), inline: false, collapse: false, version: 1, ...patch } } });

const host = () => document.querySelector<HTMLElement>(".diff-host")!;
const arrows = () => [...document.querySelectorAll<HTMLButtonElement>(".cm-merge-revert button")];
const radio = (name: string) => byText(document.body, ".segmented [role=radio]", name)[0];

describe("DiffView", () => {
  beforeEach(() => open());
  afterEach(async () => {
    await cleanup();
    useDiff.setState({ sessions: {} });
  });

  it("shows both sides with their labels, read-only tag and change count", async () => {
    await render(<DiffView doc={doc} visible />);
    await flush();
    const labels = [...document.querySelectorAll(".diff-label")].map((l) => l.textContent);
    expect(labels).toEqual(["a.txtread-only", "b.txt"]);
    expect(host().className).toContain("split");
    const views = diffViews.get(doc.id)!;
    expect(views.left?.state.doc.toString()).toBe(LEFT);
    expect(views.right?.state.doc.toString()).toBe(RIGHT);
    expect(host().querySelector(".cm-merge-a")?.textContent).toContain("two");
    expect(host().querySelector(".cm-merge-b")?.textContent).toContain("TWO");
    expect(document.querySelector(".diff-count")?.textContent).toBe("2 changes");
  });

  it("identical texts: No differences, and the change buttons are disabled", async () => {
    open({ right: side("b.txt", LEFT, true) });
    await render(<DiffView doc={doc} visible />);
    await flush();
    expect(document.querySelector(".diff-count")?.textContent).toBe("No differences");
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Next change"]')?.disabled).toBe(true);
  });

  it("the layout switch rebuilds the editors inline and back", async () => {
    await render(<DiffView doc={doc} visible />);
    await flush();
    expect(radio("Side by side").getAttribute("aria-checked")).toBe("true");
    await fire.click(radio("Inline"));
    await flush();
    expect(useDiff.getState().sessions[doc.id].inline).toBe(true);
    expect(radio("Inline").getAttribute("aria-checked")).toBe("true");
    expect(host().className).toContain("inline");
    expect(host().querySelector(".cm-merge-a")).toBeNull();
    expect(host().querySelectorAll(".cm-editor")).toHaveLength(1);
    const views = diffViews.get(doc.id)!;
    expect(views.left).toBeUndefined();
    expect(views.right?.state.doc.toString()).toBe(RIGHT);
    // The removed line is drawn inline.
    expect(host().querySelector(".cm-deletedChunk")?.textContent).toContain("two");
    await fire.click(radio("Side by side"));
    await flush();
    expect(host().querySelectorAll(".cm-editor")).toHaveLength(2);
  });

  it("an editable right side gets arrows that copy left to right", async () => {
    await render(<DiffView doc={doc} visible />);
    await flush();
    expect(arrows().length).toBeGreaterThan(0);
    expect(arrows().every((b) => b.textContent === "⇝")).toBe(true);
    // The arrow acts on mousedown (DIFF-011.2).
    await fire.mouseDown(arrows()[0]);
    await flush();
    expect(diffViews.get(doc.id)!.right?.state.doc.toString()).toBe("one\ntwo\nthree\nfour\nfive\n");
    expect(diffViews.get(doc.id)!.left?.state.doc.toString()).toBe(LEFT);
    expect(document.querySelector(".diff-label .diff-tag.edited")).not.toBeNull();
    expect(document.querySelector(".diff-count")?.textContent).toMatch(/^1 change$|^Change 1 of 1$/);
  });

  it("only the left side editable: the arrows point left", async () => {
    open({ left: side("a.txt", LEFT, true), right: side("b.txt", RIGHT, false) });
    await render(<DiffView doc={doc} visible />);
    await flush();
    expect(arrows().length).toBeGreaterThan(0);
    expect(arrows().every((b) => b.textContent === "⇜")).toBe(true);
  });

  it("both sides read-only: no arrows", async () => {
    open({ left: side("a.txt", LEFT, false), right: side("b.txt", RIGHT, false) });
    await render(<DiffView doc={doc} visible />);
    await flush();
    expect(document.querySelector(".cm-merge-revert")).toBeNull();
    expect(diffViews.get(doc.id)!.right?.state.readOnly).toBe(true);
  });

  it("inline layout: no arrows", async () => {
    open({ inline: true });
    await render(<DiffView doc={doc} visible />);
    await flush();
    expect(document.querySelector(".cm-merge-revert")).toBeNull();
    expect(document.querySelector(".cm-merge-revert button, .cm-chunkButtons")).toBeNull();
  });
});
