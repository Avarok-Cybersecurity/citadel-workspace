import { debugLog } from '@/lib/debug-config';
import { persistPendingToLocalDB } from './persistence';
import { getCurrentSessionCid } from './state';
import type { PendingPeerRequest, KVPendingEntry } from './types';

/**
 * Store an incoming request, and never let storing it hide it.
 *
 * The request is already in memory by the time this runs. What follows is two
 * awaits that can both reject — writing to LocalDB, which the ownership gate
 * refuses when it cannot place the session, and reading the session CID, which
 * falls back to IndexedDB and throws outright under strict privacy settings.
 *
 * They used to sit in front of the announcement, so either rejection took the
 * announcement with it and the caller above logged and swallowed: somebody had
 * asked to connect, the app knew, and nothing on screen said so.
 *
 * The badge is how a person learns a request exists. Persistence is for
 * surviving a reload, and failing at that must not also mean failing to
 * mention it.
 */
export async function recordWithoutLosingIt(
  request: PendingPeerRequest,
  pending: PendingPeerRequest[],
  pendingKV: Map<string, KVPendingEntry>,
  notify: (request: PendingPeerRequest) => void,
): Promise<void> {
  try {
    await persistPendingToLocalDB(pending, pendingKV);
  } catch (error) {
    debugLog('PeerRegistrationStore', 'Could not persist pending requests; showing anyway:', error);
  }

  try {
    const currentCid: bigint | null = await getCurrentSessionCid();
    if (currentCid === request.cid) notify(request);
  } catch (error) {
    debugLog('PeerRegistrationStore', 'Could not read the session cid; showing anyway:', error);
  }
}
