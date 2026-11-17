/**
 * The coupon code shape is a copy; `billing/tiers.json` `coupons` in the parent
 * repository is the original, and the control plane judges codes by it. If they
 * drift, the page refuses codes the control plane would take, or sends ones it
 * never will.
 *
 * The `coupons` block exists only on parent revisions that carry the coupon
 * work. Where it is absent there is nothing to compare with, and this says so by
 * skipping, visibly and with the path, rather than passing.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COUPON_CODE_MAX_LENGTH, COUPON_CODE_SHAPE, TRIAL_MAX_DAYS, isCouponCode, normaliseCode } from '../coupon-code';

const CATALOGUE: string = resolve(__dirname, '../../../../../billing/tiers.json');

interface CouponsBlock {
  readonly code_shape: string;
  readonly trial_caps: { readonly max_days: number };
}

function readCoupons(): CouponsBlock | undefined {
  if (!existsSync(CATALOGUE)) return undefined;
  const parsed: { coupons?: CouponsBlock } = JSON.parse(readFileSync(CATALOGUE, 'utf8')) as { coupons?: CouponsBlock };
  return parsed.coupons;
}

const coupons: CouponsBlock | undefined = readCoupons();

const TITLE: string = coupons === undefined
  ? `SKIPPED: ${CATALOGUE} has no "coupons" block to compare the code shape with`
  : `the coupon code shape matches ${CATALOGUE} "coupons"`;

describe.skipIf(coupons === undefined)(TITLE, () => {
  it('uses the catalogue code_shape, character for character', () => {
    expect(COUPON_CODE_SHAPE.source).toBe(coupons?.code_shape);
  });

  it('caps trials where the catalogue does', () => {
    expect(TRIAL_MAX_DAYS).toBe(coupons?.trial_caps.max_days);
  });
});

describe('a code as the page sees it', () => {
  it('is trimmed and upper-cased', () => {
    expect(normaliseCode('  launch10 \n')).toBe('LAUNCH10');
  });

  it.each(['LAUNCH10', 'A1B2', 'DESIGN-PARTNER-7', 'X'.repeat(COUPON_CODE_MAX_LENGTH)])('accepts %s', (code: string) => {
    expect(isCouponCode(code)).toBe(true);
  });

  it.each(['', 'ABC', '-ABCD', 'launch10', 'LAUNCH 10', 'LAUNCH_10', 'X'.repeat(COUPON_CODE_MAX_LENGTH + 1)])('refuses %j', (code: string) => {
    expect(isCouponCode(code)).toBe(false);
  });
});
