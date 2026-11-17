import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveCatalogue, deriveMetered } from '../../billing/catalogue.mjs';
import { STRIPE_MAX_LOOKUP_KEYS, priceLookupPaths } from './stripe-lookup.mjs';

const keysOf = (path) => [...path.matchAll(/lookup_keys\[\]=([^&]+)/g)].map((m) => decodeURIComponent(m[1]));

test('every lookup request stays within Stripe’s limit and together they ask for every key once', () => {
  const keys = Array.from({ length: 23 }, (_, i) => `k-${i}`);
  const paths = priceLookupPaths(keys);
  assert.equal(paths.length, 3);
  for (const p of paths) assert.ok(keysOf(p).length <= STRIPE_MAX_LOOKUP_KEYS, p);
  assert.deepEqual(paths.flatMap(keysOf), keys);
});

test('the shipped catalogue’s keys are all looked up within the limit', () => {
  const table = JSON.parse(readFileSync(new URL('../../billing/tiers.json', import.meta.url), 'utf8'));
  const keys = [...deriveCatalogue(table), ...deriveMetered(table)].flatMap((w) => w.prices.map((p) => p.lookup_key));
  const paths = priceLookupPaths(keys);
  for (const p of paths) assert.ok(keysOf(p).length <= STRIPE_MAX_LOOKUP_KEYS);
  assert.deepEqual(paths.flatMap(keysOf), keys);
});

test('no keys means no request', () => {
  assert.deepEqual(priceLookupPaths([]), []);
});
