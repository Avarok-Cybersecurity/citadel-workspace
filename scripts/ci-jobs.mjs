/**
 * What a workflow run is ACTUALLY doing, read from its jobs.
 *
 * A run's own `status` stays `queued` until every job finishes. So a run whose
 * jobs have already completed — with failures — reads as "still waiting", and
 * `gh api "repos/<r>/actions/runs?status=in_progress" --jq .total_count`
 * returns 0 while dozens of jobs are executing.
 *
 * That is not hypothetical here. This repository's own record recommended that
 * exact call under the heading "are any jobs actually in progress", and it has
 * misled twice: once into concluding the org queue was wedged and cancelling
 * other runs to free slots, and once into reporting CI as starved for hours
 * while a run had been completing with real, readable failures the whole time.
 *
 * Usage:
 *   node scripts/ci-jobs.mjs <owner/repo> <branch|run-id>
 *
 * Prints one line per status, then every failed job by name — which is the
 * thing you actually wanted.
 */
import { execFileSync } from 'node:child_process';

const [repo, target] = process.argv.slice(2);

if (!repo || !target) {
  console.error('usage: node scripts/ci-jobs.mjs <owner/repo> <branch|run-id>');
  process.exit(2);
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** A run id, or the newest run on a branch. */
function resolveRunId() {
  if (/^\d+$/.test(target)) return target;
  const out = gh([
    'run', 'list', '-R', repo, '--branch', target,
    '--limit', '1', '--json', 'databaseId',
  ]);
  const runs = JSON.parse(out);
  if (runs.length === 0) {
    console.error(`No runs found on branch ${target} in ${repo}.`);
    process.exit(1);
  }
  return String(runs[0].databaseId);
}

const runId = resolveRunId();

// --paginate: a run here can have 75 jobs and the default page is 30, so
// without it the counts are quietly wrong in the reassuring direction.
const payload = JSON.parse(
  gh(['api', `/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`, '--paginate',
      '--slurp']),
);
const jobs = Array.isArray(payload) ? payload.flatMap((p) => p.jobs ?? []) : (payload.jobs ?? []);

if (jobs.length === 0) {
  console.error(`Run ${runId} reports no jobs. It may not have been scheduled yet.`);
  process.exit(1);
}

const byState = new Map();
for (const job of jobs) {
  const state = job.status === 'completed' ? job.conclusion : job.status;
  byState.set(state, (byState.get(state) ?? 0) + 1);
}

console.log(`run ${runId} — ${jobs.length} job(s)`);
for (const [state, n] of [...byState].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${state}`);
}

const failed = jobs.filter((j) => j.conclusion === 'failure');
if (failed.length > 0) {
  console.log('\nfailed:');
  for (const job of failed) {
    const step = (job.steps ?? []).find((s) => s.conclusion === 'failure');
    console.log(`  ${job.name}${step ? `  —  step: ${step.name}` : ''}`);
  }
}

const pending = jobs.filter((j) => j.status !== 'completed').length;
console.log(
  `\n${pending === 0 ? 'every job finished' : `${pending} job(s) still running or queued`}` +
    ` (the RUN reports "${pending === 0 ? 'completed' : 'queued'}" either way once any job is pending)`,
);
