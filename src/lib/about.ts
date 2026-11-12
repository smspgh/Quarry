import { getTauriVersion, getVersion } from "@tauri-apps/api/app";
import { appLogDir } from "@tauri-apps/api/path";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { fs } from "./ipc";
import { useStore } from "./store";
import { choose } from "./dialogs";

/** Help > About: version details, a copyable summary for bug reports, and the log folder (crash reports). */
export async function showAbout() {
  const [version, tauri] = await Promise.all([getVersion().catch(() => "?"), getTauriVersion().catch(() => "?")]);
  // The user agent reports only the major WebView2 version (e.g. "155.0.0.0").
  const webview = /Edg\/(\d+)/.exec(navigator.userAgent)?.[1] ?? "?";
  const runtime = `Tauri ${tauri} · WebView2 ${webview} · ${navigator.userAgent.includes("Windows NT 10.0") ? "Windows 10/11" : navigator.platform}`;
  const info = `Quarry ${version}\n${runtime}`;
  const pick = await choose(
    `Quarry ${version}`,
    `A fast text, JSON and large-file editor.\n\n${runtime}`,
    [
      { label: "Copy Version Info", value: "copy" as const },
      { label: "Open Log Folder", value: "logs" as const },
      { label: "Close", kind: "primary", default: true, cancel: true, value: "close" as const },
    ],
    "close" as const,
  );
  if (pick === "copy") {
    writeText(info).then(() => useStore.getState().toast("Version info copied", "success", 1500), (e) => useStore.getState().toast(String(e), "error"));
  } else if (pick === "logs") {
    try {
      const dir = await appLogDir();
      await fs.createDir(dir).catch(() => {});
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(dir);
    } catch (e) {
      useStore.getState().toast(String(e), "error");
    }
  }
}
