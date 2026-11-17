/**
 * An Accept that fails must tell the person who pressed it.
 *
 * Seen live: Accept on a restored offer produced only a console line,
 * `[UseP2PFileTransfer] Failed to accept transfer: Error: Transfer not found`.
 * The bubble no longer offers Accept on such an offer (see
 * a-transfer-bubble-tells-the-truth), but any accept can still fail, and the
 * failure must reach the screen with its reason.
 *
 * The real service rejects here (no such transfer); the toast is rendered by
 * the app's real Sonner toaster. Mocked: the theme provider the toaster reads,
 * and the socket the service module would otherwise open.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, renderHook, screen, cleanup, act, waitFor } from '@testing-library/react';

vi.mock('next-themes', (): { useTheme: () => { theme: string } } => ({ useTheme: (): { theme: string } => ({ theme: 'light' }) }));
vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendRequest: async (): Promise<void> => undefined,
    sendP2PMessageReliable: async (): Promise<void> => undefined,
    canSendRequests: (): boolean => false,
  },
}));

import { Toaster } from '@/components/ui/sonner';
import { useP2PFileTransfer } from '../useP2PFileTransfer';
import { peerTransportFor } from '@/components/p2p/__tests__/doubles/peer-transport';
import type { ChatTransport } from '@/lib/chat/transport/chat-transport';

const transport: ChatTransport = peerTransportFor({ cid: 42n, name: 'alice' }, null);

afterEach(cleanup);

describe('accepting a file that cannot be accepted', () => {
  it('shows a failure toast carrying the reason', async () => {
    render(<Toaster />);
    const { result } = renderHook(() => useP2PFileTransfer({ files: transport.files, recipient: 'alice' }));

    await act(async (): Promise<void> => { await result.current.handleAcceptTransfer('no-such-transfer'); });

    await waitFor(() => expect(screen.getByText('Failed to accept file')).toBeTruthy());
    expect(screen.getByText(/transfer not found/i)).toBeTruthy();
  });
});
