// Builds and checks specs/index.json, the lookup table over the user stories in specs/*.md.
//
//   node scripts/specs-index.mjs            rebuild specs/index.json, print problems
//   node scripts/specs-index.mjs --check    exit 1 on any problem or a stale index (used by the unit tests)
//   node scripts/specs-index.mjs --lint specs/git.md [...]   check only the given spec files
//   node scripts/specs-index.mjs --for src/lib/git.ts git.push GIT-012   stories behind a file / command / id
//
// The format it parses is described in specs/README.md.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SPECS = join(ROOT, "specs");
const INDEX = join(SPECS, "index.json");
const README = join(SPECS, "README.md");

// Source files that need no story of their own (entry points, type-only files, test helpers).
const NO_STORY_NEEDED = new Set([
  "src/main.tsx",
  "src/vite-env.d.ts",
  "src-tauri/src/main.rs",
]);
const SOURCE_DIRS = ["src", "src-tauri/src"];
const SOURCE_EXT = /\.(ts|tsx|rs|css)$/;

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const ticked = (s) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

function walk(dir, out = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

/** Parses one spec file. Problems are pushed to `errors` as "file:line message". */
function parseSpec(rel, errors) {
  const lines = read(join(ROOT, rel)).split("\n");
  const err = (i, msg) => errors.push(`${rel}:${i + 1} ${msg}`);
  const area = { prefix: "", title: "", spec: rel };
  const stories = [];

  let i = 0;
  if (lines[0] !== "---") err(0, "missing front matter (--- / area: / prefix: / ---)");
  else {
    for (i = 1; i < lines.length && lines[i] !== "---"; i++) {
      const m = /^(area|prefix):\s*(.+)$/.exec(lines[i]);
      if (!m) err(i, `unexpected front matter line "${lines[i]}"`);
      else if (m[1] === "area") area.title = m[2].trim();
      else area.prefix = m[2].trim();
    }
    i++;
  }
  if (!/^[A-Z]{2,10}$/.test(area.prefix)) err(0, "front matter needs prefix: of 2-10 capital letters");
  if (!area.title) err(0, "front matter needs area:");

  let story = null;
  let list = null; // "files" while reading the indented list under "- Files:"
  let inGherkin = false;
  let scenario = null;

  const closeScenario = (at) => {
    if (!scenario) return;
    if (!scenario.when) err(scenario.line, `${scenario.id} has no When step`);
    if (!scenario.then) err(scenario.line, `${scenario.id} has no Then step`);
    scenario = null;
    void at;
  };
  const closeStory = () => {
    if (!story) return;
    const at = story.line - 1;
    if (!story.status) err(at, `${story.id} needs "- Status: planned", "- Status: draft" or "- Status: verified"`);
    if (!story.seen.commands) err(at, `${story.id} needs a "- Commands:" line (use "none" when there is no command)`);
    if (!story.files.length) err(at, `${story.id} lists no files`);
    if (!story.seen.tests) err(at, `${story.id} needs a "- Tests:" line (use "none")`);
    for (const part of ["As a", "I want", "So that"])
      if (!story.parts.has(part)) err(at, `${story.id} is missing the "**${part}**" line`);
    if (!story.scenarios.length) err(at, `${story.id} has no scenarios`);
    delete story.seen;
    delete story.parts;
    stories.push(story);
    story = null;
  };

  for (; i < lines.length; i++) {
    const line = lines[i];

    if (inGherkin) {
      if (line.trim() === "```") {
        closeScenario(i);
        inGherkin = false;
        continue;
      }
      const sc = /^\s*Scenario(?: Outline)?:\s*(\S+)\s+(.+)$/.exec(line);
      if (sc) {
        closeScenario(i);
        const [, id, title] = sc;
        const want = `${story.id}.${story.scenarios.length + 1}`;
        if (id !== want) err(i, `scenario id "${id}" should be "${want}"`);
        scenario = { id, line: i, when: false, then: false };
        story.scenarios.push({ id, title: title.trim() });
        continue;
      }
      if (/^\s*Scenario/.test(line)) err(i, 'scenario line must be "Scenario: <STORY-ID>.<n> <title>"');
      if (scenario) {
        if (/^\s*When\b/.test(line)) scenario.when = true;
        if (/^\s*Then\b/.test(line)) scenario.then = true;
      }
      continue;
    }

    const h = /^## (.+)$/.exec(line);
    if (h) {
      closeStory();
      list = null;
      const m = /^([A-Z]+)-(\d{3}): (.+)$/.exec(h[1]);
      if (!m) {
        err(i, `story heading must be "## ${area.prefix || "PREFIX"}-NNN: Title"`);
        continue;
      }
      if (m[1] !== area.prefix) err(i, `story ${m[1]}-${m[2]} does not use this file's prefix ${area.prefix}`);
      story = {
        id: `${m[1]}-${m[2]}`, title: m[3].trim(), area: area.prefix, spec: rel, line: i + 1,
        status: "", commands: [], files: [], tests: [], docs: [], scenarios: [],
        seen: {}, parts: new Set(),
      };
      continue;
    }
    if (!story) continue;

    if (line.trim() === "```gherkin") {
      inGherkin = true;
      list = null;
      continue;
    }
    if (list === "files") {
      const f = /^\s+- `([^`]+)`(?:\s+[—-]\s+(.+))?$/.exec(line);
      if (f) {
        story.files.push({ path: f[1], note: (f[2] || "").trim() });
        continue;
      }
      list = null;
    }
    const field = /^- (Status|Commands|Files|Tests|Docs):\s*(.*)$/.exec(line);
    if (field) {
      const [, key, value] = field;
      if (key === "Status") {
        if (value !== "planned" && value !== "draft" && value !== "verified") err(i, 'Status must be "planned", "draft" or "verified"');
        story.status = value;
      } else if (key === "Commands") {
        story.seen.commands = true;
        story.commands = ticked(value);
        if (!story.commands.length && value.trim() !== "none") err(i, 'Commands must be backticked ids or "none"');
      } else if (key === "Files") {
        if (value.trim()) err(i, '"- Files:" takes an indented list, one file per line');
        list = "files";
      } else if (key === "Tests") {
        story.seen.tests = true;
        story.tests = ticked(value);
        if (!story.tests.length && value.trim() !== "none") err(i, 'Tests must be backticked paths or "none"');
      } else {
        story.docs = ticked(value);
      }
      continue;
    }
    const part = /^\*\*(As an?|I want|So that)\*\* \S/.exec(line);
    if (part) story.parts.add(part[1].replace("As an", "As a"));
  }
  if (inGherkin) err(lines.length - 1, "unclosed ```gherkin block");
  closeStory();
  return { area, stories };
}

function registeredCommands() {
  const ids = new Set();
  for (const rel of walk("src")) {
    if (!/\.(ts|tsx)$/.test(rel) || rel.includes("__tests__")) continue;
    const text = read(join(ROOT, rel));
    for (const m of text.matchAll(/register\(\{\s*id:\s*"([^"]+)"/g)) ids.add(m[1]);
    // commands.ts registers the line commands through a helper: lineTransform("Title", "code.sortAsc", …)
    for (const m of text.matchAll(/lineTransform\("[^"]*",\s*"([^"]+)"/g)) ids.add(m[1]);
    // …and the language-server ones: lspCmd("code.gotoDefinition", "Go to Definition", …)
    for (const m of text.matchAll(/lspCmd\("([^"]+)"/g)) ids.add(m[1]);
  }
  return ids;
}

export function build(specFiles) {
  const errors = [];
  const areas = [];
  const stories = {};
  for (const rel of specFiles) {
    const { area, stories: found } = parseSpec(rel, errors);
    const clash = areas.find((a) => a.prefix === area.prefix);
    if (clash) errors.push(`${rel}:1 prefix ${area.prefix} is already used by ${clash.spec}`);
    areas.push({ ...area, stories: found.length });
    for (const s of found) {
      if (stories[s.id]) errors.push(`${rel}:${s.line} duplicate story id ${s.id}`);
      stories[s.id] = s;
      const paths = [...s.files.map((f) => f.path), ...s.tests, ...s.docs];
      for (const p of paths) {
        if (p.includes("\\")) errors.push(`${rel}:${s.line} ${s.id}: use forward slashes in ${p}`);
        // A planned story (not built yet) may name files that its implementation will create.
        else if (s.status !== "planned" && !existsSync(join(ROOT, p))) errors.push(`${rel}:${s.line} ${s.id}: no such file ${p}`);
      }
    }
  }

  const files = {};
  const tests = {};
  const commands = {};
  const add = (map, key, id) => (map[key] ??= []).push(id);
  for (const s of Object.values(stories)) {
    for (const f of s.files) add(files, f.path, s.id);
    for (const t of s.tests) add(tests, t, s.id);
    for (const c of s.commands) add(commands, c, s.id);
  }
  const sorted = (map) => Object.fromEntries(Object.keys(map).sort().map((k) => [k, [...new Set(map[k])].sort()]));
  areas.sort((a, b) => a.prefix.localeCompare(b.prefix));

  return {
    errors,
    index: {
      note: "Generated by scripts/specs-index.mjs from specs/*.md. Do not edit; run `pnpm specs`.",
      areas,
      stories: Object.fromEntries(
        Object.keys(stories).sort().map((k) => [k, { ...stories[k], files: stories[k].files.map((f) => f.path) }]),
      ),
      files: sorted(files),
      tests: sorted(tests),
      commands: sorted(commands),
    },
  };
}

/** Source files and command ids that no story mentions, and command ids that no longer exist. */
function gaps(index) {
  const out = [];
  const known = registeredCommands();
  for (const dir of SOURCE_DIRS)
    for (const rel of walk(dir)) {
      if (!SOURCE_EXT.test(rel) || rel.includes("__tests__") || NO_STORY_NEEDED.has(rel)) continue;
      if (!index.files[rel]) out.push(`no story lists the file ${rel}`);
    }
  // Shared test helpers (src/__tests__/helpers/) are not tests and need no story.
  for (const rel of walk("src/__tests__")) if (rel !== "src/__tests__/specs.test.ts" && !rel.startsWith("src/__tests__/helpers/") && !index.tests[rel]) out.push(`no story lists the test ${rel}`);
  for (const id of [...known].sort()) if (!index.commands[id]) out.push(`no story covers the command ${id}`);
  for (const id of Object.keys(index.commands))
    // …unless every story naming it is still planned: the command arrives with the implementation.
    if (!known.has(id) && index.commands[id].some((s) => index.stories[s].status !== "planned")) out.push(`command ${id} (${index.commands[id].join(", ")}) is not registered anywhere`);
  return out;
}

/** README.md with its table of areas (between the areas:start / areas:end markers) brought up to date. */
function readmeWithAreas(index) {
  const rows = index.areas.map((a) => `| \`${a.prefix}\` | ${a.title} | [${a.spec.slice(6)}](${a.spec.slice(6)}) | ${a.stories} |`);
  const table = ["| Prefix | Area | File | Stories |", "| --- | --- | --- | --- |", ...rows].join("\n");
  return read(README).replace(/(<!-- areas:start -->\n)[\s\S]*?(<!-- areas:end -->)/, `$1${table}\n$2`);
}

/** `--for <file | command id | story id> ...`: prints the stories behind each, one per line. */
function lookup(keys) {
  const index = JSON.parse(read(INDEX));
  for (const raw of keys) {
    const key = raw.replaceAll("\\", "/");
    const ids = index.stories[key] ? [key] : [...(index.files[key] ?? []), ...(index.tests[key] ?? []), ...(index.commands[key] ?? [])];
    console.log(`${key}: ${ids.length ? "" : "no stories"}`);
    for (const id of ids) {
      const s = index.stories[id];
      console.log(`  ${id}  ${s.title}  (${s.spec}:${s.line}, ${s.scenarios.length} scenarios, ${s.status})`);
      if (ids.length === 1 && id === key) for (const f of [...s.files, ...s.tests]) console.log(`    ${f}`);
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--for") return lookup(args.slice(1));
  const lint = args[0] === "--lint";
  const check = args[0] === "--check";
  const all = readdirSync(SPECS).filter((f) => f.endsWith(".md") && f !== "README.md" && f !== "FINDINGS.md").sort().map((f) => `specs/${f}`);
  const { errors, index } = build(lint ? args.slice(1).map((a) => a.replace(/\\/g, "/")) : all);

  if (lint) {
    for (const e of errors) console.error(e);
    console.log(`${Object.keys(index.stories).length} stories, ${errors.length} problems`);
    process.exit(errors.length ? 1 : 0);
  }

  const problems = [...errors, ...gaps(index)];
  const text = JSON.stringify(index, null, 2) + "\n";
  if (check) {
    if (!existsSync(INDEX) || read(INDEX) !== text || read(README) !== readmeWithAreas(index))
      problems.push("specs/index.json is out of date: run `pnpm specs`");
  } else {
    writeFileSync(INDEX, text);
    writeFileSync(README, readmeWithAreas(index));
  }
  for (const p of problems) console.error(p);
  const n = Object.keys(index.stories).length;
  const scenarios = Object.values(index.stories).reduce((sum, s) => sum + s.scenarios.length, 0);
  console.log(`${n} stories, ${scenarios} scenarios, ${index.areas.length} areas, ${problems.length} problems`);
  process.exit(check && problems.length ? 1 : 0);
}

main();
