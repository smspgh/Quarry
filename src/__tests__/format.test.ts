import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";

// Format Document with a stand-in editor and Tauri bridge; Prettier itself is the real bundled one.
const h = vi.hoisted(() => ({
  view: null as null | { state: import("@codemirror/state").EditorState },
  replaced: null as string | null,
  goTo: null as null | [number, number],
  jsonFormat: vi.fn(),
  formatExternal: vi.fn(),
}));

vi.mock("../editor/manager", () => ({
  editor: {
    get view() {
      return h.view;
    },
    replaceAll: (_id: string, text: string) => {
      h.replaced = text;
    },
    goTo: (line: number, col: number) => {
      h.goTo = [line, col];
    },
  },
}));
vi.mock("../lib/ipc", () => ({ json: { format: h.jsonFormat }, sys: { formatExternal: h.formatExternal } }));

import { canFormat, formatDocument } from "../lib/format";
import { useStore, type Doc } from "../lib/store";

const open = (text: string, language: string, o: { sel?: [number, number]; readonly?: boolean; path?: string | null } = {}) => {
  const doc: Doc = { id: "d", kind: "text", path: o.path === undefined ? "C:\\p\\file" : o.path, name: "file", dirty: false, encoding: "UTF-8", bom: false, eol: "LF", language, readonly: !!o.readonly, modifiedMs: 0 };
  useStore.setState({ docs: [doc], activeId: "d", split: null, toasts: [] });
  h.view = {
    state: EditorState.create({
      doc: text,
      selection: o.sel ? EditorSelection.single(o.sel[0], o.sel[1]) : undefined,
      extensions: EditorState.readOnly.of(!!o.readonly),
    }),
  };
};
const toast = () => useStore.getState().toasts.map((t) => t.message).join(" | ");

beforeEach(() => {
  h.replaced = null;
  h.goTo = null;
  h.jsonFormat.mockReset();
  h.formatExternal.mockReset();
});

describe("Format Document", () => {
  it("knows which languages it can format", () => {
    expect(canFormat("JSON")).toBe(true);
    expect(canFormat("CSS")).toBe(true);
    expect(canFormat("Rust")).toBe(true);
    expect(canFormat("Plain Text")).toBe(false);
  });

  it("formats with Prettier and names the language", async () => {
    open("const a={x:1}\n", "JavaScript");
    expect(await formatDocument()).toBe(true);
    expect(h.replaced).toBe("const a = { x: 1 };\n");
    expect(toast()).toBe("Formatted (JavaScript)");
  });

  it("says when there is nothing to do", async () => {
    open("const a = 1;\n", "JavaScript");
    expect(await formatDocument()).toBe(true);
    expect(h.replaced).toBeNull();
    expect(toast()).toBe("Already formatted");
  });

  it("formats only the selection where Prettier supports ranges", async () => {
    open("const a={x:1}\nconst b={y:2}\n", "JavaScript", { sel: [0, 13] });
    await formatDocument();
    expect(h.replaced).toBe("const a = { x: 1 };\nconst b={y:2}\n");
    expect(toast()).toBe("Formatted selection");
  });

  it("ignores the selection for CSS, which Prettier cannot range-format", async () => {
    open("a{color:red}\nb{color:blue}\n", "CSS", { sel: [0, 12] });
    await formatDocument();
    expect(h.replaced).toBe("a {\n    color: red;\n}\nb {\n    color: blue;\n}\n"); // Tab size 4 by default
    expect(toast()).toBe("Formatted (CSS)");
  });

  it("shows the first line of a parse error and changes nothing", async () => {
    open("function f(a {\n  return 1\n}\n", "JavaScript");
    expect(await formatDocument()).toBe(false);
    expect(h.replaced).toBeNull();
    expect(toast()).toBe('Format failed: Unexpected token, expected "," (1:14)');
  });

  it("leaves a read-only document alone", async () => {
    open("const a={x:1}\n", "JavaScript", { readonly: true });
    expect(await formatDocument()).toBe(false);
    expect(h.replaced).toBeNull();
    expect(toast()).toBe("file is read-only.");
  });

  it("has no formatter for Plain Text", async () => {
    open("hello", "Plain Text");
    expect(await formatDocument()).toBe(false);
    expect(toast()).toBe("No formatter for Plain Text. Use Code › Language to pick the right language.");
  });
});

describe("Format Document: JSON", () => {
  it("uses the Rust formatter with the JSON indent setting", async () => {
    open('{"a":1}', "JSON");
    h.jsonFormat.mockResolvedValue({ ok: true, output: '{\n  "a": 1\n}', error: null });
    await formatDocument();
    expect(h.jsonFormat).toHaveBeenCalledWith('{"a":1}', useStore.getState().settings.jsonIndent, !useStore.getState().settings.insertSpaces);
    expect(h.replaced).toBe('{\n  "a": 1\n}');
  });

  it("moves the cursor to an error", async () => {
    open('{"a":1,,}', "JSON");
    h.jsonFormat.mockResolvedValue({ ok: false, output: null, error: { line: 1, column: 8, message: "expected value" } });
    expect(await formatDocument()).toBe(false);
    expect(h.goTo).toEqual([1, 8]);
    expect(toast()).toBe("JSON is not valid: expected value (line 1)");
  });

  it("does not call valid JSON with too large an output invalid", async () => {
    open("[[[]]]", "JSON");
    h.jsonFormat.mockResolvedValue({ ok: false, output: null, error: { line: 0, column: 0, message: "output too large" } });
    expect(await formatDocument()).toBe(false);
    expect(h.goTo).toBeNull();
    expect(toast()).toBe("Cannot pretty-print: output too large");
  });
});

describe("Format Document: installed formatters", () => {
  it("prefers the installed tool, run in the document's folder", async () => {
    open("fn main(){}", "Rust", { path: "C:\\proj\\src\\main.rs" });
    h.formatExternal.mockResolvedValue({ ok: true, output: "fn main() {}\n", error: "", notFound: false });
    await formatDocument();
    expect(h.formatExternal).toHaveBeenCalledWith("rustfmt", ["--edition", "2021", "--emit", "stdout"], "fn main(){}", "C:\\proj\\src");
    expect(h.replaced).toBe("fn main() {}\n");
    expect(toast()).toBe("Formatted (Rust, rustfmt)");
  });

  it("explains how to install a missing tool with no built-in fallback", async () => {
    open("fn main(){}", "Rust");
    h.formatExternal.mockResolvedValue({ ok: false, output: "", error: "program not found", notFound: true });
    expect(await formatDocument()).toBe(false);
    expect(toast()).toBe("rustfmt is not installed. To format Rust: rustup component add rustfmt");
  });

  it("shows the tool's own error and does not fall back", async () => {
    open("package main\nfunc main() { if x {\n", "Go");
    h.formatExternal.mockResolvedValue({ ok: false, output: "", error: "<standard input>:2:22: expected '}', found 'EOF'", notFound: false });
    expect(await formatDocument()).toBe(false);
    expect(h.replaced).toBeNull();
    expect(toast()).toBe("gofmt failed:\n<standard input>:2:22: expected '}', found 'EOF'");
  });

  it.each([
    "Could not execute because the specified command or file was not found.",
    "The command could not be loaded, possibly because:\n  * You intended to execute a .NET application:\n      The application 'csharpier' does not exist.",
  ])("treats dotnet without CSharpier as not installed: %s", async (message) => {
    open("class A{}", "C#");
    h.formatExternal.mockResolvedValue({ ok: false, output: "", error: message, notFound: false });
    await formatDocument().catch(() => false);
    // The built-in clang-format (WebAssembly) is tried next, not the "dotnet failed" error.
    expect(toast()).not.toContain("dotnet failed");
  });
});
