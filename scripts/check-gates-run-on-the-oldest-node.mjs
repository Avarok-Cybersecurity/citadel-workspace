#!/usr/bin/env node
/**
 * A gate may not use an API newer than the Node this repository supports.
 *
 * `check-permission-gates.mjs` imported `globSync` from `node:fs`. That arrived
 * in Node 22; the lint job is pinned to Node 20 and `engines` says `>=20`. It
 * threw `does not provide an export named globSync` and took the ESLint jobs
 * for all three projects down with it.
 *
 * It passed locally, and would pass locally for anybody: the shell that wrote
 * it runs Node 22. Nothing about running the gate on a developer's machine can
 * see this, which is what makes it worth a check rather than a habit.
 *
 * Bumping CI to 22 would have made the red go away and left `engines: >=20`
 * lying. The floor is the contract; the gates have to meet it.
 *
 * The list is deliberately short. It is not "every API added since Node 20" —
 * that is unmaintainable and would rot into noise. It is the handful that are
 * genuinely tempting in a gate that walks files and reads JSON, each with the
 * version it landed in, so a reader can check the claim.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The floor, from package.json rather than repeated here. */
function engineFloor() {
  const declared = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))?.engines?.node;
  const major = /(\d+)/.exec(declared ?? '')?.[1];
  if (!major) {
    console.error('\n  package.json declares no engines.node; there is no floor to check against.\n');
    process.exit(1);
  }
  return Number(major);
}

/**
 * API → the Node major it first shipped in.
 *
 * `navigator.` was in this list for one run and had to come out: it is a Node
 * 21 global, and it is ALSO a browser global, and the gates that drive a
 * browser use it inside `page.evaluate()` where it runs in Chrome and has
 * nothing to do with Node. The check reported three of them, correctly by its
 * own rule and wrongly in every sense that matters. A gate that cries wolf is
 * a gate somebody switches off, so the rule is now: only APIs that could only
 * ever be Node's.
 */
const ARRIVED_IN = new Map([
  ['globSync', 22],
  ['fsPromises.glob', 22],
  ['Array.fromAsync', 22],
  ['process.getBuiltinModule', 22],
  ['util.styleText', 21],
]);

const FLOOR = engineFloor();
const TOO_NEW = [...ARRIVED_IN].filter(([, since]) => since > FLOOR);

const SKIP = new Set(['node_modules', 'dist', 'target', '.git', 'coverage']);

/** Every gate script in this repo and its submodules. */
function gates(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    let info;
    try { info = statSync(full); } catch { continue; }
    if (info.isDirectory()) gates(full, out);
    else if (/^check-[a-z0-9-]+\.mjs$/.test(entry)) out.push(full);
  }
  return out;
}

const found = gates(ROOT);
if (found.length < 10) {
  console.error(`\n  Found only ${found.length} gate script(s) — the layout changed and nothing was checked.\n`);
  process.exit(1);
}

const problems = [];
const SELF = fileURLToPath(import.meta.url);
for (const file of found) {
  // This file lists every API it forbids, as data rather than as prose, so
  // comment-stripping does not hide them. It reported itself on its first run.
  if (file === SELF) continue;
  // Comments stripped: this file names every API it forbids.
  const source = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const [api, since] of TOO_NEW) {
    if (source.includes(api)) {
      problems.push([relative(ROOT, file), api, since]);
    }
  }
}

if (problems.length > 0) {
  console.error(`\n  Gates using an API newer than Node ${FLOOR}, which is this repository's floor:\n`);
  for (const [file, api, since] of problems) {
    console.error(`::error file=${file}::uses ${api}, added in Node ${since}; engines says >=${FLOOR}`);
  }
  console.error(
    `\n  CI pins Node ${FLOOR} for several jobs and a gate that needs more than that\n` +
    '  dies at import and takes every other step in its job with it. Use an\n' +
    '  equivalent that exists in the floor — a readdirSync walk instead of\n' +
    '  globSync — or raise `engines` deliberately, in a commit that says so.\n',
  );
  process.exit(1);
}

console.log(`  Gate runtimes: ${found.length} gate(s), none newer than Node ${FLOOR}  ok`);
