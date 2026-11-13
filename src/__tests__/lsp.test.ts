import { describe, expect, it } from "vitest";
import { installCommand, languageIdOf, offsetOf, pathToUri, sanitizeHTML, serverFor, SERVERS, severityOf, splitCommand, typescriptInstall, uriKey, uriToPath } from "../lib/lspServers";

describe("language servers", () => {
  it("picks a server by file extension, unless switched off", () => {
    expect(serverFor("C:\\p\\a.tsx")?.id).toBe("typescript");
    expect(serverFor("C:\\p\\main.rs")?.id).toBe("rust");
    expect(serverFor("C:\\p\\x.PY")?.id).toBe("python");
    expect(serverFor("C:\\p\\a.tsx", ["typescript"])).toBeNull();
    expect(serverFor("C:\\p\\notes.txt")).toBeNull();
    expect(serverFor(null)).toBeNull();
  });

  it("gives LSP language ids", () => {
    expect(languageIdOf("a.tsx")).toBe("typescriptreact");
    expect(languageIdOf("a.mjs")).toBe("javascript");
    expect(languageIdOf("a.hpp")).toBe("cpp");
    expect(languageIdOf("a.unknown")).toBe("plaintext");
  });

  it("converts paths and file URIs both ways, whatever spelling a server uses", () => {
    const p = "C:\\My Code\\src\\a#1.ts";
    const uri = pathToUri(p);
    expect(uri).toBe("file:///c%3A/My%20Code/src/a%231.ts");
    expect(uriToPath(uri)).toBe(p);
    expect(uriToPath("file:///C:/My%20Code/src/a%231.ts")).toBe(p);
    expect(uriToPath("file:///c:/x/y.ts")).toBe("C:\\x\\y.ts");
    expect(uriKey("file:///C:/X/Y.ts")).toBe(uriKey("file:///c%3A/x/y.ts"));
    expect(uriToPath(pathToUri("\\\\server\\share\\a b.py"))).toBe("\\\\server\\share\\a b.py");
  });

  it("maps LSP positions to offsets, clamped to the line", () => {
    const lines = ["ab", "cdef", ""];
    const starts = [0, 3, 8];
    const lineAt = (n: number) => (n >= 1 && n <= lines.length ? { from: starts[n - 1], length: lines[n - 1].length } : null);
    expect(offsetOf(lineAt, { line: 1, character: 2 }, 8)).toBe(5);
    expect(offsetOf(lineAt, { line: 0, character: 99 }, 8)).toBe(2);
    expect(offsetOf(lineAt, { line: 9, character: 0 }, 8)).toBe(8);
  });

  it("maps severities", () => {
    expect([1, 2, 3, 4, undefined].map(severityOf)).toEqual(["error", "warning", "info", "hint", "error"]);
  });

  it("splits command lines with quotes", () => {
    expect(splitCommand('"C:\\Program Files\\LLVM\\bin\\clangd.exe" --background-index')).toEqual(["C:\\Program Files\\LLVM\\bin\\clangd.exe", "--background-index"]);
    expect(splitCommand("  pylsp   ")).toEqual(["pylsp"]);
    expect(splitCommand('x ""')).toEqual(["x", ""]);
  });

  it("strips active content from hover documentation", () => {
    const out = sanitizeHTML('<p onclick="x()">Hi <a href="javascript:alert(1)">bad</a> <a href="https://ok.dev">ok</a></p><script>alert(1)</script><img src=x onerror=alert(1)><iframe src="https://x"></iframe><code class="c">x</code>');
    expect(out).not.toMatch(/script|onclick|onerror|javascript:|iframe/i);
    expect(out).toContain('<a href="https://ok.dev">ok</a>');
    expect(out).toContain('<code class="c">x</code>');
  });
});

describe("TypeScript install offer", () => {
  const ts = SERVERS.find((d) => d.id === "typescript")!;
  it("adds typescript-language-server to an installed TypeScript instead of reinstalling TypeScript", () => {
    expect(typescriptInstall(true)).toBe("npm install -g typescript-language-server");
    expect(typescriptInstall(false)).toBe("npm install -g typescript-language-server typescript");
    expect(installCommand(ts, true)).toBe("npm install -g typescript-language-server");
    expect(installCommand(ts, false)).toBe("npm install -g typescript-language-server typescript");
  });
  it("falls back to installing both when it is not known what is installed", () => {
    expect(installCommand(ts, null)).toBe(ts.install);
    expect(ts.install).toBe("npm install -g typescript-language-server typescript");
  });
  it("leaves other servers' commands alone", () => {
    const py = SERVERS.find((d) => d.id === "python")!;
    expect(installCommand(py, true)).toBe("npm install -g pyright");
  });
});
