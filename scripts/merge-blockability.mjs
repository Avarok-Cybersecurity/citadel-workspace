#!/usr/bin/env node
/**
 * Will a green pull request be able to merge? Reads each repository's LIVE branch rule and
 * CODEOWNERS and predicts what will hold the merge (lib/merge-blockers.mjs says which rules and
 * why): a required check no PR job produces, code-owner reviews an author cannot give, required
 * approvals, and .github/required-checks.json having drifted from the rule.
 *
 * For people and lanes BEFORE a PR is green, so a merge is not found blocked after an hour of
 * CI. Not wired into CI: reading branch protection needs a token with admin read on the repo.
 *
 *   node scripts/merge-blockability.mjs                       every repo in required-checks.json
 *   node scripts/merge-blockability.mjs Avarok-Cybersecurity/Citadel-Protocol   also another repo
 *
 * Auth: GH_TOKEN, or `gh auth login`. Exit 1 on any predicted blocker, 2 when a read fails.
 * Check names are computed from the LOCAL checkout's workflows (the submodule at its pointer).
 */
import { execFileSync } from 'node:child_process';
import { loadConfig, repoWorkflows } from './lib/workflow-files.mjs';
import { mergeBlockers } from './lib/merge-blockers.mjs';
import { producedOnPullRequests } from './lib/workflow-graph.mjs';

const BRANCH = 'master';
const CODEOWNERS_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The API's JSON, or null on a 404 (and only a 404). */
function api(path, { raw = false } = {}) {
  try {
    const headers = raw ? ['-H', 'Accept: application/vnd.github.raw'] : [];
    const out = gh(['api', ...headers, path]);
    return raw ? out : JSON.parse(out);
  } catch (error) {
    if (/HTTP 404/.test(String(error.stderr))) return null;
    throw new Error(`gh api ${path}: ${String(error.stderr || error.message).split('\n')[0]}`);
  }
}

function codeowners(repo) {
  for (const path of CODEOWNERS_PATHS) {
    const text = api(`repos/${repo}/contents/${path}?ref=${BRANCH}`, { raw: true });
    if (text !== null) return { path, text };
  }
  return { path: null, text: null };
}

const { need } = loadConfig();
const required = need('required');
const dirs = need('workflow_dirs');
const external = need('external');
const repos = [...new Set([...Object.keys(required), ...process.argv.slice(2)])];

let blocked = 0;
try {
  for (const repo of repos) {
    const protection = api(`repos/${repo}/branches/${BRANCH}/protection`);
    if (protection === null) {
      console.log(`\n${repo}: ${BRANCH} has no branch protection (or this token cannot read it); nothing predicts a block`);
      continue;
    }
    const owners = codeowners(repo);
    const listed = required[repo] !== undefined;
    const produced = listed
      ? (() => {
          const { workflows, readCallee } = repoWorkflows(dirs[repo]);
          return producedOnPullRequests(workflows, readCallee).produced;
        })()
      : null;
    const d = mergeBlockers({ protection, codeowners: owners.text, declared: listed ? required[repo] : null, produced, external });
    const reviews = protection.required_pull_request_reviews;
    console.log(`\n${repo} (${BRANCH})`);
    console.log(`  required checks (${d.live.length}): ${d.live.join(', ') || 'none'}`);
    if (produced) console.log(`  produced by pull_request jobs here: ${produced.size}`);
    console.log(`  strict up to date: ${Boolean(protection.required_status_checks?.strict)}`);
    console.log(`  code owner reviews: ${Boolean(reviews?.require_code_owner_reviews)}; CODEOWNERS: ${owners.path ?? 'none'}`);
    console.log(`  approving reviews required: ${reviews?.required_approving_review_count ?? 0}`);
    for (const w of d.warnings) console.log(`  warning: ${w}`);
    for (const b of d.blockers) console.log(`  BLOCKER: ${b}`);
    if (d.blockers.length === 0) console.log('  no predicted blocker');
    blocked += d.blockers.length;
  }
} catch (error) {
  console.error(`merge-blockability: ${error.message}`);
  process.exit(2);
}
console.log(`\n${repos.length} repositories, ${blocked} predicted blocker(s)`);
process.exit(blocked > 0 ? 1 : 0);
