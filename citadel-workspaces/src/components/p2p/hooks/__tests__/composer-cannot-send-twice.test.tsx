/**
 * A second Enter during the send window used to deliver a genuine duplicate.
 *
 * `sendMessage` can spend tens of seconds before the message exists anywhere
 * the user can see -- peer registration is a 10s budget, CheckState another 3s.
 * For that whole window the text stayed in the composer with Send enabled, and
 * the natural reaction ("did it go?") minted a second messageId.
 *
 * These tests pin both halves of the fix: the in-flight guard, and clearing the
 * composer when the bubble appears rather than when the network resolves.
 */

import { describe, it, expect, vi, beforeEach  } from 'vitest';
import { clearAllDraftsForTests } from '@/lib/chat/draft-store';
import { renderHook, act, waitFor  } from '@testing-library/react';
import { useP2PCompose } from '../useP2PCompose';
import { peerTransportFor } from '@/components/p2p/__tests__/doubles/peer-transport';
import type { ChatTransport } from '@/lib/chat/transport/chat-transport';

const sendMessage: ReturnType<typeof vi.fn> = vi.fn();
const stopTypingPolling: ReturnType<typeof vi.fn> = vi.fn();
const startTypingPolling: ReturnType<typeof vi.fn> = vi.fn();

vi.mock('@/lib/p2p/p2p-messenger-manager', () => ({
  P2PMessengerManager: {
    getInstance: (): { sendMessage: typeof sendMessage; stopTypingPolling: typeof stopTypingPolling; startTypingPolling: typeof startTypingPolling } => ({ sendMessage, stopTypingPolling, startTypingPolling }),
  },
}));

vi.mock('@/hooks/use-toast', () => ({ useToast: (): { toast: ReturnType<typeof vi.fn> } => ({ toast: vi.fn() }) }));

// The real adapter over the mocked messenger above.
const transport: ChatTransport = peerTransportFor({ cid: 42n, name: 'Bob' }, null);

function setup(): ReturnType<typeof renderHook<ReturnType<typeof useP2PCompose>, unknown>> {
  return renderHook(() =>
    useP2PCompose({
      transport,
      messages: [],
      editMessage: vi.fn(),
      createDocument: vi.fn(),
    }),
  );
}

describe('P2P composer in-flight guard', () => {
  beforeEach(() => {
    // The composer seeds from the draft store, which is module state: without
    // this, the previous test's text arrives in the next one's empty box.
    clearAllDraftsForTests();

    sendMessage.mockReset();
    stopTypingPolling.mockReset();
  });

  it('sends once when submitted twice during the send window', async () => {
    let release!: () => void;
    sendMessage.mockImplementation(
      (): Promise<void> => new Promise<void>((resolve): void => { release = (): void => resolve(); }),
    );

    const { result } = setup();
    act(() => result.current.setInputMessage('hello'));

    act(() => { void result.current.handleSendMessage(); });
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

    // The impatient second Enter, while the first send is still in flight.
    // Fired, not awaited: without the guard it starts a second send that never
    // settles, and awaiting it would report a timeout instead of the duplicate.
    act(() => { void result.current.handleSendMessage(); });
    expect(sendMessage).toHaveBeenCalledTimes(1);

    await act(async () => { release(); });
  });

  it('clears the composer when the message appears, not when the send resolves', async () => {
    let appended!: () => void;
    let release!: () => void;
    sendMessage.mockImplementation(
      (_cid: bigint, _text: string, options: { onOptimisticAppend?: () => void }) =>
        new Promise<void>((resolve) => {
          appended = (): void | undefined => options.onOptimisticAppend?.();
          release = (): void => resolve();
        }),
    );

    const { result } = setup();
    act(() => result.current.setInputMessage('hello'));
    act(() => { void result.current.handleSendMessage(); });
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

    expect(result.current.inputMessage).toBe('hello');

    act(() => { appended(); });
    await waitFor(() => expect(result.current.inputMessage).toBe(''));
    // ...and the composer is usable again straight away, without waiting out
    // the rest of the round trip.
    expect(result.current.isSending).toBe(false);

    await act(async () => { release(); });
  });

  it('keeps the text when the send fails before the message appears', async () => {
    sendMessage.mockRejectedValue(new Error('peer registration failed'));

    const { result } = setup();
    act(() => result.current.setInputMessage('hello'));
    await act(async () => { await result.current.handleSendMessage(); });

    // No bubble was ever appended, so there is nothing to retry from -- losing
    // the text here would lose the message outright.
    expect(result.current.inputMessage).toBe('hello');
    expect(result.current.isSending).toBe(false);
  });

  it('does not send an empty composer', async () => {
    const { result } = setup();
    await act(async () => { await result.current.handleSendMessage(); });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
