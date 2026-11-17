/** Buying chat-document packs through the real create flow: Business only (doubles as in create-workspace-flow.test.tsx). */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { loadDraft } from '@/lib/onboarding/create-flow';
import { contractFake, type ContractFake } from '@/lib/onboarding/__tests__/contract-fake';
import { renderFlow, submitWithTerms, throughToReview, installFlowHooks } from './create-flow-harness';

installFlowHooks();

describe('chat-document packs', () => {
  it('are counted on Business, priced in the total, reviewed and sent', async () => {
    const fake: ContractFake = contractFake();
    fake.createReplies.push({ status: 200, body: { checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_cd', reservation_token: 'rt_cd' } });
    const redirect: ReturnType<typeof vi.fn> = vi.fn();
    renderFlow(fake, '/create', redirect);
    await throughToReview(() => {
      fireEvent.click(screen.getByTestId('plan-business'));
      expect(screen.getByTestId('plan-chat-document-packs')).toHaveValue('0');
      expect(screen.getByTestId('plan-total')).toHaveTextContent('10,000 chat documents.');
      fireEvent.click(screen.getByTestId('plan-chat-document-packs-increase'));
      expect(screen.getByTestId('plan-chat-document-packs-line')).toHaveTextContent('1 × 5,000-document pack$5');
      expect(screen.getByTestId('plan-total')).toHaveTextContent('15,000 chat documents.');
    });
    expect(screen.getByTestId('review-chat-document-packs')).toHaveTextContent('15,000 in all, with 1 extra pack');
    await submitWithTerms();
    await waitFor(() => expect(redirect).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_cd'));
    expect(fake.requests.at(-1)?.body).toMatchObject({ tier: 'business', chat_document_packs: 1 });
    expect(loadDraft('acme')?.plan.chatDocumentPacks).toBe(1);
  });

  it('are not offered on Team, which keeps its 1,000', async () => {
    renderFlow(contractFake());
    await throughToReview(() => {
      fireEvent.click(screen.getByTestId('plan-team'));
      expect(screen.queryByTestId('plan-chat-document-packs')).toBeNull();
      expect(screen.getByTestId('plan-total')).toHaveTextContent('1,000 chat documents.');
    });
    expect(screen.queryByTestId('review-chat-document-packs')).toBeNull();
  });
});
