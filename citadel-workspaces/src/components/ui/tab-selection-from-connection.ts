import type { CurrentConnectionInfo } from '@/lib/connection/types';

/** What `setSelectedUser` needs to record who this tab is using. */
export interface TabSelection {
  selectedUsername: string;
  selectedServerAddress: string;
  selectedCid: bigint;
}

/**
 * The tab's selection, taken from the connection we already have.
 *
 * This was a round trip. `use-auto-claim-session` asked the internal service
 * for the list of active sessions and searched it for the CID it was already
 * connected with — to recover a username and a server address that the
 * connection record usually holds.
 *
 * It asked through `getActiveSessions`, which returns an EMPTY ARRAY when it
 * cannot ask or is not answered. `find` then matched nothing, the selection was
 * never written, and nothing said so. The cost lands nowhere near here:
 * `resolveCurrentUserId` reads the tab selection, so every permission fetch
 * bails with "nobody is signed in on this tab" and every gated control refuses.
 *
 * `null` means the record is CID-only — which it is when a bare ConnectSuccess
 * wrote it and nothing filled in the rest — and only then is the query worth
 * making.
 */
export function tabSelectionFromConnection(
  connection: CurrentConnectionInfo | null,
): TabSelection | null {
  if (!connection?.username || !connection.serverAddress) return null;
  return {
    selectedUsername: connection.username,
    selectedServerAddress: connection.serverAddress,
    selectedCid: connection.cid,
  };
}
