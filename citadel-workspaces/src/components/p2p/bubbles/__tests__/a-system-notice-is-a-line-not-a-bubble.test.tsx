/**
 * A system notice (a screenshot notice today) is a line across the thread
 * that nobody wrote: it must not render as the peer's text bubble, with a
 * reply/edit menu and delivery ticks, as if they had typed it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MessageBubble } from '../MessageBubble';
import type { P2PMessage } from '@/lib/p2p';

afterEach(() => cleanup());

const notice: P2PMessage = {
  id: 'shot-1', content: 'Bob may have taken a screenshot', senderCid: 42n, recipientCid: 7n,
  timestamp: 1_700_000_000_000, index: 3, status: 'delivered', message_type: 'system_notice',
};

describe('a system notice', () => {
  it('renders its text as a status line', () => {
    render(<MessageBubble message={notice} isOwn={false} quoted={null} onReply={() => {}} />);
    expect(screen.getByRole('status').textContent).toContain('Bob may have taken a screenshot');
  });

  it('offers none of a message\'s actions', () => {
    render(<MessageBubble message={notice} isOwn={false} quoted={null} onReply={() => {}} onEdit={() => {}} />);
    expect(screen.queryAllByRole('button')).toEqual([]);
  });
});
