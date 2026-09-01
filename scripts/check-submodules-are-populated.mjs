#!/usr/bin/env node
/**
 * A clone without `--recurse-submodules` cannot build, and does not say so.
 *
 * Three of the four npm workspace packages live INSIDE submodules —
 * `citadel-workspaces`, `citadel-workspaces/integration-tests` and
 * `citadel-internal-service/typescript-client`. Only
 * `citadel-workspace-client-ts` is in this repository. So a plain
 * `git clone` leaves those directories empty, every one of them missing the
 * package.json that `workspaces` in the root package.json points at, and npm
 * fails on a workspace it cannot resolve rather than on the thing that is
 * actually wrong.
 *
 * `git clone --recurse-submodules` is the documented first line of the
 * quickstart, and forgetting it is the single easiest way to start badly. This
 * turns that into one sentence naming the fix.
 *
 * Local-only, deliberately: CI always checks submodules out, so by the time a
 * workflow could catch this it has never been true. Same reasoning as
 * check-submodule-pointers-pushed.
 */
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let status;
try {
  status = execFileSync('git', ['submodule', 'status', '--recursive'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
} catch (error) {
  console.error(`Could not read submodule status: ${error.message}`);
  process.exit(1);
}

const lines = status.split('\n').filter((line) => line.trim().length > 0);

// A guard that examines nothing passes as readily as one that examines
// everything: this repo has submodules, so an empty listing is itself a failure.
if (lines.length === 0) {
  console.error('git reported no submodules at all, so this check verified nothing.');
  process.exit(1);
}

// git prefixes an uninitialised submodule with '-'. '+' means the checked-out
// commit differs from the pointer, which is a different problem and not this
// check's business — check-submodule-pointers-pushed covers that ground.
const uninitialised = lines
  .filter((line) => line.startsWith('-'))
  .map((line) => line.slice(1).split(/\s+/)[1] ?? line.slice(1));

if (uninitialised.length > 0) {
  console.error('These submodules are not checked out, so the build cannot work:\n');
  for (const path of uninitialised) console.error(`  - ${path}`);
  console.error(
    '\nRun:  git submodule update --init --recursive\n' +
      '\nThree of the four npm workspace packages live inside submodules, so ' +
      'npm will fail on a workspace it cannot resolve rather than on this.',
  );
  process.exit(1);
}

console.log(`Submodules OK: ${lines.length} checked out.`);
