/**
 * Every agent build verifies the certificate it compiles in, against a floor someone chose.
 * Pure: scripts/check-agent-certificate-is-verified.mjs reads the workflows and the local
 * actions and passes their text in.
 *
 * Why: the 30-day floor lived inside the agent-certificate action and applied to every run, so
 * a Release agent dry run (run 44941697947) failed a month before the committed certificate
 * expired; and the PR legs that compile the same certificate (windows-agent, unix-agents)
 * checked nothing at all, so an expired one would have shipped from a green PR. The floor is now
 * an input -- 30 for a published build, 0 for anything else -- and this keeps it one:
 *
 *   1. the agent-certificate action requires `floor-days` and verifies with it;
 *   2. every use of that action passes `floor-days`;
 *   3. every job that compiles the agent verifies in its own steps, or takes the certificate from
 *      the `agent-tls` artifact of a job in the same workflow that ran the action;
 *   4. every workflow that runs smoke-agent.sh (itself or through an action) sets MIN_CERT_DAYS,
 *      which smoke-certificate.sh now requires.
 */
import { readJobs, workflowEnv } from './workflow-steps.mjs';

const VERIFY = 'scripts/verify-agent-certificate.mjs';
const COMPILES = /scripts\/build-agent-(unix\.sh|windows\.ps1)/;
const CERT_ACTION = './.github/actions/agent-certificate';
const BUILD_ACTION = './.github/actions/build-agent';
const localAction = (uses) => /^\.\/\.github\/actions\/([A-Za-z0-9_.-]+)$/.exec(uses ?? '')?.[1] ?? null;

/** @param {{ workflows: { path: string, text: string }[], actions: Record<string, string> }} tree */
export function certificateGaps({ workflows, actions }) {
  const problems = [];
  const certAction = actions['agent-certificate'];
  if (certAction === undefined) return { problems: ['the agent-certificate action is missing'], builds: 0, uses: 0 };
  if (!/^ {2}floor-days:\s*\n(?: {4}.*\n)*? {4}required: true/m.test(certAction)) {
    problems.push('the agent-certificate action does not declare a required `floor-days` input');
  }
  if (!certAction.includes(VERIFY) || !/inputs\.floor-days/.test(certAction)) {
    problems.push(`the agent-certificate action does not run ${VERIFY} with its floor-days input`);
  }
  const downloadsTls = (name) => /name:\s*agent-tls/.test(actions[name] ?? '') && /download-artifact/.test(actions[name] ?? '');
  const smokes = (text) => text.split('\n').some((line) => !/^\s*#/.test(line) && /smoke-agent\.sh/.test(line));
  let builds = 0;
  let uses = 0;
  for (const { path, text } of workflows) {
    const jobs = readJobs(text);
    const issuer = jobs.some((job) => job.steps.some((s) => s.uses === CERT_ACTION));
    for (const job of jobs) {
      for (const step of job.steps) {
        if (step.uses === CERT_ACTION) {
          uses += 1;
          if (!step.with['floor-days']) problems.push(`${path} job ${job.id}: agent-certificate is used without floor-days`);
        }
      }
      const compiles = job.steps.filter((s) => COMPILES.test(s.run ?? '') || s.uses === BUILD_ACTION);
      if (compiles.length === 0) continue;
      builds += 1;
      const verifies = job.steps.some((s) => (s.run ?? '').includes(VERIFY));
      const fromIssuer = compiles.some((s) => s.uses === BUILD_ACTION) && downloadsTls('build-agent') && issuer;
      if (!verifies && !fromIssuer) {
        problems.push(`${path} job ${job.id} compiles the agent without verifying its certificate: run ${VERIFY} --floor-days 0 in it`);
      }
    }
    const viaActions = jobs.flatMap((job) => job.steps.map((s) => localAction(s.uses)).filter(Boolean));
    if (smokes(text) || viaActions.some((name) => smokes(actions[name] ?? ''))) {
      const declared = workflowEnv(text).MIN_CERT_DAYS !== undefined || jobs.some((job) => job.env.MIN_CERT_DAYS !== undefined);
      if (!declared) problems.push(`${path} runs smoke-agent.sh without setting MIN_CERT_DAYS (30 to publish, 0 for a dry run)`);
    }
  }
  return { problems, builds, uses };
}
