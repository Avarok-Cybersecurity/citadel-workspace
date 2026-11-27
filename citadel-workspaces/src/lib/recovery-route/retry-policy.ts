/**
 * How an automatic retry spaces its attempts. When the delays run out the surface offers the
 * route's `then`; nothing retries forever.
 */
import type { BackoffPolicyId } from './route';

export const RETRY_DELAYS_MS: { readonly [K in BackoffPolicyId]: readonly number[] } = {
  short: [2_000, 5_000, 10_000],
  server: [2_000, 5_000, 10_000, 30_000, 60_000],
};
