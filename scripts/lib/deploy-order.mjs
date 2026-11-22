/**
 * The deploy workflow's order, as rules over its parsed job graph and deploy.sh's text.
 *
 * The agent's release cannot be taken back, so everything that can refuse the site's deploy runs
 * first: deploy.sh --preflight in the `site-preflight` job, which the tag and the release both
 * wait on. Run 44968283960 had it the other way: agent 0.14.2 was published, then Cloudflare
 * refused the site (code 10061) and the new agent stood beside the old site. Pure: the caller
 * reads the files (scripts/check-deploy-order.mjs).
 */
export const PREFLIGHT_JOB = 'site-preflight';
const DEPLOY_ACTION = './.github/actions/tenant-worker-deploy';

/** Checks that can refuse a deploy, each of which must run before --preflight stops. */
export const REFUSALS = [
  ['the Stripe catalogue audit', /stripe-catalogue\.mjs/],
  ['the secrets check', /wrangler secret list/],
  ["the live Worker's Durable Object bindings", /check-do-bindings\.mjs/],
  ["wrangler's dry run", /\bwr deploy --dry-run\b/],
  ['the D1 migration plan', /\bd1 migrations list\b.*--remote/],
];
/** Commands that change Cloudflare, none of which may run before --preflight stops. */
export const CHANGES = [
  ['the D1 migrations', /\bd1 migrations apply\b/],
  ['the upload', /^\s*wr deploy(?!.*--dry-run)/],
  ['a secret write', /^\s*(wr|npx --no-install wrangler) secret (put|bulk|delete)\b/],
];

function closure(jobs, name, seen = new Set()) {
  const needs = jobs[name]?.needs;
  for (const n of needs === undefined ? [] : [needs].flat()) {
    // A need naming no job is no wait at all (GitHub refuses the workflow; this must not pass it).
    if (!seen.has(n) && jobs[n]) {
      seen.add(n);
      closure(jobs, n, seen);
    }
  }
  return seen;
}

const steps = (job) => job.steps ?? [];
const deployMode = (job) => steps(job).find((s) => s.uses === DEPLOY_ACTION)?.with?.mode;
const publishes = (job) => typeof job.uses === 'string' && job.uses.includes('release-agent.yml');
const tags = (job) => steps(job).some((s) => typeof s.run === 'string' && /git\/refs\b/.test(s.run));

/** Problems with the workflow's job graph; none means the order holds. */
export function workflowProblems(workflow) {
  const jobs = workflow?.jobs ?? {};
  const problems = [];
  if (deployMode(jobs[PREFLIGHT_JOB] ?? {}) !== 'preflight') {
    problems.push(`no '${PREFLIGHT_JOB}' job runs ${DEPLOY_ACTION} with mode: preflight`);
  }
  const releases = Object.keys(jobs).filter((n) => publishes(jobs[n]));
  if (releases.length === 0) problems.push('no job publishes the agent (release-agent.yml); the rules below would check nothing');
  for (const name of Object.keys(jobs)) {
    const job = jobs[name];
    const upstream = closure(jobs, name);
    if ((publishes(job) || tags(job)) && !upstream.has(PREFLIGHT_JOB)) {
      problems.push(`'${name}' ${publishes(job) ? 'publishes the agent' : 'creates the release tag'} without waiting on '${PREFLIGHT_JOB}'`);
    }
    if (deployMode(job) !== 'deploy') continue;
    for (const required of [PREFLIGHT_JOB, 'plan', ...releases]) {
      if (!upstream.has(required)) problems.push(`'${name}' deploys the site without waiting on '${required}'`);
    }
    const condition = String(job.if ?? '');
    for (const required of [PREFLIGHT_JOB, 'plan']) {
      if (!condition.includes(`needs.${required}.result == 'success'`)) {
        problems.push(`'${name}' can deploy after '${required}' failed: its if does not require needs.${required}.result == 'success'`);
      }
    }
  }
  const plan = jobs.plan;
  if (!plan || !steps(plan).some((s) => typeof s.run === 'string' && s.run.includes('git rev-parse origin/master'))) {
    problems.push("'plan' no longer checks that the commit is master's head");
  }
  const verify = Object.keys(jobs).find((n) => steps(jobs[n]).some((s) => typeof s.run === 'string' && s.run.includes('version.json')));
  if (!verify || !Object.keys(jobs).some((n) => deployMode(jobs[n]) === 'deploy' && closure(jobs, verify).has(n))) {
    problems.push('no job checks, after the deploy, that the site and the download agree');
  }
  return problems;
}

/** Problems with deploy.sh's order around its --preflight stop. */
export function deployScriptProblems(text) {
  const lines = text.split('\n').map((l) => (/^\s*#/.test(l) ? '' : l));
  const stop = lines.findIndex((l) => /^if \[ "\$MODE" = preflight \]; then$/.test(l));
  if (stop < 0) return ['deploy.sh has no --preflight stop (`if [ "$MODE" = preflight ]; then`)'];
  const problems = [];
  const before = lines.slice(0, stop);
  for (const [what, pattern] of REFUSALS) {
    if (!before.some((l) => pattern.test(l))) problems.push(`deploy.sh runs ${what} after its --preflight stop, or not at all`);
  }
  for (const [what, pattern] of CHANGES) {
    const at = before.findIndex((l) => pattern.test(l));
    if (at >= 0) problems.push(`deploy.sh changes Cloudflare (${what}, line ${at + 1}) before its --preflight stop`);
  }
  if (!lines.slice(stop).some((l) => CHANGES[1][1].test(l))) problems.push('deploy.sh never uploads the Worker after its --preflight stop');
  return problems;
}
