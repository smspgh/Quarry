import { writeText as writeClipboard } from "@tauri-apps/plugin-clipboard-manager";
import type { Text } from "@codemirror/state";
import { editor } from "../editor/manager";
import { describeCopiedPath, formatPath, nodeAtOffset, parseJsonTree, pathSegments, valueClipboardText, type JsonNode, type ParseOutcome, type PathStyle } from "./jsonPath";
import { activeDoc, useStore } from "./store";

const cache = new Map<string, { doc: Text; outcome: ParseOutcome }>();
const MAX_TREE_BYTES = 64 * 1024 * 1024;

/** Parse (cached per document version) the JSON tree for a text document. */
export function getJsonTree(docId: string): ParseOutcome | null {
  const doc = editor.docOf(docId);
  if (!doc) return null;
  const hit = cache.get(docId);
  if (hit && hit.doc === doc) return hit.outcome;
  if (doc.length > MAX_TREE_BYTES) return { root: null, error: null, tooLarge: true };
  const outcome = parseJsonTree(doc.toString());
  cache.set(docId, { doc, outcome });
  return outcome;
}

export function dropJsonTree(docId: string) {
  cache.delete(docId);
}

export function jsonPathAtCursor(docId: string): { node: JsonNode; segs: (string | number)[] } | null {
  const view = editor.view;
  if (!view || editor.currentDocId !== docId) return null;
  const tree = getJsonTree(docId);
  if (!tree?.root) return null;
  const node = nodeAtOffset(tree.root, view.state.selection.main.head);
  if (!node) return null;
  return { node, segs: pathSegments(node) };
}

export function looksLikeJson(docId: string, language: string): boolean {
  if (language === "JSON") return true;
  const doc = editor.docOf(docId);
  if (!doc) return false;
  const head = doc.sliceString(0, 64).trimStart();
  return head.startsWith("{") || head.startsWith("[");
}

export async function copyJsonPath(style: PathStyle) {
  const store = useStore.getState();
  const doc = activeDoc(store);
  if (!doc || doc.kind !== "text") return;
  const at = jsonPathAtCursor(doc.id);
  if (!at) {
    store.toast("Cursor is not inside a JSON value.", "warning");
    return;
  }
  const text = formatPath(at.segs, style);
  await writeClipboard(text);
  store.toast(describeCopiedPath(text, style), "success", 2200);
}

export async function copyJsonValue() {
  const store = useStore.getState();
  const doc = activeDoc(store);
  if (!doc || doc.kind !== "text") return;
  const at = jsonPathAtCursor(doc.id);
  if (!at) {
    store.toast("Cursor is not inside a JSON value.", "warning");
    return;
  }
  const text = valueClipboardText(editor.docOf(doc.id)!.toString(), at.node);
  await writeClipboard(text);
  store.toast(`Copied value: ${previewValue(text)}`, "success", 1800);
}

/** One-line preview of copied text for toasts. */
export function previewValue(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? flat.slice(0, 57) + "…" : flat;
}

export const PATH_STYLES: { id: PathStyle; label: string; example: string }[] = [
  { id: "dot", label: "Dot notation", example: "users[0].name" },
  { id: "jsonpath", label: "JSONPath", example: "$.users[0].name" },
  { id: "js", label: "JavaScript", example: "users[0].name / [\"a-b\"]" },
  { id: "bracket", label: "Bracket notation", example: "[\"users\"][0][\"name\"]" },
  { id: "pointer", label: "JSON Pointer", example: "/users/0/name" },
];
