/**
 * The signing step's key rules, each refusal beside its control, against the kernel's own lists: the
 * deploy's key must be first-party and not the CI root's, a throwaway one must be neither, and a CI
 * run signs only with the published CI seed, whose key is the CI root's and no first-party key. And
 * without a seed nothing is signed, with no default to fall back on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ciSeedHex, GLUE_ABI, kernelKeyLists, keyProblem, moduleProblem, PROVISIONED_APPS, seedFor, signFirstPartyApps, SEED_ENV } from './sign-first-party-apps.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lists = kernelKeyLists(ROOT);
const [production] = lists.production;
const [ci] = lists.ci;
const other = 'ab'.repeat(1952);
const CI_SEED = ciSeedHex(ROOT);

test('the kernel lists one first-party key and one CI root key, and they differ', () => {
  assert.deepEqual([lists.production.length, lists.ci.length], [1, 1]);
  assert.match(production, /^[0-9a-f]{3904}$/);
  assert.match(ci, /^[0-9a-f]{3904}$/);
  assert.notEqual(production, ci);
  assert.equal(CI_SEED, Buffer.from('citadel ci first-party root seed').toString('hex'));
});

test("the deploy's key must be first-party, and never the CI root's", () => {
  assert.equal(keyProblem('calendar', production, lists, 'deploy'), null);
  assert.match(keyProblem('calendar', other, lists, 'deploy'), /not in FIRST_PARTY_PUBLISHER_KEYS/);
  assert.match(keyProblem('calendar', ci, lists, 'deploy'), /CI root's published key/);
});

test('a throwaway key must be neither first-party nor the CI root', () => {
  assert.equal(keyProblem('calendar', other, lists, 'throwaway'), null);
  assert.match(keyProblem('calendar', production, lists, 'throwaway'), /throwaway seed signed with a first-party key/);
  assert.match(keyProblem('calendar', ci, lists, 'throwaway'), /throwaway seed signed with a CI root key/);
});

test("a CI run's key must be the CI root's and no first-party key", () => {
  assert.equal(keyProblem('calendar', ci, lists, 'ci'), null);
  assert.match(keyProblem('calendar', other, lists, 'ci'), /not the CI root's/);
  assert.match(keyProblem('calendar', production, { production: [production], ci: [production] }, 'ci'), /CI run signed with a first-party key/);
});

test('each mode signs with its own seed and refuses the others', () => {
  assert.deepEqual(seedFor('ci', undefined, CI_SEED), { seed: CI_SEED });
  assert.match(seedFor('ci', 'cd'.repeat(32), CI_SEED).problem, /signs only with the published CI seed/);
  assert.deepEqual(seedFor('deploy', 'cd'.repeat(32), CI_SEED), { seed: 'cd'.repeat(32) });
  assert.match(seedFor('deploy', CI_SEED, CI_SEED).problem, /is the published CI seed/);
  assert.match(seedFor('deploy', CI_SEED.toUpperCase(), CI_SEED).problem, /is the published CI seed/);
  assert.deepEqual(seedFor('throwaway', CI_SEED, CI_SEED), { seed: CI_SEED });
  assert.match(seedFor('deploy', undefined, CI_SEED).problem, /is not set/);
  assert.match(seedFor('throwaway', '', CI_SEED).problem, /is not set/);
  assert.match(seedFor('release', 'cd'.repeat(32), CI_SEED).problem, /unknown signing mode/);
});

test('without a seed nothing is signed', () => {
  const had = process.env[SEED_ENV];
  delete process.env[SEED_ENV];
  try {
    assert.deepEqual(signFirstPartyApps(ROOT, '/nonexistent', 'deploy'), [`${SEED_ENV} is not set: nothing to sign with`]);
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
