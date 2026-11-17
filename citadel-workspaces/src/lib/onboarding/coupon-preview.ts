/**
 * What the control plane said a coupon code would do to a plan, parsed rather
 * than trusted.
 *
 * `POST /api/coupons/preview` answers one of three shapes, or refuses. Every
 * refusal of the code itself is the same 400 `coupon-unavailable`, so the page
 * cannot tell an unknown code from an expired one, and does not try. A body
 * whose shape this file does not recognise is a refusal too: an answer the
 * page cannot read is never shown as a price.
 *
 * The preview keeps the wire's field names so that one validator serves both
 * the response and the copy kept in the create-flow draft across Checkout.
 */
import { TRIAL_MAX_DAYS } from './coupon-code';
import { ControlPlaneError } from './control-plane-error';
import type { BillingInterval, PaidTierId } from './tiers';

export interface CouponPreviewRequest {
  readonly code: string;
  readonly tier: PaidTierId;
  readonly interval: BillingInterval;
  readonly seats: number;
  readonly storage_blocks: number;
  readonly link_packs: number;
  readonly chat_document_packs: number;
}

type DiscountAmount =
  | { readonly percent_off: number; readonly amount_off_cents?: undefined }
  | { readonly amount_off_cents: number; readonly percent_off?: undefined };

type DiscountTerm =
  | { readonly duration: 'once'; readonly months?: undefined }
  | { readonly duration: 'repeating'; readonly months: number };

export type DiscountPreview = { readonly kind: 'discount' } & DiscountAmount & DiscountTerm;
export interface TrialPreview { readonly kind: 'trial'; readonly days: number }
export interface CompPreview { readonly kind: 'comp'; readonly tier_as: PaidTierId; readonly seats: number }

export type CouponPreview = DiscountPreview | TrialPreview | CompPreview;

export type CouponRefusal = 'unavailable' | 'rate-limited' | 'offline';

export type CouponPreviewAnswer =
  | { readonly ok: true; readonly preview: CouponPreview }
  | { readonly ok: false; readonly refusal: CouponRefusal };

const PAID_TIERS: readonly PaidTierId[] = ['team', 'business'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max;
}

function discountFrom(body: Record<string, unknown>): DiscountPreview | undefined {
  const percent: unknown = body.percent_off;
  const amount: unknown = body.amount_off_cents;
  let off: DiscountAmount;
  if (percent !== undefined && amount === undefined && isCount(percent, 100)) off = { percent_off: percent };
  else if (amount !== undefined && percent === undefined && isCount(amount, Number.MAX_SAFE_INTEGER)) off = { amount_off_cents: amount };
  else return undefined;
  if (body.duration === 'once' && body.months === undefined) return { kind: 'discount', ...off, duration: 'once' };
  if (body.duration === 'repeating' && isCount(body.months, 120)) {
    return { kind: 'discount', ...off, duration: 'repeating', months: body.months };
  }
  return undefined;
}

/**
 * A fresh preview holding only the fields this file knows, or undefined when
 * `value` is not exactly one of the shapes. Extra fields are dropped, never kept.
 */
export function parseCouponPreview(value: unknown): CouponPreview | undefined {
  if (!isRecord(value)) return undefined;
  switch (value.kind) {
    case 'discount':
      return discountFrom(value);
    case 'trial':
      return isCount(value.days, TRIAL_MAX_DAYS) ? { kind: 'trial', days: value.days } : undefined;
    case 'comp': {
      const tierAs: unknown = value.tier_as;
      const known: PaidTierId | undefined = PAID_TIERS.find((t: PaidTierId) => t === tierAs);
      return known !== undefined && isCount(value.seats, Number.MAX_SAFE_INTEGER)
        ? { kind: 'comp', tier_as: known, seats: value.seats }
        : undefined;
    }
    default:
      return undefined;
  }
}

/** A 200 from the preview route: it must say `applies: true` and hold a known shape. */
export function answerFromBody(body: Record<string, unknown>): CouponPreviewAnswer {
  const preview: CouponPreview | undefined = body.applies === true ? parseCouponPreview(body) : undefined;
  return preview === undefined ? { ok: false, refusal: 'unavailable' } : { ok: true, preview };
}

/**
 * A preview request that did not come back 200. Nothing answering, or the
 * server failing, is `offline` (worth trying again); 429 is the attempt cap;
 * every other refusal reads as "cannot be applied". An abort is not an answer
 * and is rethrown, as is anything that is not a control-plane error.
 */
export function answerFromError(error: unknown): CouponPreviewAnswer {
  if (!(error instanceof ControlPlaneError)) throw error;
  if (error.status === 429) return { ok: false, refusal: 'rate-limited' };
  if (error.transient || error.notConfigured) return { ok: false, refusal: 'offline' };
  return { ok: false, refusal: 'unavailable' };
}
