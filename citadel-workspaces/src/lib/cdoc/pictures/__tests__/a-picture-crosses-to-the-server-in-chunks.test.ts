/**
 * A page's or a node chat document's picture goes to the workspace server a chunk at a time, each
 * answered before the next is sent, and comes back whole. Only answers about this document,
 * picture and chunk are taken, and what is read is handed on as it arrived: the caller checks it.
 */
import { describe, it, expect } from 'vitest';
import type { DocumentPicturesRequest } from 'citadel-workspace-client-ts';
import { CHAT_ATTACHMENT_CHUNK_BYTES } from '@/lib/chat/attachments/attachment-wire';
import { serverPictures } from '../server-pictures';
import type { PicturePort, PictureDocument, PictureResult } from '../picture-port';
import { scriptedServer, type ScriptedServer } from './scripted-server';

/** Long enough never to fire in a test that is not about the deadline. */
const NO_DEADLINE_HERE: number = 5_000;
const ID: string = `sha256-${'ab'.repeat(32)}`;
const PAGE: PictureDocument = { kind: 'page', nodeId: 'room-1' };
const CHAT: PictureDocument = { kind: 'nodeChat', nodeId: 'room-1', chatDoc: 'cdoc-3f2a9c1e-7b4d-4e8a-9f01-2c3d4e5f6a7b' };
const picture: Uint8Array = Uint8Array.from({ length: CHAT_ATTACHMENT_CHUNK_BYTES * 2 + 5 }, (_: unknown, i: number): number => (i * 7) % 251);

function value<T>(result: PictureResult<T>): T {
  if (!result.ok) throw new Error(`expected a value, got ${result.failure.kind}`);
  return result.value;
}

describe('a picture on the workspace server', () => {
  it('goes up in the server\'s chunks, one answered at a time, and comes back whole', async () => {
    const server: ScriptedServer = scriptedServer();
    const port: PicturePort = serverPictures(server, NO_DEADLINE_HERE);
    value(await port.put(PAGE, ID, picture));
    expect(server.maxInFlight()).toBe(1);
    const sizes: number[] = server.sent.map((r: DocumentPicturesRequest): number => ('UploadChunk' in r ? r.UploadChunk.bytes.length : -1));
    expect(sizes).toEqual([CHAT_ATTACHMENT_CHUNK_BYTES, CHAT_ATTACHMENT_CHUNK_BYTES, 5]);
    expect(value(await port.get(PAGE, ID))).toEqual(picture);
  });

  it('addresses a node chat document as itself, and takes no answer about another document', async () => {
    const server: ScriptedServer = scriptedServer();
    const port: PicturePort = serverPictures(server, NO_DEADLINE_HERE);
    value(await port.put(CHAT, ID, picture));
    const first: DocumentPicturesRequest | undefined = server.sent[0];
    expect(first !== undefined && 'UploadChunk' in first ? first.UploadChunk.doc : null).toEqual({ node_id: 'room-1', chat_doc: CHAT.kind === 'nodeChat' ? CHAT.chatDoc : '' });
    // The page's refusal of the same picture arrives first: it is not this document's answer.
    server.decoys.push({ Refused: { doc: { node_id: 'room-1', chat_doc: null }, content_id: ID, refusal: 'Denied' } });
    expect(value(await port.get(CHAT, ID))).toEqual(picture);
  });

  it('hands on what it read unchecked, and asks the server every time', async () => {
    const server: ScriptedServer = scriptedServer({ tamper: true });
    const port: PicturePort = serverPictures(server, NO_DEADLINE_HERE);
    value(await port.put(PAGE, ID, picture));
    const flipped: Uint8Array = picture.map((b: number): number => b ^ 0xff);
    expect(value(await port.get(PAGE, ID))).toEqual(flipped);
    const reads = (): number => server.sent.filter((r: DocumentPicturesRequest): boolean => 'ReadChunk' in r).length;
    const once: number = reads();
    value(await port.get(PAGE, ID));
    expect(reads()).toBe(2 * once);
  });

  it('keeps no picture of a direct chat\'s or a scratchpad\'s document', async () => {
    const port: PicturePort = serverPictures(scriptedServer(), NO_DEADLINE_HERE);
    await expect(port.put({ kind: 'pair', selfCid: 1n, peerCid: 2n, docId: 'd' }, ID, picture)).rejects.toThrow(/no pictures of a pair/);
    await expect(port.get({ kind: 'scratchpad', account: 1n, docId: 'd' }, ID)).rejects.toThrow(/no pictures of a scratchpad/);
  });
});
