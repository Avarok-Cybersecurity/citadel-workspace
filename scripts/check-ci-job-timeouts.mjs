#!/usr/bin/env node
/**
 * Every CI job declares how long it may run.
 *
 * None of them did. GitHub's default is 360 minutes, so a job that hangs —
 * a Playwright spec waiting on a stack that never came up, a `docker compose
 * up --wait` against an image that will not start — holds a runner for six
 * hours and tells nobody anything for six hours.
 *
 * That is not hypothetical here. This pipeline's slowest job is 41 minutes and
 * a full run already takes hours to clear the queue, so a single hang pushes
 * every later run behind it. And the failure it hides is the expensive kind:
 * a hang produces no assertion, no diff, and no log line saying what it was
 * waiting for.
 *
 * The budgets are roughly twice the observed maximum for each job, recorded in
 * a comment beside each one. They are a bound on a hang, not a performance
 * target — a job that legitimately grows past its budget should have the
 * budget raised, deliberately, in a commit that says so.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Jobs and their declared budgets, read as text.
 *
 * The first version of this used `js-yaml`, and the job it runs in installs
 * nothing — so it died on `Cannot find module 'js-yaml'` and took the other
 * gates in that job with it. The workflow file already carries a comment about
 * exactly this, naming the same package: the explicit-types gate lives in the
 * LINT job "because the crate-coverage job installs nothing … which is the same
 * mistake check-service-logs-are-captured made with js-yaml". Third time.
 *
 * So no dependency. A GitHub workflow's shape is fixed enough for this: job
 * keys are the only two-space-indented keys under `jobs:`, and everything
 * belonging to a job is indented further. `jobsFound` is checked by the caller,
 * so a file that stops matching fails loudly instead of reporting agreement it
 * never established.
 */
function jobsWithBudgets(source) {
  const lines = source.split('\n');
  const jobs = new Map();
  let inJobs = false;
  let current = null;
  for (const line of lines) {
    if (/^jobs:\s*$/.test(line)) { inJobs = true; continue; }
    if (!inJobs) continue;
    // A top-level key ends the jobs block.
    if (/^\S/.test(line)) { inJobs = false; continue; }
    const jobKey = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (jobKey) { current = jobKey[1]; jobs.set(current, { budget: undefined, calls: false }); continue; }
    if (current === null) continue;
    const budget = line.match(/^ {4}timeout-minutes:\s*(\S+)\s*$/);
    if (budget) jobs.get(current).budget = Number(budget[1]);
    // Job-level `uses:` -- four spaces. A step's `uses:` is indented further
    // and under a `- `, so it cannot match here.
    if (/^ {4}uses:\s*\S/.test(line)) jobs.get(current).calls = true;
  }
  return jobs;
}

/** Nothing here should need six hours; a budget above this is a typo or a hang. */
const CEILING_MINUTES = 120;

const WORKFLOWS = [
  '.github/workflows/validate.yml',
  '.github/workflows/publish-images.yml',
  '.github/workflows/release-agent.yml',
  'citadel-workspaces/.github/workflows/validate.yml',
];

const problems = [];
let checked = 0;

for (const relPath of WORKFLOWS) {
  const path = join(ROOT, relPath);
  if (!existsSync(path)) {
    problems.push([relPath, 'listed here but not present; this check is out of date']);
    continue;
  }
  const jobs = jobsWithBudgets(readFileSync(path, 'utf8'));
  if (jobs.size === 0) {
    problems.push([relPath, 'no jobs found — the file moved or its shape changed, so nothing was checked']);
    continue;
  }
  for (const [name, { budget, calls }] of jobs) {
    checked += 1;
    if (calls) {
      // A job that calls a reusable workflow may not carry `timeout-minutes`:
      // it is not a permitted key there, and GitHub rejects the whole file at
      // run-creation time -- the run appears with ZERO jobs and a red X, which
      // reads like a broken build rather than a malformed workflow. That is
      // how `publish-images.yml` spent four days unable to publish anything.
      // The called workflow is itself in WORKFLOWS above, so its jobs' budgets
      // are checked directly; nothing goes unbounded by allowing this.
      if (budget !== undefined) {
        problems.push([`${relPath}:${name}`, 'calls a reusable workflow, so timeout-minutes is not a permitted key; GitHub fails the run at creation with zero jobs']);
      }
      continue;
    }
    if (budget === undefined) {
      problems.push([`${relPath}:${name}`, 'no timeout-minutes; a hang here holds a runner for six hours']);
    } else if (!Number.isFinite(budget) || budget <= 0 || budget > CEILING_MINUTES) {
      problems.push([`${relPath}:${name}`, `timeout-minutes is ${budget}; expected 1..${CEILING_MINUTES}`]);
    }
  }
}

if (problems.length > 0) {
  console.error('\n  CI jobs whose time budget is wrong:\n');
  for (const [where, why] of problems) console.error(`::error::${where} — ${why}`);
  console.error(
    '\n  For an ordinary job: add `timeout-minutes:`, at roughly twice its observed\n' +
    '  runtime, with a comment saying what that observation was. It bounds a hang;\n' +
    '  it is not a performance target.\n' +
    '\n  For a job that `uses:` a reusable workflow: REMOVE the key. GitHub does not\n' +
    '  permit it there and fails the whole run at creation. The called workflow\n' +
    '  bounds its own jobs.\n',
  );
  process.exit(1);
}

console.log(`  CI job timeouts: ${checked} job(s) across ${WORKFLOWS.length} workflow(s), all bounded  ok`);
