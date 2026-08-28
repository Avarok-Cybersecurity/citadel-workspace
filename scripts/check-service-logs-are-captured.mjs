/**
 * A job that starts the stack must dump its logs when a test fails.
 *
 * `if: failure()` on a step reads as "run this if anything failed" and does not
 * mean that: steps run in order, so a dump placed BEFORE the test has already
 * been skipped by the time the test fails. Both test jobs had exactly one dump
 * step and it sat before the test, so every failing leg uploaded screenshots and
 * threw the backend logs away.
 *
 * That is not a small loss. The failures those legs produce are backend
 * questions — "was the first account promoted to Admin, or is the workspace
 * awaiting initialization?" is one line in the server log, and for twenty-four
 * failing legs that line was never captured. A screenshot shows the symptom; the
 * log says why.
 *
 * So: every job that runs `docker compose up` must also have a failure-dump step
 * positioned after its last test step.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = resolve(ROOT, '.github/workflows/validate.yml');

const text = (step) => `${step.name ?? ''}\n${step.run ?? ''}`;
const startsServices = (step) => /docker compose (-f \S+ )?up\b/.test(step.run ?? '');
const runsTests = (step) => /\bnpm run |npx playwright test|node .*\.mjs/.test(step.run ?? '');
const dumpsLogs = (step) =>
  step.if?.includes('failure()') && /docker compose (-f \S+ )?logs/.test(step.run ?? '');

const workflow = yaml.load(readFileSync(WORKFLOW, 'utf-8'));
const problems = [];
let checked = 0;

for (const [name, job] of Object.entries(workflow.jobs ?? {})) {
  const steps = job.steps ?? [];
  if (!steps.some(startsServices)) continue;
  checked += 1;

  const lastTest = steps.findLastIndex(runsTests);
  const dumps = steps.map((s, i) => (dumpsLogs(s) ? i : -1)).filter((i) => i >= 0);
  if (dumps.length === 0) {
    problems.push(`${name}: starts the stack and never dumps its logs`);
    continue;
  }
  if (!dumps.some((i) => i > lastTest)) {
    problems.push(
      `${name}: every log dump (step ${dumps.join(', ')}) runs BEFORE the last test ` +
        `(step ${lastTest}), so a failing test discards them`,
    );
  }
}

if (checked === 0) {
  console.error('\n  No job starts the stack — this check is measuring nothing.\n');
  process.exit(1);
}

if (problems.length > 0) {
  console.error(`\n  Service logs are discarded on failure:\n`);
  for (const problem of problems) console.error(`    ${problem}`);
  console.error('');
  process.exit(1);
}

console.log(`  ${checked} job(s) that start the stack capture its logs on failure  ok`);
