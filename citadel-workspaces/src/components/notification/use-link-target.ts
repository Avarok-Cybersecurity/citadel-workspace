/**
 * Opens what an account link named (`?open=`, lib/onboarding/link-target.ts)
 * once the workspace is up: a native notice's conversation or call, or the
 * requests list. Taken once; a later visit opens nothing.
 */
import { useEffect } from 'react';
import { eventEmitter } from '@/lib/event-emitter';
import { takeLinkTarget, type LinkTarget } from '@/lib/onboarding/link-target';
import { p2pMessengerManager } from '@/lib/p2p/p2p-messenger-manager';

export function useLinkTargetOpener(openRequests: () => void): void {
  useEffect(() => {
    const peer: Extract<LinkTarget, { kind: 'conversation' | 'call' }> | null = takeLinkTarget(['conversation', 'call']);
    if (peer) {
      const peerUsername: string = p2pMessengerManager.getConversation(peer.peerCid)?.peerUsername ?? '';
      eventEmitter.emit('p2p:open-conversation', { peerCid: peer.peerCid, peerUsername });
      return;
    }
    if (takeLinkTarget(['requests'])) openRequests();
  }, [openRequests]);
}
