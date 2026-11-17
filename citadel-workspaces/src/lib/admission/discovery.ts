/**
 * Whether this workspace asks for a human check (Cloudflare Turnstile) before
 * sign-in and registration, asked of the control plane before the form is used.
 *
 * Discovery FAILS OPEN: no control plane here, an unreachable one or an answer
 * that does not parse all mean "unknown", and the form is shown as usual. The
 * server is what enforces it and fails CLOSED: an `admission_required` refusal
 * reveals the check (refusal.ts). So a broken discovery costs one extra
 * attempt, never a locked-out workspace and never a skipped check.
 */
import type { FetchLike } from '@/lib/onboarding/control-plane-client';

/**
 * Public. `<path>/<slug>` answers for that hosted workspace; `<path>` alone, for
 * a form that cannot know its workspace yet (sign-in names an account, and the
 * agent knows its server), gives the site key and says nothing is known to be
 * required -- the server's `admission_required` refusal then shows the check.
 */
export const ADMISSION_PATH: '/admission' = '/admission';

export interface Admission {
  required: boolean;
  /** Public by design: Turnstile site keys are sent to every visitor. */
  siteKey: string;
}

/** The answer, or null when it is malformed: nothing in it is trusted half-parsed. */
export function parseAdmission(body: unknown): Admission | null {
  if (!body || typeof body !== 'object') return null;
  const turnstile: unknown = (body as Record<string, unknown>).turnstile;
  if (!turnstile || typeof turnstile !== 'object') return null;
  const { required, siteKey } = turnstile as Record<string, unknown>;
  if (typeof required !== 'boolean' || typeof siteKey !== 'string') return null;
  if (required && siteKey.trim().length === 0) return null;
  return { required, siteKey: siteKey.trim() };
}

/** Where to ask: the workspace's own answer when its slug is known, else the control plane's. */
export const admissionUrl = (base: string, slug: string | undefined): string =>
  slug === undefined ? `${base}${ADMISSION_PATH}` : `${base}${ADMISSION_PATH}/${encodeURIComponent(slug)}`;

/** Null when unknown: no control plane, no answer, or an answer that does not parse. */
export async function discoverAdmission(fetchFn: FetchLike, base: string | undefined, slug: string | undefined): Promise<Admission | null> {
  if (base === undefined) return null;
  try {
    const response: Response = await fetchFn(admissionUrl(base, slug), { method: 'GET', headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    return parseAdmission(await response.json());
  } catch {
    // Fail open, on purpose: see the header. The server still refuses without a check.
    return null;
  }
}

