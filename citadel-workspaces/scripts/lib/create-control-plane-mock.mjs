/**
 * The tenant control plane, as create-workspace-walkthrough.mjs answers it: the
 * agreed contract, scripted, with the Turnstile stub's tokens insisted on.
 * Moved out of the walkthrough unchanged, apart from the coupon preview route.
 */
import { couponPreview } from './coupon-walkthrough.mjs';

export function mockControlPlane() {
  const taken = new Set(['taken', 'acme']);
  const tenants = new Map();
  let codes = 0;
  return async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const slugCheck = url.pathname.match(/^\/api\/slug\/([^/]+)$/);
    if (slugCheck) {
      const slug = decodeURIComponent(slugCheck[1]);
      if (slug === 'offline') return json(503, { error: 'control plane not configured' });
      if (slug === 'www') return json(200, { available: false, reason: 'reserved' });
      return json(200, taken.has(slug) || tenants.has(slug) ? { available: false, reason: 'taken' } : { available: true });
    }
    if (url.pathname === '/api/tenants' && request.method() === 'POST') {
      const body = request.postDataJSON();
      if (!/^stub-token-\d+$/.test(body.turnstile_token ?? '')) return json(403, { error: 'Human verification failed.' });
      // A reservation left by a cancelled Checkout is the same visitor's to
      // retry (an ASSUMED contract point -- see the report); a live one is not.
      if (taken.has(body.slug) || tenants.get(body.slug)?.issued) return json(409, { error: 'That address was just taken.' });
      // The real shape: 32 random bytes as hex (control/secrets.mjs).
      const code = `${String(++codes).padStart(8, '0')}${'7c9a2e4f'.repeat(7)}`;
      tenants.set(body.slug, { ...body, code, polls: 0, issued: false });
      if (body.tier === 'free') {
        tenants.get(body.slug).issued = true;
        return json(200, { claim_code: code, workspace_host: `${body.slug}.work.avarok.net` });
      }
      return json(200, { checkout_url: `https://checkout.stripe.com/c/pay/cs_test_${body.slug}` });
    }
    if (url.pathname === '/api/coupons/preview' && request.method() === 'POST') return couponPreview(request, json);
    const status = url.pathname.match(/^\/api\/tenants\/([^/]+)\/status$/);
    if (status) {
      const tenant = tenants.get(decodeURIComponent(status[1]));
      if (!tenant) return json(404, { error: 'No workspace is being set up under that address.' });
      tenant.polls += 1;
      if (tenant.polls < 5) return json(200, { status: 'pending' });
      const reply = { status: 'active', workspace_host: `${tenant.slug}.work.avarok.net` };
      if (!tenant.issued) { tenant.issued = true; reply.claim_code = tenant.code; }
      return json(200, reply);
    }
    return json(404, { error: 'not found' });
  };
}
