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
 * Coupons (tiers.json `coupons.templates`, scripts/lib/stripe-coupons.mjs): one per discount
 * template under a content-addressed id, created when missing. A coupon's terms cannot be edited,
 * so one that differs is reported, never rewritten. A coupon of ours (metadata.citadel_coupon)
 * whose template is gone is deleted; existing discounts keep it. Nobody else's is ever touched.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { deriveCatalogue, deriveMetered, meterDiffs, priceDiffs, productDiffs } from '../billing/catalogue.mjs';
import { couponDiffs, couponForm, deriveCoupons, staleCoupons } from './lib/stripe-coupons.mjs';

const [keyFile, ...flags] = process.argv.slice(2);
const APPLY = flags.includes('--apply');
const LIVE = flags.includes('--live');
if (!keyFile) {
  console.error('usage: stripe-catalogue.mjs <file with STRIPE_SECRET_KEY=...> [--apply] [--live]');
  process.exit(2);
}
const key = (readFileSync(keyFile, 'utf8').match(/^STRIPE_SECRET_KEY=\s*(\S+)/m) ?? [])[1];
if (!key || !/^(sk|rk)_(test|live)_/.test(key)) {
  console.error(`${keyFile} holds no STRIPE_SECRET_KEY=sk_/rk_ line`);
  process.exit(2);
}
const mode = key.includes('_live_') ? 'live' : 'test';
if (mode === 'live' && !LIVE) {
  console.error('refusing a LIVE key without --live');
  process.exit(2);
}

async function stripe(method, path, form) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${body.error?.message ?? res.status}`);
  return body;
}

async function listAll(path) {
  const out = [];
  let after;
  for (;;) {
    const page = await stripe('GET', `${path}${path.includes('?') ? '&' : '?'}limit=100${after ? `&starting_after=${after}` : ''}`);
    out.push(...page.data);
    if (!page.has_more) return out;
    after = page.data.at(-1).id;
  }
}

const table = JSON.parse(readFileSync(new URL('../billing/tiers.json', import.meta.url), 'utf8'));
const wanted = [...deriveCatalogue(table), ...deriveMetered(table)];
const products = await listAll('products?active=true');
const meters = await listAll('billing/meters?status=active');
const keys = wanted.flatMap((w) => w.prices.map((p) => p.lookup_key));
const priceQuery = keys.map((k) => `lookup_keys[]=${encodeURIComponent(k)}`).join('&');
const pricesByKey = Object.fromEntries((await stripe('GET', `prices?${priceQuery}&limit=100`)).data.map((p) => [p.lookup_key, p]));

let drift = 0;
/** Each tier's product id as this run leaves it (created under --apply), for the coupons' applies_to. */
const productByTier = new Map();
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
  meter = await stripe('POST', 'billing/meters', {
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

for (const w of wanted) {
  const meterId = w.meter ? await meterFor(w) : undefined;
  let product = products.find((p) => p.metadata?.citadel_tier === w.tier);
  const pd = productDiffs(w.product, product);
  if (pd.length) {
    drift += 1;
    console.log(`DIFF ${mode} product ${w.tier}: ${pd.join(', ')}`);
    if (APPLY) {
      const form = { name: w.product.name, description: w.product.description, 'metadata[citadel_tier]': w.tier, active: 'true' };
      product = product ? await stripe('POST', `products/${product.id}`, form) : await stripe('POST', 'products', form);
      console.log(`  ${product.id} written`);
    }
  } else {
    console.log(`ok   ${mode} product ${w.tier} ${product.id}`);
  }
  productByTier.set(w.tier, product?.id);
  for (const p of w.prices) {
    const have = pricesByKey[p.lookup_key];
    const d = priceDiffs(p, have, product?.id, meterId);
    if (!d.length) {
      console.log(`ok   ${mode} price ${p.lookup_key} ${have.id} ${p.unit_amount} ${p.currency}/${p.interval}`);
      continue;
    }
    drift += 1;
    console.log(`DIFF ${mode} price ${p.lookup_key}: ${d.join(', ')}`);
    if (APPLY && product && meterId !== null) {
      const created = await stripe('POST', 'prices', {
        ...(meterId ? { 'recurring[meter]': meterId } : {}),
        product: product.id,
        currency: p.currency,
        unit_amount: String(p.unit_amount),
        'recurring[interval]': p.interval,
        'recurring[usage_type]': p.usage_type,
        lookup_key: p.lookup_key,
        transfer_lookup_key: 'true',
        'metadata[citadel_tier]': p.metadata.citadel_tier,
      });
      console.log(`  ${created.id} created`);
      if (have && have.active) {
        await stripe('POST', `prices/${have.id}`, { active: 'false' });
        console.log(`  ${have.id} archived (existing subscriptions keep it)`);
      }
    }
  }
}

const wantedCoupons = await deriveCoupons(table, async (text) => createHash('sha256').update(text).digest('hex'));
const coupons = await listAll('coupons?expand[]=data.applies_to');
for (const w of wantedCoupons) {
  const productIds = w.tiers.map((t) => productByTier.get(t));
  if (productIds.some((id) => !id)) {
    drift += 1;
    console.log(`DIFF ${mode} coupon ${w.id}: a tier it discounts has no product yet`);
    continue;
  }
  const have = coupons.find((c) => c.id === w.id);
  const d = couponDiffs(w, have, productIds);
  if (!d.length) {
    console.log(`ok   ${mode} coupon ${w.id}`);
    continue;
  }
  drift += 1;
  console.log(`DIFF ${mode} coupon ${w.id}: ${d.join(', ')}`);
  if (APPLY && !have) {
    await stripe('POST', 'coupons', couponForm(w, productIds));
    console.log(`  ${w.id} created`);
  }
}
for (const c of staleCoupons(wantedCoupons, coupons)) {
  drift += 1;
  console.log(`DIFF ${mode} coupon ${c.id}: its template ${c.metadata.citadel_coupon} is no longer in tiers.json`);
  if (APPLY) {
    await stripe('DELETE', `coupons/${encodeURIComponent(c.id)}`);
    console.log(`  ${c.id} deleted (existing discounts keep it)`);
  }
}

if (drift && !APPLY) {
  console.log(`\n${drift} difference(s). Re-run with --apply to correct them.`);
  process.exit(1);
}
console.log(APPLY ? `\napplied (${mode} mode).` : `\nStripe matches billing/tiers.json (${mode} mode).`);
