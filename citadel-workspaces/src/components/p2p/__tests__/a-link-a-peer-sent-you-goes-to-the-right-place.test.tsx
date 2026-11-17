/**
 * The same rule, in the chat bubble that renders a message a PEER wrote.
 *
 * The office document map and this one were the same bug wearing different
 * clothes. Here the anchor forced `target="_blank"` on everything, so a peer
 * linking you to a page in your own workspace opened a SECOND copy of the app
 * in a new tab — a fresh WASM client, a fresh connection to the local agent —
 * instead of moving you there. Both now go through `DocumentLink`, so this test
 * exists to prove the fix was applied at BOTH sites and not just the reported
 * one.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter, useLocation, type Location } from 'react-router-dom';
import { MarkdownBubble } from '../bubbles/MarkdownBubble';
import type { P2PMessage } from '@/lib/p2p/p2p-types';

function messageSaying(content: string): P2PMessage {
  return {
    id: 'm1',
    content,
    senderCid: 2n,
    recipientCid: 1n,
    timestamp: 1_700_000_000_000,
    index: 0,
    status: 'delivered',
    message_type: 'markdown',
  } as unknown as P2PMessage;
}

function CurrentLocation(): JSX.Element {
  const location: Location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
}

function renderBubble(content: string): void {
  render(
    <MemoryRouter initialEntries={['/messages?channel=c1']}>
      <CurrentLocation />
      <MarkdownBubble message={messageSaying(content)} isOwn={false} quoted={null} />
    </MemoryRouter>,
  );
}

describe('a markdown message from a peer', () => {
  it('moves you within the app when it links to a workspace page', async () => {
    const user: UserEvent = userEvent.setup();
    renderBubble('Take a look at [the plan](/workspace?nodeId=plan)');

    const link: HTMLElement = await screen.findByRole('link', { name: 'the plan' });
    // The old anchor sent every link to a new tab, including this one.
    expect(link).not.toHaveAttribute('target', '_blank');

    await user.click(link);

    await waitFor((): void => {
      expect(screen.getByTestId('location')).toHaveTextContent('/workspace?nodeId=plan');
    });
  });

  it('still opens a genuinely external link in a severed new tab', async () => {
    renderBubble('See [the docs](https://example.com/docs)');

    const link: HTMLElement = await screen.findByRole('link', { name: 'the docs' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByTestId('location')).toHaveTextContent('/messages?channel=c1');
  });
});
