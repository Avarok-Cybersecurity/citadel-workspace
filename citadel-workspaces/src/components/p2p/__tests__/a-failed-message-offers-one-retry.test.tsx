/**
 * A failed text message showed two ways to retry it: a "Retry" link beside "Failed to send" and a
 * refresh icon in the footer, both wired to the same handler. There is one now, in the footer, which
 * is also the only one live-document and file bubbles have.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TextBubble } from '../bubbles/TextBubble';
import type { P2PMessage } from '@/lib/p2p';

const FAILED: P2PMessage = { id: 'm', content: 'hello', senderCid: 1n, recipientCid: 2n, timestamp: 1, status: 'failed', error: 'peer unreachable' } as unknown as P2PMessage;

describe('a failed message', () => {
  it('offers exactly one Retry, and it retries', () => {
    const onRetry: ReturnType<typeof vi.fn> = vi.fn();
    render(<TextBubble message={FAILED} isOwn quoted={null} onRetry={onRetry} />);
    const retries: HTMLElement[] = screen.getAllByRole('button', { name: /retry/i });
    expect(retries).toHaveLength(1);
    fireEvent.click(retries[0]);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Failed to send')).toBeTruthy();
  });
});
