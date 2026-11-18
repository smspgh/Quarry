import { ChevronDown, ChevronRight, RotateCcw, Search, Undo2, X } from "lucide-react";
import React from "react";
import { editor } from "../../editor/manager";
import { askDialog, persistSettings } from "../../lib/actions";
import { appData } from "../../lib/ipc";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { loadMacros } from "../../lib/macros";
import { scriptsDir } from "../../lib/scripting";
import { useStore } from "../../lib/store";
import { isPanelShown } from "../../lib/panels";
import { DEFAULT_SETTINGS, type Settings } from "../../lib/types";
import { Select } from "../Select";
import { InfoTip } from "../InfoTip";
import { MatchText } from "../MatchText";
import { applyHistoryLimit, clearHistory } from "../../lib/searchHistory";
import { invoke } from "@tauri-apps/api/core";
import { restartServers } from "../../lib/lsp";
import { SERVERS, splitCommand } from "../../lib/lspServers";
import { installServer, resolveInstall } from "../../lib/lspInstall";
import { keyRows } from "../../lib/commands";
import { isChanged, keyRowMatches } from "../../lib/keybindings";
import { openShortcuts } from "../../lib/shortcutsTab";
import { CUSTOM_SHELL, knownShells, loadShells, pickShell, shellOptions, type Shell } from "../../lib/shells";

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

/** Pure helper (testable): a setting value as shown in the reset / previous tooltips. */
export function describeValue(v: unknown): string {
  if (v === true) return "On";
  if (v === false) return "Off";
  const t = String(v ?? "");
  if (!t) return "empty";
  return t.length > 48 ? `${t.slice(0, 47)}…` : t;
}

/** Pure helper (testable): two setting values are the same (lists and maps compared by content). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Pure helper (testable): the settings that differ from their defaults and have a row on screen
 * (the custom shell command only while Custom… is the shell, the server lists only while code
 * intelligence is on). The "Modified" filter's count.
 */
export function modifiedKeys(s: Settings): (keyof Settings)[] {
  return (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).filter((k) => {
    if (k === "terminalCustom" && s.terminalShell !== CUSTOM_SHELL) return false;
    if ((k === "lspDisabled" || k === "lspCommands") && !s.lspEnabled) return false;
    return !sameValue(s[k], DEFAULT_SETTINGS[k]);
  });
}

/** Pure helper (testable): a path cut in two so the head can shrink with an ellipsis while the last folder stays visible. */
export function splitPath(p: string): [head: string, tail: string] {
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return i <= 0 ? ["", p] : [p.slice(0, i), p.slice(i)];
}

/** The sections, in order: id, title, label in the jump bar. */
export const SECTIONS = [
  ["appearance", "Appearance", "Appearance"],
  ["editor", "Editor", "Editor"],
  ["files", "Files & tabs", "Files"],
  ["find", "Find", "Find"],
  ["languages", "Languages", "Languages"],
  ["terminal", "Terminal", "Terminal"],
  ["git", "Git", "Git"],
  ["scripts", "Scripts & macros", "Scripts"],
  ["shortcuts", "Keyboard shortcuts", "Shortcuts"],
  ["app", "App", "App"],
] as const;
type SectionId = (typeof SECTIONS)[number][0];
const titleOf = (id: SectionId) => SECTIONS.find((s) => s[0] === id)![1];

/** Collapsed sections are a per-machine convenience (not a setting): localStorage, failures ignored. */
const COLLAPSED_KEY = "quarry.settingsCollapsed";
function loadCollapsed(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}
function saveCollapsed(s: Set<string>) {
  try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...s])); } catch { /* not kept */ }
}

const FilterCtx = React.createContext("");
/** "Modified" is on: only rows whose value differs from the default are shown. */
const ModifiedCtx = React.createContext(false);
/** Id of the enclosing row's label, so controls can point aria-labelledby at it. */
const LabelCtx = React.createContext<string | undefined>(undefined);
/** Section (and group) names the filter also matches. */
const SectionCtx = React.createContext("");
/** Applies a value to a setting (the panel's `change`); rows with side effects pass their own. */
const ApplyCtx = React.createContext<(k: keyof Settings, v: Settings[keyof Settings]) => void>(() => {});
const CollapseCtx = React.createContext<{ collapsed: (id: string) => boolean; toggle: (id: string) => void }>({ collapsed: () => false, toggle: () => {} });

/** Monospaced fonts offered in the Editor font family list (only installed ones are shown). */
const FONT_CHOICES = [
  "Cascadia Code", "Cascadia Mono", "Consolas", "Courier New", "Lucida Console",
  "JetBrains Mono", "Fira Code", "Source Code Pro", "IBM Plex Mono", "Hack",
  "Roboto Mono", "Ubuntu Mono", "Iosevka", "Victor Mono", "DejaVu Sans Mono", "Inconsolata",
];
const CUSTOM_FONT = "__custom";

/** Pure helper (testable): the font-family list a font picked from the list is stored as. */
export const fontListFor = (name: string) => `"${name}", monospace`;

/** A section: a heading that collapses it, and one card holding its rows. */
function Section({ id, children }: { id: SectionId; children: React.ReactNode }) {
  const title = titleOf(id);
  const query = React.useContext(FilterCtx);
  const modifiedOnly = React.useContext(ModifiedCtx);
  const { collapsed, toggle } = React.useContext(CollapseCtx);
  // Filtering shows every match, collapsed or not.
  const shut = collapsed(id) && !query.trim() && !modifiedOnly;
  return (
    <SectionCtx.Provider value={title}>
      <section className="settings-section" data-section={id} aria-label={title}>
        <button className="section-head" aria-expanded={!shut} onClick={() => toggle(id)}>
          {shut ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <span>{title}</span>
        </button>
        <div className="settings-card" hidden={shut}>{children}</div>
      </section>
    </SectionCtx.Provider>
  );
}

/** A named group of rows inside a section's card; hidden when the filter leaves it empty. */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const section = React.useContext(SectionCtx);
  return (
    <SectionCtx.Provider value={`${section} ${title}`}>
      <div className="settings-group">
        <div className="settings-group-title">{title}</div>
        {children}
      </div>
    </SectionCtx.Provider>
  );
}

/** Should a row show under the current filter / Modified state? */
function useShown(label: string, words: string, modified: boolean): boolean {
  const query = React.useContext(FilterCtx);
  const modifiedOnly = React.useContext(ModifiedCtx);
  const section = React.useContext(SectionCtx);
  return rowMatches(query, label, words, section) && (!modifiedOnly || modified);
}

/** One setting row. With `k`, the label gets "Use previous setting" and "Restore default" buttons
 *  and the row is marked while its value differs from the default.
 *  `info` = longer help behind an "i" (the filter searches it); `keywords` = other words that find it.
 *  `apply` replaces the panel's plain setter (folder rows reload scripts / macros).
 *  `stack` puts the control on its own full-width line (text inputs). */
function Row({ label, hint, info, keywords, k, stack, apply, modified, children }: {
  label: string; hint?: string; info?: string; keywords?: string; k?: keyof Settings; stack?: boolean;
  apply?: (v: never) => void; modified?: boolean; children: React.ReactNode;
}) {
  const query = React.useContext(FilterCtx);
  const applyKey = React.useContext(ApplyCtx);
  const value = useStore((s) => (k ? s.settings[k] : undefined));
  const prev = useStore((s) => (k ? s.prevSettings[k] : undefined));
  const labelId = React.useId();
  const dflt = k ? DEFAULT_SETTINGS[k] : undefined;
  const dirty = !!k && !sameValue(value, dflt);
  const shown = useShown(label, [hint, info, keywords].filter(Boolean).join(" "), modified ?? dirty);
  if (!shown) return null;
  const set = (v: Settings[keyof Settings]) => (apply ? apply(v as never) : k && applyKey(k, v));
  const hasPrev = !!k && prev !== undefined && !sameValue(prev, value);
  return (
    <div className={`field-row ${stack ? "stack" : ""} ${(modified ?? dirty) ? "modified" : ""}`}>
      <div className="field-label">
        <span>
          <span id={labelId}><MatchText text={label} query={query} /></span>
          {info && <InfoTip text={info} label={`About ${label}`} />}
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
        {hint && <small><MatchText text={hint} query={query} /></small>}
      </div>
      <div className="field-control"><LabelCtx.Provider value={labelId}>{children}</LabelCtx.Provider></div>
    </div>
  );
}

/** A row that does something instead of holding a value: label and hint on the left, the button on the right. Not shown under "Modified". */
function ActionRow({ label, hint, keywords, children }: { label: string; hint?: string; keywords?: string; children: React.ReactNode }) {
  const query = React.useContext(FilterCtx);
  const shown = useShown(label, [hint, keywords].filter(Boolean).join(" "), false);
  if (!shown) return null;
  return (
    <div className="field-row action-row">
      <div className="field-label">
        <span><MatchText text={label} query={query} /></span>
        {hint && <small><MatchText text={hint} query={query} /></small>}
      </div>
      <div className="field-control">{children}</div>
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

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  const labelledBy = React.useContext(LabelCtx);
  return <button className={`switch ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label={label} aria-labelledby={label ? undefined : labelledBy} onClick={() => onChange(!on)} />;
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

/** Text input that commits on blur / Enter and re-syncs from the store value (so a reverted change shows correctly).
 *  `onDone` runs after the commit when the field is left (folder rows switch back to the short display). */
function TextField({ value, placeholder, onCommit, onBlurCheck, autoFocus, onDone }: {
  value: string; placeholder?: string; onCommit: (v: string) => void; onBlurCheck?: (v: string) => void; autoFocus?: boolean; onDone?: () => void;
}) {
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
      autoFocus={autoFocus}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { commit(); onDone?.(); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); onDone?.(); }
        else if (e.key === "Escape" && onDone) { e.preventDefault(); e.stopPropagation(); setText(value); onDone(); }
      }}
    />
  );
}

/** A folder setting. The field always shows the folder in use: with the setting empty, that is the
 *  default `<app data>\<sub>` (and typing that path back in keeps the setting empty). Shown with the
 *  middle cut short and the full path in the tooltip; a click turns it into a text box. */
function FolderRow({ label, hint, k, sub, value, onChange }: { label: string; hint: string; k: keyof Settings; sub: string; value: string; onChange: (v: string) => void }) {
  const [dflt, setDflt] = React.useState("");
  const [editing, setEditing] = React.useState(false);
  const labelledBy = React.useId();
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
  const shownPath = value || dflt;
  const [head, tail] = splitPath(shownPath);
  return (
    <Row label={label} hint={value ? hint : `${hint} · default folder`} keywords={shownPath} k={k} stack apply={onChange}>
      {editing ? (
        <TextField value={shownPath} placeholder="Default (app data folder)" onCommit={commit} autoFocus onDone={() => setEditing(false)} />
      ) : (
        <button className="input path-display grow" id={labelledBy} title={`${shownPath}\nClick to type a folder`} aria-label={`${label}: ${shownPath}. Click to edit`} onClick={() => setEditing(true)}>
          <span className="path-head">{head}</span>
          <span className="path-tail">{tail}</span>
        </button>
      )}
      <button className="btn small" onClick={() => void browse()}>Browse…</button>
    </Row>
  );
}

type Change = <K extends keyof Settings>(key: K, value: Settings[K]) => void;

/** Settings › Terminal (specs/terminal.md TERM-010): the shell of new terminal tabs. */
function TerminalSection({ change }: { change: Change }) {
  const shell = useStore((s) => s.settings.terminalShell);
  const custom = useStore((s) => s.settings.terminalCustom);
  const [shells, setShells] = React.useState<Shell[]>(knownShells());
  React.useEffect(() => { void loadShells().then(setShells); }, []);
  const picked = pickShell(shells, shell, custom);
  const missing = shell !== "" && shell !== CUSTOM_SHELL && shells.length > 0 && !shells.some((x) => x.id === shell);
  const options = shellOptions(shells);
  if (missing) options.push({ value: shell, label: `${shell} (not found)` });
  const program = "error" in picked ? "" : picked.argv[0];
  const hint = missing
    ? `That shell is no longer installed; new terminals use ${shells[0].name}`
    : shell === CUSTOM_SHELL ? "New terminal tabs run the command line below"
    : "error" in picked ? picked.error
    : `New terminal tabs (Ctrl+\`) run ${splitPath(program)[1].replace(/^[\\/]/, "")}`;
  return (
    <Section id="terminal">
      <Row label="Shell" hint={hint} info={program && shell !== CUSTOM_SHELL && !missing ? program : undefined} keywords="powershell cmd bash console" k="terminalShell">
        <Select value={shell} options={options} title="Terminal shell" onChange={(v) => change("terminalShell", v)} />
      </Row>
      {shell === CUSTOM_SHELL && (
        <Row label="Custom shell command" hint='The program and its arguments; put a path with spaces in "quotes"' k="terminalCustom" stack>
          <TextField value={custom} placeholder={'"C:\\msys64\\usr\\bin\\bash.exe" --login -i'} onCommit={(v) => change("terminalCustom", v)} />
        </Row>
      )}
    </Section>
  );
}

/** Languages › Code intelligence: the on / off switch, then one compact line per language server
 *  (status, Install…, switch) that opens to show its path and its own command. */
function CodeIntelGroup({ change }: { change: Change }) {
  const s = useStore((st) => st.settings);
  const isOpen = useStore((st) => isPanelShown(st, "settings"));
  const query = React.useContext(FilterCtx);
  const modifiedOnly = React.useContext(ModifiedCtx);
  const [found, setFound] = React.useState<Record<string, string | null>>({});
  // Install commands that depend on what is installed (TypeScript), by server id.
  const [installs, setInstalls] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState<Record<string, boolean>>({});

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
  const serverModified = (id: string) => s.lspDisabled.includes(id) || !!s.lspCommands[id];
  const shown = SERVERS.filter((d) =>
    rowMatches(query, d.name, `${d.command} language server lsp ${d.extensions.join(" ")}`, "Languages Code intelligence") && (!modifiedOnly || serverModified(d.id)),
  );

  return (
    <Group title="Code intelligence">
      <Row
        label="Code intelligence"
        hint="Suggestions, hover info, Go to Definition and problems"
        info="Suggestions while typing, hover info, Go to Definition (F12), Find References (Shift+F12), Rename (F2) and problems, from the language server installed for each language"
        keywords="lsp language server autocomplete intellisense completion"
        k="lspEnabled"
        apply={(v: boolean) => void apply("lspEnabled", v)}
      >
        <Switch on={s.lspEnabled} onChange={(v) => void apply("lspEnabled", v)} />
      </Row>
      {s.lspEnabled && shown.map((def) => {
        const on = !s.lspDisabled.includes(def.id);
        const path = found[def.id];
        const expanded = !!open[def.id];
        const state = !on ? "off" : path === undefined ? "looking" : path ? "ok" : "missing";
        const status = path === undefined ? "Looking…" : path ? "Installed" : `Not installed${def.needs ? ` · needs ${def.needs}` : ""}`;
        return (
          <div key={def.id} className={`field-row lsp-server-row ${serverModified(def.id) ? "modified" : ""}`}>
            <button className="lsp-server-head" aria-expanded={expanded} title={path ?? undefined} onClick={() => setOpen((o) => ({ ...o, [def.id]: !expanded }))}>
              {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span className={`lsp-dot ${state}`} aria-hidden />
              <span className="lsp-server-name"><MatchText text={def.name} query={query} /></span>
              <small>{status}</small>
            </button>
            <div className="field-control">
              {path === null && (
                <button className="btn small" title={installs[def.id] ?? def.install} onClick={() => installServer(def, installs[def.id] ?? def.install)}>Install…</button>
              )}
              <Switch on={on} label={`${def.name} language server`} onChange={(v) => void apply("lspDisabled", v ? s.lspDisabled.filter((x) => x !== def.id) : [...s.lspDisabled, def.id])} />
            </div>
            {expanded && (
              <div className="lsp-server-details">
                <small>{path ? path : path === null ? "Not found on PATH" : "Looking…"}</small>
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
              </div>
            )}
          </div>
        );
      })}
      {s.lspEnabled && (
        <ActionRow label="Restart language servers" hint="Stop every server and connect the open files again" keywords="code intelligence lsp">
          <button className="btn small" disabled={busy} onClick={() => void apply("lspEnabled", true)}>Restart</button>
        </ActionRow>
      )}
    </Group>
  );
}

/** Settings › Keyboard shortcuts: how many are changed, and the way into the Keyboard Shortcuts tab.
 *  The filter also finds commands: the row then offers to show them there. */
function ShortcutsRow() {
  useStore((s) => s.settings.keybindings); // re-render when shortcuts change
  const query = React.useContext(FilterCtx);
  const modifiedOnly = React.useContext(ModifiedCtx);
  const section = React.useContext(SectionCtx);
  const update = useStore((s) => s.updateSettings);
  const rows = keyRows();
  const changed = rows.filter(isChanged).length;
  const q = query.trim();
  const words = "keys keybindings hotkeys change remove restore";
  const own = rowMatches(query, "Keyboard shortcuts", words, section);
  const matches = q ? rows.filter((r) => (!r.hidden || isChanged(r)) && keyRowMatches(query, r)).length : 0;
  if ((!own && matches === 0) || (modifiedOnly && changed === 0)) return null;
  const restoreAll = async () => {
    const ok = await askDialog("Restore all keyboard shortcuts?", `${changed} changed shortcut${changed === 1 ? "" : "s"} go back to the built-in keys.`, "Restore");
    if (!ok) return;
    update({ keybindings: {} });
    persistSettings();
  };
  const showMatches = !own && matches > 0;
  return (
    <div className={`field-row ${changed ? "modified" : ""}`}>
      <div className="field-label">
        <span><MatchText text="Keyboard shortcuts" query={query} /></span>
        <small>
          {showMatches
            ? `${matches} command${matches === 1 ? "" : "s"} match “${q}”`
            : changed === 0 ? "No shortcuts changed" : `${changed} shortcut${changed === 1 ? "" : "s"} changed`}
        </small>
      </div>
      <div className="field-control">
        {changed > 0 && !showMatches && (
          <button className="btn small" onClick={() => void restoreAll()}>Restore all</button>
        )}
        <button className="btn small" onClick={() => openShortcuts(showMatches ? q : undefined)}>{showMatches ? "Show matches" : "Edit shortcuts…"}</button>
      </div>
    </div>
  );
}

export function SettingsPanel() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const toast = useStore((s) => s.toast);
  const isOpen = useStore((s) => isPanelShown(s, "settings"));
  const [query, setQuery] = React.useState("");
  const [modifiedOnly, setModifiedOnly] = React.useState(false);
  const [fontWarn, setFontWarn] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(loadCollapsed);
  const [active, setActive] = React.useState<SectionId>("appearance");
  const [present, setPresent] = React.useState<SectionId[]>(SECTIONS.map((s) => s[0]));
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const topRef = React.useRef<HTMLDivElement>(null);
  const filterRef = React.useRef<HTMLInputElement>(null);
  const chipsRef = React.useRef<HTMLDivElement>(null);

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

  const collapse = React.useMemo(() => ({
    collapsed: (id: string) => collapsed.has(id),
    toggle: (id: string) => setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id); else n.add(id);
      saveCollapsed(n);
      return n;
    }),
  }), [collapsed]);

  /** The section at the top of the scrolled area is the current one in the jump bar. */
  const onScroll = React.useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    const limit = body.getBoundingClientRect().top + (topRef.current?.offsetHeight ?? 0) + 12;
    const els = [...body.querySelectorAll<HTMLElement>(".settings-section")].filter((el) => el.querySelector(".field-row"));
    let cur = els[0]?.dataset.section as SectionId | undefined;
    for (const el of els) if (el.getBoundingClientRect().top <= limit) cur = el.dataset.section as SectionId;
    // Scrolled to the very end: the last section is the one being read, even when it is too short to reach the top.
    if (body.scrollTop > 0 && body.scrollTop + body.clientHeight >= body.scrollHeight - 2 && els.length) cur = els[els.length - 1].dataset.section as SectionId;
    if (cur) setActive(cur);
  }, []);

  // Which sections the filter / Modified leave something in (a section with no rows is hidden, and so is its jump button).
  React.useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const ids = [...body.querySelectorAll<HTMLElement>(".settings-section")].filter((el) => el.querySelector(".field-row")).map((el) => el.dataset.section as SectionId);
    setPresent((p) => (p.join() === ids.join() ? p : ids));
    onScroll();
  });

  // Keep the current jump button in view when the bar scrolls sideways.
  React.useEffect(() => {
    chipsRef.current?.querySelector<HTMLElement>(`[data-target="${active}"]`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [active]);

  const jump = (id: SectionId) => {
    const body = bodyRef.current;
    if (collapsed.has(id)) collapse.toggle(id);
    window.setTimeout(() => {
      const el = body?.querySelector<HTMLElement>(`.settings-section[data-section="${id}"]`);
      if (!body || !el) return;
      const top = body.scrollTop + el.getBoundingClientRect().top - body.getBoundingClientRect().top - (topRef.current?.offsetHeight ?? 0) - 4;
      body.scrollTop = Math.max(0, top);
      setActive(id);
    }, 0);
  };

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
  const sw = (key: { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings]) => (
    <Switch on={settings[key]} onChange={(v) => change(key, v)} />
  );

  const modifiedCount = modifiedKeys(settings).length;
  const nav = (cls: string, short: boolean) => (
    <nav className={cls} aria-label="Settings sections" ref={short ? chipsRef : undefined}>
      {SECTIONS.filter(([id]) => present.includes(id)).map(([id, title, label]) => (
        <button key={id} data-target={id} className={active === id ? "on" : ""} aria-current={active === id ? "true" : undefined} onClick={() => jump(id)}>
          {short ? label : title}
        </button>
      ))}
    </nav>
  );

  return (
    <ApplyCtx.Provider value={change as (k: keyof Settings, v: Settings[keyof Settings]) => void}>
    <FilterCtx.Provider value={query}>
    <ModifiedCtx.Provider value={modifiedOnly}>
    <CollapseCtx.Provider value={collapse}>
      <div className="sidebar-header">Settings</div>
      <div ref={bodyRef} className="panel-body settings-body" onScroll={onScroll}>
        <div ref={topRef} className="settings-top">
          <div className="settings-filter-row">
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
            <button
              className={`btn small settings-modified ${modifiedOnly ? "on" : ""}`}
              aria-pressed={modifiedOnly}
              title={modifiedOnly ? "Show every setting" : "Show only the settings you changed from their defaults"}
              onClick={() => setModifiedOnly(!modifiedOnly)}
            >
              Modified{modifiedCount ? ` (${modifiedCount})` : ""}
            </button>
          </div>
          {nav("settings-chips", true)}
        </div>

        <div className="settings-layout">
          {nav("settings-toc", false)}
          <div className="settings-content">
            <Section id="appearance">
              <Row label="Theme" keywords="dark light mode colour color" k="theme">
                {segmented("theme", [["system", "System"], ["light", "Light"], ["dark", "Dark"]] as const)}
              </Row>
              <Row label="Menu bar" hint="Where the File / Edit / View menus sit" info="Title bar: next to the Quarry mark. Top: a row of their own. Hidden: Alt or F10 shows them." keywords="menus" k="menuPosition">
                {segmented("menuPosition", [["top", "Top"], ["titlebar", "Title bar"], ["hidden", "Hidden"]] as const)}
              </Row>
              <Row label="Mica material" hint="Translucent window background (Windows 11)" keywords="transparency transparent blur backdrop" k="mica">
                {sw("mica")}
              </Row>
              <Group title="Editor font">
                <Row label="Font family" hint={fontWarn ? `Font "${firstFontFamily(settings.fontFamily)}" not found; falling back to the next family` : "An installed monospaced font, or Custom…"} info="Custom… takes a comma-separated CSS font list; the first installed family is used." keywords="typeface monospace" k="fontFamily" stack>
                  <FontFamilyField value={settings.fontFamily} onChange={(v) => change("fontFamily", v)} onBlurCheck={(v) => setFontWarn(fontMissing(v))} />
                </Row>
                <Row label="Font size" hint="Ctrl+= / Ctrl+- / Ctrl+0" keywords="zoom text bigger smaller" k="fontSize">
                  <NumberField value={settings.fontSize} min={8} max={40} onCommit={(v) => change("fontSize", v)} />
                </Row>
              </Group>
            </Section>

            <Section id="editor">
              <Group title="Typing">
                <Row label="Tab size" hint="Width of a tab and of one indent level" keywords="indent indentation" k="tabSize">
                  <NumberField value={settings.tabSize} min={1} max={16} onCommit={(v) => change("tabSize", v)} />
                </Row>
                <Row label="Insert spaces" hint="Indent with spaces instead of tab characters" keywords="indent indentation soft tabs" k="insertSpaces">
                  {sw("insertSpaces")}
                </Row>
                <Row label="Auto-close brackets and quotes" keywords="autoclose pairs parentheses" k="autoCloseBrackets">
                  {sw("autoCloseBrackets")}
                </Row>
              </Group>
              <Group title="Display">
                <Row label="Word wrap" hint="Alt+Z" keywords="wrap lines soft wrap long lines" k="wordWrap">
                  {sw("wordWrap")}
                </Row>
                <Row label="Line numbers" keywords="gutter" k="lineNumbers">
                  {sw("lineNumbers")}
                </Row>
                <Row label="Highlight active line" keywords="current line cursor" k="highlightActiveLine">
                  {sw("highlightActiveLine")}
                </Row>
                <Row label="Bracket matching" hint="Highlight the bracket matching the one at the cursor" keywords="parentheses pairs" k="bracketMatching">
                  {sw("bracketMatching")}
                </Row>
                <Row label="Render whitespace" hint="Show spaces, tabs and trailing whitespace" keywords="invisible characters dots" k="renderWhitespace">
                  {sw("renderWhitespace")}
                </Row>
              </Group>
            </Section>

            <Section id="files">
              <Row label="Restore session on start" hint="Reopen the folder and files from last time" keywords="startup hot exit reopen" k="restoreSession">
                {sw("restoreSession")}
              </Row>
              <Row label="Maximum open tabs" hint="Least recently used clean tabs close first" info="Opening more closes the least recently used tabs without unsaved changes, after asking." keywords="tab limit" k="maxOpenTabs">
                <NumberField value={settings.maxOpenTabs} min={1} max={1000} width={80} onCommit={(v) => change("maxOpenTabs", v)} />
              </Row>
              <Row label="Default line endings" hint="For new files" keywords="eol crlf lf newline" k="defaultEol">
                {segmented("defaultEol", [["CRLF", "CRLF"], ["LF", "LF"]] as const)}
              </Row>
              <Group title="Large files">
                <Row label="Large-file threshold (MB)" hint="Files this size or larger open in disk-backed mode" keywords="big size" k="largeFileThresholdMb">
                  <NumberField value={settings.largeFileThresholdMb} min={1} max={4096} width={80} onCommit={(v) => change("largeFileThresholdMb", v)} />
                </Row>
                <Row label="Colours in large-file mode" hint="Syntax colours for JSON, logs, CSV / TSV, XML and SQL" info="Only the lines on screen are coloured, so it stays fast at any size." keywords="colors highlight syntax big" k="bigHighlight">
                  {sw("bigHighlight")}
                </Row>
              </Group>
            </Section>

            <Section id="find">
              <Row label="Find & replace history" hint={settings.searchHistoryLimit === 0 ? "Every distinct find and replace entry is kept" : "Entries kept for find, and as many for replace"} info="With a limit, the oldest entries are dropped." keywords="search" k="searchHistoryLimit">
                <Segmented
                  items={[["unlimited", "Unlimited"], ["limit", "Limit"]] as const}
                  value={settings.searchHistoryLimit === 0 ? "unlimited" : "limit"}
                  onChange={(v) => change("searchHistoryLimit", v === "unlimited" ? 0 : settings.searchHistoryLimit || 500)}
                />
                {settings.searchHistoryLimit > 0 && <NumberField value={settings.searchHistoryLimit} min={1} max={1_000_000} width={90} onCommit={(v) => change("searchHistoryLimit", v)} />}
              </Row>
              <ActionRow label="Clear find & replace history" hint="Asks first" keywords="search history">
                <button className="btn small" onClick={() => void clearSearchHistory()}>Clear…</button>
              </ActionRow>
            </Section>

            <Section id="languages">
              <Group title="JSON">
                <Row label="Pretty-print indent" hint="Spaces, used by Format and CSV → JSON" keywords="format indentation" k="jsonIndent">
                  <NumberField value={settings.jsonIndent} min={1} max={8} onCommit={(v) => change("jsonIndent", v)} />
                </Row>
              </Group>
              <CodeIntelGroup change={change} />
            </Section>

            <TerminalSection change={change} />

            {/* Git (specs/git-merge-rebase.md MERGE-008, specs/git-compare-commits.md COMMITCMP-004). */}
            <Section id="git">
              <Row
                label="Allow merging with uncommitted changes"
                hint={settings.gitMergeWithChanges ? "A merge may start while tracked files have changes" : "A merge only starts when every tracked file is committed"}
                info={settings.gitMergeWithChanges ? "Git refuses a merge that would change those files, and if it stops on a conflict Abort may not bring them back exactly." : "So Abort can always bring everything back as it was."}
                keywords="dirty working tree"
                k="gitMergeWithChanges"
              >
                {sw("gitMergeWithChanges")}
              </Row>
              <Row
                label="Compare with Branch shows"
                hint={settings.gitCompareBranch === "tips" ? "How the two branches differ right now, tip against tip" : "Only what the picked branch changed since it split off"}
                info={settings.gitCompareBranch === "tips" ? undefined : "As a pull request shows it."}
                keywords="diff pull request"
                k="gitCompareBranch"
              >
                <Segmented items={[["tips", "The two tips"], ["split", "Changes since split"]] as const} value={settings.gitCompareBranch} onChange={(v) => change("gitCompareBranch", v)} />
              </Row>
            </Section>

            <Section id="scripts">
              <Row label="Confirm script & macro runs" hint="Ask before one started from a menu or shortcut runs" keywords="prompt safety" k="confirmRuns">
                {sw("confirmRuns")}
              </Row>
              <FolderRow label="Scripts folder" hint=".js files here and in its subfolders" k="scriptsDir" sub="scripts" value={settings.scriptsDir} onChange={(v) => void changeFolder("scriptsDir", v)} />
              <FolderRow label="Macros folder" hint="Each macro is a .macro.json file here" k="macrosDir" sub="macros" value={settings.macrosDir} onChange={(v) => void changeFolder("macrosDir", v)} />
            </Section>

            <Section id="shortcuts">
              <ShortcutsRow />
            </Section>

            <Section id="app">
              <Row label="Check for updates on start" hint="Look for a new Quarry release after launch" info="Help › Check for Updates works either way." keywords="update upgrade version release" k="autoUpdateCheck">
                {sw("autoUpdateCheck")}
              </Row>
              <ActionRow label="Open settings folder" hint="settings.json and the session, in File Explorer" keywords="app data">
                <button className="btn small" onClick={async () => { const p = await appData.path(); const { revealItemInDir } = await import("@tauri-apps/plugin-opener"); await revealItemInDir(p).catch(() => toast(p, "info", 6000)); }}>Open</button>
              </ActionRow>
              <ActionRow label="Reset all to defaults" hint="Every setting goes back to its default, after asking" keywords="reset">
                <button className="btn small btn-danger settings-reset-all" onClick={() => void resetAll()}>
                  <RotateCcw size={13} /> Reset all…
                </button>
              </ActionRow>
            </Section>
            {present.length === 0 && (
              <div className="panel-note settings-empty">
                {modifiedOnly && !query.trim() ? "Every setting has its default value" : `No settings match “${query}”${modifiedOnly ? " among the modified ones" : ""}`}
              </div>
            )}
          </div>
        </div>
      </div>
    </CollapseCtx.Provider>
    </ModifiedCtx.Provider>
    </FilterCtx.Provider>
    </ApplyCtx.Provider>
  );
}
