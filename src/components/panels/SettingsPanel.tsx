import { RotateCcw, Search, Undo2, X } from "lucide-react";
import React from "react";
import { editor } from "../../editor/manager";
import { askDialog, closeDocument, persistSettings } from "../../lib/actions";
import { appData } from "../../lib/ipc";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { loadMacros } from "../../lib/macros";
import { scriptsDir } from "../../lib/scripting";
import { useStore } from "../../lib/store";
import { isPanelShown } from "../../lib/panels";
import { DEFAULT_SETTINGS, type Settings } from "../../lib/types";
import { Select } from "../Select";
import { applyHistoryLimit, clearHistory } from "../../lib/searchHistory";
import { detectClaude, type ClaudeInstall } from "../../lib/claude";
import { invoke } from "@tauri-apps/api/core";
import { restartServers } from "../../lib/lsp";
import { SERVERS, splitCommand } from "../../lib/lspServers";
import { installServer, resolveInstall } from "../../lib/lspInstall";
import { InfoTip } from "../InfoTip";
import { SENDS_TIP } from "../../lib/gitAi";

/** Pure helper (testable): does a row with this label/hint match the filter text? */
export function rowMatches(query: string, label: string, hint?: string, section?: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${section ?? ""} ${label} ${hint ?? ""}`.toLowerCase().includes(q);
}

/** Pure helper (testable): first font family of a CSS font-family list, unquoted. */
export function firstFontFamily(list: string): string {
  const first = list.split(",")[0]?.trim() ?? "";
  return first.replace(/^["']|["']$/g, "").trim();
}

/** True when the first family in the list is not installed (generic families always count as available). */
export function fontMissing(list: string): boolean {
  const name = firstFontFamily(list);
  if (!name) return false;
  if (/^(monospace|sans-serif|serif|system-ui|ui-monospace|cursive|fantasy|math|emoji)$/i.test(name)) return false;
  return !fontInstalled(name);
}

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** True when a local font is installed. WebView2's document.fonts.check() reports every name as
 *  available, so compare text widths against each generic fallback instead. */
export function fontInstalled(name: string): boolean {
  try {
    if (measureCtx === undefined) measureCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
    const ctx = measureCtx;
    if (!ctx) return true;
    const sample = "mmmmmmmmmmlli10OWw@#";
    return ["monospace", "serif", "sans-serif"].some((generic) => {
      ctx.font = `32px ${generic}`;
      const base = ctx.measureText(sample).width;
      ctx.font = `32px "${name}", ${generic}`;
      return ctx.measureText(sample).width !== base;
    });
  } catch {
    return true;
  }
}

const FilterCtx = React.createContext("");
/** Id of the enclosing row's label, so controls can point aria-labelledby at it. */
const LabelCtx = React.createContext<string | undefined>(undefined);
const SectionCtx = React.createContext("");
/** Applies a value to a setting (the panel's `change`); rows with side effects pass their own. */
const ApplyCtx = React.createContext<(k: keyof Settings, v: Settings[keyof Settings]) => void>(() => {});

/** Pure helper (testable): a setting value as shown in the reset / previous tooltips. */
export function describeValue(v: unknown): string {
  if (v === true) return "On";
  if (v === false) return "Off";
  const t = String(v ?? "");
  if (!t) return "empty";
  return t.length > 48 ? `${t.slice(0, 47)}…` : t;
}

/** Monospaced fonts offered in the Editor font family list (only installed ones are shown). */
const FONT_CHOICES = [
  "Cascadia Code", "Cascadia Mono", "Consolas", "Courier New", "Lucida Console",
  "JetBrains Mono", "Fira Code", "Source Code Pro", "IBM Plex Mono", "Hack",
  "Roboto Mono", "Ubuntu Mono", "Iosevka", "Victor Mono", "DejaVu Sans Mono", "Inconsolata",
];
const CUSTOM_FONT = "__custom";

/** Pure helper (testable): the font-family list a font picked from the list is stored as. */
export const fontListFor = (name: string) => `"${name}", monospace`;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <SectionCtx.Provider value={title}>
      <div className="settings-section">
        <div className="section-title">{title}</div>
        {children}
      </div>
    </SectionCtx.Provider>
  );
}

/** One setting row. With `k`, the label gets "Use previous setting" and "Restore default" buttons.
 *  `apply` replaces the panel's plain setter (folder rows reload scripts / macros).
 *  `stack` puts the control on its own full-width line (text inputs). */
function Row({ label, hint, k, stack, apply, children }: { label: string; hint?: string; k?: keyof Settings; stack?: boolean; apply?: (v: never) => void; children: React.ReactNode }) {
  const query = React.useContext(FilterCtx);
  const section = React.useContext(SectionCtx);
  const applyKey = React.useContext(ApplyCtx);
  const value = useStore((s) => (k ? s.settings[k] : undefined));
  const prev = useStore((s) => (k ? s.prevSettings[k] : undefined));
  const labelId = React.useId();
  if (!rowMatches(query, label, hint, section)) return null;
  const set = (v: Settings[keyof Settings]) => (apply ? apply(v as never) : k && applyKey(k, v));
  const dflt = k ? DEFAULT_SETTINGS[k] : undefined;
  const dirty = !!k && value !== dflt;
  const hasPrev = !!k && prev !== undefined && prev !== value;
  return (
    <div className={`field-row ${stack ? "stack" : ""}`}>
      <div className="field-label">
        <span>
          <span id={labelId}>{label}</span>
          {k && (
            <span className="field-actions">
              <button
                className="icon-btn xs field-reset"
                disabled={!hasPrev}
                title={hasPrev ? `Use previous setting (${describeValue(prev)})` : "No previous setting yet"}
                aria-label={`Use previous ${label} setting`}
                onClick={() => hasPrev && set(prev as Settings[keyof Settings])}
              >
                <Undo2 size={11} />
              </button>
              <button
                className="icon-btn xs field-reset"
                disabled={!dirty}
                title={dirty ? `Restore default (${describeValue(dflt)})` : "Already the default"}
                aria-label={`Restore ${label} to default`}
                onClick={() => dirty && set(dflt as Settings[keyof Settings])}
              >
                <RotateCcw size={11} />
              </button>
            </span>
          )}
        </span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="field-control"><LabelCtx.Provider value={labelId}>{children}</LabelCtx.Provider></div>
    </div>
  );
}

/** Font family: a list of installed monospaced fonts, plus "Custom…" for a hand-written CSS list. */
function FontFamilyField({ value, onChange, onBlurCheck }: { value: string; onChange: (v: string) => void; onBlurCheck: (v: string) => void }) {
  const installed = React.useMemo(() => FONT_CHOICES.filter((f) => !fontMissing(f)), []);
  const presetOf = (v: string) => (v === DEFAULT_SETTINGS.fontFamily ? v : installed.find((f) => fontListFor(f) === v) ? v : null);
  const [custom, setCustom] = React.useState(() => !presetOf(value));
  React.useEffect(() => { if (!presetOf(value)) setCustom(true); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const options = [
    { value: DEFAULT_SETTINGS.fontFamily, label: "Default (Cascadia Code)" },
    ...installed.map((f) => ({ value: fontListFor(f), label: f })),
    { value: CUSTOM_FONT, label: "Custom…", hint: "type a CSS font list" },
  ];
  return (
    <div className="font-family-field">
      <Select
        value={custom ? CUSTOM_FONT : value}
        options={options}
        title="Editor font family"
        onChange={(v) => {
          if (v === CUSTOM_FONT) return setCustom(true);
          setCustom(false);
          onChange(v);
          onBlurCheck(v);
        }}
      />
      {custom && <TextField value={value} placeholder={'e.g. "My Font", Consolas, monospace'} onCommit={onChange} onBlurCheck={onBlurCheck} />}
    </div>
  );
}

/** Number input that commits on blur / Enter so the user can type freely; out-of-range values are
 *  clamped and reported instead of being rewritten under the cursor. */
function NumberField({ value, min, max, width = 70, onCommit }: { value: number; min: number; max: number; width?: number; onCommit: (v: number) => void }) {
  const [text, setText] = React.useState(String(value));
  const [bad, setBad] = React.useState(false);
  React.useEffect(() => { setText(String(value)); }, [value]);
  const commit = () => {
    const n = Number(text.trim());
    if (text.trim() === "" || !Number.isFinite(n)) { setText(String(value)); setBad(false); return; }
    const clamped = Math.round(Math.max(min, Math.min(max, n)));
    setBad(clamped !== n);
    setText(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };
  const labelledBy = React.useContext(LabelCtx);
  return (
    <input
      aria-labelledby={labelledBy}
      className={`input number ${bad ? "invalid" : ""}`}
      type="number"
      min={min}
      max={max}
      style={{ width }}
      value={text}
      title={bad ? `Clamped to ${min}–${max}` : `${min}–${max}`}
      aria-invalid={bad || undefined}
      onChange={(e) => { setText(e.target.value); setBad(false); }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
    />
  );
}

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  const labelledBy = React.useContext(LabelCtx);
  return <button className={`switch ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-labelledby={labelledBy} onClick={() => onChange(!on)} />;
}

function Segmented<V extends string>({ items, value, onChange }: { items: readonly (readonly [V, string])[]; value: V; onChange: (v: V) => void }) {
  const labelledBy = React.useContext(LabelCtx);
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const cur = Math.max(0, items.findIndex(([v]) => v === value));
  // Radio group keys: arrows move and select, only the checked radio is a Tab stop.
  const onKey = (e: React.KeyboardEvent) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (cur + d + items.length) % items.length;
    onChange(items[n][0]);
    refs.current[n]?.focus();
  };
  return (
    <div className="segmented" role="radiogroup" aria-labelledby={labelledBy} onKeyDown={onKey}>
      {items.map(([v, l], i) => (
        <button key={v} ref={(el) => { refs.current[i] = el; }} role="radio" aria-checked={value === v} tabIndex={i === cur ? 0 : -1} className={value === v ? "on" : ""} title={l} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

/** Text input that commits on blur / Enter and re-syncs from the store value (so a reverted change shows correctly). */
function TextField({ value, placeholder, onCommit, onBlurCheck }: { value: string; placeholder?: string; onCommit: (v: string) => void; onBlurCheck?: (v: string) => void }) {
  const [text, setText] = React.useState(value);
  React.useEffect(() => { setText(value); }, [value]);
  const commit = () => {
    if (text !== value) onCommit(text);
    onBlurCheck?.(text);
  };
  const labelledBy = React.useContext(LabelCtx);
  return (
    <input
      aria-labelledby={labelledBy}
      className="input mono grow"
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
    />
  );
}

/** A folder setting. The field always shows the folder in use: with the setting empty, that is the
 *  default `<app data>\<sub>` (and typing that path back in keeps the setting empty). */
function FolderRow({ label, hint, k, sub, value, onChange }: { label: string; hint: string; k: keyof Settings; sub: string; value: string; onChange: (v: string) => void }) {
  const [dflt, setDflt] = React.useState("");
  React.useEffect(() => {
    appData.path().then((p) => setDflt(`${p}\\${sub}`)).catch(() => {});
  }, [sub]);
  const commit = (v: string) => {
    const t = v.trim().replace(/[\\/]+$/, "");
    const next = dflt && t.toLowerCase() === dflt.toLowerCase() ? "" : v;
    if (next !== value) onChange(next);
  };
  const browse = async () => {
    const picked = await openDialog({ directory: true, title: label, defaultPath: value || dflt || undefined });
    if (picked && !Array.isArray(picked)) commit(picked);
  };
  return (
    <Row label={label} hint={value ? hint : `${hint} · default folder`} k={k} stack apply={onChange}>
      <TextField value={value || dflt} placeholder="Default (app data folder)" onCommit={commit} />
      <button className="btn small" onClick={() => void browse()}>Browse…</button>
    </Row>
  );
}

const CLAUDE_MODELS = [
  { value: "", label: "Default", hint: "Claude Code's own choice" },
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
];

/** Claude Code: the on / off switch, and (while on) where `claude` is, the model and permissions. */
function ClaudeSection({ change }: { change: <K extends keyof Settings>(key: K, value: Settings[K]) => void }) {
  const s = useStore((st) => st.settings);
  const isOpen = useStore((st) => isPanelShown(st, "settings"));
  const [found, setFound] = React.useState<ClaudeInstall | string | null>(null);

  React.useEffect(() => {
    if (!s.claudeEnabled || !isOpen) return;
    let live = true;
    setFound(null);
    detectClaude(s.claudePath).then((r) => live && setFound(r), (e) => live && setFound(String(e)));
    return () => { live = false; };
  }, [s.claudeEnabled, s.claudePath, isOpen]);

  /** Turning it off closes the Claude tabs (after asking when there are any). */
  const setEnabled = async (on: boolean) => {
    if (!on) {
      const tabs = useStore.getState().docs.filter((d) => d.kind === "claude" || d.kind === "terminal");
      if (tabs.length) {
        const ok = await askDialog(
          "Turn off Claude Code?",
          `${tabs.length === 1 ? "The Claude Code tab closes" : `The ${tabs.length} Claude Code tabs close`} and anything Claude is doing stops. Conversations stay in Claude Code's history.`,
          "Turn off",
        );
        if (!ok) return;
        for (const d of tabs) await closeDocument(d.id, true);
      }
    }
    change("claudeEnabled", on);
  };

  const browse = async () => {
    const picked = await openDialog({ title: "Claude Code executable", filters: [{ name: "Claude Code", extensions: ["exe", "cmd"] }] });
    if (picked && !Array.isArray(picked)) change("claudePath", picked);
  };
  const models = CLAUDE_MODELS.some((m) => m.value === s.claudeModel) ? CLAUDE_MODELS : [...CLAUDE_MODELS, { value: s.claudeModel, label: s.claudeModel }];
  const gitModels = CLAUDE_MODELS.some((m) => m.value === s.claudeGitModel) ? CLAUDE_MODELS : [...CLAUDE_MODELS, { value: s.claudeGitModel, label: s.claudeGitModel }];

  return (
    <Section title="Claude Code">
      <Row label="Claude Code" hint="Work with Claude Code in a folder: Explorer right-click › Work with Claude Code Here. Off hides it everywhere" k="claudeEnabled" apply={(v: boolean) => void setEnabled(v)}>
        <Switch on={s.claudeEnabled} onChange={(v) => void setEnabled(v)} />
      </Row>
      {s.claudeEnabled && (
        <>
          <Row
            label="Claude Code location"
            hint={found === null ? "Looking for Claude Code…" : typeof found === "string" ? `${found}. Install it from claude.com/claude-code, or browse to claude.exe` : `${found.version || "Claude Code"} · ${found.path}`}
            k="claudePath"
            stack
          >
            <TextField value={s.claudePath} placeholder="Found automatically" onCommit={(v) => change("claudePath", v.trim().replace(/^"|"$/g, ""))} />
            <button className="btn small" onClick={() => void browse()}>Browse…</button>
          </Row>
          <Row label="Model" hint="Applies the next time Claude Code starts for a tab, including when a conversation continues; a running one keeps its model" k="claudeModel">
            <Select value={s.claudeModel} options={models} title="Claude model" onChange={(v) => change("claudeModel", v)} />
          </Row>
          {/* Claude git helpers (specs/git-claude.md): their own model, and the question before anything is sent. */}
          <Row label="Model for git helpers" hint="Used by Draft (commit message), Explain (conflict) and Summarise in Source Control; each is one short request on your Claude Code plan. Claude tabs keep their own Model" k="claudeGitModel">
            <Select value={s.claudeGitModel} options={gitModels} title="Claude model for git helpers" onChange={(v) => change("claudeGitModel", v)} />
          </Row>
          <Row label="Ask before sending git content to Claude" hint="Each git helper first says exactly what it sends: diffs, a conflict or commit messages leave your computer through Claude Code" k="claudeGitConfirm">
            <InfoTip text={SENDS_TIP} label="What the git helpers send" />
            <Switch on={s.claudeGitConfirm} onChange={(v) => change("claudeGitConfirm", v)} />
          </Row>
          <Row label="Permissions" hint={`${s.claudePermissionMode === "acceptEdits" ? "File edits are applied without asking; commands and web access ask first" : "Claude asks before every edit and command"}. Open Claude tabs switch from their next message, once the current task ends`} k="claudePermissionMode">
            <Segmented items={[["acceptEdits", "Auto-accept edits"], ["default", "Ask first"]] as const} value={s.claudePermissionMode} onChange={(v) => change("claudePermissionMode", v)} />
          </Row>
        </>
      )}
    </Section>
  );
}

/** Code intelligence: the on / off switch and each language server (found or not, install, own command). */
function CodeIntelSection({ change }: { change: <K extends keyof Settings>(key: K, value: Settings[K]) => void }) {
  const s = useStore((st) => st.settings);
  const isOpen = useStore((st) => isPanelShown(st, "settings"));
  const query = React.useContext(FilterCtx);
  const [found, setFound] = React.useState<Record<string, string | null>>({});
  // Install commands that depend on what is installed (TypeScript), by server id.
  const [installs, setInstalls] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  const folder = useStore((st) => st.folder);
  const detect = React.useCallback(() => {
    for (const def of SERVERS) {
      const override = s.lspCommands[def.id]?.trim();
      const program = override ? splitCommand(override)[0] : def.command;
      // TypeScript: the server lib/lsp.ts would really start (TypeScript 7's tsc, or
      // typescript-language-server for 5 / 6), not just any tsc on PATH.
      const where = !override && def.id === "typescript"
        ? invoke<{ command: string } | null>("lsp_typescript", { root: folder ?? "" }).then((ts) => ts?.command ?? null)
        : invoke<string | null>("lsp_which", { command: program });
      where.then((p) => setFound((f) => ({ ...f, [def.id]: p })), () => setFound((f) => ({ ...f, [def.id]: null })));
      void resolveInstall(def, folder ?? "").then((cmd) => setInstalls((m) => ({ ...m, [def.id]: cmd })));
    }
  }, [s.lspCommands, folder]);
  React.useEffect(() => { if (isOpen && s.lspEnabled) detect(); }, [isOpen, s.lspEnabled, detect]);
  // Installing happens in a terminal tab; look again when coming back to Settings.
  React.useEffect(() => {
    const again = () => { if (isOpen && s.lspEnabled) detect(); };
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, [isOpen, s.lspEnabled, detect]);

  const apply = async <K extends keyof Settings>(k: K, v: Settings[K]) => {
    change(k, v);
    setBusy(true);
    await restartServers();
    setBusy(false);
  };
  const shown = SERVERS.filter((d) => rowMatches(query, d.name, `${d.command} language server ${d.extensions.join(" ")}`, "Code intelligence"));

  return (
    <Section title="Code intelligence">
      <Row label="Code intelligence" hint="Suggestions while typing, hover info, Go to Definition (F12), Find References (Shift+F12), Rename (F2) and problems, from the language server installed for each language" k="lspEnabled" apply={(v: boolean) => void apply("lspEnabled", v)}>
        <Switch on={s.lspEnabled} onChange={(v) => void apply("lspEnabled", v)} />
      </Row>
      {s.lspEnabled && shown.map((def) => {
        const on = !s.lspDisabled.includes(def.id);
        const path = found[def.id];
        return (
          <div key={def.id} className="field-row stack lsp-server-row">
            <div className="field-label">
              <span>{def.name}</span>
              <small>
                {path === undefined ? "Looking…" : path ? `Installed · ${path}` : `Not installed${def.needs ? ` · needs ${def.needs}` : ""}`}
              </small>
            </div>
            <div className="field-control">
              <input
                className="input mono grow"
                aria-label={`${def.name} server command`}
                placeholder={[def.command, ...def.args].join(" ")}
                defaultValue={s.lspCommands[def.id] ?? ""}
                title="Leave empty for the default command. Use a full path to pick a particular installation"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if ((s.lspCommands[def.id] ?? "") === v) return;
                  const next = { ...s.lspCommands };
                  if (v) next[def.id] = v;
                  else delete next[def.id];
                  void apply("lspCommands", next);
                }}
              />
              {path === null && (
                <button className="btn small" title={installs[def.id] ?? def.install} onClick={() => installServer(def, installs[def.id] ?? def.install)}>Install…</button>
              )}
              <Switch on={on} onChange={(v) => void apply("lspDisabled", v ? s.lspDisabled.filter((x) => x !== def.id) : [...s.lspDisabled, def.id])} />
            </div>
          </div>
        );
      })}
      {s.lspEnabled && rowMatches(query, "Restart language servers", "code intelligence", "Code intelligence") && (
        <button className="btn" disabled={busy} onClick={() => void apply("lspEnabled", true)}>Restart language servers</button>
      )}
    </Section>
  );
}

export function SettingsPanel() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const toast = useStore((s) => s.toast);
  const isOpen = useStore((s) => isPanelShown(s, "settings"));
  const [query, setQuery] = React.useState("");
  const [fontWarn, setFontWarn] = React.useState(false);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const filterRef = React.useRef<HTMLInputElement>(null);

  // On open: scroll to the top and take focus so keyboard users land in the panel.
  React.useEffect(() => {
    if (!isOpen) return;
    const t = window.setTimeout(() => {
      bodyRef.current?.scrollTo({ top: 0 });
      filterRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [isOpen]);

  React.useEffect(() => { setFontWarn(fontMissing(settings.fontFamily)); }, [settings.fontFamily]);

  const change = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    update({ [key]: value } as Partial<Settings>);
    editor.applySettings(useStore.getState().settings);
    persistSettings();
    if (key === "searchHistoryLimit") applyHistoryLimit();
  };

  const clearSearchHistory = async () => {
    const ok = await askDialog("Clear find & replace history?", "Every remembered find and replace entry is removed, in the find bar and in Find in Files.", "Clear");
    if (!ok) return;
    clearHistory();
    toast("Find & replace history cleared", "info");
  };

  /** A macros folder change may be cancelled by the unsaved-items guard inside loadMacros; the
   *  store is the source of truth afterwards, so TextField re-syncs from it. */
  const changeFolder = async (key: "scriptsDir" | "macrosDir", v: string) => {
    change(key, v);
    // The loaders toast themselves when the change is cancelled or the folder is unusable.
    // Scripts are files in tabs, so there are no drafts to lose; resolving reports an unusable folder.
    await (key === "scriptsDir" ? scriptsDir() : loadMacros("switch"));
  };

  const resetAll = async () => {
    const ok = await askDialog("Reset all settings?", "Every setting goes back to its default value. Scripts and macros folders revert to the app data folder.", "Reset all");
    if (!ok) return;
    const before = useStore.getState().settings;
    const lspKey = (x: Settings) => JSON.stringify([x.lspEnabled, x.lspDisabled, x.lspCommands]);
    const lspChanged = lspKey(before) !== lspKey(DEFAULT_SETTINGS);
    update({ ...DEFAULT_SETTINGS });
    editor.applySettings(useStore.getState().settings);
    persistSettings();
    void loadMacros("switch");
    // Like every other change to the code-intelligence settings: reconnect the language servers.
    if (lspChanged) void restartServers();
    toast("Settings reset to defaults", "info");
  };

  const segmented = <K extends keyof Settings>(key: K, items: readonly (readonly [Settings[K] & string, string])[]) => (
    <Segmented items={items} value={settings[key] as Settings[K] & string} onChange={(v) => change(key, v)} />
  );

  return (
    <ApplyCtx.Provider value={change as (k: keyof Settings, v: Settings[keyof Settings]) => void}>
    <FilterCtx.Provider value={query}>
      <div className="sidebar-header">Settings</div>
      <div ref={bodyRef} className="panel-body settings-body">
        <div className="settings-filter">
          <Search size={13} className="settings-filter-icon" />
          <input
            ref={filterRef}
            className="input"
            placeholder="Filter settings"
            value={query}
            aria-label="Filter settings"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape" && query) { e.preventDefault(); setQuery(""); } }}
          />
          {query && (
            <button className="icon-btn xs settings-filter-clear" title="Clear filter" onClick={() => { setQuery(""); filterRef.current?.focus(); }}>
              <X size={13} />
            </button>
          )}
        </div>

        <Section title="Appearance">
          <Row label="Theme" k="theme">
            {segmented("theme", [["system", "System"], ["light", "Light"], ["dark", "Dark"]] as const)}
          </Row>
          <Row label="Menu bar" hint="File / Edit / View menus. When hidden, Alt or F10 shows them" k="menuPosition">
            {segmented("menuPosition", [["top", "Top"], ["titlebar", "Title bar"], ["hidden", "Hidden"]] as const)}
          </Row>
          <Row label="Confirm script & macro runs" hint="Ask before a script or macro runs" k="confirmRuns">
            <Switch on={settings.confirmRuns} onChange={(v) => change("confirmRuns", v)} />
          </Row>
          <Row label="Check for updates on start" hint="Quietly looks for a new Quarry release shortly after launch. Help › Check for Updates works either way" k="autoUpdateCheck">
            <Switch on={settings.autoUpdateCheck} onChange={(v) => change("autoUpdateCheck", v)} />
          </Row>
          <Row label="Mica material" hint="Translucent window background (Windows 11)" k="mica">
            <Switch on={settings.mica} onChange={(v) => change("mica", v)} />
          </Row>
          <Row label="Font size" k="fontSize">
            <NumberField value={settings.fontSize} min={8} max={40} onCommit={(v) => change("fontSize", v)} />
          </Row>
          <Row label="Editor font family" hint={fontWarn ? `Font "${firstFontFamily(settings.fontFamily)}" not found; falling back to the next family` : "Pick a font, or Custom… for a comma-separated list (the first installed family is used)"} k="fontFamily" stack>
            <FontFamilyField value={settings.fontFamily} onChange={(v) => change("fontFamily", v)} onBlurCheck={(v) => setFontWarn(fontMissing(v))} />
          </Row>
        </Section>

        <Section title="Editor">
          <Row label="Tab size" k="tabSize">
            <NumberField value={settings.tabSize} min={1} max={16} onCommit={(v) => change("tabSize", v)} />
          </Row>
          <Row label="Insert spaces" hint="Use spaces instead of tab characters" k="insertSpaces">
            <Switch on={settings.insertSpaces} onChange={(v) => change("insertSpaces", v)} />
          </Row>
          <Row label="Word wrap" hint="Alt+Z" k="wordWrap">
            <Switch on={settings.wordWrap} onChange={(v) => change("wordWrap", v)} />
          </Row>
          <Row label="Line numbers" k="lineNumbers">
            <Switch on={settings.lineNumbers} onChange={(v) => change("lineNumbers", v)} />
          </Row>
          <Row label="Highlight active line" k="highlightActiveLine">
            <Switch on={settings.highlightActiveLine} onChange={(v) => change("highlightActiveLine", v)} />
          </Row>
          <Row label="Bracket matching" k="bracketMatching">
            <Switch on={settings.bracketMatching} onChange={(v) => change("bracketMatching", v)} />
          </Row>
          <Row label="Auto-close brackets and quotes" k="autoCloseBrackets">
            <Switch on={settings.autoCloseBrackets} onChange={(v) => change("autoCloseBrackets", v)} />
          </Row>
          <Row label="Render whitespace" k="renderWhitespace">
            <Switch on={settings.renderWhitespace} onChange={(v) => change("renderWhitespace", v)} />
          </Row>
          <Row label="Default line endings" hint="For new files" k="defaultEol">
            {segmented("defaultEol", [["CRLF", "CRLF"], ["LF", "LF"]] as const)}
          </Row>
        </Section>

        <Section title="Tabs and panels">
          <Row label="Maximum open tabs" hint="Opening more closes the least recently used tabs without unsaved changes, after asking" k="maxOpenTabs">
            <NumberField value={settings.maxOpenTabs} min={1} max={1000} width={80} onCommit={(v) => change("maxOpenTabs", v)} />
          </Row>
        </Section>
        <Section title="Files">
          <Row label="Large-file threshold (MB)" hint="Files at or above this size open in disk-backed mode" k="largeFileThresholdMb">
            <NumberField value={settings.largeFileThresholdMb} min={1} max={4096} width={80} onCommit={(v) => change("largeFileThresholdMb", v)} />
          </Row>
          <Row label="Colours in large-file mode" hint="Syntax colours for JSON, logs, CSV / TSV, XML and SQL; only the lines on screen are coloured, so it stays fast at any size" k="bigHighlight">
            <Switch on={settings.bigHighlight} onChange={(v) => change("bigHighlight", v)} />
          </Row>
          <Row label="Restore session on start" hint="Reopen folder and files" k="restoreSession">
            <Switch on={settings.restoreSession} onChange={(v) => change("restoreSession", v)} />
          </Row>
        </Section>

        <Section title="Folders">
          <FolderRow label="Scripts folder" hint="Root of your scripts: .js files here and in its subfolders" k="scriptsDir" sub="scripts" value={settings.scriptsDir} onChange={(v) => void changeFolder("scriptsDir", v)} />
          <FolderRow label="Macros folder" hint="Each macro is a .macro.json file here" k="macrosDir" sub="macros" value={settings.macrosDir} onChange={(v) => void changeFolder("macrosDir", v)} />
        </Section>

        <Section title="Search">
          <Row label="Find & replace history" hint={settings.searchHistoryLimit === 0 ? "Every distinct find and replace entry is kept" : "Entries kept for find, and the same number for replace; the oldest are dropped"} k="searchHistoryLimit">
            <Segmented
              items={[["unlimited", "Unlimited"], ["limit", "Limit"]] as const}
              value={settings.searchHistoryLimit === 0 ? "unlimited" : "limit"}
              onChange={(v) => change("searchHistoryLimit", v === "unlimited" ? 0 : settings.searchHistoryLimit || 500)}
            />
            {settings.searchHistoryLimit > 0 && <NumberField value={settings.searchHistoryLimit} min={1} max={1_000_000} width={90} onCommit={(v) => change("searchHistoryLimit", v)} />}
          </Row>
          {rowMatches(query, "Clear find & replace history", "search history", "Search") && (
            <button className="btn" onClick={() => void clearSearchHistory()}>Clear find & replace history</button>
          )}
        </Section>

        {/* Git (specs/git-merge-rebase.md MERGE-008, specs/git-compare-commits.md COMMITCMP-004). */}
        <Section title="Git">
          <Row label="Allow merging with uncommitted changes" hint={settings.gitMergeWithChanges ? "A merge may start while tracked files have changes; git refuses one that would change those files, and if it stops on a conflict Abort may not bring them back exactly" : "A merge only starts when every tracked file is committed, so Abort can always bring everything back as it was"} k="gitMergeWithChanges">
            <Switch on={settings.gitMergeWithChanges} onChange={(v) => change("gitMergeWithChanges", v)} />
          </Row>
          <Row label="Compare with Branch shows" hint={settings.gitCompareBranch === "tips" ? "How the two branches differ right now, tip against tip" : "Only what the picked branch changed since it split off, as a pull request shows it"} k="gitCompareBranch">
            <Segmented items={[["tips", "The two tips"], ["split", "Changes since split"]] as const} value={settings.gitCompareBranch} onChange={(v) => change("gitCompareBranch", v)} />
          </Row>
        </Section>

        <CodeIntelSection change={change} />

        <ClaudeSection change={change} />

        <Section title="JSON">
          <Row label="Pretty-print indent" k="jsonIndent">
            <NumberField value={settings.jsonIndent} min={1} max={8} onCommit={(v) => change("jsonIndent", v)} />
          </Row>
        </Section>

        <Section title="Data">
          {rowMatches(query, "Open settings folder", "app data", "Data") && (
            <button className="btn" onClick={async () => { const p = await appData.path(); const { revealItemInDir } = await import("@tauri-apps/plugin-opener"); await revealItemInDir(p).catch(() => toast(p, "info", 6000)); }}>Open settings folder</button>
          )}
          {rowMatches(query, "Reset all to defaults", "reset", "Data") && (
            <button className="btn settings-reset-all" onClick={() => void resetAll()}>
              <RotateCcw size={13} /> Reset all to defaults
            </button>
          )}
        </Section>
        {query && <div className="panel-note settings-empty">No settings match “{query}”</div>}
      </div>
    </FilterCtx.Provider>
    </ApplyCtx.Provider>
  );
}
