/**
 * A direct chat's status port: the link to the peer, their presence and typing, and the
 * registration that has to complete before messages leave.
 */
import type { P2PMessengerManager } from '@/lib/p2p/p2p-messenger-manager';
import type { PeerPresence } from '@/lib/p2p/p2p-types';
import type { ChatPeer } from '@/lib/cdoc/chat/chat-app-ports';
import { p2pAutoConnectService } from '@/lib/p2p-auto-connect-service';
import { p2pRegistrationService } from '@/lib/p2p-registration-service';
import { eventEmitter } from '@/lib/event-emitter';
import { MessagingLayerType } from '@/types/messaging-layer';
import type { AcceptancePort, StatusChange, StatusPort, StatusProbe, StatusSnapshot } from './chat-transport';

function peerAcceptance(messenger: P2PMessengerManager, peer: ChatPeer): AcceptancePort {
  return {
    accepted: (): boolean => p2pRegistrationService.isPeerRegistered(peer.cid),
    onAccepted: (listener: () => void): (() => void) =>
      eventEmitter.on('p2p:peer-registered', ({ peer: registered }: { peer: { cid: bigint } }): void => {
        if (registered.cid !== peer.cid) return;
        p2pAutoConnectService.poll();
        listener();
      }),
    flushHeld: (): void => messenger.flushHeldUntilRegistered(peer.cid),
  };
}

export function peerStatus(messenger: P2PMessengerManager, peer: ChatPeer): StatusPort {
  return {
    snapshot: (): StatusSnapshot => ({
      connected: messenger.isConnected(peer.cid),
      presence: messenger.getConversation(peer.cid)?.presence ?? null,
      typing: [],
    }),

    // A decision, so unknown behaves as not-connected: both lead to the same safe move, which is to try.
    probe: async (): Promise<StatusProbe> => {
      const linked: boolean = (await p2pAutoConnectService.isPeerConnected(peer.cid)) ?? false;
      return {
        connected: messenger.isConnected(peer.cid) || linked,
        presence: linked ? { status: MessagingLayerType.Online, lastUpdate: Date.now() } : null,
      };
    },

    subscribe: (listener: (change: StatusChange) => void): (() => void) => {
      const stops: (() => void)[] = [
        messenger.onTyping((cid: bigint, typing: boolean): void => {
          if (cid === peer.cid) listener({ kind: 'typing', typing: typing ? [peer.name] : [] });
        }),
        messenger.onConnectionChange((cid: bigint, connected: boolean): void => {
          if (cid === peer.cid) listener({ kind: 'connected', connected });
        }),
        messenger.onPresenceChange((cid: bigint, presence: PeerPresence): void => {
          if (cid === peer.cid) listener({ kind: 'presence', presence });
        }),
      ];
      return (): void => { for (const stop of stops) stop(); };
    },

    startTyping: (currentText: () => string): void => messenger.startTypingPolling(peer.cid, currentText),
    stopTyping: (): void => messenger.stopTypingPolling(peer.cid),
    acceptance: peerAcceptance(messenger, peer),
  };
}
