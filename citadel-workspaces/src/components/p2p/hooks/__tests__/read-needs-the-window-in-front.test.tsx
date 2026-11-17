/**
 * "Seen" means the person looked. A window that is visible but not focused
 * (another app in front) is not looking: marking read there told the sender
 * "Seen" for messages nobody had read.
 *
 * Drives the real useP2PMessages, the real P2PMessengerManager and the real
 * agent request path. The only stand-ins are the fake agent (the request
 * sender, which also answers, and the agent's declaration that it hosts the
 * account) and `document.hasFocus`, the browser fact under test. Each test
 * asserts on what reaches the agent: a ConversationMarkRead.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { P2PMessengerManager, type P2PMessage } from '@/lib/p2p';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { useP2PMessages } from '../useP2PMessages';
import { installHostingAgent, settle, PEER, OWN, type HostingAgent } from './hosting-agent';
import { peerTransportFor } from '@/components/p2p/__tests__/doubles/peer-transport';
import type { ChatTransport } from '@/lib/chat/transport/chat-transport';

const onUnreadMessage: () => void = (): void => {};

/** `pinned`: the reader is at the bottom (the default for a freshly opened chat). */
function mount(tab: string, pinned: boolean = true): ReturnType<typeof renderHook> {
  const activeTabIdRef: { current: string } = { current: tab };
  const pinnedRef: { current: boolean } = { current: pinned };
  return renderHook(() => useP2PMessages({
    transport, activeTabIdRef, scrollRef: { current: null }, pinnedRef, onUnreadMessage,
  }), { wrapper: ConfirmDialogProvider });
}

let agent: HostingAgent;
let transport: ChatTransport;
const markReads = (): unknown[] => agent.markReads();

beforeEach(async () => {
  agent = await installHostingAgent();
  transport = peerTransportFor({ cid: PEER, name: 'Alice' }, OWN);
});
afterEach(() => vi.restoreAllMocks());

describe('marking a conversation read', () => {
  it('does nothing in a window that is visible but not focused', async () => {
    mount('messages');
    await settle();
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await settle();
    expect(markReads()).toHaveLength(0);
  });

  it('happens when the window gains focus', async () => {
    mount('messages');
    await settle();
    expect(markReads()).toHaveLength(0);
    agent.setFocused(true);
    act(() => { window.dispatchEvent(new Event('focus')); });
    await settle();
    expect(markReads()).toHaveLength(1);
  });

  it('does not happen on gaining focus while another tab (a document) is showing', async () => {
    mount('doc-1');
    await settle();
    agent.setFocused(true);
    act(() => { window.dispatchEvent(new Event('focus')); });
    await settle();
    expect(markReads()).toHaveLength(0);
  });

  it('happens on open when the window is in front', async () => {
    agent.setFocused(true);
    mount('messages');
    await settle();
    expect(markReads()).toHaveLength(1);
  });

  describe('on a message arriving', () => {
    /** Mounts, and returns a function that delivers a message from the peer through the real listener. */
    async function mountAndReceive(tab: string, pinned: boolean = true): Promise<() => Promise<void>> {
      const messenger: P2PMessengerManager = P2PMessengerManager.getInstance();
      let deliver: ((m: P2PMessage) => void) | null = null;
      const real: P2PMessengerManager['onMessage'] = messenger.onMessage.bind(messenger);
      vi.spyOn(messenger, 'onMessage').mockImplementation((cb) => { deliver = cb; return real(cb); });
      mount(tab, pinned);
      await settle();
      agent.clear();
      return async (): Promise<void> => {
        act(() => { deliver?.({ id: 'm1', senderCid: PEER, recipientCid: OWN, timestamp: 1 } as unknown as P2PMessage); });
        await settle();
      };
    }

    it('is not read by a window that is visible but not focused', async () => {
      const arrive: () => Promise<void> = await mountAndReceive('messages');
      await arrive();
      expect(markReads()).toHaveLength(0);
    });

    it('is read when the window is in front on the Messages tab', async () => {
      agent.setFocused(true);
      const arrive: () => Promise<void> = await mountAndReceive('messages');
      await arrive();
      expect(markReads()).toHaveLength(1);
    });

    it('is NOT read when the window is in front but the reader has scrolled up', async () => {
      agent.setFocused(true);
      const arrive: () => Promise<void> = await mountAndReceive('messages', false);
      await arrive();
      expect(markReads()).toHaveLength(0);
    });

    it('is not read when the window is in front but another tab is showing', async () => {
      agent.setFocused(true);
      const arrive: () => Promise<void> = await mountAndReceive('doc-1');
      await arrive();
      expect(markReads()).toHaveLength(0);
    });
  });
});
