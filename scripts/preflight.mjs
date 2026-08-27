#!/usr/bin/env node
/**
 * Every CI gate that can run without Docker, in one command.
 *
 * The local loop was tsc + eslint + vitest + the submodule-pointer guard, while
 * CI runs eleven things. Three gates were found red by finally running them by
 * hand — the 250-line cap (twice), the stack-reachability guard, and
 * workspace-wide clippy — and the line cap was then broken twice MORE after
 * that failure had been written down. Recording a gap did not close it; a
 * runnable command might.
 *
 * Deliberately does NOT run: anything needing Docker or a live stack, the
 * integration suites (they share one backend), or the submodule-pointer check
 * (that one is about pushing, not about the code being correct).
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI = join(ROOT, 'citadel-workspaces');

const CHECKS = [
  ['file length', 'node', ['scripts/check-file-length.mjs'], ROOT],
  ['icon button names', 'node', ['scripts/check-icon-button-names.mjs'], ROOT],
  ['hover-only controls', 'node', ['scripts/check-hover-only-controls.mjs'], ROOT],
  ['storage keys', 'node', ['scripts/check-storage-keys.mjs'], ROOT],
  ['destructive contrast', 'node', ['scripts/check-destructive-contrast.mjs'], ROOT],
  ['docker workspace manifest', 'node', ['scripts/check-docker-workspace-manifest.mjs'], ROOT],
  ['intent results checked', 'node', ['scripts/check-intent-results-checked.mjs'], ROOT],
  ['crate coverage', 'node', ['scripts/check-crate-coverage.mjs'], ROOT],
  ['doc file references', 'node', ['scripts/check-doc-file-refs.mjs'], ROOT],
  ['event listeners have emitters', 'node', ['scripts/check-event-listeners-have-emitters.mjs'], UI],
  ['typecheck', 'npx', ['tsc', '-p', 'tsconfig.app.json', '--noEmit'], UI],
  ['eslint', 'npx', ['eslint', '.', '--max-warnings', '0'], UI],
  ['unit tests', 'npx', ['vitest', 'run'], UI],
];

const failed = [];
for (const [name, cmd, args, cwd] of CHECKS) {
  process.stdout.write(`  ${name} … `);
  const run = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (run.status === 0) {
    console.log('ok');
  } else {
    console.log('FAILED');
    failed.push({ name, output: `${run.stdout ?? ''}${run.stderr ?? ''}`.trim() });
  }
}

if (failed.length > 0) {
  for (const { name, output } of failed) {
    console.error(`\n─── ${name} ───\n${output.split('\n').slice(-40).join('\n')}`);
  }
  console.error(`\n${failed.length} of ${CHECKS.length} checks failed.`);
  process.exit(1);
}

console.log(`\nAll ${CHECKS.length} checks passed.`);
