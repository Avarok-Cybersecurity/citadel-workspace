import type { TabUserContext } from '@/lib/tab-context';
import type { StoredSession } from '@/types/session-types';
import type { ChatSelf } from '@/lib/chat/transport/chat-transport';

/** Who this tab is, as far as anything on screen needs to know. */
export interface TabIdentity {
  username?: string;
  fullName?: string;
  cid?: bigint;
  /** The server the session lives on: its tenant, for anything scoped by tenant and CID. */
  serverAddress?: string;
}

/**
 * The tab's user, from the selection first and the saved account second.
 *
 * The order is the point. `getTabSelectedSession` reads the selection and then
 * looks it up in the saved accounts, returning null when there is no record —
 * and stored sessions hold saved credentials, so a user who declined to save
 * them, or whose store has not loaded yet, has a perfectly good selection and
 * nothing for it to find.
 *
 * The username is in the selection. The full name is only on the saved account,
 * which is the one thing worth going there for.
 *
 * `TopBar`, `usePeerDiscovery` and `WorkspaceView` each work this way already,
 * spelled out by hand. `BaseOffice` went straight to the session and fell
 * through to `'unknown'` for the id `OfficeChatTabs` uses to decide which
 * messages are the reader's own — no own-message styling, no edit, no delete,
 * on their own messages. `resolveCurrentUserId` did the same, and every
 * permission gate in the app bailed with "nobody is signed in on this tab".
 *
 * One function, so the next caller inherits the order rather than rediscovering
 * why it matters.
 */
export function tabIdentity(
  selection: TabUserContext | null,
  session: StoredSession | null,
): TabIdentity {
  return {
    username: selection?.selectedUsername ?? session?.username,
    fullName: session?.fullName,
    cid: selection?.selectedCid ?? session?.cid,
    serverAddress: selection?.selectedServerAddress || session?.serverAddress,
  };
}

/**
 * This tab's own CID: the tab's identity first, the connection's second.
 *
 * The connection's CID is the CONNECTION's, not the tab's -- with two sessions
 * in one browser it is empty or the other tab's -- so it is only the fallback.
 * The Messages page read it alone, at render, with nothing to re-render it when
 * it arrived, and showed "No conversation selected" for the peer the user had
 * just picked. `WorkspaceView` had the right order spelled out by hand.
 */
export function selfCid(
  tab: Pick<TabIdentity, 'cid'> | null,
  connection: { cid?: bigint } | null,
): bigint | undefined {
  return tab?.cid ?? connection?.cid;
}

/** Who the reader is, for authorship and display in a room. */
export interface ReaderIdentity {
  id: string;
  displayName: string;
}

/**
 * The reader, from the workspace state first and the tab's identity second.
 *
 * `id` decides which chat messages are the reader's own — own-message styling,
 * edit and delete all hang off it — so falling through to `'unknown'` takes
 * those away from somebody looking at their own messages. The tab identity is
 * what stops that fall-through in the ordinary case where the workspace state
 * has not populated yet.
 */
/** The id `readerIdentity` gives a reader it could not identify: nobody's messages are theirs. */
export const UNKNOWN_READER_ID: string = 'unknown';

export function readerIdentity(
  stateUser: { id?: string; username?: string; displayName?: string } | null | undefined,
  tab: TabIdentity | null,
): ReaderIdentity {
  return {
    id: stateUser?.id || stateUser?.username || tab?.username || UNKNOWN_READER_ID,
    displayName:
      stateUser?.displayName || stateUser?.username || tab?.fullName || tab?.username || 'Unknown User',
  };
}

/**
 * The reader as a chat transport knows them: the workspace id the server writes as a channel
 * message's sender, and the CID a reaction names. Null until both are known.
 */
export function chatSelf(reader: ReaderIdentity, cid: bigint | undefined): ChatSelf | null {
  if (reader.id === UNKNOWN_READER_ID || cid === undefined) return null;
  return { cid, username: reader.id, displayName: reader.displayName };
}
