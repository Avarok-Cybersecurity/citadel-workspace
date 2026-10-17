/**
 * The tenant worker's Turnstile verdicts against the fixture the native server's are held to.
 *
 * The rule exists twice: control/turnstile.mjs + control/admission.mjs for a hosted tenant, and
 * kernel::sign_in::{turnstile, admission} for a self-hosted server. Both suites run every case
 * in deploy/tenant-worker/test/fixtures/turnstile-verdicts.json -- this one, and the kernel's
 * tests/turnstile_verdicts_match_the_worker.rs -- so a change to either that the other lacks
 * fails one of them. Plain node: the two modules are pure, and siteverify is the `io.fetch`
 * they are handed, answered here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { admit } from '../../deploy/tenant-worker/control/admission.mjs';
import { boundVerdict, SITEVERIFY } from '../../deploy/tenant-worker/control/turnstile.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = JSON.parse(
  readFileSync(join(ROOT, 'deploy/tenant-worker/test/fixtures/turnstile-verdicts.json'), 'utf8'),
);
const { check, ip } = FIXTURE;

const tokenOf = (c) => (c.token_repeat ? c.token_repeat[0].repeat(c.token_repeat[1]) : c.token);

/** A fetch that answers siteverify as the case says, recording each request. */
function siteverify(behaviour) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, form: Object.fromEntries(init.body) });
    if (behaviour.unreachable) throw new Error('connect ECONNREFUSED');
    return { json: async () => (behaviour.unreadable ? Promise.reject(new SyntaxError('not JSON')) : behaviour.answer) };
  };
  return { calls, fetch };
}

test('the fixture has cases on both rules', () => {
  assert.ok(FIXTURE.bound_verdict.length >= 10, 'bound_verdict cases');
  assert.ok(FIXTURE.admit.length >= 10, 'admit cases');
});

for (const c of FIXTURE.bound_verdict) {
  test(`boundVerdict: ${c.name}`, () => {
    assert.equal(boundVerdict(c.answer, check.hostnames.join(','), c.action, check.cdata), c.expected);
  });
}

for (const c of FIXTURE.admit) {
  test(`admit: ${c.name}`, async () => {
    const io = siteverify(c.siteverify);
    const logged = [];
    const ctx = {
      required: c.required,
      turnstile: { secret: check.secret, hostnames: check.hostnames.join(',') },
      tenant: check.cdata,
      io,
      log: (detail) => logged.push(detail),
    };
    const token = tokenOf(c);
    assert.deepEqual(await admit(ctx, { kind: c.kind, token, ip }), c.expected);
    const expectedCalls = c.asked
      ? [{ url: SITEVERIFY, form: { secret: check.secret, response: token, remoteip: ip } }]
      : [];
    assert.deepEqual(io.calls, expectedCalls);
    assert.equal(logged.length, c.siteverify.unreachable && c.asked ? 1 : 0, logged.join('; '));
  });
}
