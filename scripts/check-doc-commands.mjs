#!/usr/bin/env node
/**
 * Fails if the docs tell you to run something that does not exist.
 *
 * README.md advertised `npx playwright test` as the way to run the E2E suite;
 * deploy.sh's header advertised a build step it had stopped performing. Both
 * were plausible, valid-looking sentences — the kind inspection waves through,
 * because nothing about them looks wrong until you compare them with the repo.
 *
 * This checks the mechanically checkable half: every command a doc tells you to
 * run must resolve. An `npm run` script must exist in the package.json that is
 * in scope, a script path must be on disk, a `cargo -p` crate must be a
 * declared workspace member. What a command DOES once it runs is out of scope
 * and deliberately not guessed at.
 *
 * Pure file reads: nothing is executed, so the gate needs no toolchain, no
 * network and no Docker, and cannot be skipped for being slow.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_DIR = ROOT.replace(/\/+$/, '').split('/').pop();
const DOCS = ['README.md', 'ARCHITECTURE.md', ...readdirSync(join(ROOT, 'docs'))
  .filter((f) => f.endsWith('.md')).map((f) => join('docs', f))];

const failures = [];
const census = { npmRun: 0, paths: 0, cargoP: 0, skipped: 0 };

/** A token with a placeholder is a template, not a claim. */
const isTemplate = (t) => /[<>]|\$\{?[A-Z_]|\.\.\./.test(t);

const crates = new Set();
for (const mf of ['Cargo.toml', 'citadel-internal-service/Cargo.toml']) {
  const text = readFileSync(join(ROOT, mf), 'utf8');
  const block = text.match(/\[workspace\][\s\S]*?members\s*=\s*\[([\s\S]*?)\]/);
  if (!block) continue;
  const base = dirname(mf) === '.' ? '' : dirname(mf);
  for (const m of block[1].matchAll(/"([^"]+)"/g)) {
    const manifest = join(ROOT, base, m[1], 'Cargo.toml');
    if (!existsSync(manifest)) continue;
    const name = readFileSync(manifest, 'utf8').match(/^\s*name\s*=\s*"([^"]+)"/m);
    if (name) crates.add(name[1]);
  }
}

/** Scripts declared by the nearest package.json at or above `dir`. */
function scriptsFor(dir) {
  let d = dir;
  for (let i = 0; i < 6; i++) {
    const pkg = join(ROOT, d, 'package.json');
    if (existsSync(pkg)) {
      try { return Object.keys(JSON.parse(readFileSync(pkg, 'utf8')).scripts ?? {}); }
      catch { return []; }
    }
    if (d === '.' || d === '') break;
    d = dirname(d);
  }
  return [];
}

for (const doc of DOCS) {
  const full = join(ROOT, doc);
  if (!existsSync(full)) continue;
  const lines = readFileSync(full, 'utf8').split('\n');
  let inBlock = false;
  let cwd = '.';

  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (line.startsWith('```')) {
      if (inBlock) { inBlock = false; return; }
      // Only a LABELLED shell fence is a command block. An unlabelled fence is
      // just as often a directory tree or console transcript, and treating one
      // as commands invents findings — docs/WASM_SYNC.md's tree diagram lists
      // `generate_types.sh` as a leaf, which is not an instruction to run it.
      inBlock = /^```(bash|sh|shell)$/.test(line);
      if (inBlock) cwd = '.';
      return;
    }
    if (!inBlock || !line || line.startsWith('#')) return;
    const where = `${doc}:${idx + 1}`;

    // Track directory changes so a relative path is resolved the way a reader
    // would experience it. Without this, docs/TESTING.md's `./scripts/run-specs.sh`
    // — valid, because the line above it cd's into integration-tests — reads as
    // a broken reference.
    // `(cd X && ...)` is a SUBSHELL: its directory change applies to that line
    // only. A bare `cd X` on its own line persists. Conflating the two made a
    // README block resolve `(cd citadel-workspaces && ...)` against the previous
    // line's `(cd citadel-internal-service && ...)`, producing a directory that
    // does not exist — after which every remaining line in the block was skipped
    // as "unknown location". The checker went quiet over most of the file and
    // still reported success.
    const subshell = line.match(/^\(\s*cd\s+([^\s&;)]+)/);
    const bare = line.match(/^cd\s+([^\s&;)]+)/);

    /** Resolve `target` against `base`, or null if it is not a real directory. */
    const resolve = (base, target) => {
      if (base === null || isTemplate(target)) return null;
      // `git clone <repo> && cd <repo>` is how every getting-started section
      // opens, and after it the reader is standing in THIS repo's root. Without
      // this, `cd citadel-workspace` resolves to a nested directory that does
      // not exist, the location goes unknown, and the most important block in
      // the README — the one telling a newcomer how to run the thing — is the
      // one block the checker never reads.
      if (base === '.' && target === REPO_DIR) return '.';
      const next = normalize(join(base, target));
      const clamped = next.startsWith('..') ? '.' : next;
      return existsSync(join(ROOT, clamped)) ? clamped : null;
    };

    if (bare) cwd = resolve(cwd, bare[1]);
    const here = subshell ? resolve(cwd, subshell[1]) : cwd;

    if (here === null) {
      // Location unknown: `cd path/to/submodule` is a placeholder in ordinary
      // clothes, with none of the <>/$/... markers that flag a template.
      // Reporting paths from a guessed directory yields confident, wrong
      // findings, so only location-independent claims are checked here.
      for (const m of line.matchAll(/-p\s+([\w-]+)/g)) {
        if (isTemplate(m[1])) { census.skipped++; continue; }
        census.cargoP++;
        if (!crates.has(m[1])) {
          failures.push(`${where}\n    says: cargo ... -p ${m[1]}\n    reality: not a member of either Cargo workspace.`);
        }
      }
      census.skipped++;
      return;
    }

    for (const m of line.matchAll(/npm run ([\w:-]+)/g)) {
      if (isTemplate(m[1])) { census.skipped++; continue; }
      census.npmRun++;
      const scripts = scriptsFor(here);
      if (scripts.length && !scripts.includes(m[1])) {
        failures.push(`${where}\n    says: npm run ${m[1]}   (cwd: ${here})\n    reality: no such script in the package.json in scope.\n    Fix: correct the doc, or add the script. Do not leave a command a reader cannot run.`);
      }
    }

    for (const m of line.matchAll(/(?:^|\s|\()((?:\.\/)?[\w./-]+\.(?:sh|mjs))\b/g)) {
      const tok = m[1];
      if (isTemplate(tok)) { census.skipped++; continue; }
      census.paths++;
      if (!existsSync(join(ROOT, here, tok))) {
        failures.push(`${where}\n    says: ${tok}   (cwd: ${here})\n    reality: no such file relative to that directory.\n    Fix: correct the path, or restore the script the doc still advertises.`);
      }
    }

    for (const m of line.matchAll(/-p\s+([\w-]+)/g)) {
      if (isTemplate(m[1])) { census.skipped++; continue; }
      census.cargoP++;
      if (!crates.has(m[1])) {
        failures.push(`${where}\n    says: cargo ... -p ${m[1]}\n    reality: not a member of either Cargo workspace.\n    Fix: correct the crate name, or add it to a workspace's members.`);
      }
    }
  });
}

// Anti-vacuity. A checker that quietly stops matching anything reports a clean
// run forever, which is the same defect it exists to catch — one level up.
const FLOORS = { npmRun: 4, paths: 3, cargoP: 2 };
for (const [k, min] of Object.entries(FLOORS)) {
  if (census[k] < min) {
    failures.push(`Extraction census: only ${census[k]} ${k} reference(s) found, expected at least ${min}.\n    The docs changed shape and this checker is no longer reading them, so a clean result here would mean nothing.`);
  }
}

if (failures.length) {
  console.error(`\nDoc commands: ${failures.length} problem(s)\n`);
  for (const f of failures) console.error(`  - ${f}\n`);
  process.exit(1);
}
console.log(`Doc commands: ${census.npmRun} npm-run, ${census.paths} path and ${census.cargoP} crate reference(s) across ${DOCS.length} docs all resolve (${census.skipped} template(s) skipped).`);
