/**
 * Older messages are reachable when the newest page does not fill the view.
 *
 * A chat opens on the newest stored page (50 messages each, agent
 * conversations/store.rs), and older pages were fetched only from a scroll
 * event near the top. A newest page of a few messages does not overflow the
 * viewport, so there is nothing to scroll and no scroll event: the thread read
 * "↑ Scroll up for older messages" over a handful of recent ones and nothing
 * the reader did loaded the rest (owner report 2026-11-15, after a chat's
 * level change reopened it). History is not kept per level or per connection
 * -- the store's keys are (account, peer, page) -- so it was there all along.
 *
 * The chat's own wiring (useP2PMessages + MessageList) over the real peer
 * transport, messenger and agent request path. Stand-ins: the fake agent, which hosts the
 * account and answers ConversationPage from two stored pages; jsdom lays
 * nothing out, which is exactly the viewport that cannot scroll.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { useRef, type RefObject, type MutableRefObject } from 'react';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { registerConversationSender } from '@/lib/agent-conversations/requests';
import { eventEmitter } from '@/lib/event-emitter';
import { useP2PMessages } from '../useP2PMessages';
import { MessageList } from '@/components/chat/pane/MessageList';
import { listProps } from '@/components/chat/pane/__tests__/doubles/list-props';
import { peerTransportFor } from '@/components/p2p/__tests__/doubles/peer-transport';
import type { ChatTransport } from '@/lib/chat/transport/chat-transport';
import { installHostingAgent, settle, PEER, OWN } from './hosting-agent';

function stored(id: string, timestamp: number): Record<string, unknown> {
  return { id, content: `text ${id}`, senderCid: PEER, recipientCid: OWN, timestamp, index: timestamp, status: 'delivered', messageType: 'text' };
}

const NEWEST: Record<string, unknown>[] = [stored('new-1', 2_000), stored('new-2', 2_001)];
const OLDER: Record<string, unknown>[] = [stored('old-1', 1_000), stored('old-2', 1_001)];
const METADATA: Record<string, unknown> = {
  peerCid: PEER, ownerCid: OWN, totalMessageCount: 52, oldestMessageTimestamp: 1_000, newestMessageTimestamp: 2_001,
  latestPage: 1, messagesPerPage: 50, unreadCount: 0, lastMessageIndex: 52, lastUpdated: 2_001,
};

let failPages: boolean = false;
const pagesAsked: Array<number | null> = [];

function answerPages(): void {
  registerConversationSender(async (request: Record<string, unknown>): Promise<void> => {
    const [variant, body] = Object.entries(request)[0] as [string, { request_id: string; page?: number | null }];
    const reply: (message: Record<string, unknown>) => void = (message: Record<string, unknown>): void => {
      queueMicrotask(() => eventEmitter.emit('websocket-message', message));
    };
    if (variant === 'ConversationMarkRead') reply({ ConversationUpdated: { request_id: body.request_id, message: null } });
    if (variant !== 'ConversationPage') return;
    const number: number | null = body.page ?? null;
    pagesAsked.push(number);
    if (failPages && number === 0) {
      reply({ ConversationFailure: { request_id: body.request_id, message: 'the agent could not read page 0' } });
      return;
    }
    const messages: Record<string, unknown>[] = number === 0 ? OLDER : NEWEST;
    reply({
      ConversationPageResponse: {
        request_id: body.request_id, cid: OWN, peer_cid: PEER, metadata: METADATA,
        page: { peerCid: PEER, pageNumber: number ?? 1, messages, timestamps: { minTimestamp: 0, maxTimestamp: 0 } },
      },
    });
  });
}

const noop: () => void = (): void => {};
let transport: ChatTransport;

function Chat(): JSX.Element {
  const viewport: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const tab: MutableRefObject<string> = useRef<string>('messages');
  const pinnedRef: MutableRefObject<boolean> = useRef<boolean>(true);
  const chat: ReturnType<typeof useP2PMessages> = useP2PMessages({ transport, activeTabIdRef: tab, scrollRef: viewport, pinnedRef, onUnreadMessage: noop });
  return (
    <MessageList
      {...listProps(chat.messages)} ref={viewport} selfCid={OWN}
      isLoadingMore={chat.isLoadingMore} isLoadingHistory={chat.isLoadingHistory}
      hasMorePages={chat.hasMorePages} olderPagesError={chat.olderPagesError}
      onLoadOlder={(): void => { void chat.loadOlderMessages(); }} onScroll={chat.handleScroll}
    />
  );
}

/** Mounted, with the newest page on screen. */
async function openChat(): Promise<void> {
  render(<ConfirmDialogProvider><Chat /></ConfirmDialogProvider>);
  // The open runs the real messenger's load chain; on a loaded machine it outlasts the
  // default second. Waiting longer for it changes nothing about what is asserted.
  await screen.findByText('text new-1', undefined, { timeout: 5_000 });
  await settle();
}

const olderControl: () => Promise<HTMLElement> = (): Promise<HTMLElement> => within(thread()).findByRole('button', { name: /load older messages/i });

const thread: () => HTMLElement = (): HTMLElement => screen.getByRole('log', { name: 'Conversation' });

beforeEach(async () => {
  await installHostingAgent();
  answerPages();
  transport = peerTransportFor({ cid: PEER, name: 'Josef' }, OWN);
  failPages = false;
  pagesAsked.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe('a chat whose newest page does not fill the view', () => {
  it('opens on the newest page', async () => {
    await openChat();
    expect(within(thread()).queryByText('text old-1')).toBeNull();
  });

  it('loads the older page from a control, with no scroll at all', async () => {
    await openChat();
    fireEvent.click(await olderControl());
    expect(await within(thread()).findByText('text old-1')).toBeTruthy();
    expect(within(thread()).getByText('text new-2')).toBeTruthy();
    expect(pagesAsked).toContain(0);
    expect(within(thread()).queryByRole('button', { name: /load older messages/i })).toBeNull();
  });

  it('says so when the older page cannot be read, and can be asked again', async () => {
    failPages = true;
    await openChat();
    fireEvent.click(await olderControl());
    expect(await within(thread()).findByText(/could not load older messages/i)).toBeTruthy();
    failPages = false;
    fireEvent.click(await olderControl());
    expect(await within(thread()).findByText('text old-1')).toBeTruthy();
  });
});
