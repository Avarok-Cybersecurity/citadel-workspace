/** Buying secure-link packs through the real create flow (doubles as in create-workspace-flow.test.tsx). */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { loadDraft } from '@/lib/onboarding/create-flow';
import { contractFake, type ContractFake } from '@/lib/onboarding/__tests__/contract-fake';
import { renderFlow, submitWithTerms, throughToReview, installFlowHooks } from './create-flow-harness';

installFlowHooks();

describe('secure-link packs', () => {
  it('are counted beside storage, priced in the total, reviewed and sent', async () => {
    const fake: ContractFake = contractFake();
    fake.createReplies.push({ status: 200, body: { checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_lp', reservation_token: 'rt_lp' } });
    const redirect: ReturnType<typeof vi.fn> = vi.fn();
    renderFlow(fake, '/create', redirect);
    await throughToReview(() => {
      fireEvent.click(screen.getByTestId('plan-team'));
      expect(screen.getByTestId('plan-link-packs')).toHaveValue('0');
      expect(screen.queryByTestId('plan-link-packs-line')).toBeNull();
      fireEvent.click(screen.getByTestId('plan-link-packs-increase'));
      fireEvent.click(screen.getByTestId('plan-link-packs-increase'));
      expect(screen.getByTestId('plan-link-packs-line')).toHaveTextContent('2 × 50-link pack$4');
      expect(screen.getByTestId('plan-total-amount')).toHaveTextContent('$22 / month');
      expect(screen.getByTestId('plan-total')).toHaveTextContent('50 secure links per member, plus 100 shared.');
    });
    expect(screen.getByTestId('review-link-packs')).toHaveTextContent('100, shared by the workspace');
    expect(screen.getByTestId('review-total')).toHaveTextContent('$22 / month');
    await submitWithTerms();
    await waitFor(() => expect(redirect).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_lp'));
    expect(fake.requests.at(-1)?.body).toMatchObject({ tier: 'team', interval: 'month', seats: 3, storage_blocks: 0, link_packs: 2 });
    expect(loadDraft('acme')?.plan.linkPacks).toBe(2);
  });

  it('are not offered on Free, and none are sent', async () => {
    const fake: ContractFake = contractFake();
    fake.createReplies.push({ status: 200, body: { claim_code: 'C', workspace_host: 'acme.work.avarok.net' } });
    renderFlow(fake);
    await throughToReview(() => {
      expect(screen.queryByTestId('plan-link-packs')).toBeNull();
      expect(screen.getByTestId('plan-total')).toHaveTextContent('5 secure links per member.');
    });
    expect(screen.queryByTestId('review-link-packs')).toBeNull();
    await submitWithTerms();
    await waitFor(() => expect(screen.getByTestId('claim-step')).toBeInTheDocument());
    expect(fake.requests.at(-1)?.body).not.toHaveProperty('link_packs');
  });
});
