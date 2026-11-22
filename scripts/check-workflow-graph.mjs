#!/usr/bin/env node
/**
 * The workflow graph holds together: required checks exist, release steps have PR twins, and
 * no workflow dispatches another blind. The rules, and the failure behind each, are in
 * lib/workflow-graph.mjs; the data they judge against is .github/required-checks.json.
 *
 *   node scripts/check-workflow-graph.mjs
 *
 * Reads the parent's workflows and the agent submodule's (CI checks out recursively); a
 * missing directory is a failure, never a pass. The live branch rule is not read here (that
 * needs an admin-read token): scripts/merge-blockability.mjs compares the JSON with it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG, ROOT, loadConfig, repoWorkflows } from './lib/workflow-files.mjs';
import {
  localActions, producedOnPullRequests, rawDispatches, releaseOnlyGaps, releaseTargets, unproducedRequired,
} from './lib/workflow-graph.mjs';

const { need } = loadConfig();
const dirs = need('workflow_dirs');
const required = need('required');
const external = need('external');

const problems = [];
let workflowCount = 0;
let requiredCount = 0;
for (const [repo, names] of Object.entries(required)) {
  const dir = dirs[repo];
  if (!dir) {
    problems.push(`${repo}: ${CONFIG} names no workflow directory for it`);
    continue;
  }
  const { workflows, readCallee } = repoWorkflows(dir);
  workflowCount += workflows.length;
  requiredCount += names.length;
  const { produced, examined } = producedOnPullRequests(workflows, readCallee);
  if (examined === 0) problems.push(`${repo}: no workflow in ${dir} runs on pull_request, so no required check can report`);
  for (const { name, near } of unproducedRequired(names, produced, external)) {
    const hint = near.length ? ` (produced: ${near.join(', ')})` : '';
    problems.push(`${repo}: required check "${name}" is produced by no pull_request job${hint}`);
  }
  for (const { path, text } of workflows) {
    for (const { line, text: step } of rawDispatches(text)) {
      problems.push(`${path}:${line}: dispatches a workflow directly (${step}); use scripts/dispatch-workflow.mjs`);
    }
  }
}

const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const releaseFiles = need('release_workflows');
const releaseActions = new Set(releaseFiles.flatMap((f) => [...localActions(read(f))]));
const targets = releaseTargets(read('.github/workflows/release-agent.yml'));
problems.push(...releaseOnlyGaps({
  releaseActions,
  targets,
  validateText: read('.github/workflows/validate.yml'),
  twins: need('release_twins'),
  allowed: need('release_only_allowed'),
}));

if (problems.length > 0) {
  console.error('\n  The workflow graph has a hole:\n');
  for (const p of problems) console.error(`::error::${p}`);
  console.error(`\n  ${CONFIG} holds the required names, the release twins and the allowlist.\n`);
  process.exit(1);
}
console.log(
  `  Workflow graph: ${requiredCount} required checks produced across ${workflowCount} workflows, ` +
    `${releaseActions.size} release actions and ${targets.length} targets exercised or allowlisted, no raw dispatch  ok`,
);
