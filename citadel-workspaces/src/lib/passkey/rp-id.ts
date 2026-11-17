import { BRAND_NAME } from '@/components/brand/artwork/brand-rules.generated';

/**
 * The WebAuthn relying-party ID.
 *
 * Production is `work.avarok.net` for every tenant: the page origin is always
 * that host, and an RP ID must be a registrable suffix of the origin. Anywhere
 * else (localhost, a dev host) the page's own host is used, which makes dev
 * credentials a separate set by construction.
 */
export const PRODUCTION_RP_ID: 'work.avarok.net' = 'work.avarok.net';
export const RP_NAME: typeof BRAND_NAME = BRAND_NAME;

export function resolveRpId(hostname: string): string {
  const host: string = hostname.toLowerCase();
  if (host === PRODUCTION_RP_ID || host.endsWith(`.${PRODUCTION_RP_ID}`)) return PRODUCTION_RP_ID;
  return host;
}

/** WebAuthn exists here at all. Whether PRF works is only known from a ceremony. */
export function webAuthnAvailable(win: Window & { PublicKeyCredential?: unknown }): boolean {
  return win.isSecureContext && typeof win.PublicKeyCredential === 'function' && !!win.navigator.credentials;
}
