import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
  HighlightStyle,
  LanguageDescription,
  type LanguageSupport,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { json } from "@codemirror/lang-json";
import { javascript } from "@codemirror/lang-javascript";
import { lintGutter } from "@codemirror/lint";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  crosshairCursor,
  Decoration,
  type DecorationSet,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  highlightTrailingWhitespace,
  highlightWhitespace,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { Settings } from "../lib/types";
import { columnModeEnabled, columnModeExtensions } from "./columnMode";
import { viewportDrawSelection } from "./viewportSelection";
import { bulkEditing } from "./bulkEdit";
import { findScopeField } from "./findScope";

export const compartments = {
  language: new Compartment(),
  lineNumbers: new Compartment(),
  wrap: new Compartment(),
  columnMode: new Compartment(),
  whitespace: new Compartment(),
  indent: new Compartment(),
  readOnly: new Compartment(),
  activeLine: new Compartment(),
  brackets: new Compartment(),
  closeBrackets: new Compartment(),
  fontTheme: new Compartment(),
  /** Language server plugin of the document (lib/lsp.ts). */
  lsp: new Compartment(),
  /** Autocompletion: suggestions while typing only where a language server answers. */
  completion: new Compartment(),
};

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: "var(--syn-keyword)" },
  { tag: [t.string, t.special(t.string), t.inserted], color: "var(--syn-string)" },
  { tag: [t.number, t.integer, t.float, t.deleted], color: "var(--syn-number)" },
  { tag: [t.bool, t.null, t.atom, t.self], color: "var(--syn-bool)" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: [t.propertyName, t.attributeName, t.definition(t.propertyName)], color: "var(--syn-property)" },
  { tag: [t.typeName, t.className, t.namespace, t.tagName, t.standard(t.tagName)], color: "var(--syn-type)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName, t.labelName], color: "var(--syn-func)" },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: "var(--syn-op)" },
  { tag: [t.variableName, t.definition(t.variableName)], color: "var(--text)" },
  { tag: [t.regexp, t.escape], color: "var(--syn-number)" },
  { tag: t.invalid, color: "var(--syn-invalid)" },
  { tag: t.heading, fontWeight: "bold", color: "var(--syn-keyword)" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.link, color: "var(--accent)", textDecoration: "underline" },
  { tag: t.url, color: "var(--accent)" },
  { tag: t.meta, color: "var(--text-3)" },
]);

function fontTheme(s: Settings): Extension {
  return EditorView.theme({
    "&": { fontSize: `${s.fontSize}px`, backgroundColor: "transparent", color: "var(--text)" },
    ".cm-scroller": { fontFamily: s.fontFamily },
    // Right padding keeps wrapped lines off the scrollbar / window edge when word wrap is on.
    ".cm-content": { fontFamily: s.fontFamily, caretColor: "var(--cursor)", paddingRight: "24px" },
    ".cm-gutters": { backgroundColor: "var(--gutter-bg)", color: "var(--text-3)", border: "none" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text)" },
    ".cm-activeLine": { backgroundColor: "var(--active-line)" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "var(--sel-bg)" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--cursor)" },
    ".cm-tooltip": { backgroundColor: "var(--flyout)", color: "var(--text)", border: "1px solid var(--stroke-2)" },
    // Quarry has its own find bar, so CodeMirror's panel area stays hidden, except for the language
    // server's panels (references list, rename box, messages).
    ".cm-panels:not(:has(.cm-lsp-reference-panel, .cm-dialog, .cm-lsp-rename-panel, .cm-lsp-message))": { display: "none" },
  });
}

/** Briefly highlight the lines covering a range (used when revealing from the JSON tree / search). */
export const flashRange = StateEffect.define<{ from: number; to: number } | null>();
const flashDeco = Decoration.line({ class: "cm-flash-line" });
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(flashRange)) {
        if (!e.value) return Decoration.none;
        const doc = tr.state.doc;
        const a = doc.lineAt(Math.min(e.value.from, doc.length)).number;
        const b = doc.lineAt(Math.min(e.value.to, doc.length)).number;
        const lines = [];
        for (let n = a; n <= Math.min(b, a + 200); n++) lines.push(flashDeco.range(doc.line(n).from));
        return Decoration.set(lines);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** A hidden panel keeps @codemirror/search's match highlighting active while our own find bar is visible. */
function hiddenSearchPanel(_view: EditorView) {
  const dom = document.createElement("div");
  dom.style.display = "none";
  return { dom, top: true };
}

export function baseExtensions(settings: Settings, extra: Extension[] = []): Extension[] {
  return [
    compartments.lineNumbers.of(settings.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
    highlightSpecialChars(),
    history(),
    foldGutter({ openText: "⌄", closedText: "›" }),
    bulkEditing(), // linear-time typing / deleting with 500+ cursors
    viewportDrawSelection(), // drawSelection() that only measures visible ranges (huge multi-cursor selections)
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(highlight),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    compartments.brackets.of(settings.bracketMatching ? bracketMatching() : []),
    compartments.closeBrackets.of(settings.autoCloseBrackets ? closeBrackets() : []),
    compartments.completion.of(autocompletion({ activateOnTyping: false })),
    compartments.lsp.of([]),
    crosshairCursor(),
    compartments.activeLine.of(settings.highlightActiveLine ? highlightActiveLine() : []),
    highlightSelectionMatches({ minSelectionLength: 2 }),
    search({ createPanel: hiddenSearchPanel, top: true }),
    findScopeField, // Find in Selection ranges
    lintGutter(),
    flashField,
    columnModeEnabled,
    compartments.columnMode.of(columnModeExtensions(false)),
    compartments.wrap.of(settings.wordWrap ? EditorView.lineWrapping : []),
    compartments.whitespace.of(settings.renderWhitespace ? [highlightWhitespace(), highlightTrailingWhitespace()] : []),
    compartments.indent.of([EditorState.tabSize.of(settings.tabSize), indentUnit.of(settings.insertSpaces ? " ".repeat(settings.tabSize) : "\t")]),
    compartments.readOnly.of(EditorState.readOnly.of(false)),
    compartments.fontTheme.of(fontTheme(settings)),
    compartments.language.of([]),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap.filter((k) => k.key !== "Mod-f" && k.key !== "Mod-h" && k.key !== "F3" && k.key !== "Shift-F3" && k.key !== "Mod-g" && k.key !== "Mod-Shift-g" && k.key !== "Escape"),
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
    ...extra,
  ];
}

export function settingsReconfigure(s: Settings) {
  return [
    compartments.lineNumbers.reconfigure(s.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
    compartments.wrap.reconfigure(s.wordWrap ? EditorView.lineWrapping : []),
    compartments.whitespace.reconfigure(s.renderWhitespace ? [highlightWhitespace(), highlightTrailingWhitespace()] : []),
    compartments.indent.reconfigure([EditorState.tabSize.of(s.tabSize), indentUnit.of(s.insertSpaces ? " ".repeat(s.tabSize) : "\t")]),
    compartments.activeLine.reconfigure(s.highlightActiveLine ? highlightActiveLine() : []),
    compartments.brackets.reconfigure(s.bracketMatching ? bracketMatching() : []),
    compartments.closeBrackets.reconfigure(s.autoCloseBrackets ? closeBrackets() : []),
    compartments.fontTheme.reconfigure(fontTheme(s)),
  ];
}

// ---------- language detection ----------

const builtin: Record<string, () => LanguageSupport> = {
  json: () => json(),
  javascript: () => javascript(),
  typescript: () => javascript({ typescript: true }),
  jsx: () => javascript({ jsx: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
};

export interface LanguageInfo {
  name: string;
  load: () => Promise<LanguageSupport | null>;
}

export function detectLanguage(filename: string | null, firstLine = ""): LanguageInfo {
  const lower = (filename ?? "").toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  if (ext === "json" || ext === "jsonc" || ext === "json5" || ext === "har" || ext === "webmanifest") return { name: "JSON", load: async () => builtin.json() };
  if (ext === "js" || ext === "mjs" || ext === "cjs") return { name: "JavaScript", load: async () => builtin.javascript() };
  if (ext === "ts" || ext === "mts" || ext === "cts") return { name: "TypeScript", load: async () => builtin.typescript() };
  if (ext === "jsx") return { name: "JSX", load: async () => builtin.jsx() };
  if (ext === "tsx") return { name: "TSX", load: async () => builtin.tsx() };
  const desc = filename ? LanguageDescription.matchFilename(languages, filename) : null;
  if (desc) return { name: desc.name, load: () => desc.load() };
  const sniffed = sniffLanguage(firstLine);
  if (sniffed) return languageByName(sniffed);
  return { name: "Plain Text", load: async () => null };
}

/** Guess a language from the first few hundred characters of content. */
export function sniffLanguage(head: string): string | null {
  const t = head.trimStart();
  if (!t) return null;
  if (/^<\?xml/i.test(t) || /^<svg[\s>]/i.test(t)) return "XML";
  if (/^<!doctype html/i.test(t) || /^<html[\s>]/i.test(t)) return "HTML";
  if (/^#!.*\b(node|deno|bun)\b/.test(t)) return "JavaScript";
  if (/^#!.*\bpython/.test(t)) return "Python";
  if (/^#!.*\b(ba|z|da)?sh\b/.test(t)) return "Shell";
  if (/^<\?php/.test(t)) return "PHP";
  if (/^(\{\s*("|\}|$)|\[\s*(\{|\[|"|\d|\]|$))/.test(t)) return "JSON";
  if (/^---\s*$/m.test(t.slice(0, 4)) || /^\w[\w-]*:\s+\S/m.test(t.split("\n")[0] ?? "")) return "YAML";
  if (/^(use |fn |pub |impl |mod |#!\[|#\[derive)/.test(t)) return "Rust";
  if (/^(import |export |const |let |function |class )/.test(t) && /:\s*(string|number|boolean|any)\b|interface \w+ \{|<\w+>\(/.test(t)) return "TypeScript";
  if (/^(import |export |const |let |var |function |class |\/\/|\/\*)/.test(t)) return "JavaScript";
  if (/^(package |import \(|func )/.test(t)) return "Go";
  if (/^(#include|#pragma|int main\()/.test(t)) return "C++";
  if (/^(using System|namespace \w+|public class)/.test(t)) return "C#";
  if (/^(package [\w.]+;|import java\.)/.test(t)) return "Java";
  if (/^(def |class |from \w+ import |import \w+$)/m.test(t)) return "Python";
  if (/^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|WITH)\b/i.test(t)) return "SQL";
  if (/^(@import|@media|[.#]?[\w-]+\s*\{)/.test(t) && /[\w-]+\s*:\s*[^;]+;/.test(t)) return "CSS";
  if (/^# |^## /.test(t)) return "Markdown";
  return null;
}

export function languageByName(name: string): LanguageInfo {
  if (name === "Plain Text") return { name, load: async () => null };
  if (name === "JSON") return { name, load: async () => builtin.json() };
  const desc = LanguageDescription.matchLanguageName(languages, name, true);
  if (desc) return { name: desc.name, load: () => desc.load() };
  return { name: "Plain Text", load: async () => null };
}

/** "Plain Text" first (always reachable in long menus), then every language sorted by name. */
export const allLanguageNames: string[] = ["Plain Text", ...languages.map((l) => l.name).sort((a, b) => a.localeCompare(b))];
