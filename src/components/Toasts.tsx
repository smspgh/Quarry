import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useEffect } from "react";
import { editor } from "../editor/manager";
import { useStore, type DialogAction } from "../lib/store";
import { dismissDialog } from "../lib/dialogs";

const ICONS = { info: Info, success: CheckCircle2, error: XCircle, warning: AlertTriangle };
const COLORS = { info: "var(--accent)", success: "var(--success)", error: "var(--danger)", warning: "var(--warning)" };

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div
            key={t.id}
            className={`toast ${t.kind}`}
            role={t.kind === "error" ? "alert" : undefined}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.preventDefault();
              e.stopPropagation();
              dismiss(t.id);
              editor.focus();
            }}
          >
            <Icon size={16} style={{ color: COLORS[t.kind], flex: "none", marginTop: 1 }} />
            <div className="msg">{t.message}</div>
            <button className="icon-btn xs" title="Dismiss (Esc)" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Enter runs the `default` action (fallback: first non-danger), Escape the `cancel` one (fallback: "Cancel", else close). */
export function dialogDefaultAction(actions: DialogAction[]): DialogAction | undefined {
  return actions.find((a) => a.default) ?? actions.find((a) => a.kind !== "danger") ?? actions[0];
}
export function dialogCancelAction(actions: DialogAction[]): DialogAction | undefined {
  return actions.find((a) => a.cancel) ?? actions.find((a) => /^cancel$/i.test(a.label.trim()));
}

export function Dialog() {
  const dialog = useStore((s) => s.dialog);
  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        const a = dialogCancelAction(dialog.actions);
        if (a) a.run();
        else dismissDialog();
      } else if (e.key === "Enter") {
        e.stopPropagation();
        e.preventDefault();
        // A focused button wins (keyboard users may have tabbed to it); otherwise the default action.
        const focused = document.activeElement;
        if (focused instanceof HTMLButtonElement && focused.closest(".dialog")) focused.click();
        else dialogDefaultAction(dialog.actions)?.run();
      } else if (e.key === "Tab") {
        // Keep focus inside the dialog.
        const btns = [...document.querySelectorAll<HTMLButtonElement>(".dialog .actions button")];
        if (!btns.length) return;
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.shiftKey ? (i <= 0 ? btns.length - 1 : i - 1) : (i < 0 || i === btns.length - 1 ? 0 : i + 1);
        btns[next].focus();
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      // Give the keyboard back to the editor once the dialog goes away.
      editor.focus();
    };
  }, [dialog]);
  if (!dialog) return null;
  const def = dialogDefaultAction(dialog.actions);
  return (
    <div className="overlay" style={{ alignItems: "center", paddingTop: 0 }}>
      <div className="dialog" role={dialog.actions.some((a) => a.kind === "danger") ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-message">
        <h3 id="dialog-title">{dialog.title}</h3>
        <p id="dialog-message" style={{ whiteSpace: "pre-line" }}>{dialog.message}</p>
        <div className="actions">
          {dialog.actions.map((a, i) => (
            <button key={i} className={`btn ${a.kind === "primary" ? "btn-primary" : ""} ${a.kind === "danger" ? "btn-danger" : ""}`} onClick={a.run} autoFocus={a === def}>
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
