import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { couponDiffs, couponForm, deriveCoupons, staleCoupons } from './stripe-coupons.mjs';

const table = JSON.parse(readFileSync(new URL('../../billing/tiers.json', import.meta.url), 'utf8'));
const sha256Hex = async (text) => createHash('sha256').update(text).digest('hex');
const PRODUCTS = ['prod_team', 'prod_business'];

/** How Stripe would answer for a coupon created from `form`. */
const asStripeHolds = (want) => ({
  id: want.id, valid: true, max_redemptions: null, metadata: { ...want.coupon.metadata }, applies_to: { products: [...PRODUCTS].reverse() },
  percent_off: want.coupon.percent_off ?? null, amount_off: want.coupon.amount_off ?? null, currency: want.coupon.currency ?? null,
  duration: want.coupon.duration, duration_in_months: want.coupon.duration_in_months ?? null,
});

test('one Stripe coupon per discount template; trials have none', async () => {
  const wanted = await deriveCoupons(table, sha256Hex);
  assert.deepEqual(wanted.map((w) => w.template), ['pct-10-once', 'pct-20-3mo', 'usd-10-once']);
  assert.ok(wanted.every((w) => /^citadel-coupon-[a-z0-9-]+-[0-9a-f]{8}$/.test(w.id)));
  assert.deepEqual(wanted.map((w) => w.coupon.name), ['10% off', '20% off for 3 months', '$10.00 off']);
  assert.deepEqual(wanted[0].tiers, ['team', 'business']);
  // The same table derives the same ids: the Worker computes them without asking Stripe.
  assert.deepEqual((await deriveCoupons(table, sha256Hex)).map((w) => w.id), wanted.map((w) => w.id));
});

test('the create form carries the terms, our metadata and the tier products, never a Stripe-side limit', async () => {
  const [pct, repeating, amount] = await deriveCoupons(table, sha256Hex);
  assert.deepEqual(couponForm(pct, PRODUCTS), {
    id: pct.id, name: '10% off', duration: 'once', percent_off: '10', 'metadata[citadel_coupon]': 'pct-10-once',
    'applies_to[products][0]': 'prod_team', 'applies_to[products][1]': 'prod_business',
  });
  assert.equal(couponForm(repeating, PRODUCTS).duration_in_months, '3');
  assert.deepEqual([couponForm(amount, PRODUCTS).amount_off, couponForm(amount, PRODUCTS).currency], ['1000', 'usd']);
  for (const w of [pct, repeating, amount]) assert.ok(!('max_redemptions' in couponForm(w, PRODUCTS)));
});

test('a coupon Stripe holds as wanted has no differences; drift of each kind is reported', async () => {
  const [pct, , amount] = await deriveCoupons(table, sha256Hex);
  assert.deepEqual(couponDiffs(pct, asStripeHolds(pct), PRODUCTS), []);
  assert.deepEqual(couponDiffs(amount, asStripeHolds(amount), PRODUCTS), []);
  assert.deepEqual(couponDiffs(pct, undefined, PRODUCTS), ['missing']);
  assert.deepEqual(couponDiffs(pct, { ...asStripeHolds(pct), percent_off: 15 }, PRODUCTS), ['percent_off 15 ≠ 10']);
  assert.deepEqual(couponDiffs(pct, { ...asStripeHolds(pct), max_redemptions: 5 }, PRODUCTS), ['max_redemptions is set at Stripe']);
  assert.deepEqual(couponDiffs(pct, { ...asStripeHolds(pct), applies_to: { products: ['prod_team'] } }, PRODUCTS), ['applies_to products']);
  assert.deepEqual(couponDiffs(pct, { ...asStripeHolds(pct), valid: false, metadata: {} }, PRODUCTS), ['metadata.citadel_coupon', 'no longer valid']);
});

test('only our coupons for templates no longer derived are stale; nobody else\'s ever is', async () => {
  const wanted = await deriveCoupons(table, sha256Hex);
  const have = [
    { id: wanted[0].id, metadata: { citadel_coupon: 'pct-10-once' } },
    { id: 'citadel-coupon-pct-10-once-00000000', metadata: { citadel_coupon: 'pct-10-once' } },
    { id: 'citadel-coupon-old-12345678', metadata: { citadel_coupon: 'retired-template' } },
    { id: 'OTHERPRODUCT50', metadata: {} },
    { id: 'no-metadata' },
  ];
  assert.deepEqual(staleCoupons(wanted, have).map((c) => c.id), ['citadel-coupon-old-12345678']);
});
