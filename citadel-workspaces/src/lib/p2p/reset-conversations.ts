/**
 * Rescoping the P2P conversation cache when the account changes.
 *
 * `ConversationManager` is a module-lifetime cache keyed by peer, holding up to
 * 100 messages per conversation, and `P2PMessengerManager.setupEventListeners`
 * binds nothing for a change of session. So after an orphan-session claim — the
 * multi-workspace path, an SPA navigate with no reload — the previous account's
 * conversations stayed in the cache: the peer list rendered them for the new
 * account, opening one showed the previous account's message window, and the new
 * account's own history could not load because `cachedMessagesLoaded` was
 * already true.
 *
 * The group store solved exactly this with `resetGroupsForSession`, bound to
 * `instance:cid-changed`. This is its twin, which was never written.
 *
 * Clearing alone is not the fix: an account with an empty conversation list is a
 * different bug wearing the same change. The reload is part of it.
 */
import type { ConversationManager } from './conversation-manager';
import type { MessageCache } from './p2p-types';
import { debugLog } from '@/lib/debug-config';

/** Everything the outgoing account left in the cache. */
export function clearSessionState(cache: MessageCache, connections: Map<bigint, boolean>): void {
  cache.conversations.clear();
  cache.messageQueue.length = 0;
  connections.clear();
}

/**
 * Returns whether the new account's history actually loaded.
 *
 * The caller uses this to decide whether the load may be retried. Reporting
 * success unconditionally is what made a swallowed error permanent: the
 * `on-ws-connection-success` handler skips loading when the cache is already
 * marked loaded, so one failed read here left the account with an empty
 * conversation list for the lifetime of the session.
 */
export async function resetConversationsForSession(
  conversationManager: ConversationManager,
): Promise<boolean> {
  conversationManager.clearForSessionChange();

  try {
    await conversationManager.loadFromStorage();
    return true;
  } catch (error) {
    // The cache is empty and correct either way; the next connection retries,
    // which is what the `false` is for. Leaving the PREVIOUS account's messages
    // in place would be the worse failure, so this does not put them back.
    debugLog('P2PMessengerManager', 'Could not load conversations for the new session', error);
    return false;
  }
}

/**
 * Rescope the conversation cache whenever the account changes.
 *
 * Named `bind…` so `check-installers-are-called` covers it: an installer that
 * nothing calls is inert, and this one going missing is precisely the state the
 * module exists to fix.
 */
export function bindConversationSessionReset(
  listen: <T>(event: string, handler: (data: T) => void) => void,
  conversationManager: ConversationManager,
  onReloaded: (loaded: boolean) => void,
  onReloading: () => void,
): void {
  listen<{ cid: bigint | null }>('instance:cid-changed', (data) => {
    if (data.cid === null) return;
    onReloading();
    void resetConversationsForSession(conversationManager).then(onReloaded);
  });
}

/**
 * Load this account's history once the WebSocket is up.
 *
 * The twin of `bindConversationSessionReset`, and it lives beside it because the
 * two share the flag that decides whether a load may happen at all: this one
 * skips when the cache is already marked loaded, and that is precisely what a
 * falsely-set flag disables for the lifetime of the session. Reading them apart
 * is how the fail-open above survived review.
 */
export function bindCachedMessageLoad(
  listen: (event: string, handler: () => void | Promise<void>) => void,
  isLoaded: () => boolean,
  load: () => Promise<void>,
  onLoaded: () => void,
): void {
  listen('on-ws-connection-success', async () => {
    if (isLoaded()) return;
    debugLog('P2PMessengerManager', '[P2P] WebSocket connected, loading cached messages...');
    await load();
    if (isLoaded()) onLoaded();
  });
}
