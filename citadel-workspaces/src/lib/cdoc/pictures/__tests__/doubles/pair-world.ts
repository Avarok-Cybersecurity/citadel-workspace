/**
 * Two people of a direct chat, each with their own device store, over one P2P channel, for the
 * pair pictures' tests. Production throughout (pair-pictures.ts, its wire, the device store, the
 * chat index, SHA-256), except what is I/O: the channel (FakeChannel, which carries the
 * production encoder's bytes and reads them with the envelope guard message-handler.ts uses,
 * here delivering on its own a turn after each send), each agent's LocalDB (FakeAgentLocalDb,
 * with its ownership gate) and time (the browser clock, with a short deadline so an unanswered
 * ask fails within a test). Each side's `inbox` does what lib/p2p/chat-document-inbox.ts does in
 * the app: hands every `picture_want` and `picture_have` the account hears to heardPictureMessage.
 */
import type { CdocChatSyncPayload } from '@/types/cdoc-chat-sync';
import { documentPictureBlobs, type ScratchpadBlobs } from '@/lib/scratchpad/scratchpad-blobs';
import { sha256Hex } from '@/lib/chat/attachments/attachment-wire';
import { browserClock } from '@/lib/browser-clock';
import { FakeChannel } from '../../../chat/__tests__/doubles/fake-channel';
import { FakeAgentLocalDb } from '../../../chat/__tests__/doubles/fake-agent-local-db';
import { localDbChatStore } from '../../../chat/chat-local-db';
import type { ChatStoreBackend, ChatTransport } from '../../../chat/chat-ports';
import type { PictureAccess } from '../../document-pictures';
import { sha256ContentId } from '../../content-id';
import { PAIR_PICTURES, type PairPictureConfig } from '../../pair-config';
import { heardPictureMessage, pairPicturePort, type PairPicturePorts, type PictureMessageOutcome } from '../../pair-pictures';
import type { PictureDocument, PicturePort } from '../../picture-port';
import { storedAccess } from '../picture-rig';

export const ALICE: bigint = 10_000_000_000_000_000_001n;
export const BOB: bigint = 10_000_000_000_000_000_002n;
export const CAROL: bigint = 10_000_000_000_000_000_003n;
export const DOC_ID: string = 'chat-doc-pictures';

/** Production values but the deadline: an ask nobody answers fails in a quarter second, not twenty. */
export const TEST_PAIR: PairPictureConfig = { ...PAIR_PICTURES, answerDeadlineMs: 250 };

/** A channel that delivers what is in flight a turn after each send, while it is up. */
export class LiveChannel {
  readonly inner: FakeChannel = new FakeChannel();

  set up(value: boolean) { this.inner.up = value; }

  transport(self: bigint, peer: bigint): ChatTransport {
    const inner: ChatTransport = this.inner.transport(self, peer);
    return {
      ...inner,
      send: async (bytes: Uint8Array): Promise<void> => {
        await inner.send(bytes);
        setTimeout((): void => this.inner.deliverFirst(this.inner.inFlightCount), 0);
      },
    };
  }
}

export interface PairSide {
  readonly cid: bigint;
  readonly peer: bigint;
  readonly db: FakeAgentLocalDb;
  readonly store: ChatStoreBackend;
  readonly ports: PairPicturePorts;
  readonly port: PicturePort;
  readonly doc: PictureDocument;
  /** What the side's inbox did with each picture message it heard. */
  readonly outcomes: Promise<PictureMessageOutcome>[];
  /** A fresh document's access, as each open of it gets. */
  access(): PictureAccess;
  /** The picture keys this side's device keeps. */
  pictureKeys(): string[];
  /** Stops handing picture messages to the inbox, as a session not signed in here. */
  deafen(): void;
}

/** Where a side's channel comes from: a LiveChannel, or a FakeChannel a test delivers by hand. */
export interface ChannelOf {
  transport(self: bigint, peer: bigint): ChatTransport;
}

export function pairSide(channel: ChannelOf, self: bigint, peer: bigint, config: PairPictureConfig = TEST_PAIR): PairSide {
  const db: FakeAgentLocalDb = new FakeAgentLocalDb();
  const store: ChatStoreBackend = localDbChatStore(self, db.connection([self]));
  const transport: ChatTransport = channel.transport(self, peer);
  const ports: PairPicturePorts = {
    transport,
    clock: browserClock,
    blobs: (docId: string): ScratchpadBlobs => documentPictureBlobs(self, docId, db.connection([self]), sha256Hex),
    sharesWithPeer: async (docId: string): Promise<boolean> => (await store.loadEntry(docId))?.peerCid === peer,
    contentIdOf: sha256ContentId,
    config,
  };
  const outcomes: Promise<PictureMessageOutcome>[] = [];
  const stop: () => void = transport.onMessage((payload: CdocChatSyncPayload): void => {
    if (payload.sync.kind === 'picture_want' || payload.sync.kind === 'picture_have') outcomes.push(heardPictureMessage(ports, payload));
  });
  const port: PicturePort = pairPicturePort(ports);
  const doc: PictureDocument = { kind: 'pair', selfCid: self, peerCid: peer, docId: DOC_ID };
  return {
    cid: self, peer, db, store, ports, port, doc, outcomes,
    access: (): PictureAccess => storedAccess(port, doc),
    pictureKeys: (): string[] => db.keys(self).filter((k: string): boolean => k.startsWith('cdoc-picture:')),
    deafen: stop,
  };
}

/** Alice and Bob, each keeping DOC_ID in their chat with the other. */
export async function aliceAndBob(config: PairPictureConfig = TEST_PAIR): Promise<{ channel: LiveChannel; alice: PairSide; bob: PairSide }> {
  const channel: LiveChannel = new LiveChannel();
  const alice: PairSide = pairSide(channel, ALICE, BOB, config);
  const bob: PairSide = pairSide(channel, BOB, ALICE, config);
  await alice.store.saveEntry(DOC_ID, { peerCid: BOB, title: null });
  await bob.store.saveEntry(DOC_ID, { peerCid: ALICE, title: null });
  return { channel, alice, bob };
}

/** Every inbox outcome so far, once the work they started has settled. */
export async function settled(side: PairSide): Promise<PictureMessageOutcome[]> {
  // An answer can start another (a have starts a want): wait until no new outcome appears.
  let seen: number = -1;
  while (seen !== side.outcomes.length) {
    seen = side.outcomes.length;
    await Promise.all(side.outcomes);
    await new Promise<void>((resolve: () => void): void => { setTimeout(resolve, 5); });
  }
  return Promise.all(side.outcomes);
}

/** `size` bytes that are not a picture's, deterministic. */
export function rawBytes(size: number, seed: number): Uint8Array {
  const out: Uint8Array = new Uint8Array(size);
  let x: number = seed >>> 0;
  for (let i: number = 0; i < size; i += 1) {
    x = (Math.imul(x, 1_664_525) + 1_013_904_223) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}
