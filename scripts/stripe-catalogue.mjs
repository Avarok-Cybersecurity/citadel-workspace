#!/usr/bin/env node
/**
 * Make Stripe hold exactly the paid tiers in billing/tiers.json, or audit that it does.
 *
 *   node scripts/stripe-catalogue.mjs <key-file>            # audit (read-only; the default)
 *   node scripts/stripe-catalogue.mjs <key-file> --apply    # create or correct what differs
 *
 * The key is read from a file holding `STRIPE_SECRET_KEY=...` -- never an argument, never
 * printed. Live keys are refused unless --live is also given, so a slip of the file name
 * cannot write to live mode.
 *
 * Idempotent. Products are found by metadata.citadel_tier and updated in place. Prices are
 * found by lookup key; Stripe prices cannot be edited, so a price that differs is replaced:
 * the new one takes the lookup key (transfer_lookup_key) and the old one is archived.
 * Existing subscriptions keep the price they were created with.
 *
 * Metered products (tiers.json `metered`, e.g. relay overage) are billed through a Stripe Billing
 * Meter: the meter is found by its event name and created when missing; one it holds with other
 * settings is reported, never edited (Stripe allows almost no edits to a meter). Its price is a
 * `usage_type=metered` price on that meter, found and replaced by lookup key like any other.
 *
 * Tax (billing/pricing-model.json `tax`): every price is created with `tax.behavior`, and a price
 * holding another behaviour is replaced (Stripe never edits it). Products get `tax.product_tax_code`
 * only when it is non-null; null leaves the account preset alone.
 *
 * Last, Citadel's customer-portal configuration (wrangler.toml STRIPE_PORTAL_CONFIGURATION, never
 * the account default) is made to offer every licensed product with all its active prices.
 */
import { readFileSync } from 'node:fs';
import { deriveCatalogue, deriveMetered, meterDiffs, priceDiffs, productDiffs } from '../billing/catalogue.mjs';
import { planPriceSync } from '../billing/reconcile.mjs';
import { readKey, stripeClient } from './lib/stripe-api.mjs';
import { syncPortal } from './lib/stripe-portal-sync.mjs';

const [keyFile, ...flags] = process.argv.slice(2);
const APPLY = flags.includes('--apply');
if (!keyFile) {
  console.error('usage: stripe-catalogue.mjs <file with STRIPE_SECRET_KEY=...> [--apply] [--live]');
  process.exit(2);
}
let key;
let mode;
try {
  ({ key, mode } = readKey(keyFile, { live: flags.includes('--live') }));
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
const stripe = stripeClient(key);

const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const table = readJson('../billing/tiers.json');
const tax = readJson('../billing/pricing-model.json').tax;
if (!tax || tax.behavior === undefined || tax.product_tax_code === undefined) {
  console.error('billing/pricing-model.json needs tax.behavior and tax.product_tax_code (null is a value)');
  process.exit(2);
}
const licensed = deriveCatalogue(table);
const wanted = [...licensed, ...deriveMetered(table)];
const products = await stripe.listAll('products?active=true');
const meters = await stripe.listAll('billing/meters?status=active');
const keys = wanted.flatMap((w) => w.prices.map((p) => p.lookup_key));
const priceQuery = keys.map((k) => `lookup_keys[]=${encodeURIComponent(k)}`).join('&');
const pricesByKey = Object.fromEntries((await stripe.call('GET', `prices?${priceQuery}&limit=100`)).data.map((p) => [p.lookup_key, p]));

let drift = 0;
/** The id of the meter `w` bills through (created under --apply when missing), or null. */
async function meterFor(w) {
  let meter = meters.find((m) => m.event_name === w.meter.event_name);
  const md = meterDiffs(w.meter, meter);
  if (!md.length) {
    console.log(`ok   ${mode} meter ${w.meter.event_name} ${meter.id}`);
    return meter.id;
  }
  drift += 1;
  console.log(`DIFF ${mode} meter ${w.meter.event_name}: ${md.join(', ')}`);
  if (meter) return meter.id; // settings a script must not rewrite under live usage: the operator decides
  if (!APPLY) return null;
  meter = await stripe.call('POST', 'billing/meters', {
    display_name: w.meter.display_name,
    event_name: w.meter.event_name,
    'default_aggregation[formula]': 'sum',
    'customer_mapping[type]': 'by_id',
    'customer_mapping[event_payload_key]': 'stripe_customer_id',
    'value_settings[event_payload_key]': 'value',
  });
  console.log(`  ${meter.id} created`);
  return meter.id;
}

const productIdByTier = {};
for (const w of wanted) {
  const meterId = w.meter ? await meterFor(w) : undefined;
  let product = products.find((p) => p.metadata?.citadel_tier === w.tier);
  const pd = productDiffs(w.product, product, tax.product_tax_code);
  if (pd.length) {
    drift += 1;
    console.log(`DIFF ${mode} product ${w.tier}: ${pd.join(', ')}`);
    if (APPLY) {
      const form = {
        name: w.product.name,
        description: w.product.description,
        'metadata[citadel_tier]': w.tier,
        active: 'true',
        ...(tax.product_tax_code !== null ? { tax_code: tax.product_tax_code } : {}),
      };
      product = product ? await stripe.call('POST', `products/${product.id}`, form) : await stripe.call('POST', 'products', form);
      console.log(`  ${product.id} written`);
    }
  } else {
    console.log(`ok   ${mode} product ${w.tier} ${product.id}`);
  }
  if (product) productIdByTier[w.tier] = product.id;
  for (const p of w.prices) {
    const have = pricesByKey[p.lookup_key];
    const d = priceDiffs(p, have, product?.id, meterId, tax.behavior);
    if (!d.length) {
      console.log(`ok   ${mode} price ${p.lookup_key} ${have.id} ${p.unit_amount} ${p.currency}/${p.interval} ${have.tax_behavior}`);
      continue;
    }
    drift += 1;
    console.log(`DIFF ${mode} price ${p.lookup_key}: ${d.join(', ')}`);
    if (!APPLY || !product || meterId === null) continue;
    for (const op of planPriceSync(p, have, { productId: product.id, meterId, taxBehavior: tax.behavior })) {
      if (op.op === 'create_price') {
        console.log(`  ${(await stripe.call('POST', 'prices', op.form)).id} created`);
      } else if (op.op === 'archive_price') {
        await stripe.call('POST', `prices/${op.id}`, { active: 'false' });
        console.log(`  ${op.id} archived (existing subscriptions keep it)`);
      } else {
        throw new Error(`unknown op ${op.op}`);
      }
    }
  }
}

const portalProducts = licensed.map((w) => productIdByTier[w.tier]).filter(Boolean);
if (portalProducts.length === licensed.length) {
  drift += await syncPortal({ stripe, mode, apply: APPLY, productIds: portalProducts });
} else {
  drift += 1;
  console.log(`DIFF ${mode} portal: skipped until every licensed product exists`);
}

if (drift && !APPLY) {
  console.log(`\n${drift} difference(s). Re-run with --apply to correct them.`);
  process.exit(1);
}
console.log(APPLY ? `\napplied (${mode} mode).` : `\nStripe matches billing/tiers.json (${mode} mode).`);
