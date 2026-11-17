/**
 * The ports a chat document takes in the app: the P2P channel between this account's session
 * and the peer (the raw P2P message, as the Yjs live documents use: sync traffic must not wait
 * in the chat's reliable queue behind messages, and a lost one is healed by the next hello),
 * the browser's clock, and this account's copy in the agent's LocalDB.
 */
import { websocketService } from '@/lib/websocket-service';
import { eventEmitter } from '@/lib/event-emitter';
import { browserClock } from '@/lib/browser-clock';
import { usernameAvatarColor } from '@/lib/avatar-color';
import { CDOC_CHAT_COMMAND_EVENT, type CdocChatCommandEvent, type CdocChatSyncPayload } from '@/types/cdoc-chat-sync';
import { hexColor, type HexColor } from '../editor/model-values';
import type { PeerIdentity } from '../collab/ports';
import type { ChatStoreBackend, ChatTransport } from './chat-ports';
import { localDbChatStore, type LocalDbPort } from './chat-local-db';
import type { ChatKeeperPorts } from './chat-replica-keeper';

/** The chat's other person: who the document is kept in step with, and how their caret is labelled. */
export interface ChatPeer {
  readonly cid: bigint;
  readonly name: string;
  /** Picks the caret's colour, as the avatar's. */
  readonly username: string;
}

const agentLocalDb: LocalDbPort = {
  get: (cid: bigint, key: string): Promise<{ readonly value: readonly number[] } | null> => websocketService.sendLocalDBGet(cid, key),
  set: (cid: bigint, key: string, value: number[]): Promise<void> => websocketService.sendLocalDBSet(cid, key, value),
};

export function appChatStore(account: bigint): ChatStoreBackend {
  return localDbChatStore(account, agentLocalDb);
}

/** Whether a received command is the peer's, addressed to this account (the legacy path names no recipient). */
export function isFromPeerToUs(event: CdocChatCommandEvent, selfCid: bigint, peerCid: bigint): boolean {
  return event.peerCid === peerCid && (event.recipientCid === undefined || event.recipientCid === selfCid);
}

export function p2pChatTransport(selfCid: bigint, peerCid: bigint): ChatTransport {
  return {
    selfCid,
    peerCid,
    // Background: the channel being down is not news per keystroke; the next hello heals it.
    send: (bytes: Uint8Array): Promise<void> => websocketService.sendP2PMessageBytes(selfCid, peerCid, bytes, 'background'),
    onMessage: (listener: (payload: CdocChatSyncPayload) => void): (() => void) =>
      eventEmitter.on<CdocChatCommandEvent>(CDOC_CHAT_COMMAND_EVENT, (event: CdocChatCommandEvent): void => {
        if (isFromPeerToUs(event, selfCid, peerCid)) listener(event.payload);
      }),
    onConnected: (listener: () => void): (() => void) =>
      eventEmitter.on<{ readonly peerCid?: bigint }>('p2p:channel-ready', (event: { readonly peerCid?: bigint }): void => {
        if (event.peerCid === peerCid) listener();
      }),
  };
}

export function chatKeeperPorts(selfCid: bigint, peer: ChatPeer): ChatKeeperPorts {
  const color: HexColor = hexColor(usernameAvatarColor(peer.username));
  // Only the peer's records are ever heard here, so every caret is theirs.
  const identify: PeerIdentity = (): { readonly name: string; readonly color: HexColor } => ({ name: peer.name, color });
  return {
    transport: p2pChatTransport(selfCid, peer.cid),
    clock: browserClock,
    wallClock: (): number => Date.now(),
    identify,
    store: appChatStore(selfCid),
  };
}
