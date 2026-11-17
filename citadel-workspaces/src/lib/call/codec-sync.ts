/**
 * Applies codec facts learned from signalling to the live session.
 *
 * Kept out of the provider so the negotiation ordering — adopt the peers'
 * announcements, re-pick our send codec, tell peers only when it changed — is
 * a testable function instead of JSX-adjacent glue.
 */

import type { CallManager } from './call-manager';
import type { CallSession } from './call-session';

/**
 * Adopt everything peers told us: their announced send codecs configure our
 * per-peer decoders, and their decode lists drive our send-codec choice.
 *
 * Returns true when OUR send codec changed and peers therefore need telling.
 */
export function adoptPeerCodecs(manager: CallManager, session: CallSession): boolean {
  for (const [cid, codec] of manager.codecs.announcedSendCodecs()) {
    session.setPeerReceiveCodec(cid, codec);
  }
  return session.renegotiateSendCodec(manager.codecs.decodeCapsLists());
}

/**
 * Adopt peer codecs and, when our own choice changed, announce it.
 *
 * Used on inbound signals. The accept flow instead calls adoptPeerCodecs
 * directly, because the CallAccept it is about to send already carries the
 * codec — announcing first would race a media-state update ahead of the accept.
 */
export async function syncNegotiatedCodecs(
  manager: CallManager,
  session: CallSession | null,
): Promise<void> {
  if (!session) return;
  if (adoptPeerCodecs(manager, session)) {
    await manager.announceSendCodec(session.getCodec());
  }
}
