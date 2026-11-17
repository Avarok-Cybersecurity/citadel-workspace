/**
 * Creation refused the code the preview accepted (it was revoked, used up or
 * expired in between). The control plane judges the code again at creation and
 * its refusal wins, so the applied coupon is dropped and the code asked about
 * once more for the same plan: the visitor sees either its current terms or that
 * it no longer applies, and is never charged a price they were not shown.
 */
import type { ControlPlane } from './control-plane-client';
import { ControlPlaneError } from './control-plane-error';
import { COUPON_REFUSAL_COPY } from './coupon-copy';
import type { CouponPreviewAnswer, CouponPreviewRequest } from './coupon-preview';
import type { AppliedCoupon } from './create-flow';
import { previewRequestFor } from './tenant-request';
import type { PlanSelection } from './tiers';

/** The control plane's code for a coupon it will not apply, at preview and at creation alike. */
export const COUPON_UNAVAILABLE_CODE: string = 'coupon-unavailable';

export function isCouponRefusal(error: unknown): boolean {
  return error instanceof ControlPlaneError && error.code === COUPON_UNAVAILABLE_CODE;
}

export interface Recheck {
  readonly coupon: AppliedCoupon | undefined;
  readonly message: string;
}

export const TERMS_CHANGED: string = "Your code's terms have changed. Check the total, then create again.";
export const CODE_REMOVED: string = `${COUPON_REFUSAL_COPY.unavailable} It has been removed; create again to continue without it.`;

export async function recheckCoupon(
  port: Pick<ControlPlane, 'previewCoupon'>,
  code: string,
  plan: PlanSelection,
): Promise<Recheck> {
  const request: CouponPreviewRequest | undefined = previewRequestFor(code, plan);
  if (request === undefined) return { coupon: undefined, message: CODE_REMOVED };
  const answer: CouponPreviewAnswer = await port.previewCoupon(request);
  return answer.ok
    ? { coupon: { code, preview: answer.preview }, message: TERMS_CHANGED }
    : { coupon: undefined, message: CODE_REMOVED };
}
