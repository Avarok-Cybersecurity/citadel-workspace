/**
 * A chat with someone you are not registered with opens anyway (owner, 2026-10-15) and says
 * what to do: under the workspace's messaging trust the request goes out on open, otherwise the
 * banner offers it. A message written before they accept is not refused (owner, 2026-10-16): it
 * is held, shown pending, and says it sends when they accept (lib/p2p/held-until-registered.ts).
 *
 * The hook runs with its three effects injected (the trust check, the send, the outgoing record);
 * the composer and the bubble footer are the production components.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useConnectRequest, type ConnectRequest, type ConnectRequestDeps } from '../hooks/use-connect-request';
import { MessageInput } from '@/components/chat/pane/MessageInput';
import { paneTestIds } from '@/components/chat/pane/pane-test-ids';
import { BubbleFooter } from '../bubbles/BubbleFooter';
import { AwaitingAcceptContext, awaitingAcceptPlaceholder } from '../bubbles/awaiting-accept';
import type { P2PMessage } from '@/lib/p2p/p2p-types';
import type { PeerTrust } from '@/lib/workspace-service/messaging-trust-operations';

afterEach(cleanup);

function deps(trust: PeerTrust | Error, alreadyAsked: boolean = false): ConnectRequestDeps & { send: ReturnType<typeof vi.fn> } {
  return {
    askTrust: (): Promise<PeerTrust> => (trust instanceof Error ? Promise.reject(trust) : Promise.resolve(trust)),
    send: vi.fn(async (): Promise<boolean> => true),
    alreadyAsked: (): boolean => alreadyAsked,
  };
}

const NOBODY: PeerTrust = { trusted: false, peerTrustsCaller: false };
const BOTH: PeerTrust = { trusted: true, peerTrustsCaller: true };
const ONLY_US: PeerTrust = { trusted: true, peerTrustsCaller: false };

describe('the connect request in an unconnected chat', () => {
  it('is sent on open when both sides trust each other, and reads Connecting', async () => {
    const d: ReturnType<typeof deps> = deps(BOTH);
    const { result } = renderHook((): ConnectRequest => useConnectRequest(false, true, d));
    await waitFor((): void => expect(result.current.stage).toBe('connecting'));
    expect(d.send).toHaveBeenCalledTimes(1);
  });

  it('is sent on open but waits when the peer\'s own setting is stricter', async () => {
    const d: ReturnType<typeof deps> = deps(ONLY_US);
    const { result } = renderHook((): ConnectRequest => useConnectRequest(false, true, d));
    await waitFor((): void => expect(result.current.stage).toBe('waiting'));
    expect(d.send).toHaveBeenCalledTimes(1);
  });

  it('is offered, not sent, when the server does not trust the peer or cannot say', async () => {
    for (const trust of [NOBODY, new Error('timed out')]) {
      const d: ReturnType<typeof deps> = deps(trust);
      const { result, unmount } = renderHook((): ConnectRequest => useConnectRequest(false, true, d));
      await act(async (): Promise<void> => { await Promise.resolve(); });
      expect(result.current.stage).toBe('offer');
      expect(d.send).not.toHaveBeenCalled();
      act((): void => result.current.request());
      await waitFor((): void => expect(result.current.stage).toBe('waiting'));
      expect(d.send).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it('is not sent again when one is outstanding, nor at all to a contact or before a session', async () => {
    const outstanding: ReturnType<typeof deps> = deps(BOTH, true);
    const { result } = renderHook((): ConnectRequest => useConnectRequest(false, true, outstanding));
    await waitFor((): void => expect(result.current.stage).toBe('connecting'));
    const contact: ReturnType<typeof deps> = deps(BOTH);
    renderHook((): ConnectRequest => useConnectRequest(true, true, contact));
    const noSession: ReturnType<typeof deps> = deps(BOTH);
    renderHook((): ConnectRequest => useConnectRequest(false, false, noSession));
    await act(async (): Promise<void> => { await Promise.resolve(); });
    expect([outstanding.send, contact.send, noSession.send].map((s) => s.mock.calls.length)).toEqual([0, 0, 0]);
  });
});

describe('the composer while they have not accepted', () => {
  it('still sends, and says the message will wait for them; files need the link', () => {
    const onSubmit: () => void = vi.fn();
    render(
      <MessageInput
        features={{ markdown: true, documents: true, files: true }}
        testId={paneTestIds('peer').input['data-testid']}
        inputMessage="hello" messageType="text" showMarkdownPreview={false}
        paused={false} isSending={false} awaitingAcceptFrom="Bob"
        onInputChange={vi.fn()} onInputFocus={vi.fn()} onInputBlur={vi.fn()}
        onSubmit={onSubmit} onFileClick={vi.fn()} fileDestination={null} onFormat={vi.fn()}
        onTogglePreview={vi.fn()} onMessageTypeChange={vi.fn()}
      />,
    );
    const input: HTMLElement = screen.getByTestId('p2p-message-input');
    expect(input.getAttribute('placeholder')).toBe(awaitingAcceptPlaceholder('Bob'));
    expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Send file' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('a message held for someone who has not accepted', () => {
  const pending: P2PMessage = { id: 'm1', content: 'hi', senderCid: 1n, recipientCid: 2n, timestamp: 1, index: 0, status: 'pending', message_type: 'text' };

  it('shows the clock and says when it sends', () => {
    render(<AwaitingAcceptContext.Provider value="Bob"><BubbleFooter message={pending} isOwn /></AwaitingAcceptContext.Provider>);
    expect(screen.getByTestId('message-status-pending')).toBeTruthy();
    expect(screen.getByTestId('message-held-note').textContent).toBe('Sends when Bob accepts');
  });

  it('says nothing of the kind once they have, or once it is no longer pending', () => {
    // The discrimination for the case above: the note follows the wait, not the clock.
    render(<AwaitingAcceptContext.Provider value={null}><BubbleFooter message={pending} isOwn /></AwaitingAcceptContext.Provider>);
    render(<AwaitingAcceptContext.Provider value="Bob"><BubbleFooter message={{ ...pending, status: 'sent' }} isOwn /></AwaitingAcceptContext.Provider>);
    expect(screen.queryByTestId('message-held-note')).toBeNull();
  });
});
