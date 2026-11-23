/**
 * "Manage subscription": asked first over the member's session, which the server answers for the
 * session's own account; when the server refuses that, the owner proves ownership with the claim
 * code and the control plane opens the portal. Either way the Stripe billing portal opens in a new
 * tab -- or the owner is told, in plain words, why it did not.
 *
 * The claim path runs against the real control-plane client, answered at the fetch boundary by
 * contract-fake.ts. Two stand-ins: the session request (`openSessionPortal`), whose server is the
 * kernel (tested in the kernel's own suite, `only_who_configures_the_workspace_opens_its_billing_
 * portal`); and the new tab (`openTab`): jsdom cannot open or navigate a browser tab, so a
 * recorder takes its place and reports where it was sent and whether it was closed.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BillingPortalAnswer } from 'citadel-workspace-client-ts';
import { createControlPlane, PORTAL_ORIGIN } from '@/lib/onboarding/control-plane-client';
import type { PortalTab } from '@/lib/onboarding/billing-portal';
import { contractFake, type ContractFake, type Scripted } from '@/lib/onboarding/__tests__/contract-fake';
import { ManageSubscriptionDialog } from '../ManageSubscriptionDialog';

// A well-formed claim code (64 hex): a fixture, never a real one.
const CODE: string = 'cd'.repeat(32);
const PORTAL: string = `${PORTAL_ORIGIN}/p/session/test_fixture`;
const REFUSED: Error = new Error("Permission denied: EditWorkspaceConfig is required to manage this workspace's plan");

interface RecordedTab extends PortalTab {
  sentTo: string | undefined;
  closed: boolean;
}

interface World {
  fake: ContractFake;
  tabs: RecordedTab[];
  sessionCalls: () => number;
}

/** `session` is how the server answers OpenBillingPortal; `reply` how the control plane answers a claim code. */
function setUp(session: () => Promise<BillingPortalAnswer>, reply?: Scripted, blocked: boolean = false): World {
  const fake: ContractFake = contractFake();
  if (reply) fake.portalReplies.push(reply);
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
  let calls: number = 0;
  const asked = (): Promise<BillingPortalAnswer> => { calls += 1; return session(); };
  render(
    <ManageSubscriptionDialog
      open={true} onOpenChange={(): void => undefined}
      slug="acme" api={createControlPlane(fake.fetch, '/api')} openTab={openTab} openSessionPortal={asked}
    />,
  );
  return { fake, tabs, sessionCalls: (): number => calls };
}

const manage = (): Promise<void> => userEvent.click(screen.getByRole('button', { name: 'Manage subscription' }));

/** The session refused: the claim code is asked for instead. */
async function refusedToClaim(reply: Scripted, blocked: boolean = false): Promise<World> {
  const world: World = setUp(async (): Promise<BillingPortalAnswer> => { throw REFUSED; }, reply, blocked);
  await manage();
  await screen.findByLabelText('Claim code');
  return world;
}

async function submitCode(): Promise<HTMLInputElement> {
  const field: HTMLInputElement = screen.getByLabelText('Claim code') as HTMLInputElement;
  await userEvent.type(field, CODE);
  await manage();
  return field;
}

const sentAndClosed = (tabs: RecordedTab[]): (string | boolean | undefined)[][] => tabs.map((t: RecordedTab) => [t.sentTo, t.closed]);

afterEach((): void => { vi.restoreAllMocks(); });

describe('manage subscription, over the session', () => {
  it('asks no claim code of a member the server admits: one press opens the portal', async () => {
    const { fake, tabs, sessionCalls } = setUp(async (): Promise<BillingPortalAnswer> => ({ Opened: { portal_url: PORTAL } }));
    expect(screen.queryByLabelText('Claim code')).toBeNull();
    await manage();
    await screen.findByText(/opened in a new tab/i);
    expect(sessionCalls()).toBe(1);
    expect(sentAndClosed(tabs)).toEqual([[PORTAL, false]]);
    expect(fake.requests).toEqual([]);
    expect(screen.queryByLabelText('Claim code')).toBeNull();
  });

  it('says the Free plan has nothing to manage, closes the tab, and leaves nothing to press', async () => {
    const { tabs } = setUp(async (): Promise<BillingPortalAnswer> => 'NoSubscription');
    await manage();
    await screen.findByText("This workspace is on the Free plan — there's no subscription to manage");
    expect(sentAndClosed(tabs)).toEqual([[undefined, true]]);
    expect(screen.queryByRole('button', { name: 'Manage subscription' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
  });

  it('says billing management is not available yet', async () => {
    setUp(async (): Promise<BillingPortalAnswer> => 'NotConfigured');
    await manage();
    await screen.findByText("Billing management isn't available yet");
    expect(screen.queryByRole('button', { name: 'Manage subscription' })).toBeNull();
  });

  it('lets the member try again when billing could not be reached', async () => {
    setUp(async (): Promise<BillingPortalAnswer> => ({ Unavailable: { reason: 'billing could not be reached just now' } }));
    await manage();
    await screen.findByText("Billing couldn't be opened just now. Please try again.");
    expect(screen.getByRole('button', { name: 'Manage subscription' })).toBeTruthy();
    expect(screen.queryByLabelText('Claim code')).toBeNull();
  });

  it('falls back to the claim code when the server refuses the session, closing the tab it opened', async () => {
    const { tabs, fake } = await refusedToClaim({ status: 200, body: { portal_url: PORTAL } });
    expect(sentAndClosed(tabs)).toEqual([[undefined, true]]);
    expect(fake.requests).toEqual([]);
    expect(screen.getByText(/enter the claim code you were given/i)).toBeTruthy();
  });
});

describe('manage subscription, with the claim code', () => {
  it('asks for the claim code in a password field', async () => {
    await refusedToClaim({ status: 200, body: { portal_url: PORTAL } });
    expect((screen.getByLabelText('Claim code') as HTMLInputElement).type).toBe('password');
  });

  it('opens the portal in a new tab, clears the code, and never logs it', async () => {
    const printed: unknown[][] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]): void => { printed.push(args); });
    }
    const { fake, tabs } = await refusedToClaim({ status: 200, body: { portal_url: PORTAL } });
    await submitCode();
    await screen.findByText(/opened in a new tab/i);
    expect(sentAndClosed(tabs).at(-1)).toEqual([PORTAL, false]);
    expect(fake.requests[0]).toEqual({ method: 'POST', path: '/api/tenants/acme/portal', body: { claim_code: CODE } });
    const held: string[] = Array.from(document.querySelectorAll('input')).map((i: HTMLInputElement) => i.value);
    expect(held.includes(CODE)).toBe(false);
    expect(printed.some((args: unknown[]) => args.some((a: unknown) => String(a).includes(CODE)))).toBe(false);
  });

  it('offers a link when the browser blocked the new tab', async () => {
    await refusedToClaim({ status: 200, body: { portal_url: PORTAL } }, true);
    await submitCode();
    const link: HTMLAnchorElement = await screen.findByRole('link', { name: /open billing portal/i });
    expect([link.href, link.target, link.rel]).toEqual([PORTAL, '_blank', 'noopener noreferrer']);
  });

  it('says a wrong code does not own the workspace, closes the tab, clears the code', async () => {
    const { tabs } = await refusedToClaim({ status: 403, body: { error: 'not-owner', detail: 'x' } });
    const field: HTMLInputElement = await submitCode();
    await screen.findByText("That claim code doesn't own this workspace");
    expect(sentAndClosed(tabs).at(-1)).toEqual([undefined, true]);
    expect(field.value).toBe('');
    expect(screen.getByRole('button', { name: 'Manage subscription' })).toBeTruthy();
  });

  it('says the Free plan has nothing to manage, and leaves nothing to press', async () => {
    await refusedToClaim({ status: 404, body: { error: 'no-subscription', detail: 'x' } });
    await submitCode();
    await screen.findByText("This workspace is on the Free plan — there's no subscription to manage");
    expect(screen.queryByRole('button', { name: 'Manage subscription' })).toBeNull();
    expect(screen.queryByLabelText('Claim code')).toBeNull();
  });

  it('says billing management is not available yet', async () => {
    await refusedToClaim({ status: 503, body: { error: 'portal-not-configured', detail: 'x' } });
    await submitCode();
    await screen.findByText("Billing management isn't available yet");
    expect(screen.queryByRole('button', { name: 'Manage subscription' })).toBeNull();
  });
});
