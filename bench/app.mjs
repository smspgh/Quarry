// Real-app benchmark (bench/README.md): launch an editor with a file, the way a double-click in File
// Explorer does, and time until the file's first line is drawn on screen. Also records the app's
// total private memory (every process it started) at that moment and after it settles.
//
//   node bench/app.mjs <quarry|vscode> <file>... [--settle 10]
//
// Both apps are driven through their Chromium debugging port, so "on screen" means the same thing:
// the first line of the file is present in the rendered editor. VS Code runs with a throwaway
// profile and extensions disabled; it never touches your own VS Code. Quarry must not be running.
import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const app = args[0];
const settle = Number(args[args.indexOf("--settle") + 1]) || 10;
const files = args.slice(1).filter((a, i, all) => a !== "--settle" && all[i - 1] !== "--settle");
const TIMEOUT_S = 180;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const QUARRY = new URL("../src-tauri/target/release/quarry.exe", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const VSCODE = join(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe");

/** Total private memory (MB) of `pid` and all its descendants, and how many processes that is. */
function treeMemory(pid) {
  const ps = `$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, PrivatePageCount;
    $ids = @(${pid}); $added = $true
    while ($added) { $added = $false; foreach ($p in $all) { if ($ids -contains $p.ParentProcessId -and -not ($ids -contains $p.ProcessId)) { $ids += $p.ProcessId; $added = $true } } }
    $sum = ($all | Where-Object { $ids -contains $_.ProcessId } | Measure-Object -Property PrivatePageCount -Sum).Sum
    "$([math]::Round($sum / 1MB)) $($ids.Count)"`;
  const [mb, n] = execFileSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" }).trim().split(" ");
  return { mb: Number(mb), processes: Number(n) };
}

async function cdpPage(port) {
  for (const t0 = Date.now(); Date.now() - t0 < TIMEOUT_S * 1000; await sleep(100)) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((p) => p.type === "page" && !p.url.startsWith("devtools"));
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
  }
  throw new Error("no debug target");
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    pending.get(m.id)?.(m);
  };
  const state = { closed: false };
  ws.onclose = () => (state.closed = true);
  // A page that is busy (or has crashed) may never answer: give up after 2 s.
  const evaluate = (expression) =>
    new Promise((res) => {
      if (state.closed) return res(undefined);
      const i = ++id;
      const timer = setTimeout(() => res(undefined), 2000);
      pending.set(i, (m) => (clearTimeout(timer), res(m.result?.result?.value)));
      ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
    });
  return { evaluate, state, close: () => ws.close() };
}

/** The first line of the file (up to 40 chars), which must appear on screen. */
function firstLine(file) {
  const fd = openSync(file, "r");
  const buf = Buffer.alloc(400);
  readSync(fd, buf, 0, buf.length, 0);
  closeSync(fd);
  return buf.toString("utf8").split("\n")[0].slice(0, 40).trim();
}

async function run(file) {
  const marker = firstLine(file);
  const port = app === "quarry" ? 9341 : 9342;
  const scratch = mkdtempSync(join(tmpdir(), "qbench-"));
  let child;
  const t0 = performance.now();
  if (app === "quarry") {
    child = spawn(QUARRY, [file], {
      env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: join(scratch, "wv"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
      stdio: "ignore",
    });
  } else {
    // By default VS Code asks before opening a local file over 1024 MB
    // (workbench.editorLargeFileConfirmation); turn the prompt off so a person clicking it isn't timed.
    mkdirSync(join(scratch, "ud", "User"), { recursive: true });
    writeFileSync(
      join(scratch, "ud", "User", "settings.json"),
      JSON.stringify({ "workbench.editorLargeFileConfirmation": 1048576, "workbench.startupEditor": "none", "update.mode": "none", "telemetry.telemetryLevel": "off", "workbench.tips.enabled": false }),
    );
    child = spawn(VSCODE, ["--user-data-dir", join(scratch, "ud"), "--extensions-dir", join(scratch, "ext"), "--disable-extensions", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", `--remote-debugging-port=${port}`, "--new-window", file], { stdio: "ignore" });
  }
  // Quarry draws large files as .big-row lines; VS Code (Monaco) as .view-line.
  const probe = app === "quarry"
    ? `[...document.querySelectorAll(".big-row .big-text, .cm-line")].some(e => e.textContent.includes(${JSON.stringify(marker)}))`
    : `[...document.querySelectorAll(".monaco-editor .view-line")].some(e => e.textContent.replace(/\\u00a0/g," ").includes(${JSON.stringify(marker)}))`;
  const note = app === "quarry" ? "" : `document.querySelector(".notifications-toasts")?.innerText?.slice(0,160) || ""`;
  let shown = null;
  let page;
  try {
    page = await connect(await cdpPage(port));
    for (; performance.now() - t0 < TIMEOUT_S * 1000 && !page.state.closed; await sleep(25)) {
      if (await page.evaluate(probe)) {
        shown = performance.now() - t0;
        break;
      }
    }
  } catch (e) {
    console.log(`  ${e.message}`);
  }
  const closedAt = page?.state.closed ? (performance.now() - t0) / 1000 : null;
  const alive = child.exitCode === null;
  const atShown = treeMemory(child.pid);
  await sleep(settle * 1000);
  const settled = treeMemory(child.pid);
  const msg = note && page ? await page.evaluate(note) : "";
  page?.close();
  try {
    execFileSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore" });
  } catch {}
  await sleep(1500);
  rmSync(scratch, { recursive: true, force: true });
  const name = file.split(/[\\/]/).pop();
  console.log(
    `${app.padEnd(7)} ${name.padEnd(15)} ${shown !== null ? `text on screen ${(shown / 1000).toFixed(2)} s` : closedAt !== null ? `window closed/crashed after ${closedAt.toFixed(1)} s${alive ? "" : " (app exited)"}` : `not shown within ${TIMEOUT_S} s`}` +
      ` | memory ${atShown.mb} MB at that point, ${settled.mb} MB after ${settle} s (${settled.processes} processes)` +
      (app === "vscode" && statSync(file).size > 1024 * 1048576 ? " | (VS Code asks before opening this by default; the prompt was turned off)" : "") +
      (msg ? ` | notice: ${msg.replace(/\s+/g, " ")}` : ""),
  );
}

if (!["quarry", "vscode"].includes(app) || files.length === 0) {
  console.error("usage: node bench/app.mjs <quarry|vscode> <file>... [--settle 10]");
  process.exit(2);
}
if (app === "quarry" && !existsSync(QUARRY)) throw new Error(`build Quarry first (pnpm tauri build): ${QUARRY}`);
for (const f of files) await run(f);
