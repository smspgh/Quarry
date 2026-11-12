import { check, type Update } from "@tauri-apps/plugin-updater";
import { choose, inform } from "./dialogs";
import { flushSession, needsSavePromptOnExit } from "./actions";
import { stopAllClaude } from "./claude";
import { stopAllServers } from "./lsp";
import { editor } from "../editor/manager";
import { useStore } from "./store";

let busy = false;

/**
 * Looks for a newer release (endpoint and public key are in tauri.conf.json; the installer is verified against
 * the key before it runs). `silent` = the start-up check: say nothing unless an update exists, ignore failures.
 */
export async function checkForUpdates(silent: boolean): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    let update: Update | null;
    try {
      update = await check();
    } catch (e) {
      if (!silent) await inform("Check for Updates", `Couldn't check for updates.\n\n${String(e)}`);
      return;
    }
    if (!update) {
      if (!silent) await inform("Check for Updates", "Quarry is up to date.");
      return;
    }
    const notes = (update.body ?? "").trim();
    const pick = await choose(
      "Update available",
      `Quarry ${update.version} is available (you have ${update.currentVersion}).${notes ? `\n\n${notes}` : ""}`,
      [
        { label: "Later", value: "later" as const, cancel: true },
        { label: "Install and Restart", kind: "primary", default: true, value: "install" as const },
      ],
      "later" as const,
    );
    if (pick === "install") await install(update);
  } finally {
    busy = false;
  }
}

async function install(update: Update) {
  const s = useStore.getState();
  // The installer closes Quarry without the usual save prompts, so make sure nothing unsaved would be lost.
  const dirty = s.docs.filter((d) => needsSavePromptOnExit(d, d.kind === "text" && !d.path ? (editor.stateOf(d.id)?.doc.length ?? 0) : 0, s.settings.restoreSession));
  if (dirty.length > 0) {
    await inform("Save first", `Save your changes (${dirty.length === 1 ? dirty[0].name : `${dirty.length} files`}), then run Help › Check for Updates again.`);
    return;
  }
  if (!(await flushSession())) {
    await inform("Update", "Couldn't save the session, so the update was not started. Try again.");
    return;
  }
  try {
    s.toast(`Downloading Quarry ${update.version}…`, "info", 8000);
    await update.download();
    await Promise.all([stopAllClaude(), stopAllServers()]);
    // On Windows the installer takes over and Quarry exits; the new version starts when it finishes.
    await update.install();
  } catch (e) {
    await inform("Update failed", `The update could not be installed.\n\n${String(e)}`);
  }
}
