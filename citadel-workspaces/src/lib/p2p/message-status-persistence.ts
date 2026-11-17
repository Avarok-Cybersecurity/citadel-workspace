/**
 * Writing a message's terminal send status through to the page store.
 *
 * Both send paths mutated `message.status` in memory only, so the row persisted
 * while still `'pending'` was the row read back. After a reload EVERY message
 * the user had sent rendered a "sending…" clock — and the retry affordance is
 * gated on `'failed'`, so a message that genuinely failed could never be
 * resent. `resendMessage` did call the update, but only after a `catch` that
 * rethrows, so it too recorded 'sent' and never 'failed': the one status worth
 * keeping was the one that never survived.
 */

import { debugLog } from '@/lib/debug-config';
import type { P2PMessage } from './p2p-types';

interface StatusPersistenceConfig {
  updateMessageInPages: (
    peerCid: bigint,
    messageId: string,
    patch: Partial<P2PMessage>
  ) => Promise<boolean>;
}

/**
 * Persist `message`'s current status.
 *
 * Never throws. The caller is usually mid-throw with the send error the user
 * actually needs to see, and a storage problem must not replace it — the send
 * outcome is the more important of the two.
 */
export async function persistMessageStatus(
  config: StatusPersistenceConfig,
  peerCid: bigint,
  messageId: string,
  message: P2PMessage
): Promise<void> {
  try {
    const written: boolean = await config.updateMessageInPages(peerCid, messageId, {
      status: message.status,
      error: message.error,
    });
    if (!written) {
      // Not a throw — `updateMessageInPages` returns false when the id is in no
      // page, which is its normal way of reporting "nothing was written". A
      // catch alone would treat that as success and leave the row on 'pending'.
      debugLog('MessageSender', `Status for ${messageId} matched no stored page`);
    }
  } catch (persistError) {
    debugLog('MessageSender', `Could not persist status for ${messageId}`, persistError);
  }
}
