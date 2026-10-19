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
    'citadel-secure-links-month': 200,
    'citadel-secure-links-year': 2000,
  });
});

test('Free sells nothing, so it creates no Stripe product', () => {
  assert.deepEqual(deriveCatalogue(table).map((p) => p.tier), ['team', 'business', 'storage', 'secure-links']);
});

test('every paid price is per seat', () => {
  for (const price of deriveCatalogue(table).flatMap((p) => p.prices)) assert.equal(price.usage_type, 'licensed');
});

test('a price Stripe holds exactly as wanted has no differences', () => {
  const want = deriveCatalogue(table)[0].prices[0];
  const have = { active: true, unit_amount: 600, currency: 'usd', product: 'prod_1', recurring: { interval: 'month', usage_type: 'licensed' }, metadata: { citadel_tier: 'team' }, tax_behavior: 'exclusive' };
  assert.deepEqual(priceDiffs(want, have, 'prod_1', undefined, 'exclusive'), []);
});

test('an amount, an archived price and a missing price are all reported', () => {
  const want = deriveCatalogue(table)[0].prices[0];
  const have = { active: false, unit_amount: 500, currency: 'usd', product: 'prod_1', recurring: { interval: 'month', usage_type: 'licensed' }, metadata: { citadel_tier: 'team' }, tax_behavior: 'exclusive' };
  assert.deepEqual(priceDiffs(want, have, 'prod_1', undefined, 'exclusive'), ['unit_amount 500 ≠ 600', 'archived']);
  assert.deepEqual(priceDiffs(want, undefined, 'prod_1', undefined, 'exclusive'), ['missing']);
});

test('a product whose description drifted from its limits is reported', () => {
  const want = deriveCatalogue(table)[0].product;
  assert.deepEqual(productDiffs(want, { name: want.name, description: 'old', active: true }, null), ['description']);
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
  assert.deepEqual(storage.prices.map((p) => p.unit_amount), [200, 2000]);
  assert.ok(storage.prices.every((p) => p.usage_type === 'licensed'));
  const bad = structuredClone(table);
  bad.addons[0].available_on.push('enterprise');
  assert.throws(() => deriveCatalogue(bad), /unknown tier enterprise/);
});

test('secure links are their own product, per 50-link pack at $2/month or $20/year, on paid tiers only', () => {
  const links = deriveCatalogue(table).find((p) => p.tier === 'secure-links');
  assert.equal(links.product.name, 'Citadel Workspace Secure Link Pack');
  assert.equal(links.product.description, '50 secure links per pack, on team and business');
  assert.deepEqual(links.prices.map((p) => [p.lookup_key, p.unit_amount, p.interval, p.usage_type]), [
    ['citadel-secure-links-month', 200, 'month', 'licensed'],
    ['citadel-secure-links-year', 2000, 'year', 'licensed'],
  ]);
});

test('an add-on granting something the catalogue cannot describe is refused', () => {
  const bad = structuredClone(table);
  bad.addons[1].grants = { mystery: 1 };
  assert.throws(() => deriveCatalogue(bad), /grants mystery/);
  const zero = structuredClone(table);
  zero.addons[1].grants.secure_links_pool = 0;
  assert.throws(() => deriveCatalogue(zero), /positive integer/);
});

test('every paid seat carries its storage and document-append grants; Free has totals', () => {
  assert.deepEqual(Object.fromEntries(table.tiers.map((t) => [t.id, [t.limits.storage_gb_per_seat ?? t.limits.storage_gb_total, t.limits.document_appends_per_seat ?? t.limits.document_appends_total]])), {
    free: [1, 50000], team: [10, 250000], business: [25, 250000],
  });
});

test('every tier states its own secure-link allowance per member', () => {
  assert.deepEqual(Object.fromEntries(table.tiers.map((t) => [t.id, t.limits.secure_links_per_member])), { free: 5, team: 50, business: 50 });
});

test('relay overage is one metered price under citadel-relay-overage, on its own meter', () => {
  const [overage, ...rest] = deriveMetered(table);
  assert.equal(rest.length, 0);
  assert.equal(overage.meter.event_name, 'citadel_relay_gb');
  assert.equal(overage.prices[0].unit_amount, 10);
  assert.deepEqual(overage.prices.map((p) => [p.lookup_key, p.usage_type, p.interval]), [['citadel-relay-overage', 'metered', 'month']]);
  // Not a tier's product: the licensed catalogue is untouched by it.
  assert.ok(!deriveCatalogue(table).some((p) => p.tier === overage.tier));
});

test('a metered price on another meter, or a meter that does not sum, differs', () => {
  const [want] = deriveMetered(table)[0].prices;
  const have = { active: true, unit_amount: want.unit_amount, currency: 'usd', product: 'prod_o', recurring: { interval: 'month', usage_type: 'metered', meter: 'mtr_1' }, metadata: { citadel_tier: 'relay-overage' }, tax_behavior: 'exclusive' };
  assert.deepEqual(priceDiffs(want, have, 'prod_o', 'mtr_1', 'exclusive'), []);
  assert.deepEqual(priceDiffs(want, have, 'prod_o', 'mtr_2', 'exclusive'), ['meter mtr_1 ≠ mtr_2']);
  const meter = { status: 'active', default_aggregation: { formula: 'sum' }, customer_mapping: { event_payload_key: 'stripe_customer_id' }, value_settings: { event_payload_key: 'value' } };
  assert.deepEqual(meterDiffs({}, meter), []);
  assert.deepEqual(meterDiffs({}, { ...meter, default_aggregation: { formula: 'count' } }), ['aggregation is not sum']);
  assert.deepEqual(meterDiffs({}, undefined), ['missing']);
});

test('a price with another tax behaviour differs, and the behaviour is required', () => {
  const want = deriveCatalogue(table)[0].prices[0];
  const have = { active: true, unit_amount: 600, currency: 'usd', product: 'prod_1', recurring: { interval: 'month', usage_type: 'licensed' }, metadata: { citadel_tier: 'team' }, tax_behavior: 'unspecified' };
  assert.deepEqual(priceDiffs(want, have, 'prod_1', undefined, 'exclusive'), ['tax_behavior unspecified ≠ exclusive']);
  assert.throws(() => priceDiffs(want, have, 'prod_1', undefined), /needs taxBehavior/);
});

test('a product tax code is compared only when the model names one', () => {
  const want = deriveCatalogue(table)[0].product;
  const have = { name: want.name, description: want.description, active: true, tax_code: 'txcd_10000000' };
  assert.deepEqual(productDiffs(want, have, null), []);
  assert.deepEqual(productDiffs(want, have, 'txcd_10103001'), ['tax_code txcd_10000000 ≠ txcd_10103001']);
  assert.deepEqual(productDiffs(want, { ...have, tax_code: { id: 'txcd_10103001' } }, 'txcd_10103001'), []);
  assert.throws(() => productDiffs(want, have), /needs taxCode/);
  assert.throws(() => productDiffs(want, have, 'saas'), /needs taxCode/);
});

test('a proposed metered entry is not sold: no meter, product or price until its status is approved', () => {
  assert.equal(table.metered.find((m) => m.id === 'document-appends').status, 'proposed');
  assert.deepEqual(deriveMetered(table).map((w) => w.tier), ['relay-overage']);
  const approved = structuredClone(table);
  approved.metered.find((m) => m.id === 'document-appends').status = 'approved';
  const appends = deriveMetered(approved).find((w) => w.tier === 'document-appends');
  assert.deepEqual([appends.meter.event_name, appends.prices[0].lookup_key, appends.prices[0].unit_amount], ['citadel_document_appends', 'citadel-document-appends', 1]);
});

test('every metered entry states its status: missing or unknown throws', () => {
  for (const status of [undefined, 'Approved', 'sold']) {
    const bad = structuredClone(table);
    bad.metered[0].status = status;
    assert.throws(() => deriveMetered(bad), /metered relay-overage: status is proposed \| approved/);
  }
});
