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
 * awaiting initialization?" is one line in the server log, and for forty-four
 * failing legs that line was never captured. A screenshot shows the symptom; the
 * log says why.
 *
 * ## Why this reads the file as text
 *
 * The first version parsed the workflow with `js-yaml`. The `crate-coverage` job
 * that runs this gate installs nothing — every script it runs is dependency-free
 * — so that turned the whole job red with `Cannot find module 'js-yaml'` and took
 * the other twenty-five gates down with it. A gate that cannot run is worth less
 * than no gate.
 *
 * A hand-written YAML parser was the next attempt and disagreed with `js-yaml`
 * on six of thirteen jobs, which is worse: a rule whose reader is subtly wrong
 * is a rule that is confidently wrong. This needs three positions per job and
 * nothing else, so it looks for those three and asserts it found a plausible
 * number of them.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = resolve(ROOT, '.github/workflows/validate.yml');

const STARTS_SERVICES = /docker compose (-f \S+ )?up\b/;
const RUNS_TESTS = /^\s*run:.*(npm run |npx playwright test|npm test)/;
const DUMPS_LOGS = /docker compose (-f \S+ )?logs/;

const lines = readFileSync(WORKFLOW, 'utf-8').split('\n');

/** Job blocks: a two-space key whose block contains `runs-on:`. */
const blocks = [];
let current = null;
lines.forEach((line, index) => {
  const indent = line.length - line.trimStart().length;
  if (indent === 2 && /^[A-Za-z0-9_-]+:\s*$/.test(line.trim())) {
    current = { name: line.trim().slice(0, -1), start: index, end: lines.length, isJob: false };
    blocks.push(current);
    if (blocks.length > 1) blocks[blocks.length - 2].end = index;
    return;
  }
  // `on:` puts push/pull_request/workflow_call at this same indent; only a block
  // with a runner is a job.
  if (current && /^\s{4}runs-on:/.test(line)) current.isJob = true;
});

const jobs = blocks.filter((block) => block.isJob);
if (jobs.length < 5) {
  console.error(`\n  Found only ${jobs.length} job(s) — the workflow changed shape, so this cannot be trusted.\n`);
  process.exit(1);
}

const problems = [];
let checked = 0;

for (const job of jobs) {
  const body = lines.slice(job.start, job.end);
  const at = (predicate) =>
    body.map((line, index) => (predicate(line) ? index : -1)).filter((index) => index >= 0);

  const starts = at((line) => STARTS_SERVICES.test(line));
  if (starts.length === 0) continue;
  checked += 1;

  const tests = at((line) => RUNS_TESTS.test(line));
  const dumps = at((line) => DUMPS_LOGS.test(line));
  const lastTest = tests.length > 0 ? tests[tests.length - 1] : -1;

  if (dumps.length === 0) {
    problems.push(`${job.name}: starts the stack and never dumps its logs`);
    continue;
  }
  if (!dumps.some((index) => index > lastTest)) {
    problems.push(
      `${job.name}: every log dump is above the last test step, so a failing test discards them`,
    );
  }
}

if (checked === 0) {
  console.error('\n  No job starts the stack — this check is measuring nothing.\n');
  process.exit(1);
}

if (problems.length > 0) {
  console.error('\n  Service logs are discarded on failure:\n');
  for (const problem of problems) console.error(`    ${problem}`);
  console.error('');
  process.exit(1);
}

console.log(`  ${checked} job(s) that start the stack capture its logs on failure  ok`);
