import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeCertificate, parseFloorDays } from './certificate-validity.mjs';

const NOW = Date.parse('2026-11-22T12:00:00Z');
const DAY = 86_400_000;
const facts = (over = {}) => ({
  notAfterMs: Date.parse('2026-12-06T19:44:03Z'), nowMs: NOW, floorDays: 30, coversHost: true, keyMatches: true, host: 'local.avarok.net', ...over,
});

test('run 44941697947: 14 days left fails a published build and passes a dry run', () => {
  const published = judgeCertificate(facts());
  assert.equal(published.ok, false);
  assert.equal(published.daysLeft, 14);
  assert.match(published.reason, /within the 30-day floor/);
  assert.equal(judgeCertificate(facts({ floorDays: 0 })).ok, true);
});

test('negative control: an expired certificate refuses at every floor, even by a second', () => {
  for (const floorDays of [0, 30]) {
    const d = judgeCertificate(facts({ floorDays, notAfterMs: NOW - 1000 }));
    assert.equal(d.ok, false);
    assert.match(d.reason, /EXPIRED/);
  }
  assert.equal(judgeCertificate(facts({ floorDays: 0, notAfterMs: NOW })).ok, false);
});

test('a fresh certificate passes the published floor', () => {
  const d = judgeCertificate(facts({ notAfterMs: NOW + 89 * DAY }));
  assert.deepEqual([d.ok, d.daysLeft], [true, 89]);
});

test('the wrong name or an unmatched key refuses whatever the expiry', () => {
  assert.match(judgeCertificate(facts({ floorDays: 0, coversHost: false })).reason, /does not name local.avarok.net/);
  assert.match(judgeCertificate(facts({ floorDays: 0, keyMatches: false })).reason, /do not match/);
});

test('the floor is required and explicit', () => {
  assert.equal(parseFloorDays('0'), 0);
  assert.equal(parseFloorDays('30'), 30);
  for (const bad of [undefined, '', '-1', '30d', '1.5']) assert.throws(() => parseFloorDays(bad), /whole number of days/);
  assert.throws(() => judgeCertificate(facts({ floorDays: -1 })), /not a whole number/);
  assert.throws(() => judgeCertificate(facts({ notAfterMs: Number.NaN })), /not a time/);
});
