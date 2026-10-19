import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planPortal, planPriceSync, portalConfigurationFrom } from './reconcile.mjs';
import { deriveCatalogue, deriveMetered } from './catalogue.mjs';

const table = JSON.parse(readFileSync(new URL('./tiers.json', import.meta.url), 'utf8'));
const seat = deriveCatalogue(table)[0].prices[0];
const relay = deriveMetered(table)[0].prices[0];
const held = { id: 'price_old', active: true, unit_amount: 600, currency: 'usd', product: 'prod_1', recurring: { interval: 'month', usage_type: 'licensed' }, metadata: { citadel_tier: 'team' }, tax_behavior: 'exclusive' };
const ctx = { productId: 'prod_1', meterId: undefined, taxBehavior: 'exclusive' };

test('a price Stripe holds as wanted needs no ops', () => {
  assert.deepEqual(planPriceSync(seat, held, ctx), []);
});

test('a changed amount creates the new price with the key and archives the old one', () => {
  assert.deepEqual(planPriceSync(seat, { ...held, unit_amount: 500 }, ctx), [
    {
      op: 'create_price',
      form: {
        product: 'prod_1', currency: 'usd', unit_amount: '600', 'recurring[interval]': 'month', 'recurring[usage_type]': 'licensed',
        lookup_key: 'citadel-team-month', transfer_lookup_key: 'true', tax_behavior: 'exclusive', 'metadata[citadel_tier]': 'team',
      },
    },
    { op: 'archive_price', id: 'price_old' },
  ]);
});

test('a price with no tax behaviour is replaced, since Stripe never edits it', () => {
  const ops = planPriceSync(seat, { ...held, tax_behavior: 'unspecified' }, ctx);
  assert.deepEqual(ops.map((o) => o.op), ['create_price', 'archive_price']);
  assert.equal(ops[0].form.tax_behavior, 'exclusive');
});

test('a missing price is created; an archived one is not archived again', () => {
  assert.deepEqual(planPriceSync(seat, undefined, ctx).map((o) => o.op), ['create_price']);
  assert.deepEqual(planPriceSync(seat, { ...held, active: false }, ctx).map((o) => o.op), ['create_price']);
});

test('a metered price is created on its meter, and needs one', () => {
  const [create] = planPriceSync(relay, undefined, { productId: 'prod_r', meterId: 'mtr_1', taxBehavior: 'exclusive' });
  assert.equal(create.form['recurring[meter]'], 'mtr_1');
  assert.equal(create.form['recurring[usage_type]'], 'metered');
  assert.equal('recurring[meter]' in planPriceSync(seat, undefined, ctx)[0].form, false);
  assert.throws(() => planPriceSync(relay, undefined, { productId: 'prod_r', meterId: null, taxBehavior: 'exclusive' }), /needs meterId/);
  assert.throws(() => planPriceSync(seat, held, { ...ctx, productId: undefined }), /productId is required/);
  assert.throws(() => planPriceSync(seat, held, { ...ctx, taxBehavior: undefined }), /needs taxBehavior/);
});

test('the portal configuration comes from exactly one wrangler.toml line', () => {
  assert.equal(portalConfigurationFrom('A = "x"\nSTRIPE_PORTAL_CONFIGURATION = "bpc_1Abc"\n'), 'bpc_1Abc');
  assert.throws(() => portalConfigurationFrom('A = "x"\n'), /0 times/);
  assert.throws(() => portalConfigurationFrom('STRIPE_PORTAL_CONFIGURATION = "bpc_1"\n[env.x]\nSTRIPE_PORTAL_CONFIGURATION = "bpc_2"\n'), /2 times/);
  assert.throws(() => portalConfigurationFrom('STRIPE_PORTAL_CONFIGURATION = ""\n'), /not a bpc_ id/);
  const real = readFileSync(new URL('../deploy/tenant-worker/wrangler.toml', import.meta.url), 'utf8');
  assert.match(portalConfigurationFrom(real), /^bpc_/);
});

const products = [{ product: 'prod_t', prices: ['price_tm', 'price_ty'] }, { product: 'prod_s', prices: ['price_sm'] }];
const seats = { enabled: true, minimum: 1, maximum: null };
const packs = { enabled: true, minimum: 1, maximum: 1000 };
const portal = (listed) => ({ id: 'bpc_1', is_default: false, features: { subscription_update: { products: listed } } });

test('a portal offering every licensed product and price has no diffs; the form lists them all with their quantity limits', () => {
  const config = portal([{ product: 'prod_s', prices: ['price_sm'], adjustable_quantity: packs }, { product: 'prod_t', prices: ['price_ty', 'price_tm'], adjustable_quantity: seats }]);
  const { diffs, form } = planPortal(config, products);
  assert.deepEqual(diffs, []);
  assert.deepEqual(form, {
    'features[subscription_update][products][0][product]': 'prod_t',
    'features[subscription_update][products][0][prices][0]': 'price_tm',
    'features[subscription_update][products][0][prices][1]': 'price_ty',
    'features[subscription_update][products][0][adjustable_quantity][enabled]': 'true',
    'features[subscription_update][products][0][adjustable_quantity][minimum]': '1',
    'features[subscription_update][products][1][product]': 'prod_s',
    'features[subscription_update][products][1][prices][0]': 'price_sm',
    'features[subscription_update][products][1][adjustable_quantity][enabled]': 'true',
    'features[subscription_update][products][1][adjustable_quantity][minimum]': '1',
    'features[subscription_update][products][1][adjustable_quantity][maximum]': '1000',
  });
});

test('a stale price and a foreign product are reported, and the form drops the foreign one', () => {
  const config = portal([{ product: 'prod_t', prices: ['price_old'], adjustable_quantity: seats }, { product: 'prod_s', prices: ['price_sm'], adjustable_quantity: packs }, { product: 'prod_x', prices: ['price_x'], adjustable_quantity: seats }]);
  const { diffs, form } = planPortal(config, products);
  assert.deepEqual(diffs, ['prod_t prices price_old ≠ price_tm,price_ty', 'prod_x not a licensed Citadel product']);
  assert.ok(!Object.values(form).includes('prod_x'));
});

test('a product new to the portal is reported and nothing is written: its limits are not guessed', () => {
  const { diffs, form } = planPortal(portal([{ product: 'prod_t', prices: ['price_tm', 'price_ty'], adjustable_quantity: seats }]), products);
  assert.deepEqual(diffs, ['prod_s missing (add it once in the Dashboard with its quantity limits)']);
  assert.equal(form, null);
});

test('the account default portal is refused, as is an unexpanded list or a product with no price', () => {
  assert.throws(() => planPortal({ id: 'bpc_d', is_default: true, features: {} }, products), /account default portal/);
  assert.throws(() => planPortal({ id: 'bpc_1', is_default: false, features: { subscription_update: {} } }, products), /expand/);
  assert.throws(() => planPortal(portal([]), [{ product: 'prod_t', prices: [] }]), /no active price/);
});

test('the portal sync never writes while the pricing model is proposed, and reaches Stripe once approved', async () => {
  const { syncPortal } = await import('../scripts/lib/stripe-portal-sync.mjs');
  const model = JSON.parse(readFileSync(new URL('./pricing-model.json', import.meta.url), 'utf8'));
  // An in-memory port standing in for the Stripe API: it records that it was reached and stops.
  const calls = [];
  const stripe = { call: async (method, path) => { calls.push([method, path]); throw new Error('reached stripe'); } };
  await assert.rejects(syncPortal({ stripe, mode: 'test', apply: true, model, productIds: [] }), /portal: refusing to write to Stripe/);
  assert.deepEqual(calls, []);
  const approved = { ...model, approval: { status: 'approved', approved_on: '2026-10-19', approved_by: 'Owner' } };
  await assert.rejects(syncPortal({ stripe, mode: 'test', apply: true, model: approved, productIds: [] }), /reached stripe/);
  await assert.rejects(syncPortal({ stripe, mode: 'test', apply: false, model, productIds: [] }), /reached stripe/, 'the audit runs while proposed');
  await assert.rejects(syncPortal({ stripe, mode: 'test', model, productIds: [] }), /needs apply/);
});
