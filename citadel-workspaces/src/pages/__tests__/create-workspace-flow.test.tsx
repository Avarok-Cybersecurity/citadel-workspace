/**
 * The create-workspace flow, rendered for real and driven the way a visitor
 * drives it.
 *
 * Two doubles, both at a boundary this repository does not own:
 *   - the control plane, via contract-fake.ts at the fetch boundary (it is being
 *     built concurrently and cannot be called), so the real client runs;
 *   - Cloudflare's Turnstile widget, as `window.turnstile` (the real one needs
 *     the network and a person). The page's own loader and widget component run.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, type RenderResult } from '@testing-library/react';
import { loadDraft, saveDraft } from '@/lib/onboarding/create-flow';
import { recordIssuedClaim, revealClaimCode } from '@/lib/onboarding/claim-handoff';
import { MemoryRouter } from 'react-router-dom';
import { ClaimStep } from '@/components/create-workspace/ClaimStep';
import { contractFake, type ContractFake } from '@/lib/onboarding/__tests__/contract-fake';
import { nameIt, renderFlow, resets, submitWithTerms, throughToReview, installFlowHooks } from './create-flow-harness';

installFlowHooks();

describe('naming the workspace', () => {
  it('derives the address from the name and says it is available', async () => {
    renderFlow(contractFake());
    await nameIt('Acme Robotics');
    expect(screen.getByTestId('create-slug')).toHaveValue('acme-robotics');
    expect(screen.getByTestId('create-host-preview')).toHaveTextContent('https://acme-robotics.work.avarok.net');
    await waitFor(() => expect(screen.getByTestId('create-slug-status')).toHaveTextContent('Available'));
    expect(screen.getByTestId('create-name-continue')).toBeEnabled();
  });

  it('will not continue with a taken address', async () => {
    const fake: ContractFake = contractFake();
    fake.unavailable.set('acme', 'taken');
    renderFlow(fake);
    await nameIt('Acme');
    await waitFor(() => expect(screen.getByTestId('create-slug-status')).toHaveTextContent('already taken'));
    expect(screen.getByTestId('create-name-continue')).toBeDisabled();
  });

  it('stops following the name once the address is edited, and checks shape before asking', async () => {
    const fake: ContractFake = contractFake();
    renderFlow(fake);
    fireEvent.change(screen.getByTestId('create-slug'), { target: { value: 'ab' } });
    expect(screen.getByTestId('create-slug-status')).toHaveTextContent('At least 3 characters');
    await nameIt('Something Else');
    expect(screen.getByTestId('create-slug')).toHaveValue('ab');
    expect(fake.requests).toHaveLength(0);
  });
});

describe('a free workspace', () => {
  it('is created, shows its claim code once, and hands over to the join wizard', async () => {
    const fake: ContractFake = contractFake();
    fake.createReplies.push({ status: 200, body: { claim_code: 'CLAIM-7Q2', workspace_host: 'acme.work.avarok.net' } });
    renderFlow(fake);
    await throughToReview(() => {});
    expect(screen.getByTestId('review-total')).toHaveTextContent('Free');
    await submitWithTerms();

    await waitFor(() => expect(screen.getByTestId('claim-code')).toHaveTextContent('CLAIM-7Q2'));
    expect(fake.requests.at(-1)?.body).toEqual({ slug: 'acme', display_name: 'Acme', tier: 'free', turnstile_token: 'token-1', accepted_customer_terms_version: 1 });
    expect(screen.getByText(/becomes the owner/)).toBeInTheDocument();

    expect(screen.getByTestId('claim-continue')).toBeDisabled();
    fireEvent.click(screen.getByTestId('claim-stored'));
    fireEvent.click(screen.getByTestId('claim-continue'));
    expect(screen.queryByTestId('claim-code')).toBeNull();
    expect(document.body.textContent).not.toContain('CLAIM-7Q2');

    fireEvent.click(screen.getByTestId('claim-open-workspace'));
    await waitFor(() => expect(screen.getByText('landing')).toBeInTheDocument());
  });

  it('asks for a new token after a refusal, and does not resend the spent one', async () => {
    const fake: ContractFake = contractFake();
    fake.createReplies.push({ status: 403, body: { error: 'Human verification failed.' } });
    fake.createReplies.push({ status: 200, body: { claim_code: 'C', workspace_host: 'acme.work.avarok.net' } });
    renderFlow(fake);
    await throughToReview(() => {});
    await submitWithTerms();
    await waitFor(() => expect(screen.getByTestId('create-error')).toHaveTextContent('Human verification failed.'));
    expect(resets).toEqual(['widget-1']);
    await waitFor(() => expect(screen.getByTestId('create-submit')).toBeEnabled());
    await submitWithTerms();
    await waitFor(() => expect(screen.getByTestId('claim-step')).toBeInTheDocument());
    const sent: unknown[] = fake.requests.filter((r) => r.method === 'POST').map((r) => (r.body as { turnstile_token: string }).turnstile_token);
    expect(sent).toEqual(['token-1', 'token-2']);
  });
});

describe('a paid workspace', () => {
  it('prices seats and storage, then leaves for Checkout with the draft kept', async () => {
    const fake: ContractFake = contractFake();
    fake.createReplies.push({ status: 200, body: { checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_9', reservation_token: 'rt_first' } });
    const redirect: ReturnType<typeof vi.fn> = vi.fn();
    renderFlow(fake, '/create', redirect);
    await throughToReview(() => {
      fireEvent.click(screen.getByTestId('plan-team'));
      fireEvent.click(screen.getByTestId('interval-year'));
      fireEvent.click(screen.getByTestId('plan-seats-increase'));
      fireEvent.click(screen.getByTestId('plan-storage-increase'));
      expect(screen.getByTestId('plan-total-amount')).toHaveTextContent('$260 / year');
    });
    expect(screen.getByTestId('review-total')).toHaveTextContent('$260 / year');
    await submitWithTerms();

    await waitFor(() => expect(redirect).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_9'));
    expect(fake.requests.at(-1)?.body).toEqual({
      slug: 'acme', display_name: 'Acme', tier: 'team', interval: 'year', seats: 4, storage_blocks: 1, link_packs: 0, chat_document_packs: 0, turnstile_token: 'token-1', accepted_customer_terms_version: 1,
    });
    expect(loadDraft('acme')?.plan.seats).toBe(4);
    expect(loadDraft('acme')?.reservationToken).toBe('rt_first');
  });

  it('retries a cancelled Checkout under the same name, proving the reservation is its own', async () => {
    saveDraft({ displayName: 'Acme', slug: 'acme', plan: { tier: 'team', interval: 'month', seats: 2, storageBlocks: 0, linkPacks: 0, chatDocumentPacks: 0 }, reservationToken: 'rt_first' });
    const fake: ContractFake = contractFake();
    fake.createReplies.push({ status: 200, body: { checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_10', reservation_token: 'rt_second' } });
    const redirect: ReturnType<typeof vi.fn> = vi.fn();
    renderFlow(fake, '/create?tenant=acme&canceled=1', redirect);
    fireEvent.click(screen.getByTestId('cancelled-back-to-plans'));
    fireEvent.click(screen.getByTestId('create-plan-continue'));
    await waitFor(() => expect(screen.getByTestId('create-submit')).toBeEnabled());
    await submitWithTerms();
    await waitFor(() => expect(redirect).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_10'));
    expect((fake.requests.at(-1)?.body as { reservation_token?: string }).reservation_token).toBe('rt_first');
    expect(loadDraft('acme')?.reservationToken).toBe('rt_second');
  });

  it('shows the sentence the control plane gives, not its error code', async () => {
    const fake: ContractFake = contractFake();
    fake.createReplies.push({ status: 409, body: { error: 'slug-taken', detail: 'Someone has just taken acme.work.avarok.net.' } });
    renderFlow(fake);
    await throughToReview(() => {});
    await submitWithTerms();
    await waitFor(() => expect(screen.getByTestId('create-error')).toHaveTextContent('Someone has just taken acme.work.avarok.net.'));
    expect(screen.getByTestId('create-error')).not.toHaveTextContent('slug-taken');
  });

  it('on return, waits for the workspace and then shows its code', async () => {
    const fake: ContractFake = contractFake();
    fake.statusReplies.push({ status: 200, body: { status: 'pending' } });
    fake.statusReplies.push({ status: 200, body: { status: 'active', claim_code: 'PAID-CODE', workspace_host: 'acme.work.avarok.net' } });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderFlow(fake, '/create/done?tenant=acme&session_id=cs_test_9');
      expect(screen.getByTestId('provisioning')).toHaveTextContent('acme.work.avarok.net');
      await vi.advanceTimersByTimeAsync(2500);
      await waitFor(() => expect(screen.getByTestId('claim-code')).toHaveTextContent('PAID-CODE'));
    } finally {
      vi.useRealTimers();
    }
    expect(fake.requests.map((r) => r.path)).toEqual([
      '/api/tenants/acme/status?session_id=cs_test_9',
      '/api/tenants/acme/status?session_id=cs_test_9',
    ]);
  });

  it('says so, and offers the plan back, when Checkout was cancelled', async () => {
    saveDraft({ displayName: 'Acme', slug: 'acme', plan: { tier: 'business', interval: 'month', seats: 5, storageBlocks: 0, linkPacks: 0, chatDocumentPacks: 0 } });
    renderFlow(contractFake(), '/create?tenant=acme&canceled=1');
    expect(screen.getByTestId('checkout-cancelled')).toHaveTextContent('Nothing was charged');
    fireEvent.click(screen.getByTestId('cancelled-back-to-plans'));
    expect(screen.getByTestId('plan-seats')).toHaveValue('5');
    expect(screen.getByTestId('plan-total-amount')).toHaveTextContent('$60 / month');
  });
});

describe('the claim screen', () => {
  it('shows the real 64-hex code in readable groups, and copies it raw', async () => {
    const code: string = `${'0123abcd'.repeat(8)}`;
    const writeText: ReturnType<typeof vi.fn> = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<MemoryRouter><ClaimStep workspaceHost="acme.work.avarok.net" claimCode={code} onOpenWorkspace={() => {}} /></MemoryRouter>);
    expect(screen.getByTestId('claim-code').textContent).toBe(Array(8).fill('0123abcd').join(' '));
    fireEvent.click(screen.getByTestId('claim-code-copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(code));
  });

  it('does not show the code a second time when it is opened again', () => {
    recordIssuedClaim('acme.work.avarok.net', 'ONCE-ONLY');
    const first: RenderResult = render(
      <MemoryRouter><ClaimStep workspaceHost="acme.work.avarok.net" claimCode={revealClaimCode()} onOpenWorkspace={() => {}} /></MemoryRouter>,
    );
    expect(first.getByTestId('claim-code')).toHaveTextContent('ONCE-ONLY');
    first.unmount();

    render(
      <MemoryRouter><ClaimStep workspaceHost="acme.work.avarok.net" claimCode={revealClaimCode()} onOpenWorkspace={() => {}} /></MemoryRouter>,
    );
    expect(screen.queryByTestId('claim-code')).toBeNull();
    expect(screen.getByTestId('claim-already-shown')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('ONCE-ONLY');
  });
});
