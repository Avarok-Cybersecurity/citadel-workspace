// @vitest-environment node
/**
 * The migration's client id and origin, derived from the Yjs state alone, so two devices that
 * hold the same state derive the same id without talking (the engine stream proves the same
 * inputs give byte-identical snapshots; this proves the inputs are the same).
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { clientFromDigest, migrationIdentity, migrationOrigin, type MigrationIdentity } from '../migration-identity';
import { chatYDoc, STARTER_KIT_SAMPLE } from './fixtures';

const DOC_ID: string = '7b0e6c1e-3f7a-4a51-9d0c-2f1d6b8f9e10';
/** A fixed state vector: client 1 at clock 5, client 42 at clock 7 (lib0 varuints). */
const FIXED_SV: Uint8Array = new Uint8Array([2, 1, 5, 42, 7]);

describe('the migration identity', () => {
  // Pinned from an independent computation (Python hashlib over the same bytes), not from this code's output.
  it('is pinned for a fixed document and state vector, so a change to the derivation cannot pass unnoticed', async () => {
    const id: MigrationIdentity = await migrationIdentity(DOC_ID, FIXED_SV);
    expect(id.origin).toBe('92abefef13745c2f37000f9f5539c8c42a2e6153495527a1878f3b9c88c92d5f');
    expect(id.client.toString()).toBe('12343196891819993141');
  });

  it('is the same on two devices that built the same state from the same updates in different orders', async () => {
    const author: Y.Doc = chatYDoc(STARTER_KIT_SAMPLE, 'Plan');
    const first: Uint8Array = Y.encodeStateAsUpdate(author);
    const peer: Y.Doc = new Y.Doc();
    Y.applyUpdate(peer, first);
    peer.getXmlFragment('default').insert(0, [new Y.XmlElement('paragraph')]);
    const second: Uint8Array = Y.encodeStateAsUpdate(peer, Y.encodeStateVector(author));

    const deviceA: Y.Doc = new Y.Doc();
    Y.applyUpdate(deviceA, first);
    Y.applyUpdate(deviceA, second);
    const deviceB: Y.Doc = new Y.Doc();
    Y.applyUpdate(deviceB, second);
    Y.applyUpdate(deviceB, first);

    const [a, b]: MigrationIdentity[] = await Promise.all([deviceA, deviceB].map((d: Y.Doc) => migrationIdentity(DOC_ID, Y.encodeStateVector(d))));
    expect(a).toEqual(b);
  });

  it('changes with the state vector and with the document id (negative controls)', async () => {
    const base: MigrationIdentity = await migrationIdentity(DOC_ID, FIXED_SV);
    const moreEdits: MigrationIdentity = await migrationIdentity(DOC_ID, new Uint8Array([2, 1, 6, 42, 7]));
    const otherDoc: MigrationIdentity = await migrationIdentity(`${DOC_ID}x`, FIXED_SV);
    expect(moreEdits.client).not.toBe(base.client);
    expect(moreEdits.origin).not.toBe(base.origin);
    expect(otherDoc.client).not.toBe(base.client);
    // The origin is the state's alone: the same state in another document has the same origin.
    expect(otherDoc.origin).toBe(base.origin);
    expect(base.origin).toBe(await migrationOrigin(FIXED_SV));
  });

  it('is never zero across many real documents', async () => {
    for (let i: number = 0; i < 200; i += 1) {
      const id: MigrationIdentity = await migrationIdentity(`doc-${i}`, new Uint8Array([1, i % 128, i]));
      expect(id.client).toBeGreaterThan(0n);
      expect(id.client).toBeLessThan(1n << 64n);
    }
  });
});

describe('a client id from a digest', () => {
  const digest = (...words: bigint[]): Uint8Array => {
    const out: Uint8Array = new Uint8Array(words.length * 8);
    words.forEach((w: bigint, i: number): void => new DataView(out.buffer).setBigUint64(i * 8, w));
    return out;
  };

  it('is the first 64-bit word, big-endian', () => {
    expect(clientFromDigest(digest(0x0102030405060708n, 9n))).toBe(0x0102030405060708n);
  });

  it('skips a zero first word rather than answering 0, the id cdoc reserves for the blank', () => {
    expect(clientFromDigest(digest(0n, 0xffn, 3n))).toBe(0xffn);
  });

  it('refuses a digest with no non-zero word, and one that is not whole words', () => {
    expect(() => clientFromDigest(digest(0n, 0n))).toThrow(/all zero/);
    expect(() => clientFromDigest(new Uint8Array(7))).toThrow(/64-bit/);
  });
});
