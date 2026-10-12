#!/usr/bin/env node
/**
 * Publish Images' validation gate: re-run the ~80-job suite, or reuse the merged PR's run?
 *
 * Gathers the facts from the GitHub API and hands them to lib/publish-validation-decision.mjs,
 * which decides. It FAILS CLOSED: any lookup that errors, times out or returns something
 * unexpected means `validated=false`, and the full validation runs exactly as it always did.
 * It never fails the job for that reason -- a broken lookup must cost minutes, not a release.
 *
 * Writes `validated=true|false` to $GITHUB_OUTPUT and the reason to the job summary.
 * Usage (in the workflow): node scripts/publish-validation-gate.mjs
 * Env: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_REF, GITHUB_EVENT_NAME, GITHUB_OUTPUT.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide } from './lib/publish-validation-decision.mjs';

/** Runs examined per PR head; a head is rarely validated more than a couple of times. */
const MAX_RUNS_EXAMINED = 5;

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
}
const api = (path) => JSON.parse(gh(['api', '-H', 'Accept: application/vnd.github+json', path]));

function record(repo, runId) {
  const dir = mkdtempSync(join(tmpdir(), 'validated-tree-'));
  try {
    gh(['run', 'download', String(runId), '-R', repo, '-n', 'validated-tree', '-D', dir]);
    return JSON.parse(readFileSync(join(dir, 'validated-tree.json'), 'utf8'));
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function gather() {
  const repo = env('GITHUB_REPOSITORY');
  const sha = env('GITHUB_SHA');
  const facts = { event: env('GITHUB_EVENT_NAME'), ref: env('GITHUB_REF'), sha, repo };
  if (facts.event !== 'push') return facts;
  facts.masterTree = api(`repos/${repo}/git/commits/${sha}`).tree?.sha;
  facts.pulls = api(`repos/${repo}/commits/${sha}/pulls`);
  const pull = facts.pulls.find((p) => p.merge_commit_sha === sha);
  if (!pull) return facts;
  facts.runs = api(
    `repos/${repo}/actions/workflows/validate.yml/runs?event=pull_request&head_sha=${pull.head.sha}&per_page=20`,
  ).workflow_runs;
  facts.evidence = new Map();
  const examined = facts.runs
    .filter((r) => r.conclusion === 'success')
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, MAX_RUNS_EXAMINED);
  for (const r of examined) {
    const jobs = [];
    for (let page = 1; ; page += 1) {
      const batch = api(`repos/${repo}/actions/runs/${r.id}/jobs?filter=latest&per_page=100&page=${page}`).jobs;
      jobs.push(...batch);
      if (batch.length < 100) break;
    }
    facts.evidence.set(r.id, { record: record(repo, r.id), jobs });
  }
  return facts;
}

let decision;
try {
  decision = decide(gather());
} catch (error) {
  decision = { validated: false, reason: `the lookup failed (${error.message.split('\n')[0]}); validating` };
}

const verdict = decision.validated ? 'SKIP re-validation' : 'RUN full validation';
console.log(`${verdict}: ${decision.reason}`);
appendFileSync(env('GITHUB_OUTPUT'), `validated=${decision.validated}\n`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Validation gate: ${verdict}\n\n${decision.reason}\n`);
}
