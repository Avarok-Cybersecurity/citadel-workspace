/**
 * May the parent skip re-running the agent's test suite for the agent commit it points at?
 *
 * Only on proof: the agent repository's own "Validate PR" ran green, every job, on a PUSH of a
 * commit whose tree is byte-for-byte the pinned commit's tree. A push run tests that commit
 * itself; a pull_request run tests a merge of it with the base, which is a different tree and
 * proves nothing about this one. Tree equality, not sha equality, because the parent usually
 * pins the agent PR's head while the push run is of master's merge commit -- and a merge whose
 * base had not moved has the same tree (eed0b99 and 88fcd598 share tree 1043cd28). The nested
 * intersession-layer-messaging pointer is a gitlink in that tree, so it is covered too.
 *
 * Pure. scripts/submodule-validation-gate.mjs gathers the facts; anything short of proof runs
 * the suite exactly as before.
 */
import { SHA, jobsDisqualifier } from './publish-validation-decision.mjs';

const WORKFLOW_PATH = '.github/workflows/validate.yml';
const WORKFLOW_NAME = 'Validate PR';
const BRANCH = 'master';
/** The agent's leg on the image the parent's job runs on; renamed, the gate fails closed. */
export const REQUIRED_JOB = 'tests (ubuntu-24.04)';

const run = (reason) => ({ validated: false, reason });

/** The token the lookup needs. Missing is a misconfigured job, not "no proof": it fails the step. */
export function requireToken(env) {
  const token = env.GH_TOKEN;
  if (!token) throw new Error('GH_TOKEN is not set; pass `GH_TOKEN: ${{ github.token }}` to this step');
  return token;
}

/** `owner/name` from a submodule URL on github.com, or a thrown error. */
export function repoSlug(url) {
  const m = /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url ?? '');
  if (!m) throw new Error(`submodule url '${url}' is not a github.com repository`);
  return m[1];
}

/** Push runs of the agent's Validate PR on master, green, in the agent repository itself. */
export function candidateRuns(runs, repo, treeOf, tree) {
  return runs
    .filter(
      (r) =>
        r.event === 'push' &&
        r.path === WORKFLOW_PATH &&
        r.name === WORKFLOW_NAME &&
        r.head_branch === BRANCH &&
        r.status === 'completed' &&
        r.conclusion === 'success' &&
        r.repository?.full_name === repo &&
        r.head_repository?.full_name === repo &&
        treeOf.get(r.head_sha) === tree,
    )
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

/**
 * facts: { sha, tree, repo, trees: Map(commit sha -> tree sha), runs, jobs: Map(run id -> jobs) }
 *   sha/tree: the pinned commit and its tree; repo: the agent's canonical full_name;
 *   trees: every head commit the gatherer resolved (the pinned one included).
 * @returns {{ validated: true, run: number, reason: string } | { validated: false, reason: string }}
 */
export function decide({ sha, tree, repo, trees, runs, jobs }) {
  if (!SHA.test(sha ?? '') || !SHA.test(tree ?? '')) return run(`commit ${sha} / tree ${tree} is not a full object name`);
  if (trees?.get(sha) !== tree) return run(`the pinned commit's tree was not resolved consistently`);
  const candidates = candidateRuns(runs ?? [], repo, trees, tree);
  if (candidates.length === 0) {
    return run(`no green push run of ${repo}'s ${WORKFLOW_NAME} on ${BRANCH} has tree ${tree} (pinned ${sha})`);
  }
  const rejected = [];
  for (const candidate of candidates) {
    const seen = jobs?.get(candidate.id);
    if (!seen) {
      rejected.push(`run ${candidate.id}: not examined`);
      continue;
    }
    const why = jobsDisqualifier(seen, REQUIRED_JOB);
    if (why === null) {
      const same = candidate.head_sha === sha ? 'that commit' : `${candidate.head_sha}, the same tree`;
      return {
        validated: true,
        run: candidate.id,
        reason: `${repo} run ${candidate.id} (push to ${BRANCH}) tested ${same}: ${seen.length} jobs, all succeeded`,
      };
    }
    rejected.push(`run ${candidate.id}: ${why}`);
  }
  return run(`no push run proves tree ${tree}: ${rejected.join('; ')}`);
}
