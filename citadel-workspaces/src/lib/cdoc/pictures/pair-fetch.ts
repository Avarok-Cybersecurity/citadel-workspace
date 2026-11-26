/**
 * Asking the peer of a direct chat for one of a document's pictures (`picture_want`), and
 * reassembling its answer: every `picture_chunk`, in any order and with repeats, or one
 * `picture_none`. The whole picture must hash to the id it was asked by before it is kept on
 * this device, so a peer that lies cannot plant bytes under another picture's name. Pure over
 * its ports (SBIO): the P2P channel, a clock for the deadline, this device's picture store.
 */
import { isPictureSync, type CdocChatSyncPayload } from '@/types/cdoc-chat-sync';
import { NotKeptHere, type ScratchpadBlobs } from '@/lib/scratchpad/scratchpad-blobs';
import type { Clock } from '../collab/ports';
import type { ChatTransport } from '../chat/chat-ports';
import { encodePictureSync, readPictureSync, type PictureMessage } from '../chat/picture-wire';
import type { ContentIdOf } from './content-id';
import type { PairPictureConfig } from './pair-config';
import { digestOf, failed, ok, type PictureResult } from './picture-port';

/** What the pair's pictures run on, for one account and its peer. */
export interface PairPicturePorts {
  /** The P2P channel between the account (`selfCid`) and the chat's peer (`peerCid`). */
  readonly transport: Pick<ChatTransport, 'selfCid' | 'peerCid' | 'send' | 'onMessage'>;
  readonly clock: Clock;
  /** This device's copy of `docId`'s pictures, under the account. */
  readonly blobs: (docId: string) => ScratchpadBlobs;
  /** Whether the account keeps `docId` in its chat with this peer (the chat index's entry). */
  readonly sharesWithPeer: (docId: string) => Promise<boolean>;
  readonly contentIdOf: ContentIdOf;
  readonly config: PairPictureConfig;
}

/** The picture as this device keeps it, or null when it keeps none. */
export async function readHere(ports: PairPicturePorts, docId: string, contentId: string): Promise<Uint8Array | null> {
  try {
    return await ports.blobs(docId).read(digestOf(contentId));
  } catch (error: unknown) {
    if (error instanceof NotKeptHere) return null;
    throw error;
  }
}

/** Keeps `bytes`, already known to be `contentId`, on this device. */
export async function keepHere(ports: PairPicturePorts, docId: string, contentId: string, bytes: Uint8Array): Promise<void> {
  const kept: string = await ports.blobs(docId).keep(bytes);
  if (kept !== digestOf(contentId)) throw new Error(`the picture kept as ${contentId} was stored as ${kept}`);
}

function concat(parts: readonly Uint8Array[], size: number): Uint8Array {
  const whole: Uint8Array = new Uint8Array(size);
  let at: number = 0;
  for (const part of parts) {
    whole.set(part, at);
    at += part.length;
  }
  return whole;
}

/**
 * Wants `contentId` of `docId` from the peer. `offline` when the channel refuses the ask or the
 * peer is silent for `answerDeadlineMs`; `notFound` when it says it has none; `damaged` when what
 * it sent is malformed or is not that picture (then nothing is kept). The bytes it returns are kept here.
 */
export function wantFromPeer(ports: PairPicturePorts, docId: string, contentId: string): Promise<PictureResult<Uint8Array>> {
  const { config, transport } = ports;
  return new Promise<PictureResult<Uint8Array>>((resolve: (result: PictureResult<Uint8Array>) => void): void => {
    let parts: Array<Uint8Array | undefined> | null = null;
    let size: number = 0;
    let arrived: number = 0;
    let over: boolean = false;
    let cancelWait: () => void = (): void => undefined;
    const end = (): void => {
      over = true;
      cancelWait();
      stopListening();
    };
    const finish = (result: PictureResult<Uint8Array>): void => {
      if (over) return;
      end();
      resolve(result);
    };
    const waitForPeer = (): void => {
      cancelWait();
      cancelWait = ports.clock.after(config.answerDeadlineMs, (): void => finish(failed({ kind: 'offline' })));
    };
    const assemble = async (whole: Uint8Array): Promise<PictureResult<Uint8Array>> => {
      if ((await ports.contentIdOf(whole)) !== contentId) return failed({ kind: 'damaged' });
      await keepHere(ports, docId, contentId, whole);
      return ok(whole);
    };
    const heard = (payload: CdocChatSyncPayload): void => {
      if (over || payload.doc_id !== docId || !isPictureSync(payload.sync) || payload.sync.content_id !== contentId) return;
      let message: PictureMessage;
      try {
        message = readPictureSync(payload, config);
      } catch (error: unknown) {
        console.warn('[PairPictures] the peer sent a picture message this client does not write', error);
        return finish(failed({ kind: 'damaged' }));
      }
      const { sync } = message;
      if (sync.kind === 'picture_none') return finish(failed({ kind: 'notFound' }));
      if (sync.kind !== 'picture_chunk') return;
      if (parts === null) {
        parts = new Array<Uint8Array | undefined>(sync.count).fill(undefined);
        size = sync.size;
      } else if (parts.length !== sync.count || size !== sync.size) {
        return finish(failed({ kind: 'damaged' }));
      }
      if (parts[sync.index] === undefined) {
        parts[sync.index] = sync.chunk;
        arrived += 1;
      }
      if (arrived < parts.length) return waitForPeer();
      const whole: Uint8Array = concat(parts as Uint8Array[], size);
      end();
      assemble(whole).then(resolve, (error: unknown): void => {
        console.error('[PairPictures] a picture from the peer could not be kept on this device', contentId, error);
        resolve(failed({ kind: 'unavailable', detail: 'The picture arrived but could not be kept on this device.' }));
      });
    };
    const stopListening: () => void = transport.onMessage(heard);
    waitForPeer();
    transport.send(encodePictureSync(docId, config.docVersion, { kind: 'picture_want', content_id: contentId })).catch((error: unknown): void => {
      console.warn('[PairPictures] the ask for a picture did not leave', error);
      finish(failed({ kind: 'offline' }));
    });
  });
}
