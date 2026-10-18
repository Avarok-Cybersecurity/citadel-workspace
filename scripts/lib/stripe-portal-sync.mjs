/**
 * Citadel's customer-portal configuration (deploy/tenant-worker/wrangler.toml
 * STRIPE_PORTAL_CONFIGURATION -- never the account default: the account is shared with another
 * product) must offer every licensed Citadel product with all its active licensed prices as a plan
 * change. Audits, and writes under `apply`. The decisions are billing/reconcile.mjs planPortal.
 */
import { readFileSync } from 'node:fs';
import { planPortal, portalConfigurationFrom } from '../../billing/reconcile.mjs';

const WRANGLER = new URL('../../deploy/tenant-worker/wrangler.toml', import.meta.url);

/** Returns the number of differences found (0 or 1). */
export async function syncPortal({ stripe, mode, apply, productIds }) {
  const id = portalConfigurationFrom(readFileSync(WRANGLER, 'utf8'));
  const config = await stripe.call('GET', `billing_portal/configurations/${id}?expand[]=features.subscription_update.products`);
  const products = [];
  for (const product of productIds) {
    const prices = (await stripe.listAll(`prices?product=${encodeURIComponent(product)}&active=true&type=recurring`))
      .filter((p) => p.recurring?.usage_type === 'licensed')
      .map((p) => p.id);
    products.push({ product, prices });
  }
  const { diffs, form } = planPortal(config, products);
  if (!diffs.length) {
    console.log(`ok   ${mode} portal ${id}: ${products.length} product(s) offered`);
    return 0;
  }
  console.log(`DIFF ${mode} portal ${id}: ${diffs.join(', ')}`);
  if (apply) {
    if (!form) throw new Error(`portal ${id}: not written -- a licensed product is new to it (see above)`);
    await stripe.call('POST', `billing_portal/configurations/${id}`, form);
    console.log(`  ${id} written`);
  }
  return 1;
}
