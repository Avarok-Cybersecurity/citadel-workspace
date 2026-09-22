import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveCatalogue, deriveMetered, meterDiffs, priceDiffs, productDiffs, describeLimits } from './catalogue.mjs';

const table = JSON.parse(readFileSync(new URL('./tiers.json', import.meta.url), 'utf8'));

test('the approved prices are what the table says', () => {
  const byKey = Object.fromEntries(deriveCatalogue(table).flatMap((p) => p.prices).map((p) => [p.lookup_key, p.unit_amount]));
  assert.deepEqual(byKey, {
    'citadel-team-month': 600,
    'citadel-team-year': 6000,
    'citadel-business-month': 1200,
    'citadel-business-year': 12000,
    'citadel-storage-month': 200,
    'citadel-storage-year': 2000,
  });
});

test('Free sells nothing, so it creates no Stripe product', () => {
  assert.deepEqual(deriveCatalogue(table).map((p) => p.tier), ['team', 'business', 'storage']);
});

test('every paid price is per seat', () => {
  for (const price of deriveCatalogue(table).flatMap((p) => p.prices)) assert.equal(price.usage_type, 'licensed');
});

test('a price Stripe holds exactly as wanted has no differences', () => {
  const want = deriveCatalogue(table)[0].prices[0];
  const have = { active: true, unit_amount: 600, currency: 'usd', product: 'prod_1', recurring: { interval: 'month', usage_type: 'licensed' }, metadata: { citadel_tier: 'team' } };
  assert.deepEqual(priceDiffs(want, have, 'prod_1'), []);
});

test('an amount, an archived price and a missing price are all reported', () => {
  const want = deriveCatalogue(table)[0].prices[0];
  const have = { active: false, unit_amount: 500, currency: 'usd', product: 'prod_1', recurring: { interval: 'month', usage_type: 'licensed' }, metadata: { citadel_tier: 'team' } };
  assert.deepEqual(priceDiffs(want, have, 'prod_1'), ['unit_amount 500 ≠ 600', 'archived']);
  assert.deepEqual(priceDiffs(want, undefined, 'prod_1'), ['missing']);
});

test('a product whose description drifted from its limits is reported', () => {
  const want = deriveCatalogue(table)[0].product;
  assert.deepEqual(productDiffs(want, { name: want.name, description: 'old', active: true }), ['description']);
  assert.equal(describeLimits({ members: 1000, storage_gb_per_seat: 25, priority_support: true }), 'Up to 1,000 members · 25 GB per seat · priority support');
});

test('a bad amount or a duplicate lookup key is refused, not written', () => {
  const bad = structuredClone(table);
  bad.tiers[1].prices[0].unit_amount = 6.5;
  assert.throws(() => deriveCatalogue(bad), /positive integer of cents/);
  const dup = structuredClone(table);
  dup.tiers[1].prices.push({ interval: 'month', unit_amount: 700 });
  assert.throws(() => deriveCatalogue(dup), /duplicate lookup key citadel-team-month/);
});

test('extra storage is its own product, per 10 GB block, on paid tiers only', () => {
  const storage = deriveCatalogue(table).find((p) => p.tier === 'storage');
  assert.equal(storage.product.description, '10 GB per block, on team and business');
  assert.ok(storage.prices.every((p) => p.usage_type === 'licensed'));
  const bad = structuredClone(table);
  bad.addons[0].available_on.push('enterprise');
  assert.throws(() => deriveCatalogue(bad), /unknown tier enterprise/);
});

test('relay overage is one metered price under citadel-relay-overage, on its own meter', () => {
  const [overage, ...rest] = deriveMetered(table);
  assert.equal(rest.length, 0);
  assert.equal(overage.meter.event_name, 'citadel_relay_gb');
  assert.deepEqual(overage.prices.map((p) => [p.lookup_key, p.usage_type, p.interval]), [['citadel-relay-overage', 'metered', 'month']]);
  // Not a tier's product: the licensed catalogue is untouched by it.
  assert.ok(!deriveCatalogue(table).some((p) => p.tier === overage.tier));
});

test('a metered price on another meter, or a meter that does not sum, differs', () => {
  const [want] = deriveMetered(table)[0].prices;
  const have = { active: true, unit_amount: want.unit_amount, currency: 'usd', product: 'prod_o', recurring: { interval: 'month', usage_type: 'metered', meter: 'mtr_1' }, metadata: { citadel_tier: 'relay-overage' } };
  assert.deepEqual(priceDiffs(want, have, 'prod_o', 'mtr_1'), []);
  assert.deepEqual(priceDiffs(want, have, 'prod_o', 'mtr_2'), ['meter mtr_1 ≠ mtr_2']);
  const meter = { status: 'active', default_aggregation: { formula: 'sum' }, customer_mapping: { event_payload_key: 'stripe_customer_id' }, value_settings: { event_payload_key: 'value' } };
  assert.deepEqual(meterDiffs({}, meter), []);
  assert.deepEqual(meterDiffs({}, { ...meter, default_aggregation: { formula: 'count' } }), ['aggregation is not sum']);
  assert.deepEqual(meterDiffs({}, undefined), ['missing']);
});
