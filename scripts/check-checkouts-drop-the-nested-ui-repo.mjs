#!/usr/bin/env node
/**
 * Every checkout in validate.yml is followed at once by the no-nested-ui-repo action.
 *
 * A persistent runner kept the folded UI submodule's gitfile and module directory, and every
 * git-listing UI gate on it judged a dead snapshot and passed (see
 * check-ui-is-not-a-nested-repo.mjs). The cleanup only protects the jobs that run it, and a new
 * job copied from one that predates it would not, on exactly the runners where it matters. So a
 * checkout step must be followed by `uses: ./.github/actions/no-nested-ui-repo` as its next step.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = '.github/workflows/validate.yml';
const CLEANUP = './.github/actions/no-nested-ui-repo';

const lines = readFileSync(join(ROOT, WORKFLOW), 'utf8').split('\n');
const problems = [];
let checkouts = 0;
lines.forEach((line, index) => {
  const step = /^(\s*)- uses: actions\/checkout@/.exec(line);
  if (!step) return;
  checkouts += 1;
  const indent = step[1];
  const next = lines.slice(index + 1).find(
    (later) => later.trim() !== '' && (later.startsWith(`${indent}- `) || !later.startsWith(indent)),
  );
  if (next?.trim() !== `- uses: ${CLEANUP}`) {
    problems.push(`${WORKFLOW}:${index + 1}: the step after this checkout is '${next?.trim() ?? 'end of file'}'.`);
  }
});

if (checkouts === 0) {
  console.error(`FAIL: no actions/checkout step found in ${WORKFLOW}, so nothing was checked.`);
  process.exit(1);
}
if (problems.length > 0) {
  console.error(`FAIL: a checkout must be followed at once by 'uses: ${CLEANUP}'; a persistent runner`);
  console.error('      may otherwise hand the job a dead nested UI repository.');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`ok: all ${checkouts} checkouts in ${WORKFLOW} are followed by ${CLEANUP}.`);
