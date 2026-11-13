/**
 * Code intelligence: which language server handles which files, how to install it, and the small
 * pure helpers the LSP client needs (file URIs, language ids, positions, sanitising hover HTML).
 * Unit-tested; the client itself is in lsp.ts.
 */

export interface ServerDef {
  id: string;
  /** Shown in Settings and the status bar. */
  name: string;
  /** File extensions (lower case, no dot) it handles. */
  extensions: string[];
  command: string;
  args: string[];
  /** Files whose folder is the project root, nearest first (`*.ext` matches by suffix). */
  rootMarkers: string[];
  /** Command line that installs it (run in a terminal tab from Settings). TypeScript's depends on
   *  what is installed already: see `installCommand`. */
  install: string;
  /** What `install` needs first. */
  needs?: string;
  initializationOptions?: Record<string, unknown>;
}

/**
 * TypeScript's install offer. TypeScript 7 serves LSP itself; 5 and 6 need typescript-language-server.
 * The offer only shows when no server could be started, so with TypeScript already installed (in
 * the project or globally, `hasTypeScript`) what is missing is typescript-language-server, and an
 * existing TypeScript is left alone; with none at all, both are installed (whatever version npm's
 * `typescript` is, one of the two then serves).
 */
export function typescriptInstall(hasTypeScript: boolean): string {
  return hasTypeScript ? "npm install -g typescript-language-server" : "npm install -g typescript-language-server typescript";
}

/** The install command for a server; `hasTypeScript` (Rust `lsp_typescript_found`) only matters for TypeScript. */
export function installCommand(def: ServerDef, hasTypeScript: boolean | null): string {
  return def.id === "typescript" && hasTypeScript !== null ? typescriptInstall(hasTypeScript) : def.install;
}

export const SERVERS: ServerDef[] = [
  {
    id: "typescript",
    name: "TypeScript / JavaScript",
    extensions: ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"],
    // TypeScript 7 serves LSP itself (`tsc --lsp --stdio`); earlier versions go through
    // typescript-language-server. lib/lsp.ts picks per project (Rust `lsp_typescript`).
    command: "tsc",
    args: ["--lsp", "--stdio"],
    rootMarkers: ["tsconfig.json", "jsconfig.json", "package.json", ".git"],
    install: typescriptInstall(false),
    needs: "Node.js",
    initializationOptions: { preferences: { includeCompletionsForModuleExports: true, includeCompletionsWithInsertText: true } },
  },
  {
    id: "python",
    name: "Python (Pyright)",
    extensions: ["py", "pyi"],
    command: "pyright-langserver",
    args: ["--stdio"],
    rootMarkers: ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "pyrightconfig.json", ".git"],
    install: "npm install -g pyright",
    needs: "Node.js",
  },
  {
    id: "rust",
    name: "Rust (rust-analyzer)",
    extensions: ["rs"],
    command: "rust-analyzer",
    args: [],
    rootMarkers: ["Cargo.toml", ".git"],
    install: "rustup component add rust-analyzer",
    needs: "Rust (rustup)",
  },
  {
    id: "go",
    name: "Go (gopls)",
    extensions: ["go"],
    command: "gopls",
    args: [],
    rootMarkers: ["go.work", "go.mod", ".git"],
    install: "go install golang.org/x/tools/gopls@latest",
    needs: "Go",
  },
  {
    id: "c",
    name: "C / C++ (clangd)",
    extensions: ["c", "h", "cc", "cpp", "cxx", "hpp", "hh", "hxx"],
    command: "clangd",
    args: [],
    rootMarkers: ["compile_commands.json", "compile_flags.txt", ".clangd", "CMakeLists.txt", ".git"],
    install: "winget install --id LLVM.LLVM -e",
    needs: "winget",
  },
  {
    id: "csharp",
    name: "C# (csharp-ls)",
    extensions: ["cs"],
    command: "csharp-ls",
    args: [],
    rootMarkers: ["*.sln", "*.csproj", ".git"],
    install: "dotnet tool install --global csharp-ls",
    needs: ".NET SDK",
  },
  {
    id: "css",
    name: "CSS / SCSS / Less",
    extensions: ["css", "scss", "less"],
    command: "vscode-css-language-server",
    args: ["--stdio"],
    rootMarkers: ["package.json", ".git"],
    install: "npm install -g vscode-langservers-extracted",
    needs: "Node.js",
    initializationOptions: { provideFormatter: true },
  },
  {
    id: "html",
    name: "HTML",
    extensions: ["html", "htm"],
    command: "vscode-html-language-server",
    args: ["--stdio"],
    rootMarkers: ["package.json", ".git"],
    install: "npm install -g vscode-langservers-extracted",
    needs: "Node.js",
    initializationOptions: { provideFormatter: true, embeddedLanguages: { css: true, javascript: true } },
  },
];

const extOf = (path: string) => {
  const name = path.split(/[\\/]/).pop() ?? "";
  return name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
};

/** The server for a file, unless switched off in Settings. */
export function serverFor(path: string | null, disabled: readonly string[] = []): ServerDef | null {
  if (!path) return null;
  const ext = extOf(path);
  return SERVERS.find((s) => s.extensions.includes(ext) && !disabled.includes(s.id)) ?? null;
}

const LANGUAGE_IDS: Record<string, string> = {
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "typescriptreact",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascriptreact",
  py: "python", pyi: "python", rs: "rust", go: "go",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp", hxx: "cpp",
  cs: "csharp", css: "css", scss: "scss", less: "less", html: "html", htm: "html",
};

/** LSP language id of a file (`typescriptreact`, `cpp`, ...). */
export const languageIdOf = (path: string) => LANGUAGE_IDS[extOf(path)] ?? "plaintext";

/** `C:\a b\c.ts` → `file:///c%3A/a%20b/c.ts` (the spelling VS Code uses, which servers expect). */
export function pathToUri(path: string): string {
  const p = path.replace(/\\/g, "/");
  const m = /^([a-zA-Z]):\/(.*)$/.exec(p);
  if (m) return `file:///${m[1].toLowerCase()}%3A/${m[2].split("/").map(encodeURIComponent).join("/")}`;
  if (p.startsWith("//")) return `file:${p.split("/").map((s, i) => (i < 2 ? s : encodeURIComponent(s))).join("/")}`;
  return `file://${p.split("/").map(encodeURIComponent).join("/")}`;
}

/** A file URI back to a Windows path (any common spelling: `c%3A`, `C:`, `/c:/`). */
export function uriToPath(uri: string): string {
  let p = decodeURIComponent(uri.replace(/^file:/i, ""));
  if (p.startsWith("///")) p = p.slice(3);
  else if (p.startsWith("//")) p = `\\\\${p.slice(2)}`; // UNC: file://server/share
  if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
  p = p.replace(/\//g, "\\");
  return /^[a-z]:/.test(p) ? p[0].toUpperCase() + p.slice(1) : p;
}

/** Key for comparing URIs from different sources (case and encoding differ between servers). */
export const uriKey = (uri: string) => uriToPath(uri).toLowerCase();

/** LSP `{line, character}` (UTF-16, like CodeMirror) → offset in a document given its line starts. */
export function offsetOf(lineStarts: (line: number) => { from: number; length: number } | null, pos: { line: number; character: number }, docLength: number): number {
  const l = lineStarts(pos.line + 1);
  if (!l) return docLength;
  return l.from + Math.min(Math.max(0, pos.character), l.length);
}

export type Severity = "error" | "warning" | "info" | "hint";
export const severityOf = (n?: number): Severity => (n === 2 ? "warning" : n === 3 ? "info" : n === 4 ? "hint" : "error");

/** Split a command line (from Settings) into program and arguments, honouring double quotes. */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  let any = false;
  for (const ch of line) {
    if (ch === '"') {
      quoted = !quoted;
      any = true;
    } else if (/\s/.test(ch) && !quoted) {
      if (any) out.push(cur);
      cur = "";
      any = false;
    } else {
      cur += ch;
      any = true;
    }
  }
  if (any) out.push(cur);
  return out;
}

const DROP_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "BASE", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT", "SVG", "MATH", "TEMPLATE", "FRAME", "FRAMESET"]);

/**
 * Hover and completion docs from a server are Markdown rendered to HTML by the LSP client. Docs
 * come from the project's dependencies, so treat them as untrusted: keep formatting tags, drop
 * active content, event handlers, styles and non-web links.
 */
export function sanitizeHTML(html: string): string {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      if (DROP_TAGS.has(child.tagName.toUpperCase())) {
        child.remove();
        continue;
      }
      for (const a of [...child.attributes]) {
        const name = a.name.toLowerCase();
        const keep = name === "class" || (name === "href" && /^(https?:|#)/i.test(a.value.trim())) || (name === "src" && /^(https?:|data:image\/)/i.test(a.value.trim()));
        if (!keep) child.removeAttribute(a.name);
      }
      walk(child);
    }
  };
  walk(tpl.content as unknown as Element);
  return tpl.innerHTML;
}
