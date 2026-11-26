/**
 * A direct chat's pictures in the app: the ports pair-pictures.ts runs on (the pair's P2P
 * channel, the browser's clock, this account's device store and chat index in the agent's
 * LocalDB), and the handler for picture messages the peer sends, which the chat document inbox
 * (lib/p2p/chat-document-inbox.ts) hands on for as long as the account is signed in here, so a
 * closed document still answers its peer's asks and still fetches what its peer announces.
 */
import type { CdocChatCommandEvent } from '@/types/cdoc-chat-sync';
import { browserClock } from '@/lib/browser-clock';
import { errorLog } from '@/lib/debug-config';
import { documentPictureBlobs, type ScratchpadBlobs } from '@/lib/scratchpad/scratchpad-blobs';
import { sha256Hex } from '@/lib/chat/attachments/attachment-wire';
import { agentLocalDb, appChatStore, p2pChatTransport } from '../chat/chat-app-ports';
import type { ChatIndexEntry } from '../chat/chat-ports';
import { sha256ContentId } from './content-id';
import { PAIR_PICTURES } from './pair-config';
import { heardPictureMessage, type PairPicturePorts, type PictureMessageOutcome } from './pair-pictures';

export function appPairPorts(selfCid: bigint, peerCid: bigint): PairPicturePorts {
  return {
    transport: p2pChatTransport(selfCid, peerCid),
    clock: browserClock,
    blobs: (docId: string): ScratchpadBlobs => documentPictureBlobs(selfCid, docId, agentLocalDb, sha256Hex),
    sharesWithPeer: async (docId: string): Promise<boolean> => {
      const entry: ChatIndexEntry | null = await appChatStore(selfCid).loadEntry(docId);
      return entry !== null && entry.peerCid === peerCid;
    },
    contentIdOf: sha256ContentId,
    config: PAIR_PICTURES,
  };
}

const WENT_WRONG: ReadonlySet<string> = new Set<string>(['refused']);

/** A picture message the peer sent; the legacy path, which names no recipient, is not answered. */
export function heardPictureCommand(event: CdocChatCommandEvent): void {
  const account: bigint | undefined = event.recipient_cid;
  if (account === undefined || account === event.peerCid) return;
  heardPictureMessage(appPairPorts(account, event.peerCid), event.payload).then(
    (outcome: PictureMessageOutcome): void => {
      if (typeof outcome !== 'string' || WENT_WRONG.has(outcome)) errorLog('ChatDocumentPictures', `A picture message for ${event.payload.doc_id}:`, outcome);
    },
    (error: unknown): void => errorLog('ChatDocumentPictures', `A picture message for ${event.payload.doc_id} failed:`, error),
  );
}
