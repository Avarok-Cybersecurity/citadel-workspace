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

const count = countTestFiles(DIST);
if (count === 0) {
  console.error(
    '\n  No compiled *.test.js under dist/.\n' +
      '  `node --test` would exit 0 having run nothing, so this fails instead.\n' +
      '  Check that the sources still exist and that tsconfig emits them.\n'
  );
  process.exit(1);
}
console.log(`  ${count} compiled test file(s) found under dist/`);
