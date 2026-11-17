/**
 * Live Doc mode ends when its dialog does, whether a document was made or not.
 *
 * Only choosing a type ever changed the type, so after creating a Live Doc --
 * or cancelling the dialog -- the composer stayed in Live Doc mode, and the next
 * Enter reopened the dialog instead of sending what the user had typed.
 *
 * Mocked: the P2P messenger (network I/O) and toasts, as in
 * live-doc-needs-no-typed-text.test.tsx; the composer hook is production code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { clearAllDraftsForTests } from '@/lib/chat/draft-store';
import { useP2PCompose } from '../useP2PCompose';
import { peerTransportFor } from '@/components/p2p/__tests__/doubles/peer-transport';
import type { ChatTransport } from '@/lib/chat/transport/chat-transport';
import type { ChatDocumentMade } from '../useP2PTabs';

const sendMessage: ReturnType<typeof vi.fn> = vi.fn();
vi.mock('@/lib/p2p/p2p-messenger-manager', () => ({
  P2PMessengerManager: { getInstance: (): Record<string, ReturnType<typeof vi.fn>> => ({ sendMessage, stopTypingPolling: vi.fn(), startTypingPolling: vi.fn() }) },
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: (): { toast: ReturnType<typeof vi.fn> } => ({ toast: vi.fn() }) }));

type Compose = ReturnType<typeof renderHook<ReturnType<typeof useP2PCompose>, unknown>>;

// The real adapter over the mocked messenger above.
const transport: ChatTransport = peerTransportFor({ cid: 42n, name: 'Bob' }, null);

function setup(): Compose {
  const createDocument: () => Promise<ChatDocumentMade> = async (): Promise<ChatDocumentMade> => ({ delivered: Promise.resolve() });
  return renderHook(() => useP2PCompose({ transport, messages: [], editMessage: vi.fn(), createDocument }));
}

async function typeAndSend(compose: Compose, text: string): Promise<void> {
  act(() => compose.result.current.setInputMessage(text));
  await act(async () => { await compose.result.current.handleSendMessage(); });
}

describe('after the Live Doc dialog closes', () => {
  beforeEach(() => { clearAllDraftsForTests(); sendMessage.mockReset(); });

  it('the next message is sent as text once a document was created', async () => {
    const compose: Compose = setup();
    act(() => compose.result.current.handleMessageTypeChange('live_document'));
    await act(async () => { await compose.result.current.handleDocCreate({ app: 'docs', title: 'Notes', initialContent: '' }); });

    expect(compose.result.current.messageType).toBe('text');
    await typeAndSend(compose, 'hello');
    expect(compose.result.current.showDocModal).toBe(false);
    expect(sendMessage).toHaveBeenCalledWith(42n, 'hello', expect.objectContaining({ messageType: 'text' }));
  });

  it('the next message is sent as text once the dialog was cancelled', async () => {
    const compose: Compose = setup();
    act(() => compose.result.current.handleMessageTypeChange('live_document'));
    act(() => compose.result.current.closeDocModal());

    expect(compose.result.current.messageType).toBe('text');
    await typeAndSend(compose, 'hello');
    expect(compose.result.current.showDocModal).toBe(false);
    expect(sendMessage).toHaveBeenCalledWith(42n, 'hello', expect.objectContaining({ messageType: 'text' }));
  });
});
