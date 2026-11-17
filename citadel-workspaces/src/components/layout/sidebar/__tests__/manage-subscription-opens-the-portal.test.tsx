/**
 * "Manage subscription": the owner proves ownership with the claim code, and the
 * Stripe billing portal opens in a new tab -- or they are told, in plain words,
 * why it did not.
 *
 * The dialog runs against the real control-plane client, answered at the fetch
 * boundary by contract-fake.ts. The one stand-in is the new tab (`openTab`):
 * jsdom cannot open or navigate a browser tab, so a recorder takes its place
 * and reports where it was sent and whether it was closed.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createControlPlane, PORTAL_ORIGIN } from '@/lib/onboarding/control-plane-client';
import type { PortalTab } from '@/lib/onboarding/billing-portal';
import { contractFake, type ContractFake, type Scripted } from '@/lib/onboarding/__tests__/contract-fake';
import { ManageSubscriptionDialog } from '../ManageSubscriptionDialog';

// A well-formed claim code (64 hex): a fixture, never a real one.
const CODE: string = 'cd'.repeat(32);
const PORTAL: string = `${PORTAL_ORIGIN}/p/session/test_fixture`;

interface RecordedTab extends PortalTab {
  sentTo: string | undefined;
  closed: boolean;
}

function setUp(reply: Scripted, blocked: boolean = false): { fake: ContractFake; tabs: RecordedTab[] } {
  const fake: ContractFake = contractFake();
  fake.portalReplies.push(reply);
  const tabs: RecordedTab[] = [];
  const openTab = (): PortalTab | null => {
    if (blocked) return null;
    const tab: RecordedTab = {
      sentTo: undefined,
      closed: false,
      navigate(url: string): void { tab.sentTo = url; },
      close(): void { tab.closed = true; },
    };
    tabs.push(tab);
    return tab;
  };
  render(
    <ManageSubscriptionDialog
      open={true} onOpenChange={(): void => undefined}
      slug="acme" api={createControlPlane(fake.fetch, '/api')} openTab={openTab}
    />,
  );
  return { fake, tabs };
}

async function submitCode(): Promise<HTMLInputElement> {
  const field: HTMLInputElement = screen.getByLabelText('Claim code') as HTMLInputElement;
  await userEvent.type(field, CODE);
  await userEvent.click(screen.getByRole('button', { name: 'Manage subscription' }));
  return field;
}

describe('manage subscription', () => {
  it('asks for the claim code in a password field', () => {
    setUp({ status: 200, body: { portal_url: PORTAL } });
    expect((screen.getByLabelText('Claim code') as HTMLInputElement).type).toBe('password');
  });

  it('opens the portal in a new tab and clears the code', async () => {
    const { fake, tabs } = setUp({ status: 200, body: { portal_url: PORTAL } });
    await submitCode();
    await screen.findByText(/opened in a new tab/i);
    expect(tabs.map((t: RecordedTab) => [t.sentTo, t.closed])).toEqual([[PORTAL, false]]);
    expect(fake.requests[0]).toEqual({ method: 'POST', path: '/api/tenants/acme/portal', body: { claim_code: CODE } });
    const held: string[] = Array.from(document.querySelectorAll('input')).map((i: HTMLInputElement) => i.value);
    expect(held.includes(CODE)).toBe(false);
  });

  it('offers a link when the browser blocked the new tab', async () => {
    setUp({ status: 200, body: { portal_url: PORTAL } }, true);
    await submitCode();
    const link: HTMLAnchorElement = await screen.findByRole('link', { name: /open billing portal/i });
    expect([link.href, link.target, link.rel]).toEqual([PORTAL, '_blank', 'noopener noreferrer']);
  });

  it('says a wrong code does not own the workspace, closes the tab, clears the code', async () => {
    const { tabs } = setUp({ status: 403, body: { error: 'not-owner', detail: 'x' } });
    const field: HTMLInputElement = await submitCode();
    await screen.findByText("That claim code doesn't own this workspace");
    expect(tabs.map((t: RecordedTab) => [t.sentTo, t.closed])).toEqual([[undefined, true]]);
    expect(field.value).toBe('');
    expect(screen.getByRole('button', { name: 'Manage subscription' })).toBeTruthy();
  });

  it('says the Free plan has nothing to manage, and leaves nothing to press', async () => {
    setUp({ status: 404, body: { error: 'no-subscription', detail: 'x' } });
    await submitCode();
    await screen.findByText("This workspace is on the Free plan — there's no subscription to manage");
    expect(screen.queryByRole('button', { name: 'Manage subscription' })).toBeNull();
    expect(screen.queryByLabelText('Claim code')).toBeNull();
  });

  it('says billing management is not available yet', async () => {
    setUp({ status: 503, body: { error: 'portal-not-configured', detail: 'x' } });
    await submitCode();
    await screen.findByText("Billing management isn't available yet");
    expect(screen.queryByRole('button', { name: 'Manage subscription' })).toBeNull();
  });
});
