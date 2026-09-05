#!/usr/bin/env node
/**
 * Preflight must invoke each gate the way CI invokes it — arguments included.
 *
 * It did not. The workflow parse captured the script path and dropped the rest
 * of the line, so `node scripts/build-gates-index.mjs --check` ran here as
 * `node scripts/build-gates-index.mjs` — and without `--check` that script
 * takes its else branch and WRITES docs/GATES.md.
 *
 * Two things went wrong at once, and the second is the worse one:
 *
 *   - a check-only command became a mutation of a tracked file in the
 *     developer's working tree, silently;
 *   - preflight printed `build gates index … ok` for a gate that cannot fail,
 *     because the write branch always succeeds. The CI job it stands in for
 *     then went red on a file preflight had claimed to check.
 *
 * A dropped argument is invisible in the output: the gate's name is derived
 * from its filename, so the line reads the same either way. Only comparing the
 * two argument lists shows it.
 *
 * Preflight's `--print-plan` is the source of truth for what preflight runs;
 * this reads the workflow independently and compares. Re-implementing the
 * workflow parse here would be a second copy to drift, so only the ARGUMENTS
 * are re-derived, from the same lines.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = join(ROOT, '.github/workflows/validate.yml');

/** script -> argv, exactly as the workflow spells it. */
function ciInvocations() {
  const yaml = readFileSync(WORKFLOW, 'utf8');
  const byScript = new Map();
  for (const [, script, rest] of yaml.matchAll(/node\s+(scripts\/[a-z0-9-]+\.mjs)([^\n]*)/g)) {
    const args = rest.split('#')[0].trim().split(/\s+/).filter(Boolean);
    // A script invoked twice with different arguments is out of scope: preflight
    // keys its plan by (dir, script, args) and would list both. Keep the first
    // and say so rather than silently comparing against one of them.
    if (!byScript.has(script)) byScript.set(script, args);
  }
  return byScript;
}

const ci = ciInvocations();
if (ci.size < 10) {
  console.error(
    `check-preflight-runs-what-ci-runs: only ${ci.size} gate invocations found in ` +
      `${WORKFLOW} — the workflow moved or changed shape, so this comparison is ` +
      'over nothing.',
  );
  process.exit(1);
}

let plan;
try {
  plan = JSON.parse(execFileSync('node', ['scripts/preflight.mjs', '--print-plan'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    // A preflight that does not KNOW --print-plan ignores it and runs every
    // gate, including workspace clippy and the full vitest suite. That is
    // minutes of CI for a comparison, and it happened: running this against the
    // previous preflight rewrote docs/GATES.md in the working tree on the way
    // past, which is the very defect being fixed. Two minutes is far longer
    // than printing a plan and far shorter than running one.
    timeout: 120_000,
  }));
} catch (error) {
  console.error(
    'check-preflight-runs-what-ci-runs: `node scripts/preflight.mjs --print-plan` did not\n' +
      '  return a plan. If it timed out, this preflight does not support --print-plan and\n' +
      '  ran the whole suite instead.\n\n' +
      `  ${error}`,
  );
  process.exit(1);
}

/** What preflight would actually run, for the scripts it does run. */
const preflight = new Map();
for (const step of plan) {
  if (step.cmd !== 'node') continue;
  const [script, ...args] = step.args;
  if (!script?.startsWith('scripts/')) continue;
  if (!preflight.has(script)) preflight.set(script, args);
}

const mismatches = [];
let compared = 0;
for (const [script, args] of ci) {
  const mine = preflight.get(script);
  // Gates preflight deliberately skips (Docker, a live stack) are not run here
  // and have nothing to compare; the skip list is preflight's to own.
  if (mine === undefined) continue;
  compared += 1;
  if (mine.join(' ') !== args.join(' ')) {
    mismatches.push(
      `  ${script}\n      CI:        node ${script} ${args.join(' ') || '(no arguments)'}` +
        `\n      preflight: node ${script} ${mine.join(' ') || '(no arguments)'}`,
    );
  }
}

// A comparison over nothing passes for the same reason it always does.
if (compared === 0) {
  console.error(
    'check-preflight-runs-what-ci-runs: no gate appears in BOTH the workflow and ' +
      "preflight's plan, so nothing was compared.",
  );
  process.exit(1);
}

if (mismatches.length > 0) {
  console.error('preflight does not invoke these gates the way CI does:\n');
  console.error(mismatches.join('\n\n'));
  console.error(
    '\n  A dropped argument is invisible in preflight\'s output — the gate name comes\n' +
      '  from the filename, so the line reads the same either way. `--check` was the\n' +
      '  one that mattered: without it, build-gates-index writes docs/GATES.md.\n',
  );
  process.exit(1);
}

console.log(`preflight invokes all ${compared} shared gate(s) exactly as CI does.`);
