/**
 * The applied coupon in the draft kept across Checkout, and in the requests the
 * flow sends: it survives the round trip, an old draft without one still loads,
 * a stored one that does not read back is dropped, a plan change drops it, and
 * only a paid plan holding one sends `coupon_code`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DRAFT_KEY, clearDraft, couponForPlan, loadDraft, saveDraft, type AppliedCoupon, type FlowDraft } from '../create-flow';
import { previewRequestFor, requestFor } from '../tenant-request';
import type { PlanSelection } from '../tiers';

const TEAM: PlanSelection = { tier: 'team', interval: 'month', seats: 3, storageBlocks: 1, linkPacks: 2, chatDocumentPacks: 0 };
const LAUNCH: AppliedCoupon = { code: 'LAUNCH10', preview: { kind: 'discount', percent_off: 10, duration: 'once' } };
const DRAFT: FlowDraft = { displayName: 'Acme', slug: 'acme', plan: TEAM, reservationToken: 'rt_1', coupon: LAUNCH };

function store(value: unknown): void {
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(value));
}

describe('the coupon in the draft', () => {
  beforeEach(() => clearDraft());

  it('comes back from the Checkout round trip as it went', () => {
    saveDraft(DRAFT);
    expect(loadDraft('acme')).toEqual(DRAFT);
  });

  it.each([
    { kind: 'trial', days: 14 },
    { kind: 'comp', tier_as: 'business', seats: 25 },
    { kind: 'discount', amount_off_cents: 500, duration: 'repeating', months: 3 },
  ])('keeps a %j preview', (preview: unknown) => {
    store({ ...DRAFT, coupon: { code: 'X-1234', preview } });
    expect(loadDraft('acme')?.coupon).toEqual({ code: 'X-1234', preview });
  });

  it('loads a draft saved before coupons existed, with no coupon', () => {
    store({ displayName: 'Acme', slug: 'acme', plan: TEAM });
    const loaded: FlowDraft | undefined = loadDraft('acme');
    expect(loaded?.plan).toEqual(TEAM);
    expect(loaded).not.toHaveProperty('coupon');
  });

  it('loads a draft saved before link packs and coupons, upgraded on both counts', () => {
    store({ displayName: 'Acme', slug: 'acme', plan: { tier: 'team', interval: 'month', seats: 2, storageBlocks: 0 } });
    expect(loadDraft('acme')).toEqual({ displayName: 'Acme', slug: 'acme', plan: { tier: 'team', interval: 'month', seats: 2, storageBlocks: 0, linkPacks: 0, chatDocumentPacks: 0 } });
  });

  it.each([
    ['a lower-case code', { code: 'launch10', preview: LAUNCH.preview }],
    ['a code of no valid shape', { code: 'X', preview: LAUNCH.preview }],
    ['a preview of an unknown kind', { code: 'LAUNCH10', preview: { kind: 'free-money' } }],
    ['a preview beyond the trial cap', { code: 'LAUNCH10', preview: { kind: 'trial', days: 365 } }],
    ['no preview', { code: 'LAUNCH10' }],
    ['a string', 'LAUNCH10'],
  ])('drops %s, keeping the rest of the draft', (_what: string, coupon: unknown) => {
    store({ ...DRAFT, coupon });
    const loaded: FlowDraft | undefined = loadDraft('acme');
    expect(loaded?.reservationToken).toBe('rt_1');
    expect(loaded).not.toHaveProperty('coupon');
  });

  it('drops fields a stored preview should not hold', () => {
    store({ ...DRAFT, coupon: { code: 'LAUNCH10', preview: { ...LAUNCH.preview, amount: 'all' }, extra: 1 } });
    expect(loadDraft('acme')?.coupon).toEqual(LAUNCH);
  });
});

describe('a plan change', () => {
  it.each([
    ['the tier', { ...TEAM, tier: 'business' }],
    ['the interval', { ...TEAM, interval: 'year' }],
    ['the seats', { ...TEAM, seats: 4 }],
    ['to the free tier', { ...TEAM, tier: 'free' }],
  ] as ReadonlyArray<readonly [string, PlanSelection]>)('of %s drops the coupon, so a stale preview is never sent', (_what: string, next: PlanSelection) => {
    expect(couponForPlan(LAUNCH, TEAM, next)).toBeUndefined();
  });

  it('of the add-ons alone keeps it', () => {
    expect(couponForPlan(LAUNCH, TEAM, { ...TEAM, storageBlocks: 5, linkPacks: 0, chatDocumentPacks: 0 })).toBe(LAUNCH);
  });
});

describe('the requests', () => {
  it('send coupon_code with a paid plan that holds one', () => {
    expect(requestFor(DRAFT, 'tok')).toMatchObject({ tier: 'team', seats: 3, storage_blocks: 1, link_packs: 2, coupon_code: 'LAUNCH10' });
  });

  it('send none without one', () => {
    const { coupon: _dropped, ...without } = DRAFT;
    expect(requestFor(without, 'tok')).not.toHaveProperty('coupon_code');
  });

  it('send none on the free tier, whatever the draft holds', () => {
    expect(requestFor({ ...DRAFT, plan: { ...TEAM, tier: 'free' } }, 'tok')).not.toHaveProperty('coupon_code');
  });

  it('ask about a code with the same clamped plan creation sends', () => {
    expect(previewRequestFor('LAUNCH10', { ...TEAM, seats: 0 })).toEqual({
      code: 'LAUNCH10', tier: 'team', interval: 'month', seats: 1, storage_blocks: 1, link_packs: 2, chat_document_packs: 0,
    });
    expect(previewRequestFor('LAUNCH10', { ...TEAM, tier: 'free' })).toBeUndefined();
  });
});
