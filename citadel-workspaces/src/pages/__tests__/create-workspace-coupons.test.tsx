/**
 * Coupons through the real create flow, with the control plane at the fetch
 * boundary (contract-fake.ts), so the real client parses every answer: applied
 * on the plan step, shown on review, sent at creation, kept across a cancelled
 * Checkout, and re-asked about when creation refuses it.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { loadDraft, saveDraft } from '@/lib/onboarding/create-flow';
import { CODE_REMOVED, TERMS_CHANGED } from '@/lib/onboarding/coupon-recheck';
import { contractFake, type ContractFake, type Scripted } from '@/lib/onboarding/__tests__/contract-fake';
import { nameIt, renderFlow, submitWithTerms, installFlowHooks } from './create-flow-harness';

installFlowHooks();

const TEN_OFF: Scripted = { status: 200, body: { applies: true, kind: 'discount', percent_off: 10, duration: 'once' } };
const REFUSED: Scripted = { status: 400, body: { error: 'coupon-unavailable', detail: 'that code cannot be applied to this plan' } };
const CHECKOUT: Scripted = { status: 200, body: { checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_cp', reservation_token: 'rt_cp' } };

function couponRequests(fake: ContractFake): unknown[] {
  return fake.requests.filter((r) => r.path === '/api/coupons/preview').map((r) => r.body);
}

function createBodies(fake: ContractFake): unknown[] {
  return fake.requests.filter((r) => r.path === '/api/tenants').map((r) => r.body);
}

/** Name it, choose Team, apply `code`, wait for the answer, and continue to review. */
async function teamWithCode(code: string): Promise<void> {
  await nameIt('Acme');
  await waitFor(() => expect(screen.getByTestId('create-name-continue')).toBeEnabled());
  fireEvent.click(screen.getByTestId('create-name-continue'));
  fireEvent.click(screen.getByTestId('plan-team'));
  fireEvent.click(screen.getByTestId('coupon-toggle'));
  fireEvent.change(screen.getByTestId('coupon-input'), { target: { value: code } });
  fireEvent.click(screen.getByTestId('coupon-apply'));
  await waitFor(() => expect(screen.getByTestId('coupon-field')).toHaveAttribute('data-state', 'applied'));
  fireEvent.click(screen.getByTestId('create-plan-continue'));
  await waitFor(() => expect(screen.getByTestId('create-submit')).toBeEnabled());
}

describe('a discount code', () => {
  it('is previewed for the plan, reviewed with what is due today, sent, and kept across Checkout', async () => {
    const fake: ContractFake = contractFake();
    fake.couponReplies.push(TEN_OFF);
    fake.createReplies.push(CHECKOUT);
    const redirect: ReturnType<typeof vi.fn> = vi.fn();
    renderFlow(fake, '/create', redirect);
    await teamWithCode('launch10');
    expect(couponRequests(fake)).toEqual([{ code: 'LAUNCH10', tier: 'team', interval: 'month', seats: 3, storage_blocks: 0, link_packs: 0, chat_document_packs: 0 }]);
    expect(screen.getByTestId('review-coupon')).toHaveTextContent('LAUNCH10: 10% off the first payment');
    expect(screen.getByTestId('review-total')).toHaveTextContent('$18 / month');
    expect(screen.getByTestId('review-due-today')).toHaveTextContent('$16.20');
    expect(screen.getByTestId('create-submit')).toHaveTextContent('Continue to payment');
    await submitWithTerms();
    await waitFor(() => expect(redirect).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_cp'));
    expect(createBodies(fake).at(-1)).toMatchObject({ tier: 'team', coupon_code: 'LAUNCH10' });
    expect(loadDraft('acme')?.coupon).toEqual({ code: 'LAUNCH10', preview: { kind: 'discount', percent_off: 10, duration: 'once' } });
  });

  it('comes back applied after a cancelled Checkout', async () => {
    saveDraft({
      displayName: 'Acme', slug: 'acme', plan: { tier: 'team', interval: 'month', seats: 3, storageBlocks: 0, linkPacks: 0, chatDocumentPacks: 0 },
      reservationToken: 'rt_cp', coupon: { code: 'LAUNCH10', preview: { kind: 'discount', percent_off: 10, duration: 'once' } },
    });
    renderFlow(contractFake(), '/create?tenant=acme&canceled=1');
    fireEvent.click(screen.getByTestId('cancelled-back-to-plans'));
    expect(screen.getByTestId('coupon-field')).toHaveAttribute('data-state', 'applied');
    expect(screen.getByTestId('coupon-input')).toHaveValue('LAUNCH10');
  });
});

describe('a trial code', () => {
  it('says no card is needed, and what happens afterwards', async () => {
    const fake: ContractFake = contractFake();
    fake.couponReplies.push({ status: 200, body: { applies: true, kind: 'trial', days: 14 } });
    renderFlow(fake);
    await teamWithCode('TRIAL14');
    expect(screen.getByTestId('review-trial')).toHaveTextContent(
      '14-day trial, no card needed. Afterwards your workspace continues on the Free plan unless you add a payment method.',
    );
    expect(screen.getByTestId('review-due-today')).toHaveTextContent('$0');
    expect(screen.getByTestId('create-submit')).toHaveTextContent('Start free trial');
  });
});

describe('a comp code', () => {
  it('shows $0 covered by the code and goes straight to the claim screen', async () => {
    const fake: ContractFake = contractFake();
    fake.couponReplies.push({ status: 200, body: { applies: true, kind: 'comp', tier_as: 'business', seats: 25 } });
    fake.createReplies.push({ status: 201, body: { claim_code: 'CLAIM-CP', workspace_host: 'acme.work.avarok.net' } });
    renderFlow(fake);
    await teamWithCode('PARTNER-ACME');
    expect(screen.getByTestId('review-total')).toHaveTextContent('$0 — covered by your code');
    expect(screen.queryByTestId('review-due-today')).toBeNull();
    expect(screen.getByTestId('create-submit')).toHaveTextContent('Create workspace');
    await submitWithTerms();
    await waitFor(() => expect(screen.getByTestId('claim-step')).toBeInTheDocument());
    expect(createBodies(fake).at(-1)).toMatchObject({ coupon_code: 'PARTNER-ACME' });
  });
});

describe('a code creation refuses', () => {
  it('is removed when asking again refuses it too, and the next attempt goes without it', async () => {
    const fake: ContractFake = contractFake();
    fake.couponReplies.push(TEN_OFF, REFUSED);
    fake.createReplies.push(REFUSED, CHECKOUT);
    renderFlow(fake);
    await teamWithCode('LAUNCH10');
    await submitWithTerms();
    await waitFor(() => expect(screen.getByTestId('create-error')).toHaveTextContent(CODE_REMOVED));
    expect(couponRequests(fake)).toHaveLength(2);
    expect(screen.queryByTestId('review-coupon')).toBeNull();
    expect(screen.getByTestId('review-due-today')).toHaveTextContent('$18');
    await waitFor(() => expect(screen.getByTestId('create-submit')).toBeEnabled());
    await submitWithTerms();
    await waitFor(() => expect(createBodies(fake)).toHaveLength(2));
    expect(createBodies(fake)[1]).not.toHaveProperty('coupon_code');
  });

  it('shows its new terms when asking again still applies it', async () => {
    const fake: ContractFake = contractFake();
    fake.couponReplies.push(TEN_OFF, { status: 200, body: { applies: true, kind: 'discount', percent_off: 5, duration: 'once' } });
    fake.createReplies.push(REFUSED);
    renderFlow(fake);
    await teamWithCode('LAUNCH10');
    await submitWithTerms();
    await waitFor(() => expect(screen.getByTestId('create-error')).toHaveTextContent(TERMS_CHANGED));
    expect(screen.getByTestId('review-coupon')).toHaveTextContent('LAUNCH10: 5% off the first payment');
  });
});

describe('the free tier', () => {
  it('offers no code field and sends no code', async () => {
    const fake: ContractFake = contractFake();
    fake.createReplies.push({ status: 200, body: { claim_code: 'C', workspace_host: 'acme.work.avarok.net' } });
    renderFlow(fake);
    await nameIt('Acme');
    await waitFor(() => expect(screen.getByTestId('create-name-continue')).toBeEnabled());
    fireEvent.click(screen.getByTestId('create-name-continue'));
    expect(screen.queryByTestId('coupon-field')).toBeNull();
    fireEvent.click(screen.getByTestId('create-plan-continue'));
    await waitFor(() => expect(screen.getByTestId('create-submit')).toBeEnabled());
    expect(screen.queryByTestId('review-due-today')).toBeNull();
    await submitWithTerms();
    await waitFor(() => expect(screen.getByTestId('claim-step')).toBeInTheDocument());
    expect(createBodies(fake).at(-1)).not.toHaveProperty('coupon_code');
  });
});
