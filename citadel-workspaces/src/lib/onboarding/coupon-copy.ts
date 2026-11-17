/**
 * The sentences a coupon preview is shown as. One place, so the plan step and
 * the review step can never describe the same code two ways.
 */
import type { CouponPreview, CouponRefusal, DiscountPreview } from './coupon-preview';
import { formatUsd, tierById } from './tiers';

export const COVERED_BY_CODE: string = '$0 — covered by your code';

export const COUPON_REFUSAL_COPY: Readonly<Record<CouponRefusal, string>> = {
  unavailable: "This code can't be applied to this plan.",
  'rate-limited': 'Too many attempts. Try again in an hour.',
  offline: 'Could not check the code. Check your connection and try again.',
};

export function trialCopy(days: number): string {
  return `${days}-day trial, no card needed. Afterwards your workspace continues on the Free plan unless you add a payment method.`;
}

function discountCopy(preview: DiscountPreview): string {
  const off: string = preview.percent_off !== undefined ? `${preview.percent_off}%` : formatUsd(preview.amount_off_cents);
  if (preview.duration === 'once') return `${off} off the first payment`;
  const months: string = preview.months === 1 ? 'month' : `${preview.months} months`;
  return preview.percent_off !== undefined ? `${off} off the first ${months}` : `${off} off each payment in the first ${months}`;
}

/** What the code does, short enough for a summary row; the trial's terms are shown beside it in full. */
export function couponSummary(preview: CouponPreview): string {
  switch (preview.kind) {
    case 'discount':
      return discountCopy(preview);
    case 'trial':
      return `${preview.days}-day trial`;
    case 'comp':
      return `${tierById(preview.tier_as).name} plan for ${preview.seats.toLocaleString('en-US')} seats`;
  }
}

/** What the code does, in one line: a trial's terms in full, a comp as what it covers. */
export function describeCoupon(preview: CouponPreview): string {
  if (preview.kind === 'trial') return trialCopy(preview.days);
  if (preview.kind === 'comp') return `${COVERED_BY_CODE}: ${couponSummary(preview)}`;
  return couponSummary(preview);
}
