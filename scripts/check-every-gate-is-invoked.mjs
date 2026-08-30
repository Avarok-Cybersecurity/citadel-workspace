#!/usr/bin/env node
/**
 * Every `check-*.mjs` must be invoked by something.
 *
 * `check-submodule-pointers-pushed.mjs` was written, was correct, named the
 * offending pointer and the order to push in — and had never run once, because
 * nothing invoked it. A whole CI run of 73 jobs died in checkout for exactly the
 * condition it detects, while the detector sat in the same directory.
 *
 * Writing the guard is the hard part and it was already done. The cheap part —
 * connecting it — is the part that was missing, and nothing noticed because a
 * gate that runs nowhere looks identical to a gate that passes.
 *
 * Three places count as invoking one:
 *   - `.github/workflows/validate.yml`, for gates CI runs;
 *   - `scripts/preflight.mjs`, for gates that must run before a push and cannot
 *     wait for CI (the submodule pointer check is the whole reason that
 *     distinction exists);
 *   - a `package.json` script, for gates a developer runs against a live stack.
 *
 * A gate in none of those has no way to fire.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Where a gate can be named. Missing files are a broken checkout, not a pass. */
const CALLERS = [
  '.github/workflows/validate.yml',
  'scripts/preflight.mjs',
  'package.json',
  'citadel-workspaces/package.json',
];

const corpus = CALLERS.map((relative) => {
  const path = join(ROOT, relative);
  if (!existsSync(path)) {
    console.error(`check-every-gate-is-invoked: ${relative} is missing, so nothing was checked.`);
    process.exit(1);
  }
  return readFileSync(path, 'utf8');
}).join('\n');

/** Every gate script, in both scripts directories. */
function gates() {
  const found = [];
  for (const dir of ['scripts', join('citadel-workspaces', 'scripts')]) {
    const path = join(ROOT, dir);
    if (!existsSync(path)) continue;
    for (const file of readdirSync(path)) {
      if (file.startsWith('check-') && file.endsWith('.mjs')) found.push({ dir, file });
    }
  }
  return found;
}

const all = gates();
if (all.length < 10) {
  console.error(
    `check-every-gate-is-invoked: only ${all.length} gate scripts found — ` +
      'the layout moved, so this check cannot be trusted.',
  );
  process.exit(1);
}

// Matched by BASENAME, because the workflow, preflight and package.json each
// spell the path differently and a path-exact rule would report false failures
// that teach people to ignore it.
const orphans = all.filter(({ file }) => !corpus.includes(file)).map(({ dir, file }) => `${dir}/${file}`);

if (orphans.length > 0) {
  console.error('\ncheck-every-gate-is-invoked: gates that nothing runs:\n');
  for (const o of orphans) console.error(`  ${o}`);
  console.error(
    '\n  Add it to validate.yml, to preflight.mjs, or to a package.json script.\n' +
      '  A gate that runs nowhere looks exactly like a gate that passes.\n',
  );
  process.exit(1);
}
console.log(`check-every-gate-is-invoked: OK — all ${all.length} gates are invoked by something.`);
