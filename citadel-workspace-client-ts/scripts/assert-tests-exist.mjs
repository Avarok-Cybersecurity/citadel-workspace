#!/usr/bin/env node
/**
 * Fail if there are no compiled test files to run.
 *
 * `node --test "dist/**\/*.test.js"` exits 0 when the glob matches nothing, so
 * this package's `test` script reported success while running zero tests — the
 * failure mode a reviewer caught here, and the reason the typescript-integration
 * CI job was green without asserting anything.
 *
 * Tests existing again is not enough on its own: renaming a file, changing the
 * build's output layout or excluding it from tsconfig would all restore the
 * silent pass. This makes that an error instead.
 */

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';

function countTestFiles(dir) {
  if (!existsSync(dir)) return 0;
  let found = 0;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found += countTestFiles(path);
    else if (entry.endsWith('.test.js')) found += 1;
  }
  return found;
}

// `--print` emits the discovered paths on stdout so the test script can run
// exactly these files. One walk, two consumers: the check and the runner cannot
// disagree about what exists, which is precisely how this failed in CI — the
// check reported 2 compiled files and `node --test` then said it could not find
// them, because glob support in `--test` varies by Node version and CI pins 20,
// which has none.
const PRINT = process.argv.includes('--print');

const files = [];
function collect(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) collect(path);
    else if (entry.endsWith('.test.js')) files.push(path);
  }
}
collect(DIST);

const count = files.length;
if (PRINT && count > 0) {
  process.stdout.write(files.join(' '));
}
if (count === 0) {
  console.error(
    '\n  No compiled *.test.js under dist/.\n' +
      '  `node --test` would exit 0 having run nothing, so this fails instead.\n' +
      '  Check that the sources still exist and that tsconfig emits them.\n'
  );
  process.exit(1);
}
if (!PRINT) console.log(`  ${count} compiled test file(s) found under dist/`);

// The package calls globalThis.crypto.randomUUID() with no import — fine in
// browsers and Node >= 19, a ReferenceError on 18. That requirement was
// implicit until it surfaced here as two failing tests, so package.json now
// declares engines: node >= 20, matching CI.
