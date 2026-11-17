/**
 * Where the create-workspace flow is, and what it has been told so far.
 *
 * The paid path leaves the page: the visitor goes to Stripe Checkout and comes
 * back to `/create/done?tenant=…&session_id=…` (paid) or `/create?tenant=…&canceled=1`
 * (they backed out). So the step is read from the URL on arrival, and the
 * choices made before the redirect -- the name and the plan, nothing secret --
 * are kept in sessionStorage for the length of that round trip, so that
 * cancelling does not throw away everything they typed.
 *
 * The claim code is NOT part of any of this. See claim-handoff.ts.
 */
import { sessionGet, sessionRemove, sessionSet } from '@/lib/safe-session-storage';
import type { BillingInterval, PlanSelection, TierId } from './tiers';
import { isCouponCode } from './coupon-code';
import { parseCouponPreview, type CouponPreview } from './coupon-preview';

export type FlowStep =
  | { readonly step: 'name' }
  | { readonly step: 'plan' }
  | { readonly step: 'review' }
  | { readonly step: 'provisioning'; readonly slug: string; readonly sessionId: string }
  | { readonly step: 'cancelled'; readonly slug: string }
  | { readonly step: 'claim'; readonly workspaceHost: string; readonly claimCode: string | undefined };

/** The three steps a visitor fills in, in order; the rest are outcomes. */
export const FORM_STEPS: readonly ['name', 'plan', 'review'] = ['name', 'plan', 'review'];
export const FORM_STEP_LABELS: readonly string[] = ['Name', 'Plan', 'Verify'];

export function formStepNumber(step: FlowStep['step']): number {
  const index: number = (FORM_STEPS as readonly string[]).indexOf(step);
  return index < 0 ? FORM_STEPS.length : index + 1;
}

/** The step to open on, from the query string Stripe sends the visitor back with. */
export function stepFromUrl(params: URLSearchParams): FlowStep {
  // The control plane's Checkout return URLs (control/tenants.mjs success_url and
  // cancel_url): `tenant`, and Stripe's own spelling `canceled`.
  const slug: string | null = params.get('tenant');
  if (slug) {
    const sessionId: string | null = params.get('session_id');
    if (sessionId) return { step: 'provisioning', slug, sessionId };
    if (params.get('canceled') === '1') return { step: 'cancelled', slug };
  }
  return { step: 'name' };
}

/** A code the control plane said applies, and what it said, for the plan it was asked about. */
export interface AppliedCoupon {
  readonly code: string;
  readonly preview: CouponPreview;
}

export interface FlowDraft {
  readonly displayName: string;
  readonly slug: string;
  readonly plan: PlanSelection;
  /**
   * Proof that a pending reservation of `slug` is this visitor's, returned with the
   * Checkout URL. Sent back on a retry after a cancelled Checkout so the control
   * plane replaces the reservation instead of answering "taken" for their own name.
   */
  readonly reservationToken?: string;
  /** Kept across Checkout so a cancelled payment comes back with the code still applied. */
  readonly coupon?: AppliedCoupon;
}

export const DRAFT_KEY: string = 'citadel:create-workspace-draft';

const TIER_IDS: readonly TierId[] = ['free', 'team', 'business'];
const INTERVALS: readonly BillingInterval[] = ['month', 'year'];

function isDraft(value: unknown): value is FlowDraft {
  if (typeof value !== 'object' || value === null) return false;
  const draft: Partial<Record<keyof FlowDraft, unknown>> = value as Partial<Record<keyof FlowDraft, unknown>>;
  if (typeof draft.displayName !== 'string' || typeof draft.slug !== 'string') return false;
  const plan: unknown = draft.plan;
  if (typeof plan !== 'object' || plan === null) return false;
  const p: Partial<Record<keyof PlanSelection, unknown>> = plan as Partial<Record<keyof PlanSelection, unknown>>;
  return (
    TIER_IDS.includes(p.tier as TierId) &&
    INTERVALS.includes(p.interval as BillingInterval) &&
    typeof p.seats === 'number' &&
    typeof p.storageBlocks === 'number' &&
    typeof p.linkPacks === 'number' &&
    typeof p.chatDocumentPacks === 'number' &&
    (draft.reservationToken === undefined || typeof draft.reservationToken === 'string')
  );
}

/** A stored coupon, rebuilt from only the fields it may hold; undefined when any is wrong. */
function appliedCouponFrom(value: unknown): AppliedCoupon | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { code, preview } = value as { code?: unknown; preview?: unknown };
  if (typeof code !== 'string' || !isCouponCode(code)) return undefined;
  const parsed: CouponPreview | undefined = parseCouponPreview(preview);
  return parsed === undefined ? undefined : { code, preview: parsed };
}

/**
 * The coupon a plan change leaves standing. A preview answers for one tier,
 * interval and seat count; once any of them changes it says nothing about the
 * new plan, so it is dropped and the code must be asked about again.
 */
export function couponForPlan(coupon: AppliedCoupon | undefined, before: PlanSelection, after: PlanSelection): AppliedCoupon | undefined {
  const same: boolean = before.tier === after.tier && before.interval === after.interval && before.seats === after.seats;
  return same ? coupon : undefined;
}

/** The pack counts a plan states, each added by a later release than the draft may be from. */
const PACK_FIELDS: readonly ('linkPacks' | 'chatDocumentPacks')[] = ['linkPacks', 'chatDocumentPacks'];

/**
 * A draft saved before a kind of pack was sold has no count of it: that visitor bought none.
 * Upgraded on read so a Checkout that spans the deploy does not come back to a blank form.
 */
function withLinkPacks(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const plan: unknown = (value as { plan?: unknown }).plan;
  if (typeof plan !== 'object' || plan === null) return value;
  const absent: readonly string[] = PACK_FIELDS.filter((f) => !(f in plan));
  if (absent.length === 0) return value;
  return { ...value, plan: { ...plan, ...Object.fromEntries(absent.map((f: string): [string, number] => [f, 0])) } };
}

/**
 * False when storage refused the write (private mode, blocked site data). The
 * only consequence is that a cancelled checkout comes back to a blank form, and
 * the cancelled screen already says whether the choices survived.
 */
export function saveDraft(draft: FlowDraft): boolean {
  return sessionSet(DRAFT_KEY, JSON.stringify(draft));
}

/** The draft saved before a Checkout redirect, if it was for this slug. */
export function loadDraft(slug: string): FlowDraft | undefined {
  const raw: string | null = sessionGet(DRAFT_KEY);
  if (!raw) return undefined;
  try {
    const parsed: unknown = withLinkPacks(JSON.parse(raw));
    if (!isDraft(parsed) || parsed.slug !== slug) return undefined;
    // A coupon that does not read back is dropped rather than trusted; the rest of the draft stands.
    const { coupon, ...rest } = parsed;
    const kept: AppliedCoupon | undefined = coupon === undefined ? undefined : appliedCouponFrom(coupon);
    return kept === undefined ? rest : { ...rest, coupon: kept };
  } catch {
    return undefined;
  }
}

export function clearDraft(): void {
  sessionRemove(DRAFT_KEY);
}

/**
 * A fresh plan: Free, so nothing is charged unless the visitor chooses to be.
 * The seat count is what a paid tier starts at when they switch to one.
 */
export const INITIAL_PLAN: PlanSelection = { tier: 'free', interval: 'month', seats: 3, storageBlocks: 0, linkPacks: 0, chatDocumentPacks: 0 };
