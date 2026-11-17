/**
 * Switching accounts left the previous account's messages on screen.
 *
 * `ConversationManager` is a module-lifetime cache keyed by peer, holding up to
 * 100 messages per conversation. `P2PMessengerManager.setupEventListeners`
 * binds `on-ws-connection-success`, `websocket-message` and
 * `p2p-connection-established` — and nothing for a change of session.
 *
 * So after an orphan-session claim (the multi-workspace path, an SPA navigate
 * with no reload) `instanceManager.cid` changes, the groups rescope — the group
 * store binds `instance:cid-changed` and calls `resetGroupsForSession` — and the
 * P2P cache does not. The peer list renders the previous account's
 * conversations for the new account, opening one shows the previous account's
 * message window, and the new account's own history cannot load because
 * `cachedMessagesLoaded` is already true and short-circuits the reload.
 *
 * The twin fix existed and was not carried across. That is the defect class this
 * campaign has found most often.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let currentCid: bigint | null = 111n;
const loads: Array<bigint | null> = [];

vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { get cid(): bigint | null { return currentCid; } }) };
});
vi.mock('../../websocket-service', () => ({
  websocketService: {
    sendLocalDBListKeys: async (): Promise<string[]> => { loads.push(currentCid); return []; },
    sendLocalDBGet: async (): Promise<{ value: string }> => { throw new Error('none'); },
    sendLocalDBSet: async (): Promise<undefined> => undefined,
    sendLocalDBDelete: async (): Promise<undefined> => undefined,
  },
}));

const { ConversationManager } = await import('../conversation-manager');
const { resetConversationsForSession } = await import('../reset-conversations');

const PEER: bigint = 900n;
const CONFIG: never = { maxQueueSize: 100, maxMessagesPerConversation: 100 } as never;

describe('switching session', () => {
  beforeEach((): void => { currentCid = 111n; loads.length = 0; });

  it('drops the previous account’s conversations', async () => {
    const manager: InstanceType<typeof ConversationManager> = new ConversationManager(CONFIG);
    manager.getOrCreateConversation(PEER, 'someone-alice-knows');
    expect(manager.getAllConversations()).toHaveLength(1);

    currentCid = 222n;
    await resetConversationsForSession(manager as never);

    expect(manager.getAllConversations()).toEqual([]);
  });

  it('reloads under the new session rather than staying empty', async () => {
    // Clearing alone would leave the new account with no history at all, which
    // is a different bug wearing the same fix.
    const manager: InstanceType<typeof ConversationManager> = new ConversationManager(CONFIG);
    manager.getOrCreateConversation(PEER, 'someone-alice-knows');

    currentCid = 222n;
    await resetConversationsForSession(manager as never);

    expect(loads).toContain(222n);
  });

  it('drops connection state too', async () => {
    // A peer marked connected for the previous account renders as online for
    // the new one, on a channel it has no session for.
    const manager: InstanceType<typeof ConversationManager> = new ConversationManager(CONFIG);
    manager.setConnection(PEER, true);
    expect(manager.isConnected(PEER)).toBe(true);

    currentCid = 222n;
    await resetConversationsForSession(manager as never);

    expect(manager.isConnected(PEER)).toBe(false);
  });
});

/**
 * The reload's own failure must stay retryable.
 *
 * `resetConversationsForSession` swallows a storage error on purpose — leaving
 * the previous account's messages in place would be worse — but it reported
 * success either way, and the caller turned that into `cachedMessagesLoaded =
 * true`. The `on-ws-connection-success` handler skips the load entirely when
 * that flag is set, so a single failed read left the account with a permanently
 * empty conversation list and nothing that would ever try again.
 *
 * Fail-open where it should fail closed: the flag means "this account's history
 * is in the cache", and it was being set by a path that had just failed to put
 * it there.
 */
describe('a reload that fails', () => {
  beforeEach((): void => { currentCid = 111n; loads.length = 0; });

  it('reports success when the history really loaded', async () => {
    const manager: InstanceType<typeof ConversationManager> = new ConversationManager(CONFIG);
    await expect(resetConversationsForSession(manager as never)).resolves.toBe(true);
  });

  it('reports failure so the connection path retries', async () => {
    const manager: InstanceType<typeof ConversationManager> = new ConversationManager(CONFIG);
    vi.spyOn(manager, 'loadFromStorage').mockRejectedValue(new Error('IndexedDB unavailable'));

    await expect(resetConversationsForSession(manager as never)).resolves.toBe(false);
  });

  it('still drops the previous account’s messages when the reload fails', async () => {
    // The swallow is deliberate and must stay: a failed read is not a reason to
    // show the outgoing account's conversations to the incoming one.
    const manager: InstanceType<typeof ConversationManager> = new ConversationManager(CONFIG);
    manager.getOrCreateConversation(PEER, 'someone-alice-knows');
    vi.spyOn(manager, 'loadFromStorage').mockRejectedValue(new Error('IndexedDB unavailable'));

    currentCid = 222n;
    await resetConversationsForSession(manager as never);

    expect(manager.getAllConversations()).toEqual([]);
  });
});
