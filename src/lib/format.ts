/**
 * Language-aware "Format Document". JSON goes through the Rust formatter (preserves key order
 * and number precision); web languages use Prettier (loaded on demand so startup stays light);
 * other languages use their standard formatter when it is installed, otherwise a built-in
 * WebAssembly / JS build of a formatter (also loaded on demand).
 */
import { editor } from "../editor/manager";
import { json as jsonIpc, sys } from "./ipc";
import { activeDoc, useStore } from "./store";

type Loader = () => Promise<unknown>;

interface PrettierTarget {
  parser: string;
  plugins: Loader[];
  /**
   * Prettier honours `rangeStart` / `rangeEnd` for this parser. Only the JS, TS, GraphQL and Vue
   * parsers do; for the others a range formats nothing, so the selection is ignored there.
   */
  range?: true;
}

const babel = () => import("prettier/plugins/babel");
const estree = () => import("prettier/plugins/estree");
const typescript = () => import("prettier/plugins/typescript");
const postcss = () => import("prettier/plugins/postcss");
const html = () => import("prettier/plugins/html");
const markdown = () => import("prettier/plugins/markdown");
const yaml = () => import("prettier/plugins/yaml");
const graphql = () => import("prettier/plugins/graphql");
const xml = () => import("@prettier/plugin-xml");

const PRETTIER: Record<string, PrettierTarget> = {
  JavaScript: { parser: "babel", plugins: [babel, estree], range: true },
  JSX: { parser: "babel", plugins: [babel, estree], range: true },
  TypeScript: { parser: "typescript", plugins: [typescript, estree], range: true },
  TSX: { parser: "typescript", plugins: [typescript, estree], range: true },
  CSS: { parser: "css", plugins: [postcss] },
  SCSS: { parser: "scss", plugins: [postcss] },
  Less: { parser: "less", plugins: [postcss] },
  HTML: { parser: "html", plugins: [html] },
  Vue: { parser: "vue", plugins: [html, babel, estree, postcss], range: true },
  Angular: { parser: "angular", plugins: [html] },
  Markdown: { parser: "markdown", plugins: [markdown] },
  YAML: { parser: "yaml", plugins: [yaml] },
  GraphQL: { parser: "graphql", plugins: [graphql], range: true },
  XML: { parser: "xml", plugins: [xml] },
  SVG: { parser: "xml", plugins: [xml] },
};

type Settings = ReturnType<typeof useStore.getState>["settings"];

/** A formatter bundled with the app (WebAssembly or plain JS), loaded on first use. */
interface Builtin {
  /** Shown in the success toast, e.g. "built-in ruff". */
  name: string;
  run: (text: string, s: Settings) => Promise<string>;
}

/** Standard formatter for a language, invoked with the document on stdin. */
interface External {
  tool: string;
  args: string[];
  install: string;
  /** Error output meaning the formatter itself is missing although `tool` ran (e.g. `dotnet` without CSharpier). */
  missing?: RegExp;
}

const clangStyle = (base: string, s: Settings, extra = "") =>
  `{BasedOnStyle: ${base}, IndentWidth: ${s.tabSize}, TabWidth: ${s.tabSize}, UseTab: ${s.insertSpaces ? "Never" : "Always"}, ColumnLimit: 100${extra}}`;

async function clangFormat(text: string, filename: "main.c" | "main.cpp" | "main.cs", style: string): Promise<string> {
  const m = await import("@wasm-fmt/clang-format/vite");
  await m.default();
  return m.format(text, filename, style);
}

const sqlBuiltin = (dialect: string): Builtin => ({
  name: "built-in sql-formatter",
  run: async (text, s) => {
    const { format } = await import("sql-formatter");
    return format(text, { language: dialect as never, tabWidth: s.tabSize, useTabs: !s.insertSpaces });
  },
});

/**
 * Languages with a standard command-line formatter and/or a built-in one. An installed tool wins,
 * so output matches the user's own setup; the built-in formatter covers machines without it.
 */
const CODE: Record<string, { external?: External; builtin?: Builtin }> = {
  Rust: { external: { tool: "rustfmt", args: ["--edition", "2021", "--emit", "stdout"], install: "rustup component add rustfmt" } },
  Go: {
    external: { tool: "gofmt", args: [], install: "install Go (gofmt ships with it)" },
    builtin: {
      name: "built-in gofmt",
      run: async (text) => {
        const m = await import("@wasm-fmt/gofmt/vite");
        await m.default();
        return m.format(text);
      },
    },
  },
  Python: {
    external: { tool: "ruff", args: ["format", "-"], install: "pip install ruff" },
    builtin: {
      name: "built-in ruff",
      run: async (text, s) => {
        const m = await import("@wasm-fmt/ruff_fmt/vite");
        await m.default();
        return m.format(text, null, { indent_style: s.insertSpaces ? "space" : "tab", indent_width: s.tabSize });
      },
    },
  },
  C: {
    external: { tool: "clang-format", args: [], install: "install LLVM / clang-format" },
    builtin: { name: "built-in clang-format", run: (text, s) => clangFormat(text, "main.c", clangStyle("LLVM", s)) },
  },
  "C++": {
    external: { tool: "clang-format", args: [], install: "install LLVM / clang-format" },
    builtin: { name: "built-in clang-format", run: (text, s) => clangFormat(text, "main.cpp", clangStyle("LLVM", s)) },
  },
  "C#": {
    external: { tool: "dotnet", args: ["csharpier", "--"], install: "dotnet tool install -g csharpier", missing: /csharpier' does not exist|could not execute|could not be loaded/i },
    builtin: { name: "built-in clang-format", run: (text, s) => clangFormat(text, "main.cs", clangStyle("Microsoft", s, ", NamespaceIndentation: All")) },
  },
  Java: {
    external: { tool: "google-java-format", args: ["-"], install: "install google-java-format" },
    builtin: {
      name: "built-in prettier-plugin-java",
      run: async (text, s) => {
        const [prettier, java] = await Promise.all([import("prettier/standalone"), import("prettier-plugin-java")]);
        return prettier.format(text, { parser: "java", plugins: [(java as { default?: unknown }).default ?? java] as never[], tabWidth: s.tabSize, useTabs: !s.insertSpaces, printWidth: 100 });
      },
    },
  },
  Shell: {
    external: { tool: "shfmt", args: ["-"], install: "install shfmt" },
    builtin: {
      name: "built-in shfmt",
      run: async (text, s) => {
        const m = await import("@wasm-fmt/shfmt/vite");
        await m.default();
        // shfmt indents with tabs when indent is 0.
        return m.format(text, "script.sh", { indent: s.insertSpaces ? s.tabSize : 0 });
      },
    },
  },
  SQL: { external: { tool: "sqlfluff", args: ["fix", "-"], install: "pip install sqlfluff" }, builtin: sqlBuiltin("sql") },
  MySQL: { builtin: sqlBuiltin("mysql") },
  "MariaDB SQL": { builtin: sqlBuiltin("mariadb") },
  PostgreSQL: { builtin: sqlBuiltin("postgresql") },
  "MS SQL": { builtin: sqlBuiltin("transactsql") },
  SQLite: { builtin: sqlBuiltin("sqlite") },
  PLSQL: { builtin: sqlBuiltin("plsql") },
};

export function canFormat(language: string): boolean {
  return language === "JSON" || language in PRETTIER || language in CODE;
}

export async function formatDocument(): Promise<boolean> {
  const store = useStore.getState();
  const doc = activeDoc(store);
  if (!doc || doc.kind !== "text" || !editor.view) return false;
  const view = editor.view;
  if (view.state.readOnly) {
    store.toast(`${doc.name} is read-only.`, "info", 2000);
    return false;
  }
  const lang = doc.language;
  const s = store.settings;
  const text = view.state.doc.toString();
  const sel = view.state.selection.main;
  const hasRange = !sel.empty && !!PRETTIER[lang]?.range;

  try {
    let out: string;
    let via = lang;
    if (lang === "JSON") {
      const r = await jsonIpc.format(text, s.jsonIndent, !s.insertSpaces);
      if (!r.ok) {
        // Line 0 means the JSON is fine but the result cannot be produced (pretty output too large).
        if (r.error?.line === 0) store.toast(`Cannot pretty-print: ${r.error.message}`, "warning", 6000);
        else store.toast(`JSON is not valid: ${r.error?.message ?? "parse error"} (line ${r.error?.line ?? "?"})`, "error");
        return false;
      }
      out = r.output ?? text;
    } else if (lang in PRETTIER) {
      const target = PRETTIER[lang];
      const [prettier, ...plugins] = await Promise.all([import("prettier/standalone"), ...target.plugins.map((p) => p())]);
      out = await prettier.format(text, {
        parser: target.parser,
        // CommonJS plugins (plugin-xml) arrive wrapped in a default export.
        plugins: plugins.map((p) => (p as { default?: unknown }).default ?? p) as never[],
        tabWidth: s.tabSize,
        useTabs: !s.insertSpaces,
        endOfLine: "lf",
        printWidth: 100,
        ...(hasRange ? { rangeStart: sel.from, rangeEnd: sel.to } : {}),
        // Plugin-specific niceties.
        xmlWhitespaceSensitivity: "ignore",
        bracketSameLine: false,
      } as never);
    } else if (lang in CODE) {
      const { external: ext, builtin } = CODE[lang];
      let result: string | null = null;
      if (ext) {
        // Run in the document's folder so the tool picks up project config files.
        const cwd = doc.path ? doc.path.replace(/[\\/][^\\/]*$/, "") : null;
        const r = await sys.formatExternal(ext.tool, ext.args, text, cwd);
        if (!r.ok && ext.missing?.test(r.error)) r.notFound = true;
        if (r.ok) {
          result = r.output;
          via = `${lang}, ${ext.tool}`;
        } else if (!r.notFound || !builtin) {
          store.toast(r.notFound ? `${ext.tool} is not installed. To format ${lang}: ${ext.install}` : `${ext.tool} failed:\n${r.error}`, r.notFound ? "warning" : "error", 6000);
          return false;
        }
      }
      if (result === null && builtin) {
        result = await builtin.run(text, s);
        via = `${lang}, ${builtin.name}`;
      }
      out = result ?? text;
    } else {
      store.toast(`No formatter for ${lang}. Use Code › Language to pick the right language.`, "info", 3500);
      return false;
    }
    if (out === text) {
      store.toast("Already formatted", "info", 1200);
      return true;
    }
    editor.replaceAll(doc.id, out);
    store.toast(hasRange ? "Formatted selection" : `Formatted (${via})`, "success", 1500);
    return true;
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).split("\n")[0];
    store.toast(`Format failed: ${msg}`, "error", 6000);
    return false;
  }
}
