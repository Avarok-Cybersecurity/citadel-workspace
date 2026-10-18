import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dueAlerts, percentOf, quotaReached } from './thresholds.mjs';
import { checkPolicy, publicPolicy, withoutComments } from './policy-shape.mjs';

const policy = checkPolicy(JSON.parse(readFileSync(new URL('./policy.json', import.meta.url), 'utf8')));
const [P1, P2, P3] = policy.alerts.usage_percent;
const STEP = policy.alerts.overage_step_units['relay-overage'];
const HOUR = 3600 * 1000;
const TTL = policy.overage_billing.termination_ttl_hours * HOUR;
const [C1, C2] = policy.alerts.countdown_hours;
const NOW = Date.UTC(2026, 9, 18);

const due = (over) => dueAlerts({
  policy, dimension: 'relay-overage', used: 0, included: 100, overage_billing: false, state: 'ok', terminate_at: null, now: NOW, sent: new Set(), ...over,
});
const at = (pct) => pct; // used, of the quota of 100 `due` measures against

test('the policy file has every key the billing code reads', () => {
  assert.equal(policy.alerts.usage_percent.length >= 2, true);
});

test('a missing or malformed policy key throws, naming it', () => {
  const broken = (edit) => { const p = structuredClone(policy); edit(p); return () => checkPolicy(p); };
  assert.throws(broken((p) => delete p.overage_billing.termination_ttl_hours), /overage_billing.termination_ttl_hours/);
  assert.throws(broken((p) => { p.alerts.usage_percent = [P2, P1]; }), /ascending/);
  assert.throws(broken((p) => delete p.overage_billing.terminated_service.storage), /terminated_service.storage/);
  assert.throws(broken((p) => { p.alerts.overage_step_units.bogus = 1; }), /overage_step_units.bogus/);
  assert.throws(broken((p) => delete p.dunning.grace_days), /dunning.grace_days/);
  assert.throws(broken((p) => delete p.terms), /terms/);
});

test('the public policy is the file without its comments', () => {
  const file = withoutComments(policy);
  assert.deepEqual(publicPolicy(policy), {
    overage_billing: file.overage_billing, dunning: file.dunning, alerts: file.alerts, terms: file.terms,
  });
  assert.equal(JSON.stringify(publicPolicy(policy)).includes('$comment'), false);
});

test('percent thresholds: each boundary, below it nothing', () => {
  assert.deepEqual(due({ used: at(P1) - 0.001 }), []);
  assert.deepEqual(due({ used: at(P1) }), [`percent:${P1}`]);
  assert.deepEqual(due({ used: at(P2) - 0.001, sent: new Set([`percent:${P1}`]) }), []);
  assert.deepEqual(due({ used: at(P2), sent: new Set([`percent:${P1}`]) }), [`percent:${P2}`]);
  assert.deepEqual(due({ used: at(P3), overage_billing: true, state: 'over', sent: new Set([`percent:${P1}`, `percent:${P2}`]) }), [`percent:${P3}`]);
});

test('a leap past two thresholds is one key, and a sent key covers those below it', () => {
  assert.deepEqual(due({ used: at(P2) }), [`percent:${P2}`]);
  assert.deepEqual(due({ used: at(P2), sent: new Set([`percent:${P2}`]) }), []);
  assert.deepEqual(due({ used: at(P1), sent: new Set([`percent:${P2}`]) }), []);
});

test('with overage on: one key per step beyond the quota, none before the first step', () => {
  const on = { overage_billing: true, state: 'over', sent: new Set([`percent:${P3}`]) };
  assert.deepEqual(due({ ...on, used: 100 + STEP - 0.001 }), []);
  assert.deepEqual(due({ ...on, used: 100 + STEP }), ['overage:1']);
  assert.deepEqual(due({ ...on, used: 100 + 3 * STEP, sent: new Set([...on.sent, 'overage:1']) }), ['overage:3']);
  assert.deepEqual(due({ ...on, used: 100 + 3 * STEP, sent: new Set([...on.sent, 'overage:3']) }), []);
  assert.deepEqual(due({ ...on, used: 100 + 9 * STEP, state: 'terminating', terminate_at: NOW }), ['overage:9']);
});

test('a dimension with no overage step (storage) has no overage keys', () => {
  assert.deepEqual(due({ dimension: 'storage', used: 1000, overage_billing: true, state: 'over', sent: new Set([`percent:${P3}`]) }), []);
});

test('with overage off: the countdown at each boundary, then the termination', () => {
  const off = { used: 100, sent: new Set([`percent:${P3}`]) };
  const left = (h) => ({ ...off, state: 'terminating', terminate_at: NOW + h * HOUR });
  assert.deepEqual(due(left(C1 + 1)), []);
  assert.deepEqual(due(left(C1)), [`countdown:${C1}`]);
  assert.deepEqual(due({ ...left(C2 + 0.01), sent: new Set([...off.sent, `countdown:${C1}`]) }), []);
  assert.deepEqual(due({ ...left(C2), sent: new Set([...off.sent, `countdown:${C1}`]) }), [`countdown:${C2}`]);
  assert.deepEqual(due({ ...off, state: 'terminated', terminate_at: NOW - 1, sent: new Set([...off.sent, `countdown:${C2}`]) }), ['countdown:0']);
  assert.deepEqual(due({ ...off, state: 'terminated', terminate_at: NOW - 1, sent: new Set([...off.sent, 'countdown:0']) }), []);
  assert.deepEqual(due({ ...off, state: 'terminating', terminate_at: NOW + TTL }), [`countdown:${C1}`]);
});

test('a countdown with no terminate_at, or sent as a list, is refused', () => {
  assert.throws(() => due({ used: 100, state: 'terminating', terminate_at: null }), /terminate_at/);
  assert.throws(() => due({ sent: [] }), /Set/);
});

test('a quota of zero is reached by any use and by none', () => {
  assert.equal(quotaReached(0, 0), false);
  assert.equal(quotaReached(1, 0), true);
  assert.equal(percentOf(0, 0), 0);
  assert.equal(percentOf(1, 0), Infinity);
  assert.equal(quotaReached(99.999, 100), false);
  assert.equal(quotaReached(100, 100), true);
});
