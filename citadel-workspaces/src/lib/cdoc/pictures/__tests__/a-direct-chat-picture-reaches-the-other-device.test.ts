/**
 * The owner's scenario in a direct chat: Alice inserts a picture, closes the document, and Bob
 * opens it on his own device, which had nothing of it. Bob's copy wants it from Alice by content
 * id over their P2P channel, keeps what arrives, and draws and exports the same bytes; from then
 * on it is on Bob's device, so it is there after Alice goes offline. Alice's `picture_have` gets
 * it to Bob's device before he ever opens the document. With Alice gone before Bob had it, the
 * box says the picture is offline.
 *
 * Real: pair-pictures.ts and its wire, both device stores, the chat index, SHA-256, the wasm
 * editor. Stood in: the channel, each agent's LocalDB, time (doubles/pair-world.ts).
 */
import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES } from '../../engine/engine-limits';
import { pictureMissingLabel } from '../picture-port';
import { sha256ContentId } from '../content-id';
import { close, drawnImages, heldBytes, insertCloseReopen, labels, openWith, paintSettled, type Opened, type OwnerScenario } from './picture-rig';
import { PNG_4X3 } from './doubles/memory-pictures';
import { aliceAndBob, settled } from './doubles/pair-world';

describe('a picture in a direct chat\'s document', () => {
  it('is drawn on the other person\'s device after a reopen, with the same bytes, and exported', async () => {
    const { alice, bob } = await aliceAndBob();
    // Bob's agent is not listening for announcements: his reopen has to want it from Alice.
    bob.deafen();
    expect(bob.pictureKeys()).toEqual([]);
    const seen: OwnerScenario = await insertCloseReopen(() => alice.access(), () => bob.access(), PNG_4X3);
    expect(drawnImages(seen.reopenedCalls)).toBe(1);
    expect(seen.reopenedBytes).toEqual(PNG_4X3);
    expect(seen.exported).toEqual({ bytes: PNG_4X3 });
    expect(await settled(alice)).toContain('sent');
    expect(alice.db.requests.every((r) => r.cid === alice.cid)).toBe(true);
    expect(bob.db.requests.every((r) => r.cid === bob.cid)).toBe(true);
  });

  it('is kept on the other device at its first fetch, so it is there after the inserter goes offline', async () => {
    const { channel, alice, bob } = await aliceAndBob();
    bob.deafen();
    const id: string = await sha256ContentId(PNG_4X3);
    expect((await alice.port.put(alice.doc, id, PNG_4X3)).ok).toBe(true);
    expect(await bob.port.get(bob.doc, id)).toEqual({ ok: true, value: PNG_4X3 });
    channel.up = false;
    expect(await bob.port.get(bob.doc, id)).toEqual({ ok: true, value: PNG_4X3 });
  });

  it('reaches the other device when it is inserted, so Bob opens it after Alice went offline', async () => {
    const { channel, alice, bob } = await aliceAndBob();
    const a: Opened = await openWith(alice.access(), { kind: 'blank' });
    let snapshot: Uint8Array;
    try {
      const { contentId } = await a.editor.addImage(PNG_4X3, MAX_IMAGE_BYTES);
      await a.editor.execute({ name: 'insertImageFitted', contentId });
      snapshot = await a.editor.snapshot();
    } finally {
      close(a);
    }
    expect(await settled(bob)).toEqual(['kept']);
    channel.up = false;
    const b: Opened = await openWith(bob.access(), { kind: 'snapshot', snapshot });
    try {
      expect(drawnImages(await paintSettled(b))).toBe(1);
      expect(await heldBytes(b, await sha256ContentId(PNG_4X3))).toEqual(PNG_4X3);
    } finally {
      close(b);
    }
  });

  it('is drawn as an offline box when Alice is gone and Bob never had it', async () => {
    const { channel, alice, bob } = await aliceAndBob();
    channel.up = false;
    const seen: OwnerScenario = await insertCloseReopen(() => alice.access(), () => bob.access(), PNG_4X3);
    expect(drawnImages(seen.reopenedCalls)).toBe(0);
    expect(labels(seen.reopenedCalls)).toContain(pictureMissingLabel({ kind: 'offline' }));
    expect(seen.exported).toEqual({ refused: expect.stringMatching(/^The document was not exported: 1 picture could not be fetched/) });
    expect(bob.pictureKeys()).toEqual([]);
  });
});
