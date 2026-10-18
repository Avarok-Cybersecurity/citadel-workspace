import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACTIVE, DAY_SECONDS, dunningPolicy, HOUR_SECONDS, markSent, transition } from './dunning.mjs';

const policy = JSON.parse(readFileSync(new URL('./policy.json', import.meta.url), 'utf8'));
const { grace_days, reminder_days, final_warning_hours } = policy.dunning;
const T0 = 1_800_000_000;
const invoice = { id: 'in_1', hosted_invoice_url: 'https://invoice.stripe.com/i/1', customer_email: 'owner@example.com' };

const failedAt = (at = T0) => transition(ACTIVE, { type: 'payment_failed', at, invoice }, policy);
/** The state after the failure, with the day-0 email sent. */
const owing = () => markSent(failedAt().state, failedAt().actions[1], T0, policy);
const tickAt = (state, at) => transition(state, { type: 'tick', at }, policy);
const finalAt = (state) => state.purge_at - final_warning_hours * HOUR_SECONDS;
/** Every email a run of ticks at `times` sends, each recorded as sent before the next. */
function run(state, times) {
  const sent = [];
  for (const at of times) {
    const { actions } = tickAt(state, at);
    for (const a of actions) {
      sent.push({ at, ...a });
      if (a.type === 'email') state = markSent(state, a, at, policy);
    }
  }
  return { state, sent };
}

test('the policy is read whole: a missing or malformed key throws, nothing is defaulted', () => {
  assert.deepEqual(dunningPolicy(policy), { grace_days, reminder_days, final_warning_hours });
  for (const key of ['grace_days', 'reminder_days', 'final_warning_hours']) {
    const { [key]: _, ...rest } = policy.dunning;
    assert.throws(() => dunningPolicy({ dunning: rest }), new RegExp(`dunning.${key} is required`));
  }
  assert.throws(() => dunningPolicy({}), /no dunning section/);
  assert.throws(() => dunningPolicy({ dunning: { ...policy.dunning, reminder_days: [7, 21] } }), /starting at 0/);
  assert.throws(() => dunningPolicy({ dunning: { ...policy.dunning, final_warning_hours: grace_days * 24 } }), /final_warning_hours/);
  assert.throws(() => transition(ACTIVE, { type: 'tick', at: T0 }, { dunning: {} }), /required/);
});

test('a failure suspends, then emails day 0, and starts the grace clock', () => {
  const { state, actions } = failedAt();
  assert.deepEqual(actions, [{ type: 'suspend' }, { type: 'email', kind: 'failed', day: 0 }]);
  assert.deepEqual(state, {
    kind: 'payment_required', since: T0, purge_at: T0 + grace_days * DAY_SECONDS, reminders_sent: [], final_warning_sent_at: null, invoice,
  });
});

test('a second failure while owing changes nothing and sends nothing', () => {
  const state = owing();
  assert.deepEqual(transition(state, { type: 'payment_failed', at: T0 + 3 * DAY_SECONDS, invoice: { ...invoice, id: 'in_2' } }, policy), { state, actions: [] });
});

test('each reminder day is due at exactly since + day, not a second before', () => {
  let state = owing();
  for (const d of reminder_days.filter((d) => d > 0)) {
    const at = T0 + d * DAY_SECONDS;
    assert.deepEqual(tickAt(state, at - 1).actions, [], `day ${d} is not due a second early`);
    const { actions } = tickAt(state, at);
    assert.deepEqual(actions, [{ type: 'email', kind: 'reminder', day: d }]);
    state = markSent(state, actions[0], at, policy);
  }
  assert.deepEqual(state.reminders_sent, reminder_days);
});

test(`the final warning is due exactly ${final_warning_hours} h before the purge, and the purge at purge_at`, () => {
  let state = run(owing(), reminder_days.map((d) => T0 + d * DAY_SECONDS)).state;
  assert.deepEqual(tickAt(state, finalAt(state) - 1).actions, []);
  const { actions } = tickAt(state, finalAt(state));
  assert.deepEqual(actions, [{ type: 'email', kind: 'final', day: grace_days - final_warning_hours / 24 }]);
  state = markSent(state, actions[0], finalAt(state), policy);
  assert.equal(state.final_warning_sent_at, finalAt(state));
  assert.deepEqual(tickAt(state, state.purge_at - 1).actions, []);
  assert.deepEqual(tickAt(state, state.purge_at).actions, [{ type: 'purge' }]);
});

test('a repeated tick is idempotent: a recorded email is not sent again', () => {
  const at = T0 + reminder_days[1] * DAY_SECONDS;
  const { sent } = run(owing(), [at, at, at + 1, at + HOUR_SECONDS]);
  assert.deepEqual(sent.map((s) => s.day), [reminder_days[1]]);
  // Negative control: without recording the send, the same tick sends it again. The guard above is
  // markSent's record, not something the tick does by itself.
  const state = owing();
  assert.deepEqual(tickAt(state, at).actions, tickAt(state, at).actions);
  assert.equal(tickAt(state, at).actions.length, 1);
});

test('a day-0 email that failed to send is retried by the next tick, as the failure notice', () => {
  const { state } = failedAt();
  assert.deepEqual(tickAt(state, T0 + 60).actions, [{ type: 'email', kind: 'failed', day: 0 }]);
  assert.deepEqual(tickAt(owing(), T0 + 60).actions, []);
});

test('a missed run sends only the latest due email, never a reminder after the final warning', () => {
  const late = T0 + reminder_days.at(-1) * DAY_SECONDS + DAY_SECONDS;
  const { state, sent } = run(owing(), [late, late + 1]);
  assert.deepEqual(sent.map((s) => s.day), [reminder_days.at(-1)]);
  assert.deepEqual(state.reminders_sent, reminder_days);
  const skipped = run(owing(), [finalAt(owing()), finalAt(owing()) + 60]);
  assert.deepEqual(skipped.sent.map((s) => s.kind), ['final']);
  assert.deepEqual(run(owing(), [owing().purge_at + 5]).sent.map((s) => s.type), ['purge']);
});

test('the whole run: one email per reminder day, one final warning, then the purge, in order', () => {
  const times = [];
  for (let at = T0; at <= T0 + (grace_days + 1) * DAY_SECONDS; at += 15 * 60) times.push(at);
  const { sent } = run(failedAt().state, times);
  assert.deepEqual(sent.filter((s) => s.type === 'email').map((s) => [s.kind, s.day]), [
    ...reminder_days.map((d) => [d === 0 ? 'failed' : 'reminder', d]), ['final', grace_days - final_warning_hours / 24],
  ]);
  const purges = sent.filter((s) => s.type === 'purge');
  assert.equal(purges[0].at, T0 + grace_days * DAY_SECONDS);
  assert.ok(sent.indexOf(purges[0]) === sent.length - purges.length, 'nothing but purges after the first purge');
});

test('payment restores from any owing state, even past purge_at while the purge has not run', () => {
  for (const at of [T0 + 1, T0 + 20 * DAY_SECONDS, owing().purge_at + 3600]) {
    assert.deepEqual(transition(owing(), { type: 'paid', at }, policy), { state: ACTIVE, actions: [{ type: 'restore' }] });
  }
  assert.deepEqual(transition(ACTIVE, { type: 'paid', at: T0 }, policy), { state: ACTIVE, actions: [] });
  assert.deepEqual(tickAt(ACTIVE, T0 + 99 * DAY_SECONDS), { state: ACTIVE, actions: [] });
});

test('a cancellation for non-payment keeps the clock; any other is the voluntary path', () => {
  const state = owing();
  assert.deepEqual(transition(state, { type: 'canceled', reason: 'payment_failed', at: T0 + 5 }, policy), { state, actions: [] });
  assert.deepEqual(transition(ACTIVE, { type: 'canceled', reason: 'cancellation_requested', at: T0 }, policy), { state: ACTIVE, actions: [{ type: 'voluntary_cancel' }] });
  assert.deepEqual(transition(state, { type: 'canceled', reason: null, at: T0 }, policy), { state, actions: [{ type: 'voluntary_cancel' }] });
  // From active, Stripe's non-payment cancellation starts the clock as a failure would.
  const started = transition(ACTIVE, { type: 'canceled', reason: 'payment_failed', at: T0, invoice: null }, policy);
  assert.deepEqual(started.actions.map((a) => a.type), ['suspend', 'email']);
  assert.deepEqual(started.state.invoice, { id: null, hosted_invoice_url: null, customer_email: null });
});

test('markSent marks earlier reminder days with a later one, and refuses what is not an email', () => {
  const later = markSent(failedAt().state, { type: 'email', kind: 'reminder', day: reminder_days[1] }, T0, policy);
  assert.deepEqual(later.reminders_sent, reminder_days.slice(0, 2));
  assert.throws(() => markSent(owing(), { type: 'email', kind: 'reminder', day: 3 }, T0, policy), /not a reminder day/);
  assert.throws(() => markSent(ACTIVE, { type: 'email', kind: 'final', day: 28 }, T0, policy), /only while payment is required/);
  assert.throws(() => markSent(owing(), { type: 'purge' }, T0, policy), /records an email/);
});

test('unreadable input throws rather than guessing', () => {
  assert.throws(() => transition({ kind: 'purged' }, { type: 'tick', at: T0 }, policy), /unknown dunning state/);
  assert.throws(() => transition(ACTIVE, { type: 'refund', at: T0 }, policy), /unknown dunning event/);
  assert.throws(() => transition(ACTIVE, { type: 'tick', at: '1' }, policy), /integer time/);
  assert.throws(() => transition({ kind: 'payment_required', since: T0 }, { type: 'tick', at: T0 }, policy), /since, purge_at/);
});
