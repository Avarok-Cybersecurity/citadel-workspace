/**
 * The bodies the create flow sends: the tenant itself, and the coupon question
 * asked about the same plan. Both clamp the plan the same way, here, so a code
 * is never previewed against one selection and redeemed against another.
 */
import type { CreateTenantRequest } from './control-plane-client';
import type { CouponPreviewRequest } from './coupon-preview';
import type { FlowDraft } from './create-flow';
import { SHOWN_CUSTOMER_TERMS_VERSION } from '@/lib/terms/customer-terms';
import { clampChatDocumentPacks, clampLinkPacks, clampSeats, clampStorageBlocks, isPaid, type BillingInterval, type PaidTierId, type PlanSelection } from './tiers';

interface PaidPlanFields {
  readonly tier: PaidTierId;
  readonly interval: BillingInterval;
  readonly seats: number;
  readonly storage_blocks: number;
  readonly link_packs: number;
  readonly chat_document_packs: number;
}

/** The plan as the control plane reads it, or undefined on the free tier, which takes none of it. */
function paidPlanFields(plan: PlanSelection): PaidPlanFields | undefined {
  const tier: PlanSelection['tier'] = plan.tier;
  if (!isPaid(tier)) return undefined;
  return {
    tier,
    interval: plan.interval,
    seats: clampSeats(tier, plan.seats),
    storage_blocks: clampStorageBlocks(tier, plan.storageBlocks),
    link_packs: clampLinkPacks(tier, plan.linkPacks),
    chat_document_packs: clampChatDocumentPacks(tier, plan.chatDocumentPacks),
  };
}

export function requestFor(draft: FlowDraft, turnstileToken: string): CreateTenantRequest {
  const base: CreateTenantRequest = {
    slug: draft.slug,
    display_name: draft.displayName.trim(),
    tier: draft.plan.tier,
    turnstile_token: turnstileToken,
    accepted_customer_terms_version: SHOWN_CUSTOMER_TERMS_VERSION,
    ...(draft.reservationToken ? { reservation_token: draft.reservationToken } : {}),
  };
  const paid: PaidPlanFields | undefined = paidPlanFields(draft.plan);
  if (paid === undefined) return base;
  return { ...base, ...paid, ...(draft.coupon ? { coupon_code: draft.coupon.code } : {}) };
}

/** The preview question for `code` against `plan`; undefined on the free tier, which takes no coupon. */
export function previewRequestFor(code: string, plan: PlanSelection): CouponPreviewRequest | undefined {
  const paid: PaidPlanFields | undefined = paidPlanFields(plan);
  return paid === undefined ? undefined : { code, ...paid };
}
