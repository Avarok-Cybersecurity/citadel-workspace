/**
 * A quote with a coupon preview applied: what is due today, and what follows.
 *
 * Pure and separate from tiers.ts `quote()`, which stays a plain mirror of the
 * catalogue so its drift test keeps its meaning. Nothing here judges a code;
 * it only does the arithmetic on what the control plane already said the code
 * does. Stripe computes the real charge.
 */
import type { CouponPreview } from './coupon-preview';
import type { BillingInterval, Quote } from './tiers';

export interface PricedQuote extends Quote {
  /** Cents taken off the first payment. Never more than `totalCents`. */
  readonly discountCents: number;
  readonly dueTodayCents: number;
  /** Payments the discount covers, the first one included; 0 without a discount. */
  readonly discountedPayments: number;
  /** 0 without a trial. */
  readonly trialDays: number;
  /** What each payment costs once any trial or discount has run out. */
  readonly recurringAfterTrialCents: number;
  /** The code grants the workspace outright: nothing is ever charged. */
  readonly covered: boolean;
}

const MONTHS_PER: Readonly<Record<BillingInterval, number>> = { month: 1, year: 12 };

/** A repeating discount runs N months from the start, so it touches every payment due inside them. */
function paymentsWithin(months: number, interval: BillingInterval): number {
  return Math.ceil(months / MONTHS_PER[interval]);
}

function plain(quote: Quote): PricedQuote {
  return {
    ...quote,
    discountCents: 0,
    dueTodayCents: quote.totalCents,
    discountedPayments: 0,
    trialDays: 0,
    recurringAfterTrialCents: quote.totalCents,
    covered: false,
  };
}

export function applyCoupon(quote: Quote, preview: CouponPreview | null, interval: BillingInterval): PricedQuote {
  const base: PricedQuote = plain(quote);
  if (preview === null) return base;
  switch (preview.kind) {
    case 'trial':
      return { ...base, dueTodayCents: 0, trialDays: preview.days };
    case 'comp':
      return { ...base, discountCents: quote.totalCents, dueTodayCents: 0, recurringAfterTrialCents: 0, covered: true };
    case 'discount': {
      const raw: number = preview.percent_off !== undefined
        ? Math.round((quote.totalCents * preview.percent_off) / 100)
        : preview.amount_off_cents;
      const discountCents: number = Math.min(Math.max(raw, 0), quote.totalCents);
      const discountedPayments: number = preview.duration === 'once' ? 1 : paymentsWithin(preview.months, interval);
      return { ...base, discountCents, dueTodayCents: quote.totalCents - discountCents, discountedPayments };
    }
  }
}
