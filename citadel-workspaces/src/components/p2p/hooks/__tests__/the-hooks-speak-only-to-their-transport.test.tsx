/**
 * The chat's hooks reach a conversation only through the transport they are given.
 *
 * `useP2PMessages` took `P2PMessengerManager.getInstance()` itself, so the one chat that had live
 * documents, ticks and retry could only ever talk to a peer: a node channel needed a second
 * component. With the port, the same hooks drive any transport. These tests hand the hooks a
 * recording fake and make the messenger singleton refuse to be reached, so a hook that goes
 * around its transport fails here instead of quietly working for direct chats only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { MutableRefObject } from 'react';

vi.mock('@/lib/p2p/p2p-messenger-manager', () => ({
  P2PMessengerManager: { getInstance: (): never => { throw new Error('the hooks must reach the conversation through its transport'); } },
}));

import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { clearAllDraftsForTests } from '@/lib/chat/draft-store';
import { useP2PMessages } from '../useP2PMessages';
import { useP2PCompose } from '../useP2PCompose';
import { useCatchUpRead } from '../use-catch-up-read';
import { fakeTransport, fakeMessage, type Recorded } from '@/lib/chat/transport/__tests__/doubles/fake-transport';
import type { ChatMessage, ChatTransport } from '@/lib/chat/transport/chat-transport';
import type { StatedFeatures } from '@/lib/chat/transport/features';

const STATED: StatedFeatures = { markdown: true, readReceipts: true, securityLevel: false, retention: false, optimistic: true, namesSenders: true };
let transport: ChatTransport;
let recorded: Recorded;
// Stable, as the chat's own useCallback is: a fresh one per render re-runs the conversation's effect.
const onUnreadMessage = (): void => {};

beforeEach(() => {
  clearAllDraftsForTests();
  ({ transport, recorded } = fakeTransport({
    kind: 'node', self: { cid: 1n, username: 'me', displayName: 'You' }, counterpart: 'General',
    latest: { messages: [fakeMessage('m1', 'hello', 10, false)], older: { kind: 'before', timestamp: 10n } },
    stated: STATED, ports: { status: true, files: true, documents: true, settings: false, revise: true, reactions: true }, sendGate: 'allowed', recordsOnSend: true,
  }));
});

const refs = (): { tab: MutableRefObject<string>; pinned: MutableRefObject<boolean> } => ({ tab: { current: 'other' }, pinned: { current: true } });

describe('useP2PMessages over a transport', () => {
  it('loads, listens, pages and acts through the transport', async () => {
    const { tab, pinned } = refs();
    const { result } = renderHook(() => useP2PMessages({ transport, activeTabIdRef: tab, scrollRef: { current: null }, pinnedRef: pinned, onUnreadMessage }), { wrapper: ConfirmDialogProvider });

    await waitFor(() => expect(result.current.messages.map((m) => m.id)).toEqual(['m1']));
    expect(result.current.hasMorePages).toBe(true);
    expect(recorded.calls).toEqual(expect.arrayContaining(['history.focus', 'history.loadLatest', 'history.subscribe', 'status.probe']));

    act(() => recorded.emit({ kind: 'arrived', message: fakeMessage('m2', 'there', 20, false), incoming: true }));
    expect(result.current.messages.map((m) => m.id)).toEqual(['m1', 'm2']);

    await act(async () => {
      await result.current.handleEditMessage('m1', 'changed');
      result.current.handleReactMessage('m1', '👍');
      await result.current.handleRetryMessage({ id: 'm2', status: 'failed' });
    });
    expect(recorded.calls).toEqual(expect.arrayContaining(['send.edit:m1:changed', 'send.react:m1:👍', 'send.retry:m2']));

    act(() => recorded.status({ kind: 'typing', typing: ['Alice'] }));
    expect(result.current.typing).toEqual(['Alice']);
  });

  it('marks read through the transport when the reader catches up', () => {
    const { tab, pinned } = refs();
    tab.current = 'messages';
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const { result } = renderHook(() => useCatchUpRead(transport.history, tab, pinned));
    act(() => result.current());
    expect(recorded.calls).toContain('history.markRead:all');
  });
});

describe('useP2PCompose over a transport', () => {
  it('sends the typed text, its kind and its reply through the transport', async () => {
    const messages: ChatMessage[] = [fakeMessage('m1', 'hello', 10, false)];
    const { result } = renderHook(() => useP2PCompose({ transport, messages, editMessage: vi.fn(), createDocument: vi.fn() }));
    act(() => result.current.handleReplyMessage('m1'));
    act(() => result.current.handleMessageTypeChange('markdown'));
    act(() => result.current.setInputMessage('**hi**'));
    await act(async () => { await result.current.handleSendMessage(); });

    expect(recorded.texts.map(({ content, messageType, replyTo }) => ({ content, messageType, replyTo })))
      .toEqual([{ content: '**hi**', messageType: 'markdown', replyTo: 'm1' }]);
    expect(result.current.inputMessage).toBe('');
    expect(recorded.calls).toContain('status.stopTyping');
  });
});
