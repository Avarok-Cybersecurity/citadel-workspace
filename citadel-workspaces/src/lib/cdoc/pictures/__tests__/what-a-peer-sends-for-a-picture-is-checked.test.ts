/**
 * What the peer sends about a picture is checked before anything is kept or answered: bytes
 * that do not hash to the id asked for are refused and nothing is stored; a `picture_want` for
 * a document the asker does not share with this account is answered as a picture not kept,
 * `picture_none`; a picture larger than one chunk is reassembled from chunks in any order and
 * with repeats; one over the cap is refused by name; and the document's own sync leaves picture
 * messages to the pictures. (Malformed messages: picture-wire.test.ts.)
 */
import { describe, expect, it } from 'vitest';
import type { CdocChatSyncPayload } from '@/types/cdoc-chat-sync';
import type { ChatTransport } from '../../chat/chat-ports';
import { encodePictureSync, pictureChunks } from '../../chat/picture-wire';
import { FakeChannel } from '../../chat/__tests__/doubles/fake-channel';
import { FakeAgentLocalDb } from '../../chat/__tests__/doubles/fake-agent-local-db';
import { Rng } from '../../chat/__tests__/doubles/rng';
import { BLANK, DOC, newWorld, openSide, settle, ALICE as CHAT_ALICE, BOB as CHAT_BOB, type ChatSide, type World } from '../../chat/__tests__/doubles/chat-pair';
import { sha256ContentId } from '../content-id';
import { PAIR_PICTURES } from '../pair-config';
import type { PictureResult } from '../picture-port';
import { ALICE, aliceAndBob, BOB, CAROL, DOC_ID, LiveChannel, pairSide, rawBytes, settled, type PairSide } from './doubles/pair-world';

describe('a picture from the peer', () => {
  it('whose bytes do not hash to the id asked for is refused, and nothing is kept', async () => {
    const channel: LiveChannel = new LiveChannel();
    const bob: PairSide = pairSide(channel, BOB, ALICE);
    await bob.store.saveEntry(DOC_ID, { peerCid: ALICE, title: null });
    const id: string = await sha256ContentId(rawBytes(300, 1));
    // A lying Alice: answers a want for `id` with other bytes under that id.
    const liar: ChatTransport = channel.transport(ALICE, BOB);
    liar.onMessage((payload: CdocChatSyncPayload): void => {
      if (payload.sync.kind !== 'picture_want') return;
      for (const chunk of pictureChunks(payload.sync.content_id, rawBytes(300, 2), PAIR_PICTURES.chunkBytes)) void liar.send(encodePictureSync(payload.doc_id, PAIR_PICTURES.docVersion, chunk));
    });
    expect(await bob.port.get(bob.doc, id)).toEqual({ ok: false, failure: { kind: 'damaged' } });
    expect(bob.pictureKeys()).toEqual([]);
  });

  it('larger than one chunk is reassembled from its chunks, in any order and with repeats, and kept', async () => {
    const channel: FakeChannel = new FakeChannel();
    const alice: PairSide = pairSide(channel, ALICE, BOB);
    const bob: PairSide = pairSide(channel, BOB, ALICE);
    await alice.store.saveEntry(DOC_ID, { peerCid: BOB, title: null });
    const big: Uint8Array = rawBytes(PAIR_PICTURES.chunkBytes * 3 + 1234, 3);
    const id: string = await sha256ContentId(big);
    expect((await alice.port.put(alice.doc, id, big)).ok).toBe(true);
    channel.lose();
    const getting: Promise<PictureResult<Uint8Array>> = bob.port.get(bob.doc, id);
    await new Promise<void>((resolve: () => void): void => { setTimeout(resolve, 0); });
    channel.deliverFirst(channel.inFlightCount);
    expect(await settled(alice)).toEqual(['sent']);
    const chunks: typeof channel.sent = channel.sent.filter((s) => s.from === ALICE && s.kind === 'picture_chunk');
    expect(chunks.length).toBe(4);
    expect(chunks.every((s) => s.bytes <= PAIR_PICTURES.chunkBytes + 1024)).toBe(true);
    channel.deliver(new Rng(7), { drop: 0, duplicate: 1, reorder: true });
    expect(await getting).toEqual({ ok: true, value: big });
    expect(await bob.port.get(bob.doc, id)).toEqual({ ok: true, value: big });
    expect(channel.inFlightCount).toBe(0);
  });

  it('larger than the cap is refused by name, and the peer is told nothing', async () => {
    const { channel, alice } = await aliceAndBob();
    const big: Uint8Array = new Uint8Array(PAIR_PICTURES.maxBytes + 1);
    expect(await alice.port.put(alice.doc, await sha256ContentId(big), big)).toEqual({ ok: false, failure: { kind: 'tooLarge', maxBytes: PAIR_PICTURES.maxBytes } });
    expect(channel.inner.sent).toEqual([]);
    expect(alice.pictureKeys()).toEqual([]);
  });
});

describe('a want from the peer', () => {
  it('for a document it does not share with this account is answered none, as a picture not kept', async () => {
    const channel: LiveChannel = new LiveChannel();
    const alice: PairSide = pairSide(channel, ALICE, BOB);
    const bob: PairSide = pairSide(channel, BOB, ALICE);
    // Alice keeps DOC_ID, with the picture, in her chat with Carol; Bob names the same id.
    await alice.store.saveEntry(DOC_ID, { peerCid: CAROL, title: null });
    const picture: Uint8Array = rawBytes(500, 4);
    const id: string = await sha256ContentId(picture);
    await alice.ports.blobs(DOC_ID).keep(picture);
    expect(await bob.port.get(bob.doc, id)).toEqual({ ok: false, failure: { kind: 'notFound' } });
    const notKept: string = await sha256ContentId(rawBytes(500, 5));
    expect(await bob.port.get(bob.doc, notKept)).toEqual({ ok: false, failure: { kind: 'notFound' } });
    expect(await settled(alice)).toEqual(['none', 'none']);
    expect(channel.inner.sent.filter((s) => s.from === ALICE).map((s) => s.kind)).toEqual(['picture_none', 'picture_none']);
  });
});

describe('the document\'s own sync', () => {
  it('leaves picture messages to the pictures: nothing reported, nothing applied', async () => {
    const world: World = newWorld();
    const alice: ChatSide = await openSide(world, CHAT_ALICE, CHAT_BOB, new FakeAgentLocalDb(), BLANK);
    const bob: ChatSide = await openSide(world, CHAT_BOB, CHAT_ALICE, new FakeAgentLocalDb(), BLANK);
    await settle(world, [alice, bob]);
    const before: Uint8Array = await alice.editor().snapshot();
    const id: string = await sha256ContentId(rawBytes(10, 6));
    const bobsChannel: ChatTransport = world.channel.transport(CHAT_BOB, CHAT_ALICE);
    for (const sync of [{ kind: 'picture_have', content_id: id }, { kind: 'picture_want', content_id: id }, { kind: 'picture_none', content_id: id }] as const) {
      await bobsChannel.send(encodePictureSync(DOC, PAIR_PICTURES.docVersion, sync));
    }
    await settle(world, [alice, bob]);
    expect(alice.problems).toEqual([]);
    expect(Array.from(await alice.editor().snapshot())).toEqual(Array.from(before));
  });
});
