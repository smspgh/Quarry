// Generate large, realistic test files for the benchmarks (bench/README.md).
//
//   node bench/gen.mjs [--dir <folder>] [--only log,json,csv] [--sizes 100M,1G,5G]
//
// Files are written to %LOCALAPPDATA%\quarry-bench by default (never into the repo) and are
// deterministic: the same size always produces the same bytes, so runs are comparable.
import { createWriteStream, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const dir = opt("dir", join(process.env.LOCALAPPDATA ?? ".", "quarry-bench"));
const kinds = opt("only", "log,json,csv").split(",");
const sizes = opt("sizes", "100M,1G,5G").split(",");
const parseSize = (s) => Number.parseFloat(s) * { K: 1 << 10, M: 1 << 20, G: 1 << 30 }[s.slice(-1).toUpperCase()];

// Small deterministic PRNG (mulberry32) so every run writes identical files.
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];
const LEVELS = ["INFO", "INFO", "INFO", "INFO", "DEBUG", "DEBUG", "WARN", "ERROR"];
const PATHS = ["/api/orders", "/api/users", "/api/search", "/health", "/api/invoices/export", "/static/app.js"];
const CITIES = ["Pittsburgh", "Austin", "Denver", "Seattle", "Boston", "Chicago", "Atlanta"];
// One line in a million carries this marker, so "find a rare string" has a known answer.
const NEEDLE = "NEEDLE-7f3a";

function* logLines(r) {
  let t = Date.UTC(2026, 0, 1);
  for (let i = 0; ; i++) {
    t += Math.floor(r() * 40);
    const lvl = pick(r, LEVELS);
    const extra = i % 1_000_000 === 999_999 ? ` marker=${NEEDLE}` : "";
    yield `${new Date(t).toISOString()} ${lvl.padEnd(5)} [worker-${Math.floor(r() * 16)}] req=${(i * 2654435761 >>> 0).toString(16)} ${pick(r, ["GET", "POST", "PUT"])} ${pick(r, PATHS)} status=${lvl === "ERROR" ? 500 : 200} ms=${Math.floor(r() * 900)}${extra}\n`;
  }
}

function* csvLines(r) {
  yield "id,timestamp,user,email,city,amount,status,note\n";
  for (let i = 1; ; i++) {
    const note = i % 1_000_000 === 0 ? NEEDLE : pick(r, ["", "rush", "gift", "\"quoted, note\""]);
    yield `${i},2026-01-${String(1 + (i % 28)).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00Z,User ${i},user${i}@example.com,${pick(r, CITIES)},${(r() * 1000).toFixed(2)},${pick(r, ["paid", "open", "void"])},${note}\n`;
  }
}

// A pretty-printed array of records, the shape of a typical API export. Closed properly at the end.
function* jsonChunks(r) {
  yield "[\n";
  for (let i = 0; ; i++) {
    const rec = {
      id: i,
      name: `User ${i}`,
      email: `user${i}@example.com`,
      active: r() < 0.7,
      score: Math.round(r() * 100000) / 100,
      tags: [pick(r, ["a", "b", "c"]), pick(r, ["x", "y"])],
      address: { city: pick(r, CITIES), zip: String(10000 + Math.floor(r() * 89999)) },
      note: i % 1_000_000 === 999_999 ? NEEDLE : null,
    };
    yield (i ? ",\n" : "") + JSON.stringify(rec, null, 2).replace(/^/gm, "  ");
  }
}

async function write(path, gen, target, closing = "") {
  const out = createWriteStream(path, { highWaterMark: 4 << 20 });
  let n = 0;
  let buf = "";
  for (const piece of gen) {
    buf += piece;
    if (buf.length > 1 << 20) {
      n += Buffer.byteLength(buf);
      if (!out.write(buf)) await new Promise((res) => out.once("drain", res));
      buf = "";
      if (n >= target) break;
    }
  }
  out.end(buf + closing);
  await new Promise((res) => out.on("finish", res));
  return statSync(path).size;
}

mkdirSync(dir, { recursive: true });
for (const size of sizes) {
  const target = parseSize(size);
  for (const kind of kinds) {
    const name = `${kind}-${size}.${kind === "log" ? "log" : kind}`;
    const path = join(dir, name);
    const t0 = performance.now();
    const gen = kind === "log" ? logLines(rng(1)) : kind === "csv" ? csvLines(rng(2)) : jsonChunks(rng(3));
    const bytes = await write(path, gen, target, kind === "json" ? "\n]\n" : "");
    console.log(`${name.padEnd(16)} ${(bytes / 1048576).toFixed(0).padStart(6)} MB  ${((performance.now() - t0) / 1000).toFixed(1)} s  ${path}`);
  }
}
console.log(`Rare string in every file: ${NEEDLE}`);
