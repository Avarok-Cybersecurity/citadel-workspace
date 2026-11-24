/**
 * The signing step's key rule, each refusal beside its control, against the kernel's own list: the
 * deploy's key must be first-party and a throwaway one must not be. And without a seed nothing is
 * signed, with no default to fall back on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firstPartyKeys, GLUE_ABI, keyProblem, moduleProblem, PROVISIONED_APPS, signFirstPartyApps, SEED_ENV } from './sign-first-party-apps.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const trusted = firstPartyKeys(readFileSync(join(ROOT, 'citadel-workspace-server-kernel/src/kernel/apps/install.rs'), 'utf8'));

test('the kernel lists the one first-party key', () => {
  assert.equal(trusted.length, 1);
  assert.match(trusted[0], /^[0-9a-f]{3904}$/);
});

test("the deploy's key must be first-party", () => {
  assert.equal(keyProblem('calendar', trusted[0], trusted, false), null);
  assert.match(keyProblem('calendar', 'ab'.repeat(1952), trusted, false), /not in FIRST_PARTY_PUBLISHER_KEYS/);
});

test("a throwaway key must not be first-party", () => {
  assert.equal(keyProblem('calendar', 'ab'.repeat(1952), trusted, true), null);
  assert.match(keyProblem('calendar', trusted[0], trusted, true), /throwaway seed signed with a first-party key/);
});

test('without a seed nothing is signed', () => {
  const had = process.env[SEED_ENV];
  delete process.env[SEED_ENV];
  try {
    assert.deepEqual(signFirstPartyApps(ROOT, '/nonexistent', { throwaway: false }), [`${SEED_ENV} is not set: nothing to sign with`]);
  } finally {
    if (had !== undefined) process.env[SEED_ENV] = had;
  }
});

test('an app-ABI app ships its module and a glue app does not', () => {
  assert.equal(moduleProblem('synchronized-work', 'citadel-app-abi-1', true), null);
  assert.match(moduleProblem('synchronized-work', 'citadel-app-abi-1', false), /wrote no module\.wasm/);
  assert.equal(moduleProblem('calendar', GLUE_ABI, false), null);
  assert.match(moduleProblem('calendar', GLUE_ABI, true), /in the UI bundle/);
});

test('every provisioned app is committed with the module the script signs', () => {
  for (const { app, module } of PROVISIONED_APPS) {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'apps/first-party', app, 'manifest.json'), 'utf8'));
    assert.equal(readFileSync(join(ROOT, module)).length, manifest.artifact.bytes, app);
  }
  assert.deepEqual(PROVISIONED_APPS.map((a) => a.app), ['calendar', 'synchronized-work']);
});
