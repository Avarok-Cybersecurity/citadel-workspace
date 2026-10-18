/**
 * The Stripe REST port scripts/stripe-catalogue.mjs writes through: a key read from a file (never
 * an argument, never printed), and form-encoded calls bounded by a timeout.
 */
import { readFileSync } from 'node:fs';

/** One Stripe call may take this long before it is abandoned; observed calls take < 2 s. */
const CALL_TIMEOUT_MS = 30_000;

/** The key in `keyFile` (a `STRIPE_SECRET_KEY=...` line) and its mode; refuses live without `live`. */
export function readKey(keyFile, { live }) {
  const key = (readFileSync(keyFile, 'utf8').match(/^STRIPE_SECRET_KEY=\s*(\S+)/m) ?? [])[1];
  if (!key || !/^(sk|rk)_(test|live)_/.test(key)) throw new Error(`${keyFile} holds no STRIPE_SECRET_KEY=sk_/rk_ line`);
  const mode = key.includes('_live_') ? 'live' : 'test';
  if (mode === 'live' && live !== true) throw new Error('refusing a LIVE key without --live');
  return { key, mode };
}

export function stripeClient(key) {
  async function call(method, path, form) {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, {
      method,
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
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
      const page = await call('GET', `${path}${path.includes('?') ? '&' : '?'}limit=100${after ? `&starting_after=${after}` : ''}`);
      out.push(...page.data);
      if (!page.has_more) return out;
      after = page.data.at(-1).id;
    }
  }
  return { call, listAll };
}
