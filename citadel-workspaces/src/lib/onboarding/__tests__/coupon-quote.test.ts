/** `applyCoupon`: the arithmetic a coupon preview does to a quote, and the words it is shown in. */
import { describe, it, expect } from 'vitest';
import { applyCoupon, type PricedQuote } from '../coupon-quote';
import { COVERED_BY_CODE, couponSummary, describeCoupon, trialCopy } from '../coupon-copy';
import type { CouponPreview } from '../coupon-preview';
import { quote, type Quote } from '../tiers';

// 3 Team seats ($18) + 1 storage block ($2) + 2 link packs ($4) = $24 a month.
const MONTHLY: Quote = quote({ tier: 'team', interval: 'month', seats: 3, storageBlocks: 1, linkPacks: 2, chatDocumentPacks: 0 });

describe('applyCoupon', () => {
  it('without a coupon, charges the total today and every interval after', () => {
    expect(MONTHLY.totalCents).toBe(2400);
    const priced: PricedQuote = applyCoupon(MONTHLY, null, 'month');
    expect(priced).toMatchObject({ discountCents: 0, dueTodayCents: 2400, discountedPayments: 0, trialDays: 0, recurringAfterTrialCents: 2400, covered: false });
    expect(priced.totalCents).toBe(2400);
  });

  it('takes a percentage off the first payment only, for a once discount', () => {
    const priced: PricedQuote = applyCoupon(MONTHLY, { kind: 'discount', percent_off: 10, duration: 'once' }, 'month');
    expect(priced).toMatchObject({ discountCents: 240, dueTodayCents: 2160, discountedPayments: 1, recurringAfterTrialCents: 2400 });
  });

  it('rounds a percentage to whole cents', () => {
    // Every catalogue price today is whole dollars, so a quote is built by hand to reach a fraction.
    const odd: Quote = { seatsCents: 999, storageCents: 0, linkPacksCents: 0, chatDocumentPacksCents: 0, totalCents: 999, storageGb: 10, sharedLinks: 0, chatDocuments: 1000 };
    expect(applyCoupon(odd, { kind: 'discount', percent_off: 10, duration: 'once' }, 'month')).toMatchObject({ discountCents: 100, dueTodayCents: 899 });
  });

  it('applies a repeating discount to the first N monthly payments, then the full price', () => {
    const priced: PricedQuote = applyCoupon(MONTHLY, { kind: 'discount', percent_off: 20, duration: 'repeating', months: 3 }, 'month');
    expect(priced).toMatchObject({ discountCents: 480, dueTodayCents: 1920, discountedPayments: 3, recurringAfterTrialCents: 2400 });
  });

  it('counts a repeating discount on a yearly plan as the payments inside those months', () => {
    const yearly: Quote = quote({ tier: 'team', interval: 'year', seats: 3, storageBlocks: 0, linkPacks: 0, chatDocumentPacks: 0 });
    expect(applyCoupon(yearly, { kind: 'discount', percent_off: 20, duration: 'repeating', months: 3 }, 'year').discountedPayments).toBe(1);
    expect(applyCoupon(yearly, { kind: 'discount', percent_off: 20, duration: 'repeating', months: 13 }, 'year').discountedPayments).toBe(2);
  });

  it('takes a fixed amount off', () => {
    const priced: PricedQuote = applyCoupon(MONTHLY, { kind: 'discount', amount_off_cents: 1000, duration: 'once' }, 'month');
    expect(priced).toMatchObject({ discountCents: 1000, dueTodayCents: 1400 });
  });

  it('clamps an amount larger than the total to nothing due, never below zero', () => {
    const priced: PricedQuote = applyCoupon(MONTHLY, { kind: 'discount', amount_off_cents: 5000, duration: 'once' }, 'month');
    expect(priced).toMatchObject({ discountCents: 2400, dueTodayCents: 0, recurringAfterTrialCents: 2400 });
  });

  it('charges nothing today for a trial, and the full price after it', () => {
    const priced: PricedQuote = applyCoupon(MONTHLY, { kind: 'trial', days: 14 }, 'month');
    expect(priced).toMatchObject({ discountCents: 0, dueTodayCents: 0, trialDays: 14, recurringAfterTrialCents: 2400, covered: false });
  });

  it('charges nothing, ever, for a comp', () => {
    const priced: PricedQuote = applyCoupon(MONTHLY, { kind: 'comp', tier_as: 'business', seats: 25 }, 'month');
    expect(priced).toMatchObject({ discountCents: 2400, dueTodayCents: 0, recurringAfterTrialCents: 0, covered: true });
  });

  it('leaves the quote it was given untouched', () => {
    const before: Quote = { ...MONTHLY };
    applyCoupon(MONTHLY, { kind: 'discount', percent_off: 50, duration: 'once' }, 'month');
    expect(MONTHLY).toEqual(before);
  });
});

describe('the words a preview is shown in', () => {
  it.each([
    [{ kind: 'discount', percent_off: 10, duration: 'once' }, '10% off the first payment'],
    [{ kind: 'discount', percent_off: 20, duration: 'repeating', months: 3 }, '20% off the first 3 months'],
    [{ kind: 'discount', percent_off: 20, duration: 'repeating', months: 1 }, '20% off the first month'],
    [{ kind: 'discount', amount_off_cents: 1000, duration: 'once' }, '$10 off the first payment'],
    [{ kind: 'discount', amount_off_cents: 550, duration: 'repeating', months: 2 }, '$5.50 off each payment in the first 2 months'],
    [{ kind: 'comp', tier_as: 'business', seats: 25 }, `${COVERED_BY_CODE}: Business plan for 25 seats`],
  ] as ReadonlyArray<readonly [CouponPreview, string]>)('%j', (preview: CouponPreview, words: string) => {
    expect(describeCoupon(preview)).toBe(words);
  });

  it('states the trial terms exactly, with the days the control plane gave', () => {
    expect(describeCoupon({ kind: 'trial', days: 14 })).toBe(
      '14-day trial, no card needed. Afterwards your workspace continues on the Free plan unless you add a payment method.',
    );
    expect(trialCopy(7)).toMatch(/^7-day trial, no card needed\./);
    expect(couponSummary({ kind: 'trial', days: 14 })).toBe('14-day trial');
  });

  it('shows a comp as $0 covered by the code', () => {
    expect(COVERED_BY_CODE).toBe('$0 — covered by your code');
  });
});
