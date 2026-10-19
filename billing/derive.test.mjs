import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { amountsOf, applyDerived, belowCost, ceilTo, derive, driftOf, floorViolations } from './derive.mjs';
import { approvalOf, stripeWriteRefusal } from './approval.mjs';

const load = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
const rates = load('./rates.json');
const model = load('./pricing-model.json');
const tiers = load('./tiers.json');
const sold = amountsOf;
const approve = (m) => ({ ...structuredClone(m), approval: { ...m.approval, status: 'approved', approved_on: '2026-10-19', approved_by: 'Owner' } });
const APPROVED_SOLD = { 'citadel-storage-month': 200, 'citadel-storage-year': 2000, 'citadel-relay-overage': 10, 'citadel-document-appends': 1 };

test('today the proposals are storage 600/6000, relay 15, appends 1, seats 2/5 GB, floors 400/700', () => {
  const d = derive({ rates, model, tiers });
  assert.equal(d.approval, 'proposed');
  assert.deepEqual(d.proposed, {
    'citadel-storage-month': 600,
    'citadel-storage-year': 6000,
    'citadel-relay-overage': 15,
    'citadel-document-appends': 1,
  });
  assert.deepEqual([d.grants, d.floors], [{ team: 2, business: 5 }, { team: 400, business: 700 }]);
});

/** Asserts tiers.json holds only what the gate allows under `m`; returns the drift. */
function gate(m, table) {
  const drift = driftOf({ rates, model: m, tiers: table });
  if (approvalOf(m) === 'approved') {
    assert.deepEqual(drift, [], 'approved: tiers.json must equal the derivation; run scripts/rates/update-rates.mjs');
  } else {
    const have = sold(table);
    for (const [key, cents] of Object.entries(APPROVED_SOLD)) assert.equal(have[key], cents, `proposed: ${key} must stay ${cents}, the approved price, not ${have[key]}`);
    assert.deepEqual(table.tiers.map((t) => t.limits.storage_gb_per_seat), [undefined, 10, 25], 'proposed: the approved 10/25 GB grants stay');
  }
  return drift;
}

test('GATE (proposed, today): nobody wrote the proposals into the sold table', () => {
  assert.deepEqual(gate(model, tiers), [
    { key: 'citadel-storage-month', tiers: 200, derived: 600 },
    { key: 'citadel-storage-year', tiers: 2000, derived: 6000 },
    { key: 'citadel-relay-overage', tiers: 10, derived: 15 },
    { key: 'team limits.storage_gb_per_seat', tiers: 10, derived: 2 },
    { key: 'business limits.storage_gb_per_seat', tiers: 25, derived: 5 },
  ]);
});

test('GATE negative control: a tiers.json carrying the proposed 600 under status proposed fails', () => {
  const leaked = structuredClone(tiers);
  leaked.addons.find((a) => a.id === 'storage').prices[0].unit_amount = 600;
  assert.throws(() => gate(model, leaked), /citadel-storage-month must stay 200/);
});

test('GATE (approved): drift is empty once the derived figures are written in, and not before', () => {
  const m = approve(model);
  const written = applyDerived(tiers, derive({ rates, model: m, tiers }));
  assert.deepEqual(gate(m, written), []);
  assert.throws(() => gate(m, tiers), /approved: tiers.json must equal/);
});

test('DRIFT: a mutated rate is a drift', () => {
  const moved = structuredClone(rates);
  moved.rates['cloudflare.turn.usd_per_gb'].value = 0.06;
  const m = approve(model);
  const written = applyDerived(tiers, derive({ rates, model: m, tiers }));
  assert.deepEqual(driftOf({ rates: moved, model: m, tiers: written }), [{ key: 'citadel-relay-overage', tiers: 15, derived: 18 }]);
});

test('approval: status is exactly proposed | approved, every key present, no defaults', () => {
  assert.equal(approvalOf(model), 'proposed');
  assert.equal(approvalOf(approve(model)), 'approved');
  const bad = (edit, base = model) => { const m = structuredClone(base); edit(m); return m; };
  assert.throws(() => approvalOf(bad((m) => { delete m.approval; })), /missing pricing-model.json approval/);
  assert.throws(() => derive({ rates, model: bad((m) => { delete m.approval; }), tiers }), /missing pricing-model.json approval/);
  for (const s of ['Approved', 'yes', undefined, true]) assert.throws(() => approvalOf(bad((m) => { m.approval.status = s; })), /approval.status is proposed \| approved/);
  assert.throws(() => approvalOf(bad((m) => { delete m.approval.approved_by; })), /missing pricing-model.json approval.approved_by/);
  assert.throws(() => approvalOf(bad((m) => { m.approval.status = 'approved'; })), /approved_on is the approval date/);
  assert.throws(() => approvalOf(bad((m) => { m.approval.approved_by = ' '; }, approve(model))), /approved_by names who approved/);
  assert.throws(() => approvalOf(bad((m) => { m.approval.approved_by = 'Owner'; })), /a proposed model has approved_on and approved_by null/);
});

test('a Stripe write is refused while proposed and allowed once approved', () => {
  assert.match(stripeWriteRefusal(model), /refusing to write to Stripe: .*approval.status is "proposed"/);
  assert.equal(stripeWriteRefusal(approve(model)), null);
});

test('the derived entries are exactly the ones tiers.json marks derived', () => {
  const marked = [...tiers.addons, ...tiers.metered].filter((e) => e.derived === true).map((e) => e.id).sort();
  assert.deepEqual(marked, ['document-appends', 'relay-overage', 'storage']);
  const bad = structuredClone(tiers);
  bad.addons.find((a) => a.id === 'secure-links').derived = true;
  assert.throws(() => derive({ rates, model, tiers: bad }), /secure-links is marked derived but derive.mjs has no formula/);
});

test('seat floors today: Team 400, Business 700 cents per seat-month, and list prices clear them', () => {
  const d = derive({ rates, model, tiers });
  assert.deepEqual(d.floors, { team: 400, business: 700 });
  assert.ok(d.floors.team <= 600 && d.floors.business <= 1200);
  assert.deepEqual(floorViolations(applyDerived(tiers, d), d.floors, model), []);
});

test('a list seat price under its floor is a violation, month and year', () => {
  const cheap = structuredClone(tiers);
  cheap.tiers[1].prices = [{ interval: 'month', unit_amount: 300 }, { interval: 'year', unit_amount: 3000 }];
  assert.deepEqual(floorViolations(cheap, { team: 400, business: 700 }, model), ['team/month 300¢ < floor 400¢', 'team/year 3000¢ < floor 4000¢']);
});

test('seat_prices: derived rewrites the seat prices to the floor; list leaves them out', () => {
  const m = structuredClone(model);
  m.seat_prices.value = 'derived';
  const d = derive({ rates, model: m, tiers }).proposed;
  assert.deepEqual([d['citadel-team-month'], d['citadel-team-year'], d['citadel-business-month'], d['citadel-business-year']], [400, 4000, 700, 7000]);
  assert.equal(derive({ rates, model, tiers }).proposed['citadel-team-month'], undefined);
  m.seat_prices.value = 'cheap';
  assert.throws(() => derive({ rates, model: m, tiers }), /seat_prices is list \| derived/);
});

test('storage on R2 prices the add-on at $0.50 a block', () => {
  const m = structuredClone(model);
  m.storage_backend.value = 'r2';
  const d = derive({ rates, model: m, tiers }).proposed;
  assert.deepEqual([d['citadel-storage-month'], d['citadel-storage-year']], [50, 500]);
});

test('relay on the object path costs about 1.6 cents a GB x 3, so it rounds up to 2', () => {
  const m = structuredClone(model);
  m.relay_cost_path.value = 'object';
  const { proposed: prices, costs } = derive({ rates, model: m, tiers });
  assert.equal(prices['citadel-relay-overage'], 2);
  assert.ok(Math.abs(costs['citadel-relay-overage'] - 1.6071) < 1e-3);
});

test('a missing rate or model key fails, never defaults', () => {
  const r = structuredClone(rates);
  delete r.rates['cloudflare.do.sqlite_usd_per_gb_month'];
  assert.throws(() => derive({ rates: r, model, tiers }), /missing rates.json rates.cloudflare.do.sqlite_usd_per_gb_month.value/);
  for (const key of ['approval', 'multiplier', 'storage_backend', 'relay_cost_path', 'object_relay_frame_bytes', 'seat_floor_relay_path', 'seat_storage_gb', 'rows_written_per_document_append', 'rounding', 'seat_prices']) {
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
  const out = applyDerived(tiers, { proposed: { 'citadel-relay-overage': 18, 'citadel-storage-year': 7000 }, grants: { team: 3 } });
  assert.equal(sold(out)['citadel-relay-overage'], 18);
  assert.equal(sold(out)['citadel-storage-year'], 7000);
  assert.equal(out.tiers[1].limits.storage_gb_per_seat, 3);
  assert.equal(sold(tiers)['citadel-relay-overage'], 10, 'the input is not mutated');
  assert.throws(() => applyDerived(tiers, { proposed: { 'citadel-nothing': 1 }, grants: {} }), /names no entry/);
  assert.throws(() => applyDerived(tiers, { proposed: {}, grants: { enterprise: 1 } }), /names no tier/);
  assert.throws(() => applyDerived(tiers, { 'citadel-relay-overage': 18 }), /needs \{ proposed, grants \}/);
});
