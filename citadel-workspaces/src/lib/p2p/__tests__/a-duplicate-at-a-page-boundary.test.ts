/**
 * A redelivered message landing exactly when a page fills was stored twice.
 *
 * `appendUnserialised` rolls the page over BEFORE it checks for a duplicate:
 *
 *   1. the current page is full, so it is saved and `latestPage` advances;
 *   2. `currentPage` becomes a fresh, EMPTY page;
 *   3. the duplicate check runs against that empty page and finds nothing;
 *   4. the message is written into the new page.
 *
 * The copy it should have matched is on the page that was just closed. Two
 * copies, in different pages, permanently — and the render-side merge dedups
 * across batches but not within one, so both show.
 *
 * The check is also only ever against ONE page, which is narrower than the
 * window it exists for: ILM's delivered-set is memory-only, so after a reload it
 * redelivers whatever is still in its persisted inbound map, and that need not
 * all fall inside the newest 50 messages.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { greetAs } from '@/lib/agent-conversations/__tests__/agent-greeting';
import { MESSAGES_PER_PAGE, type MessagePage, type ConversationMetadata, type P2PMessage } from '../p2p-types';

const pages: Map<string, MessagePage> = new Map<string, MessagePage>();
let metadata: ConversationMetadata | null = null;

vi.mock('../message-page-operations', () => ({
  loadMetadata: async (): Promise<ConversationMetadata | null> => metadata,
  tryLoadMetadata: async (): Promise<ConversationMetadata | null> => metadata,
  saveMetadata: async (_cid: bigint, m: ConversationMetadata): Promise<void> => { metadata = m; },
  loadMessagePage: async (_cid: bigint, n: number): Promise<MessagePage | null> => pages.get(String(n)) ?? null,
  tryLoadMessagePage: async (_cid: bigint, n: number): Promise<MessagePage | null> => pages.get(String(n)) ?? null,
  saveMessagePage: async (_cid: bigint, n: number, p: MessagePage): Promise<void> => { pages.set(String(n), p); },
}));
vi.mock('../peer-write-lock', () => ({
  withPeerLock: async <T>(_cid: bigint, fn: () => Promise<T>): Promise<T> => fn(),
}));

const { messagePaginationStore } = await import('../message-pagination-store');

const PEER: bigint = 900n;
const ME: bigint = 100n;

function message(id: string, timestamp: number): P2PMessage {
  return { id, timestamp, index: timestamp, senderCid: PEER, status: 'delivered' } as unknown as P2PMessage;
}

function fullPage(): MessagePage {
  const messages: P2PMessage[] = Array.from({ length: MESSAGES_PER_PAGE }, (_, i) =>
    message(`m${i}`, i + 1),
  );
  return {
    peerCid: PEER,
    pageNumber: 0,
    messages,
    pageTimestamps: { minTimestamp: 1, maxTimestamp: MESSAGES_PER_PAGE },
  } as unknown as MessagePage;
}

function allStored(): string[] {
  return [...pages.values()].flatMap((p) => p.messages.map((m) => m.id));
}

async function append(m: P2PMessage): Promise<void> {
  await messagePaginationStore.appendMessageToPage(
    PEER,
    m,
    async (): Promise<bigint | null> => ME,
    (): string | undefined => 'peer',
  );
}


// The browser-written store is the path for an agent before 0.8.6; this tab's socket greeted one.
beforeAll(() => greetAs('older'));
describe('a duplicate arriving as a page fills', () => {
  beforeEach((): void => {
    pages.clear();
    pages.set('0', fullPage());
    metadata = {
      peerCid: PEER, ownerCid: ME, peerUsername: 'peer',
      totalMessageCount: MESSAGES_PER_PAGE,
      oldestMessageTimestamp: 1, newestMessageTimestamp: MESSAGES_PER_PAGE,
      latestPage: 0, messagesPerPage: MESSAGES_PER_PAGE,
      unreadCount: 0, lastMessageIndex: MESSAGES_PER_PAGE, lastUpdated: 0,
    } as unknown as ConversationMetadata;
  });

  it('is not stored a second time on the new page', async (): Promise<void> => {
    // `m49` is the last message of the full page — the exact copy the rollover
    // hides by emptying `currentPage` before the check runs.
    await append(message('m49', MESSAGES_PER_PAGE));

    const ids: string[] = allStored();
    expect(
      ids.filter((id) => id === 'm49').length,
      'the duplicate rolled onto a fresh page and was never compared to the copy that was there',
    ).toBe(1);
  });

  it('still stores a genuinely new message, rolling the page over', async (): Promise<void> => {
    // The opposite failure: deduping against everything, or refusing the
    // rollover, would drop real messages — and the assertion above cannot see it.
    await append(message('brand-new', MESSAGES_PER_PAGE + 1));

    expect(allStored()).toContain('brand-new');
    expect(pages.size, 'the page did not roll over').toBe(2);
  });

  it('still catches a duplicate within a page that is not full', async (): Promise<void> => {
    // The case that always worked, kept honest.
    pages.set('0', {
      peerCid: PEER, pageNumber: 0,
      messages: [message('only', 1)],
      pageTimestamps: { minTimestamp: 1, maxTimestamp: 1 },
    } as unknown as MessagePage);

    await append(message('only', 1));

    expect(allStored().filter((id) => id === 'only').length).toBe(1);
  });

  it('catches a redelivery whose twin is on the previous page', async (): Promise<void> => {
    // The case the rollover ordering CANNOT reach: no page fills here. Page 1 is
    // current and half empty, and the redelivered message was stored on page 0.
    // Only looking back a page finds it.
    pages.set('1', {
      peerCid: PEER, pageNumber: 1,
      messages: [message('newer', MESSAGES_PER_PAGE + 1)],
      pageTimestamps: { minTimestamp: MESSAGES_PER_PAGE + 1, maxTimestamp: MESSAGES_PER_PAGE + 1 },
    } as unknown as MessagePage);
    metadata = { ...metadata, latestPage: 1 } as unknown as ConversationMetadata;

    await append(message('m10', 11));

    expect(
      allStored().filter((id) => id === 'm10').length,
      'a redelivery older than the current page was stored again',
    ).toBe(1);
  });
});

/**
 * WHICH HALF OF THE FIX IS PROVEN, stated because the controls disagreed with
 * the commit message before this note existed.
 *
 * Two things changed: the duplicate check moved BEFORE the page rollover, and it
 * now looks at the previous page as well. Each of them alone catches the
 * boundary case above — so neither control can fail it, and the boundary test
 * proves only that *something* catches it.
 *
 * What is independently proven is the previous-page lookup, by the test directly
 * above: no page fills, so ordering is irrelevant, and disabling the lookup
 * fails it.
 *
 * The ordering change is NOT independently observable while the lookup exists.
 * It stays because checking for a duplicate before mutating page state is
 * correct on its own terms — the rollover writes a page and advances a pointer
 * for a message that is then discarded — but it is recorded here as reasoning,
 * not as something a control demonstrated.
 */
