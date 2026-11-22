import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { actionAsJob, issuanceGaps } from './certificate-issuance-coverage.mjs';

// The real files, so the controls below mutate what ships rather than a fixture that could drift.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const ACTION = read('.github/actions/agent-certificate/action.yml');
const RELEASE = read('.github/workflows/release-agent.yml');
const RENEW = read('.github/workflows/renew-agent-tls.yml');

const gaps = ({ action = ACTION, release = RELEASE, renew = RENEW } = {}) => issuanceGaps({
  workflows: [{ path: 'release-agent.yml', text: release }, { path: 'renew-agent-tls.yml', text: renew }],
  actions: { 'agent-certificate': action },
});
const swap = (text, from, to) => {
  assert.ok(text.includes(from), `the control's anchor ${JSON.stringify(from)} is gone; update this test`);
  return text.replace(from, to);
};
const ISSUE_GATE = "      if: steps.decide.outputs.action == 'issue'\n      env:\n        CF_TOKEN";

test('the shipped action and workflows gate both certbot steps on the decision', () => {
  assert.deepEqual(gaps(), { problems: [], issuers: 2 });
});

test('the action reader sees composite steps with their ids and conditions', () => {
  const steps = actionAsJob(ACTION);
  assert.ok(steps.some((s) => /id: decide/.test(s.text) && s.run.includes('agent-certificate-decision.mjs release')));
  assert.ok(steps.some((s) => s.if === "steps.decide.outputs.action == 'issue'" && /certbot certonly/.test(s.run)));
});

test('negative control: the old per-release gate is refused', () => {
  const old = swap(ACTION, ISSUE_GATE, "      if: inputs.issue == 'true'\n      env:\n        CF_TOKEN");
  assert.match(gaps({ action: old }).problems.join('\n'), /action agent-certificate runs certbot on `inputs.issue == 'true'`/);
});

test('negative control: an ungated, widened or misdirected certbot step is refused', () => {
  const none = swap(ACTION, ISSUE_GATE, '      env:\n        CF_TOKEN');
  assert.match(gaps({ action: none }).problems.join('\n'), /runs certbot unconditionally/);
  const widened = swap(ACTION, ISSUE_GATE, "      if: steps.decide.outputs.action == 'issue' || true\n      env:\n        CF_TOKEN");
  assert.match(gaps({ action: widened }).problems.join('\n'), /runs certbot on/);
  const elsewhere = swap(ACTION, ISSUE_GATE, "      if: steps.cached.outputs.action == 'issue'\n      env:\n        CF_TOKEN");
  assert.match(gaps({ action: elsewhere }).problems.join('\n'), /runs certbot on/);
  const renewNoGate = swap(RENEW, "        if: steps.due.outputs.action == 'renew'\n        env:\n          CF_TOKEN", '        env:\n          CF_TOKEN');
  assert.match(gaps({ renew: renewNoGate }).problems.join('\n'), /renew-agent-tls.yml job renew runs certbot unconditionally/);
});

test('negative control: the margin must be passed, from an env literal', () => {
  const noMargin = swap(RELEASE, '          margin-days: ${{ env.CERT_REISSUE_MARGIN_DAYS }}\n', '');
  assert.match(gaps({ release: noMargin }).problems.join('\n'), /needs margin-days/);
  const noLiteral = swap(RELEASE, "  CERT_REISSUE_MARGIN_DAYS: '15'\n", '');
  assert.match(gaps({ release: noLiteral }).problems.join('\n'), /needs margin-days/);
  const noReal = swap(RELEASE, "          real-release: ${{ startsWith(env.RELEASE_REF, 'refs/tags/agent-v') }}\n", '');
  assert.match(gaps({ release: noReal }).problems.join('\n'), /without real-release/);
});

test('negative control: renewal must start above the release floor + margin (45)', () => {
  const at = (days) => gaps({ renew: swap(RENEW, "  RENEW_BELOW_DAYS: '60'", `  RENEW_BELOW_DAYS: '${days}'`) }).problems;
  // 35 was the renewal threshold before this gate: every release in the last 10 days would issue.
  assert.match(at(35).join('\n'), /RENEW_BELOW_DAYS 35 must exceed the release's floor \+ margin \(45\)/);
  assert.equal(at(45).length, 1);
  assert.deepEqual(at(46), []);
  const unset = swap(RENEW, "  RENEW_BELOW_DAYS: '60'\n", '');
  assert.match(gaps({ renew: unset }).problems.join('\n'), /without a RENEW_BELOW_DAYS env literal/);
});
