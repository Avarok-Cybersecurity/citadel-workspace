/**
 * Delivering an inbound message that has already arrived.
 *
 * `addMessageToConversation` pushes to the in-memory conversation and THEN
 * awaits the page write, which rejects on a LocalDB timeout. That rejection
 * used to unwind past the delivery ACK, the render notification and the desktop
 * notification — all of which sit inside one `if (wasAdded)` — so a storage
 * hiccup discarded a message that had genuinely arrived and was already in
 * memory. Nothing rendered, nothing was notified, and the sender's bubble stayed
 * on 'sent' forever.
 *
 * Durability is a separate concern from delivery, and conflating them lost both.
 */

import { debugLog } from '@/lib/debug-config';

export interface DeliveryOutcome {
  /** The message belongs in the conversation and should be shown. */
  present: boolean;
  /** It also reached storage, so it will survive a reload. */
  persisted: boolean;
}

/**
 * Add `message`, distinguishing "did not arrive" from "arrived but unstored".
 *
 * A write failure yields `{ present: true, persisted: false }`: the message is
 * real and in memory, so the UI must show it — but callers must not claim
 * delivery for it (see `shouldAck`).
 */
export async function deliverToConversation(
  add: () => Promise<boolean>,
  messageId: string
): Promise<DeliveryOutcome> {
  try {
    return { present: await add(), persisted: true };
  } catch (error) {
    debugLog('P2PMessageHandler', `Message ${messageId} arrived but could not be stored:`, error);
    return { present: true, persisted: false };
  }
}

/**
 * Whether to send the 'delivered' ACK.
 *
 * The ACK is what turns the sender's bubble into "delivered". A message we could
 * not store is gone on the next reload, so claiming delivery would be a lie that
 * outlives the message itself. Leaving the sender on 'sent' is accurate.
 */
export function shouldAck(outcome: DeliveryOutcome): boolean {
  return outcome.present && outcome.persisted;
}
