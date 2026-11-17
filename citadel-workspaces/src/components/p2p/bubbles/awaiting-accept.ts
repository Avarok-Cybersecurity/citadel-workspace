/**
 * Who a held message is waiting for, and the words for it.
 *
 * A message to someone who has not accepted your request is held, not sent
 * (lib/p2p/held-until-registered.ts). Its bubble says so, and the composer says
 * so before you write it, in the same words.
 *
 * `null` means nobody: the chat is with a contact, or it is a group chat, which
 * has no registration to wait for. That is also what a bubble outside a direct
 * chat reads, which is why it is this context's value when none is provided.
 */
import { createContext, type Context } from 'react';

export const AwaitingAcceptContext: Context<string | null> = createContext<string | null>(null);

export function sendsWhenAcceptedCopy(peerName: string): string {
  return `Sends when ${peerName} accepts`;
}

export function awaitingAcceptPlaceholder(peerName: string): string {
  return `Message ${peerName} — it sends when they accept`;
}
