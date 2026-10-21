import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalJson, checkCoupon, couponCatalogue, stripeCouponId } from './coupons-catalogue.mjs';

const table = JSON.parse(readFileSync(new URL('./tiers.json', import.meta.url), 'utf8'));
const sha256Hex = async (text) => createHash('sha256').update(text).digest('hex');
/** `table` with `edit` applied to a deep copy of its coupons block. */
const withCoupons = (edit) => {
  const copy = structuredClone(table);
  edit(copy.coupons);
  return copy;
};
const template = (coupons, id) => coupons.templates.find((t) => t.id === id);

test('the approved coupons block loads, one static code in the shape a dynamic one has', () => {
  const cat = couponCatalogue(table);
  assert.deepEqual([...cat.templates.keys()], ['pct-10-once', 'pct-20-3mo', 'usd-10-once', 'trial-14']);
  assert.deepEqual([...cat.grants.keys()], ['design-partner', 'owner-internal']);
  assert.deepEqual(cat.statics, [{
    code: 'LAUNCH10', template: 'pct-10-once', grant_id: null, available_on: ['team', 'business'], intervals: ['month', 'year'],
    max_redemptions: 500, redeem_by_ms: Date.parse('2026-12-31T23:59:59Z'),
  }]);
  assert.deepEqual(cat.paidTiers, ['team', 'business']);
});

test('Stripe coupon ids are content-addressed and stable', async () => {
  const cat = couponCatalogue(table);
  const t = cat.templates.get('pct-10-once');
  const id = await stripeCouponId(t, sha256Hex);
  assert.match(id, /^citadel-coupon-pct-10-once-[0-9a-f]{8}$/);
  assert.equal(await stripeCouponId(structuredClone(t), sha256Hex), id);
  // Key order and comments do not move it; content does.
  const reordered = { intervals: t.intervals, duration: t.duration, discount: { percent_off: 10, kind: 'percent' }, id: t.id, $comment: 'x' };
  assert.equal(await stripeCouponId(reordered, sha256Hex), id);
  assert.notEqual(await stripeCouponId({ ...t, discount: { kind: 'percent', percent_off: 11 } }, sha256Hex), id);
  assert.equal(canonicalJson({ b: [1, { d: 1, c: 2 }], a: null }), '{"a":null,"b":[1,{"c":2,"d":1}]}');
});

test('every malformed template is refused at load', () => {
  const cases = [
    [(c) => { template(c, 'pct-10-once').discount.percent_off = 0; }, /percent_off/],
    [(c) => { template(c, 'pct-10-once').discount.percent_off = 101; }, /percent_off/],
    [(c) => { template(c, 'pct-10-once').discount.percent_off = 9.5; }, /percent_off/],
    [(c) => { template(c, 'usd-10-once').discount.amount_off = 10001; }, /amount_off/],
    [(c) => { template(c, 'usd-10-once').discount.amount_off = 0; }, /amount_off/],
    [(c) => { template(c, 'trial-14').trial_days = 31; }, /trial_days/],
    [(c) => { c.trial_caps.max_days = 31; }, /max_days/],
    [(c) => { template(c, 'pct-20-3mo').intervals = ['month', 'year']; }, /repeating discount is for intervals \["month"\] only/],
    [(c) => { template(c, 'pct-20-3mo').intervals = ['year']; }, /repeating/],
    [(c) => { delete template(c, 'pct-20-3mo').months; }, /months/],
    [(c) => { template(c, 'pct-10-once').months = 2; }, /once discount has no months/],
    [(c) => { template(c, 'pct-10-once').duration = 'forever'; }, /duration/],
    [(c) => { template(c, 'pct-10-once').discount.kind = 'bogo'; }, /discount.kind/],
    [(c) => { template(c, 'pct-10-once').intervals = ['week']; }, /intervals/],
    [(c) => { template(c, 'pct-10-once').stackable = true; }, /unknown fields: stackable/],
    [(c) => { c.templates.push(structuredClone(c.templates[0])); }, /duplicate coupon template/],
  ];
  for (const [edit, why] of cases) assert.throws(() => couponCatalogue(withCoupons(edit)), why);
  // The control: the file as approved, and a valid template beside it, load.
  assert.doesNotThrow(() => couponCatalogue(withCoupons((c) => {
    c.templates.push({ id: 'pct-15-6mo', discount: { kind: 'percent', percent_off: 15 }, duration: 'repeating', months: 6, intervals: ['month'] });
  })));
});

test('a static code may never name an unlimited grant', () => {
  const naming = (grantId) => withCoupons((c) => {
    c.static.push({ code: 'PARTNER1', grant_id: grantId, available_on: ['business'], intervals: ['month'], max_redemptions: 1, redeem_by: '2026-11-30T00:00:00Z' });
  });
  assert.throws(() => couponCatalogue(naming('design-partner')), /static code may not name the unlimited grant design-partner/);
  // The control: the same entry naming a grant that is not unlimited loads.
  const capped = naming('capped');
  capped.coupons.grants.push({
    id: 'capped', tier_as: 'team', seats: 5, storage_gb: 50, unmetered_relay: false, unlimited: false,
    alarm: { relay_gb_per_period: null, storage_gb: null, members: null },
  });
  assert.equal(couponCatalogue(capped).statics.at(-1).grant_id, 'capped');
});

test('malformed grants and static codes are refused at load', () => {
  const grant = (c) => c.grants[0];
  const cases = [
    [(c) => { grant(c).tier_as = 'free'; }, /tier_as is a paid tier/],
    [(c) => { grant(c).seats = 1001; }, /seats/],
    [(c) => { grant(c).storage_gb = 25 * 25 + 1; }, /storage_gb/],
    [(c) => { grant(c).unmetered_relay = false; }, /unlimited grant's relay is unmetered/],
    [(c) => { delete grant(c).unlimited; }, /lacks unlimited/],
    [(c) => { delete grant(c).alarm.members; }, /alarm lacks members/],
    [(c) => { grant(c).alarm.storage_gb = 0; }, /alarm.storage_gb/],
    [(c) => { c.static.push(structuredClone(c.static[0])); }, /duplicate static coupon LAUNCH10/],
    [(c) => { c.static[0].code = 'launch10'; }, /code_shape/],
    [(c) => { c.static[0].available_on = ['free']; }, /available_on names free/],
    [(c) => { c.static[0].available_on = []; }, /available_on is a non-empty list/],
    [(c) => { c.static[0].template = 'no-such'; }, /no template no-such/],
    [(c) => { c.static[0].grant_id = 'design-partner'; }, /exactly one of template and grant_id/],
    [(c) => { c.static[0].max_redemptions = 0; }, /max_redemptions/],
    [(c) => { delete c.static[0].max_redemptions; }, /lacks max_redemptions/],
    [(c) => { c.static[0].redeem_by = 'soon'; }, /redeem_by/],
    [(c) => { c.static[0].template = 'pct-20-3mo'; }, /intervals names year/],
    [(c) => { c.code_shape = '[A-Z]+'; }, /anchored/],
    [(c) => { delete c.flat_max_cents; }, /lacks flat_max_cents/],
  ];
  for (const [edit, why] of cases) assert.throws(() => couponCatalogue(withCoupons(edit)), why);
});

test('a dynamic code for an unlimited grant needs an expiry; any other may have none', () => {
  const cat = couponCatalogue(table);
  const dynamic = { code: 'PARTNER-ACME', template: null, grant_id: 'design-partner', available_on: ['business'], intervals: ['month'], max_redemptions: 1, redeem_by_ms: null };
  assert.throws(() => checkCoupon(dynamic, cat, { allowUnlimited: true }), /needs redeem_by_ms/);
  assert.doesNotThrow(() => checkCoupon({ ...dynamic, redeem_by_ms: Date.parse('2026-11-30T00:00:00Z') }, cat, { allowUnlimited: true }));
  assert.doesNotThrow(() => checkCoupon({ ...dynamic, template: 'trial-14', grant_id: null }, cat, { allowUnlimited: true }));
});
