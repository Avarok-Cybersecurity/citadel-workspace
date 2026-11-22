#!/usr/bin/env node
/**
 * The agent's test suite: run it here, or reuse the agent repository's own green run?
 *
 * "Rust Tests - citadel-internal-service workspace" re-ran the agent's whole suite, 35-45 min of
 * a hosted runner, on commits the agent's "Validate PR" had already passed on a push to its
 * master (run 45018083721 on 88fcd598, for one). This gathers the facts from the GitHub API and
 * lib/submodule-validation-decision.mjs decides.
 *
 * A missing GH_TOKEN or GITHUB_OUTPUT fails the step: that is a misconfigured job. Any lookup that
 * errors or answers unexpectedly is `validated=false`, and the suite runs exactly as before --
 * a broken lookup costs the minutes it was meant to save, never a test.
 *
 * Writes `validated=true|false` (and `run=<id>` on proof) to $GITHUB_OUTPUT.
 * Usage (in the workflow): node scripts/submodule-validation-gate.mjs
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { candidateRuns, decide, repoSlug, requireToken } from './lib/submodule-validation-decision.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SUBMODULE = 'citadel-internal-service';
/** Master commits searched for the pinned tree, runs examined per tree: both small and bounded. */
const COMMITS_SEARCHED = 30;
const RUNS_EXAMINED = 5;

let output;
try {
  requireToken(process.env);
  output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error('GITHUB_OUTPUT is not set; this gate writes its verdict there');
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exit(1);
}

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const api = (path) =>
  JSON.parse(execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github+json', path], { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] }));
const pushRuns = (slug, sha) => api(`repos/${slug}/actions/runs?head_sha=${sha}&event=push&per_page=20`).workflow_runs;

function gather() {
  const slug = repoSlug(git('config', '-f', '.gitmodules', '--get', `submodule.${SUBMODULE}.url`));
  const sha = git('rev-parse', `HEAD:${SUBMODULE}`);
  const repo = api(`repos/${slug}`).full_name;
  const tree = api(`repos/${slug}/git/commits/${sha}`).tree?.sha;
  const trees = new Map([[sha, tree]]);
  const runs = pushRuns(slug, sha);
  if (candidateRuns(runs, repo, trees, tree).length === 0) {
    for (const c of api(`repos/${slug}/commits?sha=master&per_page=${COMMITS_SEARCHED}`)) {
      trees.set(c.sha, c.commit?.tree?.sha);
      if (c.sha !== sha && c.commit?.tree?.sha === tree) runs.push(...pushRuns(slug, c.sha));
    }
  }
  const jobs = new Map();
  for (const r of candidateRuns(runs, repo, trees, tree).slice(0, RUNS_EXAMINED)) {
    const all = [];
    for (let page = 1; ; page += 1) {
      const batch = api(`repos/${slug}/actions/runs/${r.id}/jobs?filter=latest&per_page=100&page=${page}`).jobs;
      all.push(...batch);
      if (batch.length < 100) break;
    }
    jobs.set(r.id, all);
  }
  return { facts: { sha, tree, repo, trees, runs, jobs }, repo };
}

let decision;
let repo = null;
try {
  const gathered = gather();
  repo = gathered.repo;
  decision = decide(gathered.facts);
} catch (error) {
  decision = { validated: false, reason: `the lookup failed (${error.message.split('\n')[0]}); running the suite` };
}

const verdict = decision.validated ? 'SKIP the agent test suite' : 'RUN the agent test suite';
console.log(`${verdict}: ${decision.reason}`);
if (decision.validated) console.log(`::notice title=Agent suite proven elsewhere::https://github.com/${repo}/actions/runs/${decision.run}`);
appendFileSync(output, `validated=${decision.validated}\n${decision.validated ? `run=${decision.run}\n` : ''}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Agent test suite: ${verdict}\n\n${decision.reason}\n`);
}
