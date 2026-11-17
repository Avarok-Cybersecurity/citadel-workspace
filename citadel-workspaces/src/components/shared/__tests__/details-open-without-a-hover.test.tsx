/**
 * The delivery tick and the "?" beside a field held their words in a hover tooltip: a touch user
 * could not open them and a keyboard user could not focus them. Both are buttons now, named for what
 * they explain, and open on a press: the tick's details open in the message, the field's help in a
 * popover.
 *
 * No mocks: Radix Popover is the production one.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BubbleFooter } from '@/components/p2p/bubbles/BubbleFooter';
import { SecurityModeSelect } from '@/components/security/SecurityModeSelect';
import type { P2PMessage } from '@/lib/p2p';
import type { PaneMessage } from '@/lib/chat/transport/chat-transport';

describe('details that used to wait for a hover', () => {
  it('a sent P2P message names its status and opens its details on a press', async () => {
    const message: P2PMessage = { id: 'm1', content: 'hi', senderCid: 1n, recipientCid: 2n, timestamp: 1, status: 'delivered' } as unknown as P2PMessage;
    render(<BubbleFooter message={message} isOwn />);
    const tick: HTMLElement = screen.getByRole('button', { name: 'Delivered to peer. Show details' });
    expect(tick.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(tick);
    expect(await screen.findByTestId('message-status-details')).toBeTruthy();
    expect(screen.getByText('From:')).toBeTruthy(); // a direct chat's two ends, which a channel message lacks
    expect(screen.getByRole('button', { name: 'Delivered to peer. Hide details' }).getAttribute('aria-expanded')).toBe('true');
    await userEvent.click(tick);
    expect(screen.queryByTestId('message-status-details')).toBeNull();
  });

  it('a channel message opens its details on a press, and names no CID it does not have', async () => {
    // A channel message has a sender's name and no recipient, so it carries no CIDs at all.
    const message: PaneMessage = { id: 'g1', content: 'hi', timestamp: 1, index: 0, status: 'sent', message_type: 'text' };
    render(<BubbleFooter message={message} isOwn />);
    await userEvent.click(screen.getByRole('button', { name: 'Sent to server. Show details' }));
    expect(await screen.findByTestId('message-status-details')).toBeTruthy();
    expect(screen.queryByText('From:')).toBeNull();
    expect(screen.queryByText('To:')).toBeNull();
  });

  it('a field names its help and opens it on a press', async () => {
    render(<SecurityModeSelect />);
    await userEvent.click(screen.getByRole('button', { name: 'About Security Mode' }));
    expect(await screen.findByText(/preferred security mode/)).toBeTruthy();
  });
});
