#!/usr/bin/env node
// CI lints every workspace with `--max-warnings 0`. Two of the three `lint`
// scripts a developer actually runs did not, so a warning-level rule passed
// locally and failed in CI -- the same shape as CI pinning a different vitest
// than the lockfile: "it's green here" and "it's green in CI" were answers to
// different questions.
//
// `citadel-workspace-client-ts/eslint.config.js` has `no-unused-vars` and
// `no-explicit-any` at "warn", so this was reachable, not theoretical.
//
// The required flags are DERIVED from the workflow, not listed here, so
// tightening CI is what makes this gate demand more.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = readFileSync(join(root, '.github', 'workflows', 'validate.yml'), 'utf8');

// The line the lint job actually runs, e.g.
//   ${{ github.workspace }}/node_modules/.bin/eslint . --max-warnings 0
const ciLine = workflow
  .split('\n')
  .find((l) => /\.bin\/eslint\b/.test(l) && !/^\s*#/.test(l));
if (!ciLine) {
  throw new Error('no eslint invocation found in validate.yml -- has the lint job moved?');
}

const required = [...ciLine.matchAll(/(--[a-z-]+(?:[= ]\S+)?)/g)]
  .map(([, flag]) => flag.trim())
  .filter((f) => !f.startsWith('--config'));
if (required.length === 0) {
  throw new Error(`CI's eslint line carries no flags to require: ${ciLine.trim()}`);
}

const workspaces = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).workspaces ?? [];
const failures = [];
const absent = [];
let checked = 0;

for (const ws of workspaces) {
  const manifest = join(root, ws, 'package.json');
  if (!existsSync(manifest)) {
    // A submodule that is not checked out. Named rather than skipped in
    // silence, so a narrowed scan is visible instead of reading as a pass.
    absent.push(ws);
    continue;
  }
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
  const lint = pkg.scripts?.lint;
  if (!lint) continue; // a workspace with no lint script is finding #2's problem, not this one
  checked++;
  const missing = required.filter((flag) => !lint.includes(flag));
  if (missing.length) {
    failures.push(
      `${ws}/package.json  "lint": ${JSON.stringify(lint)}\n` +
        `      missing ${missing.join(' ')} -- CI lints this path with them, so a ` +
        `warning passes here and fails there.`,
    );
  }
}

if (checked === 0) {
  throw new Error('no workspace declares a lint script -- the scan matched nothing');
}

if (failures.length) {
  console.error('Local lint is weaker than CI lint:\n');
  for (const f of failures) console.error('  ' + f + '\n');
  console.error(`CI runs: ${ciLine.trim()}`);
  process.exit(1);
}

console.log(
  `OK: all ${checked} workspace lint scripts carry CI's flags (${required.join(' ')}).` +
    (absent.length ? `  Not checked (not checked out): ${absent.join(', ')}.` : ''),
);
