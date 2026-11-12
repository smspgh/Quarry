/**
 * Pictures attached to a Claude message (pasted screenshots, dropped or browsed files). They are
 * scaled down so the longest side is at most 2000 px and the encoded data stays under the API's
 * 5 MB limit; small PNG / JPEG / GIF / WebP files are sent unchanged.
 */
import { invoke } from "@tauri-apps/api/core";

export interface Attachment {
  id: string;
  name: string;
  mediaType: string;
  /** Base64 without the data: prefix (what Claude Code receives). */
  data: string;
  /** data: URL for thumbnails. */
  url: string;
}

const MAX_SIDE = 2000;
const MAX_BYTES = 3_750_000; // base64 grows by 4/3; stays under 5 MB encoded
const SENDABLE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

let seq = 1;

/** Longest side ≤ `max`, keeping the aspect ratio (pure, tested). */
export function fitSize(w: number, h: number, max = MAX_SIDE): { w: number; h: number } {
  const long = Math.max(w, h);
  if (long <= max) return { w, h };
  const k = max / long;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode the image"))), type, quality));
}

/** Turn a picture into an attachment, scaling / re-encoding it only when it is too big. */
export async function prepareImage(blob: Blob, name = "image"): Promise<Attachment> {
  let out = blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const size = fitSize(bitmap.width, bitmap.height);
    const scaled = size.w !== bitmap.width || size.h !== bitmap.height;
    if (scaled || blob.size > MAX_BYTES || !SENDABLE.has(blob.type)) {
      const canvas = document.createElement("canvas");
      canvas.width = size.w;
      canvas.height = size.h;
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, size.w, size.h);
      out = await canvasBlob(canvas, "image/png");
      if (out.size > MAX_BYTES) out = await canvasBlob(canvas, "image/jpeg", 0.88);
    }
  } finally {
    bitmap.close();
  }
  const url = await readDataUrl(out);
  return { id: `img${seq++}`, name, mediaType: out.type || "image/png", data: url.slice(url.indexOf(",") + 1), url };
}

/** An image file on disk (Browse…, or dropped on the tab). */
export async function imageFromPath(path: string): Promise<Attachment> {
  const { mediaType, data } = await invoke<{ mediaType: string; data: string }>("claude_read_image", { path });
  const blob = await (await fetch(`data:${mediaType};base64,${data}`)).blob();
  return prepareImage(blob, path.split(/[\\/]/).pop() || "image");
}

export const isImagePath = (p: string) => /\.(png|jpe?g|gif|webp)$/i.test(p);
