/**
 * A picture message from the peer is read only in the shape this client writes, and refused
 * otherwise: the document id's and content id's shapes, a chunk's index within its count, the
 * count its size needs, the size within the cap, the chunk's exact length, and bytes that are
 * bytes. Each refused message is otherwise one this client writes, so each case shows its own
 * check discriminating. Through the real CBOR codec, as the channel carries it.
 */
import { describe, expect, it } from 'vitest';
import { deserializeP2PCommand } from '@/types/p2p-commands';
import { isCdocChatSyncPayload, type CdocChatPictureSync, type CdocChatSyncPayload } from '@/types/cdoc-chat-sync';
import { ChatWireError } from '../../chat/chat-wire';
import { encodePictureSync, pictureChunks, readPictureSync } from '../../chat/picture-wire';
import { PAIR_PICTURES } from '../pair-config';
import { heardPictureMessage } from '../pair-pictures';
import { sha256ContentId } from '../content-id';
import { aliceAndBob, DOC_ID, rawBytes } from './doubles/pair-world';

const LIMITS = { chunkBytes: 4, maxBytes: 10 } as const;
const ID: string = `sha256-${'a'.repeat(64)}`;

/** `sync` as the peer's bytes arrive: encoded and decoded by the production codec. */
function carried(sync: Record<string, unknown>, docId: string = DOC_ID): CdocChatSyncPayload {
  const payload: unknown = deserializeP2PCommand(encodePictureSync(docId, PAIR_PICTURES.docVersion, sync as unknown as CdocChatPictureSync)).payload;
  if (!isCdocChatSyncPayload(payload)) throw new Error('the envelope guard refused a picture message');
  return payload;
}

const chunk = (fields: Record<string, unknown>): Record<string, unknown> => ({ kind: 'picture_chunk', content_id: ID, index: 0, count: 3, size: 10, chunk: new Uint8Array(4), ...fields });

describe('a picture message from the peer', () => {
  it('in the shape this client writes is read, without anything else it carried', () => {
    expect(readPictureSync(carried({ kind: 'picture_want', content_id: ID, extra: 1 }), LIMITS)).toEqual({ docId: DOC_ID, sync: { kind: 'picture_want', content_id: ID } });
    const chunks: CdocChatPictureSync[] = pictureChunks(ID, rawBytes(10, 1), LIMITS.chunkBytes);
    expect(chunks.map((c) => readPictureSync(carried(c as unknown as Record<string, unknown>), LIMITS).sync)).toEqual(chunks);
  });

  it.each([
    ['a content id that is not one', { kind: 'picture_have', content_id: 'sha256-ABC' }],
    ['no content id', { kind: 'picture_none' }],
    ['a chunk index past its count', chunk({ index: 3, chunk: new Uint8Array(2) })],
    ['a count the size does not need', chunk({ count: 4 })],
    ['a size over the cap', chunk({ size: 11, count: 3 })],
    ['a chunk shorter than its place', chunk({ chunk: new Uint8Array(3) })],
    ['a last chunk longer than the rest of the size', chunk({ index: 2, chunk: new Uint8Array(4) })],
    ['a chunk that is not bytes', chunk({ chunk: [0, 0, 0, 0] })],
    ['a negative index', chunk({ index: -1 })],
  ])('with %s is refused', (_: string, sync: Record<string, unknown>) => {
    expect(() => readPictureSync(carried(sync), LIMITS)).toThrow(ChatWireError);
  });

  it('naming a document id that is not one is refused', () => {
    expect(() => readPictureSync(carried({ kind: 'picture_want', content_id: ID }, 'a:b'), LIMITS)).toThrow(ChatWireError);
  });

  it('that is malformed is refused by the inbox and answered with nothing', async () => {
    const { channel, alice } = await aliceAndBob();
    const id: string = await sha256ContentId(rawBytes(8, 2));
    expect(await heardPictureMessage(alice.ports, carried({ kind: 'picture_want', content_id: id.toUpperCase() }))).toBe('refused');
    expect(channel.inner.sent).toEqual([]);
  });
});
