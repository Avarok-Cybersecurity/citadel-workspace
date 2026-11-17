#!/usr/bin/env node
// `npm ci` inside a directory that is already a root workspace re-resolves that
// subtree and unhoists the root's devDependencies. Whatever the root `npm ci`
// put in `node_modules/.bin` is gone, and every later step that relies on it
// fails with exit 127.
//
// That is why the lint job carried an explicit `npm install eslint@9.39.2`
// two steps after a nested `npm ci`: not because eslint was missing, but to
// put it back. Removing the install without removing its cause turned the job
// into `.bin/eslint: not found`.
//
// The unit-tests job has never had the nested `npm ci` and has never needed a
// compensating install. That difference is the whole finding.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspaces = new Set(
  JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).workspaces ?? [],
);
if (workspaces.size === 0) throw new Error('root package.json declares no workspaces');

/**
 * Both workflow sets, because the submodule's jobs install into the SAME tree.
 *
 * This read only the parent's own `.github/workflows`, and the submodule's lint
 * job carried the exact pattern above — a nested `npm ci` in
 * `citadel-internal-service/typescript-client`, followed two steps later by the
 * compensating `npm install eslint@9.39.2` this file's header describes, plus
 * three `ln -sf` calls putting the unhoisted packages back. It was invisible here
 * for as long as this gate existed, while docs/ROBUSTNESS.md recorded the fix as
 * done.
 *
 * The UI repo's workflows were read here too until the UI was folded into
 * citadel-workspaces/ and its CI into this repository's validate.yml.
 */
const WORKFLOW_SETS = [{ dir: join(root, '.github', 'workflows'), label: '' }];

const failures = [];
let scanned = 0;
let setsRead = 0;

for (const set of WORKFLOW_SETS) {
  if (!existsSync(set.dir)) continue; // see the floor below
  setsRead += 1;
  for (const name of readdirSync(set.dir).filter((f) => /\.ya?ml$/.test(f))) {
  const file = set.label + name;
  const lines = readFileSync(join(set.dir, name), 'utf8').split('\n');
  scanned++;
  lines.forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    if (!/\bnpm\s+ci\b/.test(line)) return;

    // A step's directory is either on the same `run:` line (`cd x && npm ci`)
    // or in the `working-directory:` that follows it within the step.
    const cd = /\bcd\s+([^\s&|;]+)/.exec(line)?.[1];
    let dir = cd ?? null;
    if (!dir) {
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        if (/^\s*-\s/.test(lines[j])) break; // next step
        const wd = /^\s*working-directory:\s*(\S+)/.exec(lines[j]);
        if (wd) {
          dir = wd[1];
          break;
        }
      }
    }
    if (!dir) return; // repo root: that is the npm ci everything depends on
    const normalised = dir.replace(/^\.\//, '').replace(/\/$/, '');
    if (!workspaces.has(normalised)) return;

    failures.push(
      `${file}:${i + 1}  \`npm ci\` in ${normalised}, which is a root workspace.\n` +
        `      The root \`npm ci\` already installs it; running it again here ` +
        `unhoists\n      the root devDependencies and later steps fail with exit 127.\n` +
        `      ${line.trim()}`,
    );
  });
  }
}

// The directory must have been readable, or this reports a clean bill for a tree
// it never opened.
if (setsRead < WORKFLOW_SETS.length) {
  console.error(
    `FAIL: read ${setsRead} of ${WORKFLOW_SETS.length} workflow directories, so nothing was checked.`,
  );
  process.exit(1);
}

if (failures.length) {
  console.error('A nested `npm ci` will unhoist the root devDependencies:\n');
  for (const f of failures) console.error('  ' + f + '\n');
  console.error('Use `npm run <script>` with `working-directory` instead.');
  process.exit(1);
}

console.log(
  `OK: no workflow runs \`npm ci\` inside one of the ${workspaces.size} root ` +
    `workspaces (${scanned} workflow file(s) across ${setsRead} repositor(y/ies) scanned).`,
);
