#!/usr/bin/env node
/**
 * Every tracked Cargo.lock is complete for its manifests: `cargo metadata --locked` resolves it
 * without wanting to write it.
 *
 * Validate PR run 45010060046 failed in "telemetry-read builds and passes its tests" and
 * "coupon-admin and control-request build and pass their tests" with `cannot update the lock
 * file .../tools/telemetry-read/Cargo.lock because --locked was passed`. Those tools are cargo
 * workspaces of their own that reach the SDK through path deps (citadel-workspace-types ->
 * citadel-internal-service/...), so a citadel_sdk re-pin in the root or the agent left their locks
 * behind -- and nothing but those two jobs ever builds them. check-git-deps-agree-across-lockfiles
 * compares the revisions that ARE locked; it cannot see a lock that no longer matches its manifests.
 *
 * Online on purpose. `--offline` resolves from the local cache only, so a box that never built
 * apps/first-party/calendar failed it with "failed to download jiff-static" on a complete lock: a
 * red that names the cache, not the lock. Online, a complete lock costs well under a second per
 * lockfile once its crates are cached, and ~11 s for telemetry-read on an empty CARGO_HOME.
 *
 * Usage: node scripts/check-lockfiles-are-complete.mjs   (from anywhere; reads git ls-files)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lockDirs, verdict } from './lib/lockfile-completeness.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (spawnSync('cargo', ['--version'], { stdio: 'ignore' }).status !== 0) {
  console.error('FAIL: cargo is not on PATH, so no Cargo.lock can be judged.');
  process.exit(1);
}

const dirs = lockDirs(execFileSync('git', ['ls-files', '-z', '--', 'Cargo.lock', '*/Cargo.lock'], { cwd: ROOT, encoding: 'utf8' }));
if (dirs.length === 0) {
  console.error('FAIL: git ls-files found no tracked Cargo.lock; this gate would judge nothing.');
  process.exit(1);
}

const failures = [];
for (const dir of dirs) {
  const absDir = realpathSync(resolve(ROOT, dir));
  // cwd is the repository root for every run, so rustup picks one toolchain rather than a
  // directory's pin; a lock's completeness does not depend on which cargo reads it.
  const r = spawnSync('cargo', ['metadata', '--locked', '--format-version', '1', '--manifest-path', join(absDir, 'Cargo.toml')], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let workspaceRoot = null;
  if (r.status === 0) workspaceRoot = realpathSync(JSON.parse(r.stdout).workspace_root);
  const v = verdict({ dir, status: r.error ? null : r.status, stderr: r.error ? r.error.message : r.stderr, workspaceRoot, absDir });
  if (!v.ok) failures.push(v);
}

if (failures.length > 0) {
  for (const f of failures) console.error(`::error file=${f.lock}::${f.message.split('\n')[0]}`);
  console.error(`\nFAIL: ${failures.length} of ${dirs.length} tracked Cargo.lock file(s) cannot be built with --locked:\n`);
  for (const f of failures) console.error(`  [${f.kind}] ${f.message}\n`);
  console.error(
    'A stale lock passes every local build (cargo rewrites it silently) and fails only the CI job\n' +
      'that builds that workspace with --locked. Run each fix above and commit the lockfile.',
  );
  process.exit(1);
}
console.log(`check-lockfiles-are-complete: ${dirs.length} tracked Cargo.lock file(s) resolve with --locked: ${dirs.join(', ')}`);
