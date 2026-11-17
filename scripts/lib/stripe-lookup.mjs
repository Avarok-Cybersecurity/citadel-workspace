/**
 * Stripe's `GET /v1/prices` accepts at most this many `lookup_keys[]` per
 * request, and refuses the whole request beyond it ("Array lookup_keys exceeded
 * maximum 10 allowed elements"). The catalogue outgrew it at twelve keys and the
 * read-only catalogue check stopped every site deploy.
 */
export const STRIPE_MAX_LOOKUP_KEYS = 10;

/**
 * The `prices?...` paths that together look up every key, each within Stripe's
 * limit. Each page holds at most `STRIPE_MAX_LOOKUP_KEYS` prices (one per key),
 * so `limit=100` never truncates one.
 *
 * @param {readonly string[]} keys
 * @returns {string[]}
 */
export function priceLookupPaths(keys) {
  const paths = [];
  for (let i = 0; i < keys.length; i += STRIPE_MAX_LOOKUP_KEYS) {
    const query = keys
      .slice(i, i + STRIPE_MAX_LOOKUP_KEYS)
      .map((k) => `lookup_keys[]=${encodeURIComponent(k)}`)
      .join('&');
    paths.push(`prices?${query}&limit=100`);
  }
  return paths;
}
