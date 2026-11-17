#!/usr/bin/env node
/**
 * A job that starts the stack and then runs tests must dump the backend logs
 * when a TEST fails, not only when the stack fails to start.
 *
 * Both workflows had a step called `Dump Service Logs on Start Failure`, placed
 * immediately after `Start Services` and guarded with `if: failure()`. That
 * guard reads as "on any earlier failure", and it is — but steps run in ORDER.
 * By the time the test step fails, this one has already been reached and
 * skipped. It can only ever fire for a stack that did not come up.
 *
 * So six P2P specs failed in run 34050229807 — registration and handshake, both
 * call specs, screen share, member-list, and three reconnection legs — across
 * all three Playwright shards, and every one of those jobs finished with no
 * backend log whatsoever. The single line that separates "the request never
 * reached the agent" from "it reached the agent and was not answered" was not
 * in the artefact, and a wave was spent on a hypothesis that a log line would
 * have settled in seconds.
 *
 * The parent workflow already had the after-the-test step. This repository's
 * did not, which is the shape this codebase produces most: one correct fix, in
 * one of the two places its mechanism appears.
 *
 * The rule is positional, because the defect is positional: within a job that
 * brings the stack up, at least one `docker compose logs` step guarded by
 * `if: failure()` must appear AFTER the last step that runs tests. A step
 * before it does not count, however it is named.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Both workflows, so the parent cannot regress while this one is fixed. */
const WORKFLOWS = [
  join(UI, '.github/workflows/validate.yml'),
  join(UI, '..', '.github/workflows/validate.yml'),
];

/** A step that brings the stack up. */
const STARTS_STACK = /docker\s+compose\s+up\b/;
/** A step that runs tests against it. */
const RUNS_TESTS = /npm\s+run\s+(test:|\$\{\{\s*matrix\.test)|npx\s+playwright\s+test\b/;
/** A step that dumps backend logs. */
const DUMPS_LOGS = /docker\s+compose\s+logs\b/;

/** Split a workflow into jobs, and each job into steps, by indentation. */
function jobsOf(text) {
  const lines = text.split('\n');
  const jobStarts = [];
  lines.forEach((line, i) => {
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(line)) jobStarts.push(i);
  });
  return jobStarts.map((start, n) => {
    const end = n + 1 < jobStarts.length ? jobStarts[n + 1] : lines.length;
    const name = lines[start].trim().replace(/:$/, '');
    // Step boundaries inside the job.
    const stepStarts = [];
    for (let i = start; i < end; i += 1) {
      if (/^\s{6}- name: /.test(lines[i])) stepStarts.push(i);
    }
    const steps = stepStarts.map((s, k) => {
      const e = k + 1 < stepStarts.length ? stepStarts[k + 1] : end;
      return { at: s + 1, body: lines.slice(s, e).join('\n') };
    });
    return { name, steps };
  });
}

const offenders = [];
let jobsChecked = 0;
let workflowsRead = 0;

for (const path of WORKFLOWS) {
  if (!existsSync(path)) {
    console.error(
      `FAIL: ${path} is missing.\n` +
        'Run from the parent checkout so both workflows are present; a gate that\n' +
        'silently examines one of the two files is how this defect survived.',
    );
    process.exit(1);
  }
  workflowsRead += 1;
  const label = relative(join(UI, '..'), path);

  for (const job of jobsOf(readFileSync(path, 'utf8'))) {
    if (!job.steps.some((s) => STARTS_STACK.test(s.body))) continue;
    const lastTest = job.steps.filter((s) => RUNS_TESTS.test(s.body)).pop();
    if (!lastTest) continue; // brings the stack up but runs no tests
    jobsChecked += 1;

    const dumpsAfter = job.steps.some(
      (s) => s.at > lastTest.at && DUMPS_LOGS.test(s.body) && /if:\s*failure\(\)/.test(s.body),
    );
    if (!dumpsAfter) {
      offenders.push(
        `${label}: job \`${job.name}\` runs tests at line ${lastTest.at} and never dumps ` +
          'backend logs after them — a failing TEST leaves no backend log at all',
      );
    }
  }
}

// Vacuity floor: both workflows have such jobs. Zero means the step vocabulary
// changed and the walk went past all of them.
if (workflowsRead < 2 || jobsChecked < 3) {
  console.error(
    `FAIL: read ${workflowsRead} workflow(s) and found ${jobsChecked} job(s) that start the\n` +
      'stack and run tests; there are more than that. The step shapes changed — fix the\n' +
      'match rather than leaving this reporting over nothing.',
  );
  process.exit(1);
}

if (offenders.length > 0) {
  for (const o of offenders) console.error(`::error::${o}`);
  console.error(`\nFAIL: ${offenders.length} job(s) capture no backend log when a test fails.\n`);
  for (const o of offenders) console.error(`  ${o}`);
  console.error(
    '\n`if: failure()` does not mean "at the end". Steps run in order, so a dump placed\n' +
      'after `Start Services` can only ever fire for a stack that did not come up — by the\n' +
      'time a TEST fails, that step has already been skipped.\n' +
      '\nAdd a second `Dump Service Logs on Test Failure` step AFTER the test step. Six P2P\n' +
      'specs failed across three shards with no backend log at all, and the line that\n' +
      'separates "never arrived" from "arrived and was not answered" was not in any artefact.',
  );
  process.exit(1);
}

console.log(
  `check-test-failures-capture-backend-logs: ${jobsChecked} job(s) across ${workflowsRead} ` +
    'workflow(s) start the stack and run tests; all dump backend logs after the test step.',
);
