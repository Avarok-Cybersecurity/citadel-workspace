/**
 * What a coupon code looks like, before anyone is asked whether it applies.
 *
 * A MIRROR of the parent repository's `billing/tiers.json` `coupons` block,
 * like tiers.ts is of the rest of that file: `__tests__/coupon-code-matches-the-catalogue.test.ts`
 * reads the JSON and fails when the two disagree. The page only uses these to
 * avoid asking the control plane questions it would refuse anyway; the control
 * plane alone decides whether a code applies.
 */

/** `coupons.code_shape`: what a code is after `normaliseCode`. */
export const COUPON_CODE_SHAPE: RegExp = /^[A-Z0-9][A-Z0-9-]{3,31}$/;

/** The longest code the shape admits, which bounds the input field. */
export const COUPON_CODE_MAX_LENGTH: number = 32;

/** `coupons.trial_caps.max_days`: a trial preview promising more is not believed. */
export const TRIAL_MAX_DAYS: number = 30;

/** Codes are compared after trimming and upper-casing, on both sides of the wire. */
export function normaliseCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isCouponCode(code: string): boolean {
  return COUPON_CODE_SHAPE.test(code);
}
