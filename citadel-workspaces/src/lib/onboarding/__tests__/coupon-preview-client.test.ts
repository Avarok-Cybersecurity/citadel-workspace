/**
 * `previewCoupon` against its contract, through the real client at the fetch
 * boundary: what each answer becomes, and that an answer of any other shape is
 * a refusal rather than a price.
 */
import { describe, it, expect } from 'vitest';
import { createControlPlane, type ControlPlane, type FetchLike } from '../control-plane-client';
import type { CouponPreviewAnswer, CouponPreviewRequest } from '../coupon-preview';
import { contractFake, type ContractFake } from './contract-fake';

const REQUEST: CouponPreviewRequest = { code: 'LAUNCH10', tier: 'team', interval: 'month', seats: 3, storage_blocks: 1, link_packs: 2, chat_document_packs: 0 };

async function answerTo(status: number, body: unknown): Promise<CouponPreviewAnswer> {
  const fake: ContractFake = contractFake();
  fake.couponReplies.push({ status, body });
  return createControlPlane(fake.fetch, '/api').previewCoupon(REQUEST);
}

describe('the preview request', () => {
  it('posts the code and the plan to /api/coupons/preview', async () => {
    const fake: ContractFake = contractFake();
    fake.couponReplies.push({ status: 200, body: { applies: true, kind: 'trial', days: 14 } });
    await createControlPlane(fake.fetch, '/api').previewCoupon(REQUEST);
    expect(fake.requests).toEqual([{ method: 'POST', path: '/api/coupons/preview', body: REQUEST }]);
  });
});

describe('answers that apply', () => {
  it.each([
    [{ applies: true, kind: 'discount', percent_off: 10, duration: 'once' }, { kind: 'discount', percent_off: 10, duration: 'once' }],
    [{ applies: true, kind: 'discount', percent_off: 20, duration: 'repeating', months: 3 }, { kind: 'discount', percent_off: 20, duration: 'repeating', months: 3 }],
    [{ applies: true, kind: 'discount', amount_off_cents: 1000, duration: 'once' }, { kind: 'discount', amount_off_cents: 1000, duration: 'once' }],
    [{ applies: true, kind: 'trial', days: 14 }, { kind: 'trial', days: 14 }],
    [{ applies: true, kind: 'comp', tier_as: 'business', seats: 25 }, { kind: 'comp', tier_as: 'business', seats: 25 }],
  ])('%j', async (body: unknown, preview: unknown) => {
    expect(await answerTo(200, body)).toEqual({ ok: true, preview });
  });

  it('keeps only the fields it knows', async () => {
    const answer: CouponPreviewAnswer = await answerTo(200, { applies: true, kind: 'trial', days: 14, note: 'x', percent_off: 99 });
    expect(answer).toEqual({ ok: true, preview: { kind: 'trial', days: 14 } });
  });
});

describe('answers of any other shape are refusals, never prices', () => {
  it.each([
    ['no applies', { kind: 'trial', days: 14 }],
    ['applies false', { applies: false, kind: 'trial', days: 14 }],
    ['applies as a string', { applies: 'true', kind: 'trial', days: 14 }],
    ['an unknown kind', { applies: true, kind: 'bogof' }],
    ['percent and amount both', { applies: true, kind: 'discount', percent_off: 10, amount_off_cents: 100, duration: 'once' }],
    ['neither percent nor amount', { applies: true, kind: 'discount', duration: 'once' }],
    ['a percent over 100', { applies: true, kind: 'discount', percent_off: 101, duration: 'once' }],
    ['a zero percent', { applies: true, kind: 'discount', percent_off: 0, duration: 'once' }],
    ['a fractional percent', { applies: true, kind: 'discount', percent_off: 12.5, duration: 'once' }],
    ['a negative amount', { applies: true, kind: 'discount', amount_off_cents: -100, duration: 'once' }],
    ['an amount as a string', { applies: true, kind: 'discount', amount_off_cents: '1000', duration: 'once' }],
    ['repeating without months', { applies: true, kind: 'discount', percent_off: 10, duration: 'repeating' }],
    ['once with months', { applies: true, kind: 'discount', percent_off: 10, duration: 'once', months: 3 }],
    ['an unknown duration', { applies: true, kind: 'discount', percent_off: 10, duration: 'forever' }],
    ['a trial beyond the cap', { applies: true, kind: 'trial', days: 31 }],
    ['a zero-day trial', { applies: true, kind: 'trial', days: 0 }],
    ['a comp on the free tier', { applies: true, kind: 'comp', tier_as: 'free', seats: 5 }],
    ['a comp on an unknown tier', { applies: true, kind: 'comp', tier_as: 'enterprise', seats: 5 }],
    ['a comp without seats', { applies: true, kind: 'comp', tier_as: 'team' }],
  ])('%s', async (_what: string, body: unknown) => {
    expect(await answerTo(200, body)).toEqual({ ok: false, refusal: 'unavailable' });
  });

  it('reads a body that is not an object at all as a reply that could not be checked', async () => {
    // The client's shared parsing calls this an unexpected reply (502) before any coupon parsing runs:
    // still a refusal, worded as "could not check" rather than as a verdict on the code.
    expect(await answerTo(200, [{ applies: true, kind: 'trial', days: 14 }])).toEqual({ ok: false, refusal: 'offline' });
  });
});

describe('refusals', () => {
  it('reads the uniform 400 as unavailable, and any other 4xx the same way', async () => {
    const detail: string = 'that code cannot be applied to this plan';
    expect(await answerTo(400, { error: 'coupon-unavailable', detail })).toEqual({ ok: false, refusal: 'unavailable' });
    expect(await answerTo(400, { error: 'something-else' })).toEqual({ ok: false, refusal: 'unavailable' });
    expect(await answerTo(404, { error: 'not found' })).toEqual({ ok: false, refusal: 'unavailable' });
  });

  it('reads 429 as the attempt cap', async () => {
    expect(await answerTo(429, { error: 'coupon-rate-limited', detail: 'Too many attempts. Try again in an hour.' }))
      .toEqual({ ok: false, refusal: 'rate-limited' });
  });

  it('reads a server failure or a missing control plane as offline', async () => {
    expect(await answerTo(500, { error: 'boom' })).toEqual({ ok: false, refusal: 'offline' });
    expect(await answerTo(503, { error: 'not configured' })).toEqual({ ok: false, refusal: 'offline' });
  });

  it('reads no answer at all as offline', async () => {
    const offline: FetchLike = async () => { throw new TypeError('Failed to fetch'); };
    const api: ControlPlane = createControlPlane(offline, '/api');
    expect(await api.previewCoupon(REQUEST)).toEqual({ ok: false, refusal: 'offline' });
  });

  it('rethrows an abort, which is not an answer', async () => {
    const fake: ContractFake = contractFake();
    const controller: AbortController = new AbortController();
    controller.abort();
    await expect(createControlPlane(fake.fetch, '/api').previewCoupon(REQUEST, controller.signal)).rejects.toThrow('Aborted');
  });
});
