/**
 * Pressing Create puts the Customer Terms and the Terms of Use to the visitor; nothing is sent
 * until they accept, and what is sent names the version they were shown. The flow, the control
 * plane client and the dialog are the real ones (doubles: the fetch boundary and the Turnstile
 * widget, as in the flow's own spec).
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { contractFake, type ContractFake } from '@/lib/onboarding/__tests__/contract-fake';
import { SHOWN_CUSTOMER_TERMS_VERSION } from '@/lib/terms/customer-terms';
import { renderFlow, submitWithTerms, throughToReview, installFlowHooks } from './create-flow-harness';

installFlowHooks();

const posts = (fake: ContractFake): ContractFake['requests'] => fake.requests.filter((r) => r.method === 'POST');

describe('Create on the final step', () => {
  it('asks first: nothing is sent, and Accept waits for the box', async () => {
    const fake: ContractFake = contractFake();
    renderFlow(fake);
    await throughToReview(() => {});
    fireEvent.click(screen.getByTestId('create-submit'));
    expect(await screen.findByTestId('terms-acceptance-modal')).toBeInTheDocument();
    expect(screen.getByTestId('terms-accept')).toBeDisabled();
    expect(posts(fake)).toHaveLength(0);
    expect(screen.getAllByRole('tab').map((t: HTMLElement): string | null => t.textContent)).toEqual(['Customer Terms', 'Terms of Use']);
    expect(screen.getByLabelText(/on behalf of myself or the organization I represent/)).toBeInTheDocument();
  });

  it('Cancel sends nothing and returns to the step with Create still available', async () => {
    const fake: ContractFake = contractFake();
    renderFlow(fake);
    await throughToReview(() => {});
    fireEvent.click(screen.getByTestId('create-submit'));
    fireEvent.click(await screen.findByTestId('terms-cancel'));
    await waitFor(() => expect(screen.queryByTestId('terms-acceptance-modal')).toBeNull());
    expect(posts(fake)).toHaveLength(0);
    expect(screen.getByTestId('create-submit')).toBeEnabled();
  });

  it('Accept sends the version of the Customer Terms the visitor was shown', async () => {
    const fake: ContractFake = contractFake();
    fake.createReplies.push({ status: 200, body: { claim_code: 'C', workspace_host: 'acme.work.avarok.net' } });
    renderFlow(fake);
    await throughToReview(() => {});
    await submitWithTerms();
    await waitFor(() => expect(screen.getByTestId('claim-step')).toBeInTheDocument());
    expect(posts(fake)).toHaveLength(1);
    expect(posts(fake)[0].body).toMatchObject({ accepted_customer_terms_version: SHOWN_CUSTOMER_TERMS_VERSION });
    expect(SHOWN_CUSTOMER_TERMS_VERSION).toBe(1);
  });

  it("shows the control plane's sentence when it says the terms moved on", async () => {
    const fake: ContractFake = contractFake();
    fake.createReplies.push({ status: 409, body: { error: 'customer-terms-stale', detail: 'version 1 is not current; the current version is 2' } });
    renderFlow(fake);
    await throughToReview(() => {});
    await submitWithTerms();
    await waitFor(() => expect(screen.getByTestId('create-error')).toHaveTextContent('the current version is 2'));
  });
});
