import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyDerived, belowCost, ceilTo, derive, floorViolations } from './derive.mjs';
import { deriveCatalogue, deriveMetered } from './catalogue.mjs';

const load = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
const rates = load('./rates.json');
const model = load('./pricing-model.json');
const tiers = load('./tiers.json');
const sold = (table) => Object.fromEntries([...deriveCatalogue(table), ...deriveMetered(table)].flatMap((w) => w.prices).map((p) => [p.lookup_key, p.unit_amount]));

test('today the derived prices are storage 600/6000, relay 15, appends 1', () => {
  assert.deepEqual(derive({ rates, model, tiers }).prices, {
    'citadel-storage-month': 600,
    'citadel-storage-year': 6000,
    'citadel-relay-overage': 15,
    'citadel-document-appends': 1,
  });
});

test('DRIFT: every derived price in tiers.json is exactly what rates.json x pricing-model.json gives', () => {
  const have = sold(tiers);
  for (const [key, cents] of Object.entries(derive({ rates, model, tiers }).prices)) {
    assert.equal(have[key], cents, `${key} in tiers.json is ${have[key]}, derivation gives ${cents}: run scripts/rates/update-rates.mjs`);
  }
});

test('DRIFT: a mutated rate is a drift', () => {
  const moved = structuredClone(rates);
  moved.rates['cloudflare.turn.usd_per_gb'].value = 0.06;
  const d = derive({ rates: moved, model, tiers }).prices;
  assert.equal(d['citadel-relay-overage'], 18);
  assert.notEqual(sold(tiers)['citadel-relay-overage'], d['citadel-relay-overage']);
});

test('the derived entries are exactly the ones tiers.json marks derived', () => {
  const marked = [...tiers.addons, ...tiers.metered].filter((e) => e.derived === true).map((e) => e.id).sort();
  assert.deepEqual(marked, ['document-appends', 'relay-overage', 'storage']);
  const bad = structuredClone(tiers);
  bad.addons.find((a) => a.id === 'secure-links').derived = true;
  assert.throws(() => derive({ rates, model, tiers: bad }), /secure-links is marked derived but derive.mjs has no formula/);
});

test('seat floors today: Team 400, Business 700 cents per seat-month, and list prices clear them', () => {
  const { floors } = derive({ rates, model, tiers });
  assert.deepEqual(floors, { team: 400, business: 700 });
  assert.ok(floors.team <= 600 && floors.business <= 1200);
  assert.deepEqual(floorViolations(tiers, floors, model), []);
});

test('a list seat price under its floor is a violation, month and year', () => {
  const cheap = structuredClone(tiers);
  cheap.tiers[1].prices = [{ interval: 'month', unit_amount: 300 }, { interval: 'year', unit_amount: 3000 }];
  assert.deepEqual(floorViolations(cheap, { team: 400, business: 700 }, model), ['team/month 300¢ < floor 400¢', 'team/year 3000¢ < floor 4000¢']);
});

test('seat_prices: derived rewrites the seat prices to the floor; list leaves them out', () => {
  const m = structuredClone(model);
  m.seat_prices.value = 'derived';
  const d = derive({ rates, model: m, tiers }).prices;
  assert.deepEqual([d['citadel-team-month'], d['citadel-team-year'], d['citadel-business-month'], d['citadel-business-year']], [400, 4000, 700, 7000]);
  assert.equal(derive({ rates, model, tiers }).prices['citadel-team-month'], undefined);
  m.seat_prices.value = 'cheap';
  assert.throws(() => derive({ rates, model: m, tiers }), /seat_prices is list \| derived/);
});

test('storage on R2 prices the add-on at $0.50 a block', () => {
  const m = structuredClone(model);
  m.storage_backend.value = 'r2';
  const d = derive({ rates, model: m, tiers }).prices;
  assert.deepEqual([d['citadel-storage-month'], d['citadel-storage-year']], [50, 500]);
});

test('relay on the object path costs about 1.6 cents a GB x 3, so it rounds up to 2', () => {
  const m = structuredClone(model);
  m.relay_cost_path.value = 'object';
  const { prices, costs } = derive({ rates, model: m, tiers });
  assert.equal(prices['citadel-relay-overage'], 2);
  assert.ok(Math.abs(costs['citadel-relay-overage'] - 1.6071) < 1e-3);
});

test('a missing rate or model key fails, never defaults', () => {
  const r = structuredClone(rates);
  delete r.rates['cloudflare.do.sqlite_usd_per_gb_month'];
  assert.throws(() => derive({ rates: r, model, tiers }), /missing rates.json rates.cloudflare.do.sqlite_usd_per_gb_month.value/);
  for (const key of ['multiplier', 'storage_backend', 'relay_cost_path', 'object_relay_frame_bytes', 'seat_floor_relay_path', 'rows_written_per_document_append', 'rounding', 'seat_prices']) {
    const m = structuredClone(model);
    delete m[key];
    assert.throws(() => derive({ rates, model: m, tiers }), new RegExp(`missing pricing-model.json ${key}`), key);
  }
  const zero = structuredClone(rates);
  zero.rates['cloudflare.turn.usd_per_gb'].value = 0;
  assert.throws(() => derive({ rates: zero, model, tiers }), /positive number/);
});

test('rounding goes up, and float noise does not add a step', () => {
  assert.equal(ceilTo(0.05 * 3 * 100, 1), 15);
  assert.equal(ceilTo(15.01, 1), 16);
  assert.equal(ceilTo(2 * 0.1 * 10 * 3 * 100 + 1e-11, 50), 600);
  assert.equal(ceilTo(601, 50), 650);
});

test('belowCost names a price under its cost; applyDerived writes prices and refuses an unknown key', () => {
  assert.deepEqual(belowCost({ a: 1 }, { a: 0.9 }), []);
  assert.deepEqual(belowCost({ a: 0 }, { a: 0.9 }), ['a: 0¢ < cost x multiplier 0.9000¢']);
  assert.deepEqual(belowCost({ a: 21 }, { a: 0.07 * 3 * 100 }), [], 'float noise is not a shortfall');
  const out = applyDerived(tiers, { 'citadel-relay-overage': 18, 'citadel-storage-year': 7000 });
  assert.equal(sold(out)['citadel-relay-overage'], 18);
  assert.equal(sold(out)['citadel-storage-year'], 7000);
  assert.equal(sold(tiers)['citadel-relay-overage'], 15, 'the input is not mutated');
  assert.throws(() => applyDerived(tiers, { 'citadel-nothing': 1 }), /names no entry/);
});
