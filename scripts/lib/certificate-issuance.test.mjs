import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBoolean, parseDays, releaseIssuance, renewalIssuance } from './certificate-issuance.mjs';

// The release's configuration as release-agent.yml sets it: a 30-day publish floor (smoke-agent.sh
// holds the packaged binary to it) and a 15-day margin. Fixed here so each boundary is visible.
const FLOOR = 30;
const MARGIN = 15;
const release = (committedDaysLeft, cachedDaysLeft, realRelease = true) =>
  releaseIssuance({ committedDaysLeft, cachedDaysLeft, floorDays: FLOOR, marginDays: MARGIN, realRelease }).action;

test('a release builds with the committed certificate while it has floor + margin', () => {
  assert.equal(release(89, null), 'use-committed');
  assert.equal(release(45, null), 'use-committed');
  assert.equal(release(45, 80), 'use-committed');
});

test('below floor + margin a release reuses what an earlier run issued', () => {
  assert.equal(release(44, 45), 'use-cached');
  assert.equal(release(14, 88), 'use-cached');
});

test('it issues only when neither the committed nor a cached certificate has floor + margin', () => {
  assert.equal(release(44, null), 'issue');
  assert.equal(release(14, 44), 'issue');
  assert.equal(release(-3, null), 'issue');
  assert.match(releaseIssuance({ committedDaysLeft: 14, cachedDaysLeft: null, floorDays: FLOOR, marginDays: MARGIN, realRelease: true }).reason, /14 days \(< 45\) and none is cached/);
});

test('negative control: a re-run after an issuance does not issue again', () => {
  // Run 1 issued an 89-day certificate and cached it; run 2 is the same release, re-run.
  assert.equal(release(14, null), 'issue');
  assert.equal(release(14, 89), 'use-cached');
});

test('a dry run never issues: committed at its floor, or refuse', () => {
  const dry = (committed) => releaseIssuance({ committedDaysLeft: committed, cachedDaysLeft: null, floorDays: 0, marginDays: MARGIN, realRelease: false });
  assert.equal(dry(14).action, 'use-committed');
  assert.equal(dry(0).action, 'use-committed');
  assert.equal(dry(-1).action, 'refuse');
  assert.match(dry(-1).reason, /never issues/);
  for (const committed of [-30, -1, 0, 10, 44, 89]) assert.notEqual(dry(committed).action, 'issue');
});

test('renewal does nothing while the committed certificate has renew-below days', () => {
  const r = (committed, pending, force = false) => renewalIssuance({ committedDaysLeft: committed, pendingDaysLeft: pending, renewBelowDays: 60, force }).action;
  assert.equal(r(60, null), 'nothing');
  assert.equal(r(89, 20), 'nothing');
  assert.equal(r(59, null), 'renew');
  assert.equal(r(14, 59), 'renew');
  assert.equal(r(89, null, true), 'renew');
});

test('negative control: an unmerged renewal PR is re-proposed, never re-issued, even when forced', () => {
  const r = (pending, force) => renewalIssuance({ committedDaysLeft: 14, pendingDaysLeft: pending, renewBelowDays: 60, force });
  assert.equal(r(84, false).action, 'propose-pending');
  assert.equal(r(60, true).action, 'propose-pending');
  assert.match(r(84, false).reason, /not issuing again/);
});

test('missing or malformed configuration fails instead of defaulting', () => {
  const base = { committedDaysLeft: 14, cachedDaysLeft: null, floorDays: FLOOR, marginDays: MARGIN, realRelease: true };
  assert.throws(() => releaseIssuance({ ...base, marginDays: undefined }), /margin/);
  assert.throws(() => releaseIssuance({ ...base, floorDays: -1 }), /floor/);
  assert.throws(() => releaseIssuance({ ...base, realRelease: 'true' }), /real release/);
  assert.throws(() => releaseIssuance({ ...base, cachedDaysLeft: undefined }), /cached/);
  assert.throws(() => renewalIssuance({ committedDaysLeft: 14, pendingDaysLeft: null, renewBelowDays: 0, force: false }), /renew-below/);
  assert.throws(() => renewalIssuance({ committedDaysLeft: 14, pendingDaysLeft: null, renewBelowDays: 60 }), /force/);
  assert.throws(() => parseDays(undefined, '--margin-days'), /--margin-days must be a whole number/);
  assert.throws(() => parseDays('15.5', '--margin-days'), /whole number/);
  assert.equal(parseDays(' 15 ', 'margin'), 15);
  assert.throws(() => parseBoolean('yes', '--real-release'), /"true" or "false"/);
  assert.throws(() => parseBoolean(undefined, '--force'), /"true" or "false"/);
  assert.equal(parseBoolean('false', 'x'), false);
});
