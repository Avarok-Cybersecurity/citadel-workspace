/**
 * The Apps tab's one row: this member's grant for apps to reach their private network from
 * this computer. Read from the agent, sent to the agent for the signed-in session, and not
 * offered to a window nobody is signed in to.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentAppsTab } from '../AgentAppsTab';
import { LAN_GRANT_COPY } from '../AppsPrivateNetworkRow';
import { registerConversationSender } from '@/lib/agent-conversations/sender';
import { eventEmitter } from '@/lib/event-emitter';

const ALICE: bigint = 42n;

/** The agent's side: every request recorded, each answered with what it now holds. */
function fakeAgent(initially: boolean): Array<[string, Record<string, unknown>]> {
  const asked: Array<[string, Record<string, unknown>]> = [];
  let held: boolean = initially;
  registerConversationSender(async (request: Record<string, unknown>): Promise<void> => {
    const [variant, body] = Object.entries(request)[0] as [string, Record<string, unknown>];
    asked.push([variant, body]);
    if (variant === 'AppsSetAgentSettings') held = body.private_network as boolean;
    const answer: Record<string, unknown> = { cid: body.cid, request_id: body.request_id, private_network: held };
    queueMicrotask((): void => { eventEmitter.emit('websocket-message', { AppsAgentSettings: answer }); });
  });
  return asked;
}

const signedIn = async (): Promise<bigint | null> => ALICE;
const signedOut = async (): Promise<bigint | null> => null;
const row = (): HTMLElement => screen.getByTestId('agent-apps-lan-grant');

describe('the apps private-network grant', () => {
  it('is unchecked while the member has not granted it, and says what it opens', async () => {
    fakeAgent(false);
    render(<AgentAppsTab resolveCid={signedIn} />);
    await waitFor((): void => expect(row()).not.toBeDisabled());
    expect(row()).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(LAN_GRANT_COPY.label)).toBeInTheDocument();
    expect(screen.getByTestId('agent-apps')).toHaveTextContent('LAN or private network');
  });

  it('turning it on sends the grant for the signed-in session, and off sends false', async () => {
    const asked: Array<[string, Record<string, unknown>]> = fakeAgent(false);
    render(<AgentAppsTab resolveCid={signedIn} />);
    await waitFor((): void => expect(row()).not.toBeDisabled());
    fireEvent.click(row());
    await waitFor((): void => expect(row()).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(row());
    await waitFor((): void => expect(row()).toHaveAttribute('aria-checked', 'false'));
    const sets: unknown[][] = asked.filter(([variant]) => variant === 'AppsSetAgentSettings').map(([, body]) => [body.cid, body.private_network]);
    expect(sets).toEqual([[ALICE, true], [ALICE, false]]);
    expect(asked[0]?.[0]).toBe('AppsGetAgentSettings');
    expect(asked[0]?.[1].cid).toBe(ALICE);
  });

  it('shows what the agent holds, not a default', async () => {
    fakeAgent(true);
    render(<AgentAppsTab resolveCid={signedIn} />);
    await waitFor((): void => expect(row()).toHaveAttribute('aria-checked', 'true'));
  });

  it('is disabled with nobody signed in, says so, and asks the agent nothing', async () => {
    const asked: Array<[string, Record<string, unknown>]> = fakeAgent(true);
    render(<AgentAppsTab resolveCid={signedOut} />);
    expect(await screen.findByText(LAN_GRANT_COPY.signedOut)).toBeInTheDocument();
    expect(row()).toBeDisabled();
    fireEvent.click(row());
    expect(asked).toEqual([]);
  });
});
