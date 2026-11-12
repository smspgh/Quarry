import { useStore, type DialogAction } from "./store";

/**
 * In-app modal dialogs. There is one dialog on screen at a time; a dialog asked for while another is
 * open waits its turn instead of replacing it (a replaced dialog's promise would never settle, and
 * whatever awaited it, e.g. the changes-on-disk check, would stay stuck).
 */

export interface Choice<T> {
  label: string;
  kind?: DialogAction["kind"];
  /** Runs on Enter (see Dialog in Toasts.tsx for the fallbacks). */
  default?: boolean;
  /** Runs on Escape. */
  cancel?: boolean;
  value: T;
}

interface Pending {
  title: string;
  message: string;
  choices: Choice<unknown>[];
  dismissed: unknown;
  resolve: (v: unknown) => void;
}

const queue: Pending[] = [];
let current: Pending | null = null;

function showNext() {
  current = queue.shift() ?? null;
  const c = current;
  useStore.getState().set({
    dialog: c
      ? {
          title: c.title,
          message: c.message,
          actions: c.choices.map((a) => ({ label: a.label, kind: a.kind, default: a.default, cancel: a.cancel, run: () => finish(c, a.value) })),
        }
      : null,
  });
}

function finish(p: Pending, value: unknown) {
  if (current !== p) return;
  p.resolve(value);
  showNext();
}

/** Show a dialog and resolve with the value of the button chosen; `dismissed` if it is closed another way. */
export function choose<T>(title: string, message: string, choices: Choice<T>[], dismissed: T): Promise<T> {
  return new Promise<T>((resolve) => {
    queue.push({ title, message, choices, dismissed, resolve: resolve as (v: unknown) => void });
    if (!current) showNext();
  });
}

/** Close the dialog on screen without a choice (Escape on a dialog that has no cancel button). */
export function dismissDialog() {
  if (current) finish(current, current.dismissed);
}

/** A dialog with one OK button. */
export function inform(title: string, message: string): Promise<void> {
  return choose(title, message, [{ label: "OK", kind: "primary", default: true, cancel: true, value: undefined }], undefined);
}
