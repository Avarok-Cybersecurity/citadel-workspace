/**
 * May Publish Images skip re-running the validation suite for this master commit?
 *
 * Only when that is provably redundant: master's tree is byte-for-byte a tree that already
 * passed the WHOLE suite as the merged pull request's `refs/pull/N/merge`. Anything short of
 * proof -- a direct push, a fork, master having moved between the PR's run and the merge (the
 * branch rule is not "strict"), a run with any job not green, a missing record -- runs the
 * full validation, exactly as before. Pure: the facts are gathered by
 * scripts/publish-validation-gate.mjs, so every rule here is tested without the network.
 *
 * Why a run's own record of its tree can be trusted: it is read only from a `pull_request`
 * run whose head is the merged PR's final head, in this repository. Such a run executes the
 * workflow from that head merged with a master commit -- both already in master's history --
 * so the code that wrote the record is code master accepted. A record from any other run is
 * never consulted.
 */

const VALIDATE_PATH = '.github/workflows/validate.yml';
const AGGREGATE_JOB = 'Validation passed';
const SHA = /^[0-9a-f]{40}$/;

const run = (reason) => ({ validated: false, reason });

/** The one merged PR whose merge commit IS this commit, or a reason there is none. */
export function mergedPullFor(pulls, sha) {
  const merged = pulls.filter(
    (p) => p.merged_at && p.merge_commit_sha === sha && p.base?.ref === 'master',
  );
  if (merged.length !== 1) {
    return { reason: `${merged.length} merged pull requests have ${sha} as their merge commit; expected exactly 1` };
  }
  return { pull: merged[0] };
}

/** Successful validate.yml runs of the PR's final head, newest first. */
export function candidateRuns(runs, pull, repo) {
  return runs
    .filter(
      (r) =>
        r.event === 'pull_request' &&
        r.path === VALIDATE_PATH &&
        r.head_sha === pull.head.sha &&
        r.status === 'completed' &&
        r.conclusion === 'success' &&
        r.repository?.full_name === repo &&
        r.head_repository?.full_name === repo,
    )
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

/** Why this run does not prove master's tree, or null when it does. */
export function runDisqualifier(candidate, record, jobs, masterTree) {
  if (!record) return 'it recorded no validated tree';
  if (String(record.run_id) !== String(candidate.id)) return `its record names run ${record.run_id}`;
  if (record.event !== 'pull_request') return `its record is from a ${record.event} event`;
  if (record.tree !== masterTree) return `it validated tree ${record.tree}, master's is ${masterTree}`;
  if (!Array.isArray(jobs) || jobs.length === 0) return 'it lists no jobs';
  const notGreen = jobs.filter((j) => j.conclusion !== 'success');
  if (notGreen.length > 0) {
    return `not every job succeeded: ${notGreen.map((j) => `${j.name}=${j.conclusion}`).join(', ')}`;
  }
  if (!jobs.some((j) => j.name === AGGREGATE_JOB)) return `it has no "${AGGREGATE_JOB}" job`;
  return null;
}

/**
 * facts: { event, ref, sha, repo, masterTree, pulls, runs, evidence }
 * evidence: Map(run id -> { record, jobs }) for the candidate runs the gatherer examined.
 */
export function decide(facts) {
  const { event, ref, sha, repo, masterTree } = facts;
  if (event !== 'push' || ref !== 'refs/heads/master') {
    return run(`this is a ${event} on ${ref}, not a push to master; only a merge can reuse a PR's validation`);
  }
  if (!SHA.test(sha ?? '') || !SHA.test(masterTree ?? '')) {
    return run(`commit ${sha} / tree ${masterTree} is not a full object name`);
  }
  const { pull, reason } = mergedPullFor(facts.pulls ?? [], sha);
  if (!pull) return run(reason);
  if (pull.head?.repo?.full_name !== repo) {
    return run(`PR #${pull.number} came from ${pull.head?.repo?.full_name ?? 'a deleted fork'}, not ${repo}`);
  }
  const candidates = candidateRuns(facts.runs ?? [], pull, repo);
  if (candidates.length === 0) {
    return run(`PR #${pull.number} has no successful ${VALIDATE_PATH} run for its final head ${pull.head.sha}`);
  }
  const rejected = [];
  for (const candidate of candidates) {
    const seen = facts.evidence?.get(candidate.id);
    if (!seen) {
      rejected.push(`run ${candidate.id}: not examined`);
      continue;
    }
    const why = runDisqualifier(candidate, seen.record, seen.jobs, masterTree);
    if (why === null) {
      return {
        validated: true,
        reason:
          `master's tree ${masterTree} is the tree PR #${pull.number}'s run ${candidate.id} validated ` +
          `(${seen.jobs.length} jobs, all succeeded)`,
        run: candidate.id,
        pull: pull.number,
      };
    }
    rejected.push(`run ${candidate.id}: ${why}`);
  }
  return run(`no run of PR #${pull.number} proves master's tree: ${rejected.join('; ')}`);
}
