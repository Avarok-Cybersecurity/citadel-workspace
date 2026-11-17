/**
 * The "Have a code?" field as a state machine: idle, checking, applied,
 * unavailable, rate-limited, offline -- and what moves it between them.
 *
 * WHY A FAKE PORT: the field's only dependency is `previewCoupon`, and the
 * questions here are about ordering (an old answer arriving after a newer
 * question, a plan change mid-flight), which need each answer released by
 * hand. The client's own parsing of real responses is covered through the
 * fetch boundary in coupon-preview-client.test.ts and the flow specs.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type JSX } from 'react';
import { CouponField } from '../CouponField';
import type { CouponPort } from '../use-coupon-field';
import type { CouponPreviewAnswer, CouponPreviewRequest } from '@/lib/onboarding/coupon-preview';
import { couponForPlan, type AppliedCoupon } from '@/lib/onboarding/create-flow';
import type { PlanSelection } from '@/lib/onboarding/tiers';

interface Asked {
  readonly request: CouponPreviewRequest;
  readonly signal: AbortSignal | undefined;
  readonly answer: (a: CouponPreviewAnswer) => void;
}

function fakePort(): { port: CouponPort; asked: Asked[] } {
  const asked: Asked[] = [];
  const port: CouponPort = {
    previewCoupon: (request: CouponPreviewRequest, signal?: AbortSignal): Promise<CouponPreviewAnswer> =>
      new Promise<CouponPreviewAnswer>((resolve: (a: CouponPreviewAnswer) => void) => asked.push({ request, signal, answer: resolve })),
  };
  return { port, asked };
}

const TEAM: PlanSelection = { tier: 'team', interval: 'month', seats: 3, storageBlocks: 0, linkPacks: 0, chatDocumentPacks: 0 };
const TEN_OFF: CouponPreviewAnswer = { ok: true, preview: { kind: 'discount', percent_off: 10, duration: 'once' } };

/** The parent's half, as CreateWorkspace does it: it owns the plan and the applied coupon. */
function Host({ port, initial, onApplied }: { port: CouponPort; initial: AppliedCoupon | undefined; onApplied: (c: AppliedCoupon | undefined) => void }): JSX.Element {
  const [plan, setPlan] = useState<PlanSelection>(TEAM);
  const [coupon, setCoupon] = useState<AppliedCoupon | undefined>(initial);
  const change = (next: PlanSelection): void => {
    setCoupon((held: AppliedCoupon | undefined) => couponForPlan(held, plan, next));
    setPlan(next);
  };
  return (
    <>
      <CouponField port={port} plan={plan} applied={coupon} onApplied={(c) => { setCoupon(c); onApplied(c); }} />
      <output data-testid="held">{coupon ? coupon.code : 'none'}</output>
      <button type="button" onClick={() => change({ ...plan, seats: plan.seats + 1 })}>more seats</button>
      <button type="button" onClick={() => change({ ...plan, tier: 'free' })}>free</button>
      <button type="button" onClick={() => change({ ...plan, storageBlocks: plan.storageBlocks + 1 })}>more storage</button>
    </>
  );
}

function mount(initial?: AppliedCoupon): { asked: Asked[]; onApplied: ReturnType<typeof vi.fn> } {
  const { port, asked } = fakePort();
  const onApplied: ReturnType<typeof vi.fn> = vi.fn();
  render(<Host port={port} initial={initial} onApplied={onApplied} />);
  return { asked, onApplied };
}

function state(): string | null {
  return screen.getByTestId('coupon-field').getAttribute('data-state');
}

function typeAndApply(code: string): void {
  fireEvent.click(screen.getByTestId('coupon-toggle'));
  fireEvent.change(screen.getByLabelText('Code'), { target: { value: code } });
  fireEvent.click(screen.getByTestId('coupon-apply'));
}

describe('the coupon field', () => {
  it('is a closed disclosure until asked for, with a labelled input that upper-cases', () => {
    mount();
    const toggle: HTMLElement = screen.getByRole('button', { name: /have a code/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('Code')).not.toBeVisible();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '  launch10 ' } });
    expect(screen.getByLabelText('Code')).toHaveValue('LAUNCH10');
    expect(screen.getByTestId('coupon-status')).toHaveAttribute('aria-live', 'polite');
    expect(state()).toBe('idle');
  });

  it('does not render on the free tier', () => {
    mount();
    fireEvent.click(screen.getByText('free'));
    expect(screen.queryByTestId('coupon-field')).toBeNull();
  });

  it('checks, then applies and shows the preview with what is due today', async () => {
    const { asked, onApplied } = mount();
    typeAndApply('launch10');
    expect(state()).toBe('checking');
    expect(screen.getByTestId('coupon-apply')).toBeDisabled();
    expect(asked.map((a) => a.request)).toEqual([{ code: 'LAUNCH10', tier: 'team', interval: 'month', seats: 3, storage_blocks: 0, link_packs: 0, chat_document_packs: 0 }]);
    await act(async () => asked[0].answer(TEN_OFF));
    expect(state()).toBe('applied');
    expect(screen.getByTestId('coupon-preview-line')).toHaveTextContent('10% off the first payment');
    expect(screen.getByTestId('coupon-due-today')).toHaveTextContent('Due today: $16.20');
    expect(onApplied).toHaveBeenLastCalledWith({ code: 'LAUNCH10', preview: TEN_OFF.ok ? TEN_OFF.preview : undefined });
  });

  it.each([
    ['unavailable', "This code can't be applied to this plan."],
    ['rate-limited', 'Too many attempts. Try again in an hour.'],
    ['offline', 'Could not check the code. Check your connection and try again.'],
  ] as const)('shows %s in words, and holds no coupon', async (refusal, words: string) => {
    const { asked, onApplied } = mount();
    typeAndApply('LAUNCH10');
    await act(async () => asked[0].answer({ ok: false, refusal }));
    expect(state()).toBe(refusal);
    expect(screen.getByTestId('coupon-status')).toHaveTextContent(words);
    expect(screen.getByLabelText('Code')).toHaveAttribute('aria-invalid', 'true');
    expect(onApplied).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByTestId('held')).toHaveTextContent('none');
  });

  it('refuses a code of no valid shape without spending an attempt', () => {
    const { asked } = mount();
    typeAndApply('ab');
    expect(state()).toBe('unavailable');
    expect(asked).toHaveLength(0);
  });

  it('ignores an answer to a code the visitor has since edited', async () => {
    const { asked, onApplied } = mount();
    typeAndApply('LAUNCH10');
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'LAUNCH1' } });
    expect(asked[0].signal?.aborted).toBe(true);
    await act(async () => asked[0].answer(TEN_OFF));
    expect(state()).toBe('idle');
    expect(onApplied).not.toHaveBeenCalledWith(expect.objectContaining({ code: 'LAUNCH10' }));
  });

  it('withdraws the coupon on Remove', async () => {
    const { asked, onApplied } = mount();
    typeAndApply('LAUNCH10');
    await act(async () => asked[0].answer(TEN_OFF));
    fireEvent.click(screen.getByTestId('coupon-remove'));
    expect(state()).toBe('idle');
    expect(screen.getByLabelText('Code')).toHaveValue('');
    expect(onApplied).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByTestId('held')).toHaveTextContent('none');
  });

  it('asks again for the new plan when the seats change, and holds nothing until it answers', async () => {
    const { asked } = mount();
    typeAndApply('LAUNCH10');
    await act(async () => asked[0].answer(TEN_OFF));
    expect(screen.getByTestId('held')).toHaveTextContent('LAUNCH10');
    fireEvent.click(screen.getByText('more seats'));
    expect(screen.getByTestId('held')).toHaveTextContent('none');
    expect(state()).toBe('checking');
    await waitFor(() => expect(asked).toHaveLength(2));
    expect(asked[1].request.seats).toBe(4);
    await act(async () => asked[1].answer({ ok: false, refusal: 'unavailable' }));
    expect(state()).toBe('unavailable');
    expect(screen.getByTestId('held')).toHaveTextContent('none');
  });

  it('keeps the coupon when only the add-ons change', async () => {
    const { asked } = mount();
    typeAndApply('LAUNCH10');
    await act(async () => asked[0].answer(TEN_OFF));
    fireEvent.click(screen.getByText('more storage'));
    expect(screen.getByTestId('held')).toHaveTextContent('LAUNCH10');
    expect(state()).toBe('applied');
    expect(asked).toHaveLength(1);
  });

  it('opens already applied for a coupon the draft brought back', () => {
    mount({ code: 'TRIAL14', preview: { kind: 'trial', days: 14 } });
    expect(screen.getByLabelText('Code')).toHaveValue('TRIAL14');
    expect(state()).toBe('applied');
    expect(screen.getByTestId('coupon-preview-line')).toHaveTextContent(
      '14-day trial, no card needed. Afterwards your workspace continues on the Free plan unless you add a payment method.',
    );
    expect(screen.getByTestId('coupon-due-today')).toHaveTextContent('Due today: $0');
  });

  it('shows a comp as covered, with nothing due', () => {
    mount({ code: 'PARTNER-1', preview: { kind: 'comp', tier_as: 'business', seats: 25 } });
    expect(screen.getByTestId('coupon-preview-line')).toHaveTextContent('$0 — covered by your code: Business plan for 25 seats');
    expect(screen.queryByTestId('coupon-due-today')).toBeNull();
  });
});
