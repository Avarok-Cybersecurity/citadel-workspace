/**
 * Whether the reader's own bubbles show their sent, delivered and read ticks.
 *
 * A tick says somebody received the message. In the scratchpad nobody does, so a tick there
 * would read as a conversation with someone; the pane sets this from the transport's
 * `deliveryTicks`. "Saving" and "could not be saved" (pending, failed) are always shown.
 * True when no pane provides it, which is every bubble outside a chat (previews, tests).
 */
import { createContext, type Context } from 'react';
import type { MessageStatus } from 'citadel-internal-service-wasm-client';

export const DeliveryTicksContext: Context<boolean> = createContext<boolean>(true);

/** The statuses that report a recipient: hidden where there is none. */
export function reportsRecipient(status: MessageStatus): boolean {
  return status === 'sent' || status === 'delivered' || status === 'read';
}
