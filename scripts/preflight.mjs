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
 *
 * The script list is DERIVED from validate.yml, not written out here.
 *
 * It used to be a hand-maintained array, and it drifted: CI grew to twenty-one
 * `node scripts/*.mjs` gates while this file still listed ten, so eleven checks
 * a developer could have run in one second locally were only ever discovered by
 * pushing. That is the same failure this file was written to end, re-appearing
 * one gate at a time — which is what a hand-copied list does. Reading the
 * workflow means adding a gate to CI adds it here, with no second edit.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI = join(ROOT, 'citadel-workspaces');

/**
 * Gates that genuinely cannot run here, with the reason. Anything NOT listed is
 * run — so a new CI gate is included by default and this file has to be edited
 * to exclude it, rather than edited to include it.
 */
const NEEDS_MORE_THAN_A_CHECKOUT = new Map([
  ['check-production-image.mjs', 'drives a real browser against a built production image'],
]);

/** Every `node scripts/<name>.mjs` step in the workflow, in file order. */
function ciScriptGates() {
  const path = join(ROOT, '.github/workflows/validate.yml');
  let workflow;
  try {
    workflow = readFileSync(path, 'utf8');
  } catch {
    // An unreadable workflow means an empty gate list, and an empty gate list
    // is a clean run over nothing. Say which file, rather than a stack trace.
    console.error(`preflight: cannot read ${path}; the gate list would be empty.`);
    process.exit(1);
  }
  const found = [...workflow.matchAll(/node\s+(scripts\/[a-z0-9-]+\.mjs)/g)].map((m) => m[1]);
  const unique = [...new Set(found)];
  // A guard that silently checks nothing is the thing this repo keeps finding.
  // If the workflow is renamed or its shape changes, say so rather than
  // reporting a clean run over an empty list.
  if (unique.length < 10) {
    console.error(
      `preflight: only ${unique.length} script gates found in validate.yml — ` +
        'the workflow moved or changed shape, so this list cannot be trusted.',
    );
    process.exit(1);
  }
  return unique;
}

const skipped = [];
const derived = ciScriptGates().flatMap((script) => {
  const name = script.replace(/^scripts\//, '').replace(/\.mjs$/, '');
  const reason = NEEDS_MORE_THAN_A_CHECKOUT.get(script.replace(/^scripts\//, ''));
  if (reason) {
    skipped.push([name, reason]);
    return [];
  }
  return [[name.replace(/^check-/, '').replace(/-/g, ' '), 'node', [script], ROOT]];
});

const CHECKS = [
  ...derived,
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

if (skipped.length > 0) {
  // Named, not hidden: an exclusion nobody can see is how a list starts lying.
  for (const [name, reason] of skipped) {
    console.log(`  ${name} … skipped here (${reason})`);
  }
}
console.log(`\nAll ${CHECKS.length} checks passed.`);
