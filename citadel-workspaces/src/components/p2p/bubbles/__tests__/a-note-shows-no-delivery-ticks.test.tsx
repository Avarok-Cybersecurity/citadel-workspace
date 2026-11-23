/**
 * A note in the scratchpad shows no sent, delivered or read tick: each says somebody received it,
 * and nobody is there (lib/scratchpad). Whether it is still saving, or could not be saved, still
 * shows. A direct chat's bubble, with no pane saying otherwise, keeps its ticks.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BubbleFooter } from '../BubbleFooter';
import { DeliveryTicksContext } from '../delivery-ticks';
import type { P2PMessage } from '@/lib/p2p';

const note = (status: P2PMessage['status']): P2PMessage =>
  ({ id: `m-${status}`, content: 'n', sender_cid: 1n, recipient_cid: 1n, timestamp: 1, index: 1, status, message_type: 'text' });

function footer(status: P2PMessage['status'], ticks: boolean | null): void {
  const bubble: JSX.Element = <BubbleFooter message={note(status)} isOwn={true} />;
  render(ticks === null ? bubble : <DeliveryTicksContext.Provider value={ticks}>{bubble}</DeliveryTicksContext.Provider>);
}

describe('a note\'s footer', () => {
  it.each(['sent', 'delivered', 'read'] as const)('shows no %s tick in the scratchpad', (status) => {
    footer(status, false);
    expect(screen.queryByTestId(`message-status-${status}`)).toBeNull();
  });

  it.each(['pending', 'failed'] as const)('still shows a %s note as such', (status) => {
    footer(status, false);
    expect(screen.getByTestId(`message-status-${status}`)).toBeTruthy();
  });

  it.each(['sent', 'delivered', 'read'] as const)('keeps the %s tick in a direct chat', (status) => {
    footer(status, null);
    expect(screen.getByTestId(`message-status-${status}`)).toBeTruthy();
  });
});
