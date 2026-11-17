/**
 * Message Retention deletes, from this device's stored conversation, every
 * message older than the chosen period -- and nothing else.
 *
 * The slider used to be static text ("90 days") over an uncontrolled input:
 * no store, no consumer, nothing ever deleted.
 *
 * The page store is the local agent's LocalDB over the WebSocket, so it is
 * replaced by an in-memory `RetentionPageIO` here; the pruning, the metadata
 * arithmetic and the cutoff are production code.
 */
import { describe, it, expect } from 'vitest';
import { pruneOlderThan, retentionCutoff, type RetentionPageIO } from '../retention';
import { recordAppend } from '../message-page-append';
import type { ConversationMetadata, MessagePage, P2PMessage } from '../p2p-types';

const PEER: bigint = 5n;
const OWN: bigint = 4n;
const DAY: number = 24 * 60 * 60 * 1000;
const NOW: number = Date.UTC(2026, 8, 25);

function message(id: string, timestamp: number): P2PMessage {
  return {
    id, content: id, senderCid: PEER, recipientCid: OWN, timestamp, index: 0,
    status: 'delivered', message_type: 'text',
  } as P2PMessage;
}

function page(n: number, messages: P2PMessage[]): MessagePage {
  return {
    peerCid: PEER, pageNumber: n, messages,
    pageTimestamps: { minTimestamp: messages[0]?.timestamp ?? 0, maxTimestamp: messages[messages.length - 1]?.timestamp ?? 0 },
  };
}

interface Store extends RetentionPageIO { pages: Map<number, MessagePage>; meta: ConversationMetadata; writes: number }

function store(pages: MessagePage[]): Store {
  const all: P2PMessage[] = pages.flatMap((p: MessagePage) => p.messages);
  const s: Store = {
    pages: new Map(pages.map((p: MessagePage) => [p.pageNumber, structuredClone(p)])),
    meta: {
      peerCid: PEER, ownerCid: OWN, totalMessageCount: all.length,
      oldestMessageTimestamp: Math.min(...all.map((m: P2PMessage) => m.timestamp)),
      newestMessageTimestamp: Math.max(...all.map((m: P2PMessage) => m.timestamp)),
      latestPage: pages.length - 1, messagesPerPage: 50, unreadCount: 0, lastMessageIndex: 0, lastUpdated: 0,
    },
    writes: 0,
    loadMetadata: async (): Promise<ConversationMetadata | null> => structuredClone(s.meta),
    loadPage: async (_peer: bigint, n: number): Promise<MessagePage | null> => structuredClone(s.pages.get(n) ?? null),
    savePage: async (_peer: bigint, n: number, p: MessagePage): Promise<void> => { s.writes++; s.pages.set(n, structuredClone(p)); },
    saveMetadata: async (_peer: bigint, m: ConversationMetadata): Promise<void> => { s.writes++; s.meta = structuredClone(m); },
  };
  return s;
}

const ids = (s: Store): string[] => [...s.pages.values()].flatMap((p: MessagePage) => p.messages.map((m: P2PMessage) => m.id));

describe('retentionCutoff', () => {
  it('is the moment the period began, or null when everything is kept', () => {
    expect(retentionCutoff(NOW, 7)).toBe(NOW - 7 * DAY);
    expect(retentionCutoff(NOW, 'forever')).toBeNull();
  });
});

describe('pruneOlderThan', () => {
  it('deletes the older messages, in every page, and keeps the rest', async () => {
    const s: Store = store([
      page(0, [message('a', NOW - 40 * DAY), message('b', NOW - 31 * DAY)]),
      page(1, [message('c', NOW - 29 * DAY)]),
      // An offline message delivered late sits in a NEWER page, past one that
      // is kept whole, so the prune cannot stop at the first page it keeps.
      page(2, [message('late', NOW - 35 * DAY), message('d', NOW - DAY)]),
    ]);

    const removed: number = await pruneOlderThan(s, PEER, NOW - 30 * DAY);

    expect(removed).toBe(3);
    expect(ids(s)).toEqual(['c', 'd']);
    expect(s.meta.totalMessageCount).toBe(2);
    expect(s.meta.oldestMessageTimestamp).toBe(NOW - 29 * DAY);
    expect(s.pages.get(2)?.pageTimestamps.minTimestamp).toBe(NOW - DAY);
  });

  it('writes nothing when nothing stored is old enough', async () => {
    const s: Store = store([page(0, [message('a', NOW - DAY)])]);
    expect(await pruneOlderThan(s, PEER, NOW - 7 * DAY)).toBe(0);
    expect(s.writes).toBe(0);
    expect(ids(s)).toEqual(['a']);
  });

  it('leaves a conversation emptied by retention able to record its next message', async () => {
    const s: Store = store([page(0, [message('a', NOW - 10 * DAY)])]);
    expect(await pruneOlderThan(s, PEER, NOW - 7 * DAY)).toBe(1);
    expect(ids(s)).toEqual([]);
    expect(s.meta.totalMessageCount).toBe(0);

    // The next message is the conversation's oldest again; without that, the
    // stats tab and the prune's own fast path read a timestamp that is gone.
    const next: P2PMessage = message('new', NOW);
    recordAppend(s.meta, next, false, OWN);
    expect(s.meta.oldestMessageTimestamp).toBe(NOW);
  });

  it('does nothing for a conversation that has no stored record', async () => {
    const s: Store = store([page(0, [message('a', NOW - 10 * DAY)])]);
    s.loadMetadata = async (): Promise<ConversationMetadata | null> => null;
    expect(await pruneOlderThan(s, PEER, NOW)).toBe(0);
    expect(s.writes).toBe(0);
  });
});
