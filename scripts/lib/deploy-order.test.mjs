import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { deployScriptProblems, workflowProblems } from './deploy-order.mjs';
import { ROOT } from './remap-paths.mjs';

const workflow = () => load(readFileSync(join(ROOT, '.github/workflows/deploy.yml'), 'utf8'));
const script = () => readFileSync(join(ROOT, 'deploy/tenant-worker/deploy.sh'), 'utf8');

test('the deploy workflow and deploy.sh hold the order', () => {
  assert.deepEqual(workflowProblems(workflow()), []);
  assert.deepEqual(deployScriptProblems(script()), []);
});

test("a release that does not wait on the preflight is refused (the order of run 44968283960)", () => {
  const wf = workflow();
  wf.jobs.release.needs = ['plan'];
  wf.jobs.plan.needs = undefined;
  const problems = workflowProblems(wf);
  assert.ok(problems.some((p) => p.includes("'release' publishes the agent without waiting on 'site-preflight'")), problems.join('\n'));
  assert.ok(problems.some((p) => p.includes("'plan' creates the release tag without waiting")), problems.join('\n'));
});

test('a tag made by the REST call, not the script, is still recognised and refused', () => {
  const wf = workflow();
  wf.jobs.plan.needs = undefined;
  const step = wf.jobs.plan.steps.find((s) => typeof s.run === 'string' && s.run.includes('agent-release-tag.mjs'));
  step.run = 'gh api -X POST "repos/$GITHUB_REPOSITORY/git/refs" -f ref="refs/tags/$TAG" -f sha="$SHA"';
  assert.ok(workflowProblems(wf).some((p) => p.includes("'plan' creates the release tag without waiting")));
});

test('a workflow whose tag step no rule recognises is refused, not passed', () => {
  const wf = workflow();
  for (const s of wf.jobs.plan.steps) if (typeof s.run === 'string') s.run = s.run.replace('scripts/agent-release-tag.mjs', 'scripts/place-tag.mjs');
  assert.ok(workflowProblems(wf).some((p) => p.includes('no job creates the release tag')));
});

test('a deploy that runs after a failed preflight is refused', () => {
  const wf = workflow();
  wf.jobs.deploy.if = wf.jobs.deploy.if.replace("needs.site-preflight.result == 'success' && ", '');
  assert.ok(workflowProblems(wf).some((p) => p.includes("can deploy after 'site-preflight' failed")));
});

test('a preflight that is not the preflight mode, or is missing, is refused', () => {
  const wf = workflow();
  wf.jobs['site-preflight'].steps.find((s) => s.with?.mode).with.mode = 'deploy';
  assert.ok(workflowProblems(wf).some((p) => p.includes("no 'site-preflight' job")));
  const gone = workflow();
  delete gone.jobs['site-preflight'];
  assert.ok(workflowProblems(gone).length >= 2);
});

test("the head check and the after-deploy agreement check are still required", () => {
  const wf = workflow();
  for (const s of wf.jobs.plan.steps) if (typeof s.run === 'string') s.run = s.run.replace('git rev-parse origin/master', 'true');
  assert.ok(workflowProblems(wf).some((p) => p.includes("master's head")));
  const noVerify = workflow();
  delete noVerify.jobs.verify;
  assert.ok(workflowProblems(noVerify).some((p) => p.includes('the site and the download agree')));
});

test('a refusal moved after the preflight stop is refused', () => {
  const moved = script().replace(/^CLOUDFLARE_API_TOKEN="\$TOKEN" node "\$HERE\/check-do-bindings\.mjs".*\n/m, '');
  const text = moved.replace('say "D1: migrations, remote"', 'CLOUDFLARE_API_TOKEN="$TOKEN" node "$HERE/check-do-bindings.mjs" ./wrangler.toml\nsay "D1: migrations, remote"');
  assert.notEqual(text, script());
  assert.ok(deployScriptProblems(text).some((p) => p.includes('Durable Object bindings')));
});

test('a change to Cloudflare before the preflight stop is refused', () => {
  const text = script().replace('say "secrets: every required one is set"', 'wr d1 migrations apply citadel-control --remote\nsay "secrets: every required one is set"');
  assert.ok(deployScriptProblems(text).some((p) => p.includes('changes Cloudflare (the D1 migrations')));
  assert.deepEqual(deployScriptProblems('#!/bin/sh\nwr deploy\n'), ['deploy.sh has no --preflight stop (`if [ "$MODE" = preflight ]; then`)']);
});
