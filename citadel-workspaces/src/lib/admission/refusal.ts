/**
 * The server's two admission refusals, carried as `reason_code` on a
 * ConnectFailure or RegisterFailure.
 *
 * - `admission_required`: this workspace needs a human check and none came.
 * - `admission_failed`: a check came and did not verify (failed, expired, or a
 *   token already spent: each one is single-use).
 */
import type { FailureReason } from 'citadel-workspace-client-ts';

/** The generated `FailureReason`'s admission codes (agent #112); its others are not about the check. */
export type AdmissionReason = Extract<FailureReason, 'admission_required' | 'admission_failed'>;

const REASONS: ReadonlySet<string> = new Set<string>(['admission_required', 'admission_failed'] satisfies AdmissionReason[]);

export function admissionReasonOf(payload: Record<string, unknown> | undefined): AdmissionReason | null {
  const code: unknown = payload?.reason_code;
  return typeof code === 'string' && REASONS.has(code) ? (code as AdmissionReason) : null;
}

/**
 * The check an `admission_required` refusal publishes (agent `admission_challenge`): how a
 * server reached only through the agent -- a self-hosted one, with no HTTP discovery -- says
 * which widget to render. Public: a site key every visitor is sent, and the value the token is
 * bound to (Turnstile's cData).
 */
export interface AdmissionChallenge {
  siteKey: string;
  /** The cData to render the widget with; null when the server binds the token to nothing. */
  identity: string | null;
}

/** What Turnstile accepts for a site key and a cData: 1 to 255 of A-Z a-z 0-9 _ -. */
const TURNSTILE_VALUE: RegExp = /^[A-Za-z0-9_-]{1,255}$/;

/**
 * The challenge on a ConnectFailure / RegisterFailure, or null. Strict: an unknown provider, a
 * malformed site key or identity, or anything else unexpected is no challenge at all, and the
 * form falls back to discovery and the generic "check required" message. Absent arrives as
 * undefined from the WASM client (serde-wasm-bindgen) and as null from JSON; both are none.
 */
export function admissionChallengeOf(payload: Record<string, unknown> | undefined): AdmissionChallenge | null {
  const raw: unknown = payload?.admission_challenge;
  if (raw === null || typeof raw !== 'object') return null;
  const { provider, site_key: siteKey, identity } = raw as Record<string, unknown>;
  if (provider !== 'turnstile' || typeof siteKey !== 'string' || !TURNSTILE_VALUE.test(siteKey)) return null;
  if (identity === undefined || identity === null) return { siteKey, identity: null };
  return typeof identity === 'string' && TURNSTILE_VALUE.test(identity) ? { siteKey, identity } : null;
}

/** A refusal the form answers by showing or resetting the check, not by a generic error. */
export class AdmissionRefusal extends Error {
  readonly reason: AdmissionReason;
  /** The check the server published with it, when it published one (admission_required only). */
  readonly challenge: AdmissionChallenge | null;
  constructor(reason: AdmissionReason, message: string, challenge: AdmissionChallenge | null) {
    super(message);
    this.name = 'AdmissionRefusal';
    this.reason = reason;
    this.challenge = challenge;
  }
}

export const isAdmissionRefusal = (error: unknown): error is AdmissionRefusal => error instanceof AdmissionRefusal;

/**
 * Registered, but not signed in: with connect_after_register on a workspace that
 * checks, the register token is spent and the follow-up Connect is refused with
 * admission_required. Not a failure -- the account exists; the window signs in
 * with a fresh `sign-in` token.
 */
export class RegisteredAwaitingSignIn extends Error {
  readonly cid: bigint;
  constructor(cid: bigint) {
    super('Registered; signing in needs a fresh human check');
    this.name = 'RegisteredAwaitingSignIn';
    this.cid = cid;
  }
}
