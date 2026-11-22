/**
 * No workflow or action can ask Let's Encrypt for the agent's certificate unconditionally.
 * Pure: scripts/check-agent-certificate-is-verified.mjs passes the workflow and action texts in.
 *
 * Why: the agent-certificate action ran certbot on `inputs.issue == 'true'` -- every real
 * release -- and in one week eight deploy runs and one renewal spent Let's Encrypt's five
 * certificates for local.avarok.net, so deploy run 45073729582 was refused and nothing shipped.
 * The decision now lives in scripts/agent-certificate-decision.mjs (lib/certificate-issuance.mjs),
 * and this keeps every issuer behind it:
 *
 *   1. every step that runs `certbot certonly` has exactly
 *        if: steps.<id>.outputs.action == 'issue'   (or 'renew')
 *      and the step `<id>` in the same job or action runs agent-certificate-decision.mjs;
 *   2. every use of the agent-certificate action passes `real-release` and a `margin-days`
 *      taken from a workflow env literal (no default anywhere);
 *   3. a workflow that renews sets RENEW_BELOW_DAYS above the publish floor + margin, so the
 *      committed certificate -- not a release-time issuance -- is the normal case.
 */
import { readJobs, workflowEnv } from './workflow-steps.mjs';

const DECISION = 'scripts/agent-certificate-decision.mjs';
const CERT_ACTION = './.github/actions/agent-certificate';
const CERTBOT = /^\s*certbot\s+certonly\b/m;
const GATE = /^steps\.([A-Za-z0-9_-]+)\.outputs\.action == '(issue|renew)'$/;
const ENV_REF = /^\$\{\{\s*env\.([A-Z0-9_]+)\s*\}\}$/;

/** An action's composite steps, read with the workflow reader (they sit two spaces shallower). */
export function actionAsJob(text) {
  const lines = text.split('\n');
  const at = lines.findIndex((line) => /^ {2}steps:\s*$/.test(line));
  if (at < 0) return [];
  const body = lines.slice(at + 1).map((line) => (line.trim() === '' ? line : `  ${line}`));
  return readJobs(['jobs:', '  action:', '    steps:', ...body].join('\n'))[0].steps;
}

const stepId = (step) => /^\s*(?:- )?id:\s*([A-Za-z0-9_-]+)\s*$/m.exec(step.text)?.[1] ?? null;
const literalDays = (value) => (/^'?(\d+)'?$/.exec(value ?? '') ? Number(/\d+/.exec(value)[0]) : null);

function ungated(where, steps) {
  const problems = [];
  let issuers = 0;
  for (const step of steps) {
    if (!CERTBOT.test(step.run ?? '')) continue;
    issuers += 1;
    const condition = (step.if ?? '').replace(/^\$\{\{\s*|\s*\}\}$/g, '').trim();
    const gate = GATE.exec(condition);
    const decider = gate && steps.find((s) => stepId(s) === gate[1]);
    if (!gate || !decider || !(decider.run ?? '').includes(DECISION)) {
      problems.push(`${where} runs certbot ${step.if ? `on \`${step.if}\`` : 'unconditionally'}: gate it on exactly \`steps.<id>.outputs.action == 'issue'\` (or 'renew') of a step that runs ${DECISION}`);
    }
  }
  return { problems, issuers };
}

/** @param {{ workflows: { path: string, text: string }[], actions: Record<string, string> }} tree */
export function issuanceGaps({ workflows, actions }) {
  const problems = [];
  let issuers = 0;
  const count = (result) => { problems.push(...result.problems); issuers += result.issuers; };
  for (const [name, text] of Object.entries(actions)) count(ungated(`action ${name}`, actionAsJob(text)));
  let publishNeed = null;
  const renewers = [];
  for (const { path, text } of workflows) {
    const env = workflowEnv(text);
    for (const job of readJobs(text)) {
      count(ungated(`${path} job ${job.id}`, job.steps));
      if (job.steps.some((s) => (s.run ?? '').includes(`${DECISION} renew`))) renewers.push({ path, env });
      for (const step of job.steps.filter((s) => s.uses === CERT_ACTION)) {
        if (!step.with['real-release']) problems.push(`${path} job ${job.id}: agent-certificate is used without real-release`);
        const ref = ENV_REF.exec(step.with['margin-days'] ?? '');
        const margin = ref ? literalDays(env[ref[1]]) : null;
        if (margin === null) {
          problems.push(`${path} job ${job.id}: agent-certificate needs margin-days from a workflow env literal (e.g. CERT_REISSUE_MARGIN_DAYS: '15')`);
          continue;
        }
        const floors = [...(env.MIN_CERT_DAYS ?? '').matchAll(/'(\d+)'/g)].map((m) => Number(m[1]));
        if (floors.length === 0) problems.push(`${path}: MIN_CERT_DAYS names no floor to add the margin to`);
        else publishNeed = Math.max(publishNeed ?? 0, Math.max(...floors) + margin);
      }
    }
  }
  for (const { path, env } of renewers) {
    const below = literalDays(env.RENEW_BELOW_DAYS);
    if (below === null) problems.push(`${path} renews without a RENEW_BELOW_DAYS env literal`);
    else if (publishNeed !== null && below <= publishNeed) {
      problems.push(`${path}: RENEW_BELOW_DAYS ${below} must exceed the release's floor + margin (${publishNeed}), or releases issue routinely`);
    }
  }
  return { problems, issuers };
}
