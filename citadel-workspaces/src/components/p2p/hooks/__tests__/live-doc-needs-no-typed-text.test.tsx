/**
 * Choosing Live Doc opens the new-document dialog whether or not the box has text.
 *
 * The composer returned on an empty box before it looked at the message type, and choosing the
 * type opened the dialog only when something was already typed -- so the button was enabled
 * and did nothing, and the live-doc spec had to type a placeholder first ("BUG WORKAROUND").
 * A Live Doc takes its title and seed from the dialog, not from the box.
 *
 * Mocked: the P2P messenger (network I/O) and toasts; the composer hook is production code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { clearAllDraftsForTests } from '@/lib/chat/draft-store';
import { useP2PCompose } from '../useP2PCompose';
import { peerTransportFor } from '@/components/p2p/__tests__/doubles/peer-transport';
import type { ChatTransport } from '@/lib/chat/transport/chat-transport';

const sendMessage: ReturnType<typeof vi.fn> = vi.fn();
vi.mock('@/lib/p2p/p2p-messenger-manager', () => ({
  P2PMessengerManager: { getInstance: (): Record<string, ReturnType<typeof vi.fn>> => ({ sendMessage, stopTypingPolling: vi.fn(), startTypingPolling: vi.fn() }) },
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: (): { toast: ReturnType<typeof vi.fn> } => ({ toast: vi.fn() }) }));

// The real adapter over the mocked messenger above.
const transport: ChatTransport = peerTransportFor({ cid: 42n, name: 'Bob' }, null);

function setup(): ReturnType<typeof renderHook<ReturnType<typeof useP2PCompose>, unknown>> {
  return renderHook(() => useP2PCompose({ transport, messages: [], editMessage: vi.fn(), createDocument: vi.fn() }));
}

describe('the Live Doc type', () => {
  beforeEach(() => { clearAllDraftsForTests(); sendMessage.mockReset(); });

  it('opens the dialog when chosen with an empty box', () => {
    const { result } = setup();
    act(() => result.current.handleMessageTypeChange('live_document'));
    expect(result.current.showDocModal).toBe(true);
  });

  it('keeps the dialog up, and sends nothing, when Send is pressed with an empty box', async () => {
    const { result } = setup();
    act(() => result.current.handleMessageTypeChange('live_document'));
    await act(async () => { await result.current.handleSendMessage(); });
    expect(result.current.showDocModal).toBe(true);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('still refuses an empty TEXT message', async () => {
    const { result } = setup();
    await act(async () => { await result.current.handleSendMessage(); });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(result.current.showDocModal).toBe(false);
  });
});
