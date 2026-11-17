/**
 * Third UX pass on the send flow:
 *  - the delivery ticks on the sender's own bubble take the bubble's foreground
 *    (muted measured 1.09:1 on bg-primary);
 *  - the toast after Send says what actually happened: preparing, or held for an
 *    offline peer -- never "File Sent" while nothing has been offered.
 * Stand-ins: the transfer service (the hook's port to everything below it) and the toast.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, renderHook, act } from '@testing-library/react';

const world: { state: string; toasts: string[] } = vi.hoisted(() => ({ state: 'preparing', toasts: [] }));
vi.mock('@/lib/file-transfer', () => ({
  fileTransferService: {
    sendFile: async (): Promise<string> => 't1',
    getTransfer: (): { state: string } => ({ state: world.state }),
  },
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: (): { toast: (t: { title: string }) => void } => ({ toast: (t: { title: string }): void => { world.toasts.push(t.title); } }) }));

const { BubbleFooter } = await import('../bubbles/BubbleFooter');
const { useP2PFileTransfer } = await import('../hooks/useP2PFileTransfer');
import type { P2PMessage } from '@/lib/p2p';
import { peerTransportFor } from '@/components/p2p/__tests__/doubles/peer-transport';
import type { ChatTransport } from '@/lib/chat/transport/chat-transport';

const transport: ChatTransport = peerTransportFor({ cid: 42n, name: 'Bob' }, null);

afterEach((): void => { cleanup(); world.toasts = []; });

describe('the sender\'s delivery ticks', () => {
  it.each(['pending', 'sent', 'delivered'])('%s takes the bubble\'s foreground', (status: string) => {
    const message: P2PMessage = { id: 'm', content: 'hi', senderCid: 7n, recipientCid: 42n, timestamp: 1, status } as P2PMessage;
    render(<BubbleFooter message={message} isOwn />);
    expect(screen.getByTestId(`message-status-${status}`).getAttribute('class')).toContain('text-primary-foreground');
  });
});

describe('the toast after Send', () => {
  it.each([
    ['preparing', 'Preparing to send video.mov'],
    ['queued', 'Will send video.mov when Bob is online'],
  ])('for a send that is %s says so', async (state: string, title: string) => {
    world.state = state;
    const { result } = renderHook(() => useP2PFileTransfer({ files: transport.files, recipient: 'Bob' }));
    await act(async () => { await result.current.handleSendFile(new File(['x'], 'video.mov')); });
    expect(world.toasts).toEqual([title]);
  });
});
