/**
 * The stored session this tab is acting as: the one its own selection names, or none.
 *
 * The stored-session list lives in the agent's store (cid 0), so it is shared by every browser
 * on the machine, and its `activeSessionIndex` is whichever browser wrote last. A tab with no
 * selection of its own used to fall back to that index, so a fresh tab -- or one whose selection
 * was lost -- acted as another browser's account: the agent refused its requests ("the
 * connection does not own it"), peer discovery listed everyone but that account, and a peer
 * request went out as the wrong person. Choosing a session for a tab with no selection is
 * claim-on-start's (pick-session-to-claim.ts), which writes the selection it makes.
 */
import type { StoredSession, StoredSessions } from '@/types/session-types';
import type { TabSelectionContext } from './types';

export function tabSelectedSession(stored: StoredSessions, tab: TabSelectionContext | null): StoredSession | null {
  if (!tab?.selectedUsername || !tab.selectedServerAddress) return null;
  const { selectedUsername, selectedServerAddress }: TabSelectionContext = tab;
  return stored.sessions.find((s: StoredSession) => s.username === selectedUsername && s.serverAddress === selectedServerAddress) ?? null;
}
