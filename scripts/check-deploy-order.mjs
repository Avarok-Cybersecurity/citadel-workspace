#!/usr/bin/env node
/**
 * The deploy workflow refuses a site deploy before it releases the agent, never after
 * (scripts/lib/deploy-order.mjs has the rules and their reason).
 *
 * Needs js-yaml, so it runs in a job that has run `npm ci`; without it this fails, never skips.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REFUSALS, deployScriptProblems, workflowProblems } from './lib/deploy-order.mjs';
import { ROOT } from './lib/remap-paths.mjs';

let load;
try {
  ({ load } = await import('js-yaml'));
} catch {
  console.error('check-deploy-order: js-yaml is not installed (run npm ci), so the workflow was not read.');
  process.exit(1);
}
const WORKFLOW = '.github/workflows/deploy.yml';
const SCRIPT = 'deploy/tenant-worker/deploy.sh';
const workflow = load(readFileSync(join(ROOT, WORKFLOW), 'utf8'));
const problems = [
  ...workflowProblems(workflow).map((p) => `${WORKFLOW}: ${p}`),
  ...deployScriptProblems(readFileSync(join(ROOT, SCRIPT), 'utf8')).map((p) => `${SCRIPT}: ${p}`),
];
if (problems.length) {
  console.error(`The site's checks no longer all run before the agent is released:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(
  `check-deploy-order: ${Object.keys(workflow.jobs).length} jobs and ${REFUSALS.length} refusal(s) in deploy.sh read; ` +
    `everything that can refuse the site's deploy runs before the agent is tagged or published.`,
);
