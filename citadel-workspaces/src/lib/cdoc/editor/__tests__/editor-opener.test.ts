/**
 * Replicas: each open is a new CRDT client id drawn from the random source, read back from
 * the real engine's own awareness record; tombstone collection between two real replicas;
 * images held by signature. Files, chunked diffs and the v4 members are editor-files.test.ts
 * and editor-v4.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { inProcessRuntime, type TestRuntime } from '../../__tests__/wasm-rig';
import { createEditorOpener, newReplicaId } from '../editor-opener';
import type { EditorSession } from '../editor-session';
import type { AddedImage, EditorOrigin } from '../controller';
import { createHash } from 'node:crypto';
import { decodeAwareness, type Collected } from '../wire/decode-records';

/** The smallest PNG: a 1x1 transparent pixel. */
const PNG_1X1: Uint8Array = Uint8Array.from(Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex',
));

async function opened(random: (bytes: Uint8Array) => Uint8Array, from: EditorOrigin): Promise<EditorSession> {
  const runtime: TestRuntime = inProcessRuntime('worker');
  return createEditorOpener({ client: runtime.client, renderer: runtime.renderer }, random)(from);
}

/** A deterministic source standing in for crypto.getRandomValues: the id it yields is known. */
function counting(): (bytes: Uint8Array) => Uint8Array {
  let next: number = 1;
  return (bytes: Uint8Array): Uint8Array => bytes.map((): number => next++ & 0xff);
}

describe('the editor opener', () => {
  it('reads 64 bits big-endian from the random source', () => {
    expect(newReplicaId(counting())).toBe(0x0102030405060708n);
    expect(newReplicaId((b: Uint8Array): Uint8Array => b.fill(0xff))).toBe(0xffff_ffff_ffff_ffffn);
  });

  it('refuses a source that did not fill eight bytes', () => {
    expect(() => newReplicaId((): Uint8Array => new Uint8Array(4))).toThrow(/8 bytes/);
  });

  it('opens every replica with a fresh client id, which the engine then reports as its own', async () => {
    const runtime: TestRuntime = inProcessRuntime('worker');
    const open: (from: EditorOrigin) => Promise<EditorSession> = createEditorOpener({ client: runtime.client, renderer: runtime.renderer }, counting());
    const first: EditorSession = await open({ kind: 'blank' });
    const firstId: bigint = decodeAwareness(await first.awareness()).client;
    const second: EditorSession = await open({ kind: 'blank' });
    const secondId: bigint = decodeAwareness(await second.awareness()).client;
    expect(firstId).toBe(0x0102030405060708n);
    expect(secondId).toBe(0x090a0b0c0d0e0f10n);
  });

  it('collects the tombstones a caught-up peer has seen, and refuses with no peers listed', async () => {
    const a: EditorSession = await opened(counting(), { kind: 'blank' });
    // The peer joins from A's snapshot, as a collaborator does: one document, two replicas.
    const b: EditorSession = await opened((bytes: Uint8Array): Uint8Array => bytes.fill(0x22), { kind: 'snapshot', snapshot: await a.snapshot() });
    await a.execute({ name: 'insertText', text: 'tomb stone' });
    await b.applyRemote(await a.encodeDiff(await b.stateVector()));
    await a.execute({ name: 'deleteBackward', unit: 'word' });
    await b.applyRemote(await a.encodeDiff(await b.stateVector()));
    await expect(a.collectGarbage([])).rejects.toThrow();
    const collected: Collected = await a.collectGarbage([await b.stateVector()]);
    expect(collected.units).toBeGreaterThan(0);
  });

  it('holds a PNG, naming it by its sha256, and refuses a file over the limit', async () => {
    const editor: EditorSession = await opened(counting(), { kind: 'blank' });
    const image: AddedImage = await editor.addImage(PNG_1X1, 1024);
    expect(image).toEqual({ contentId: `sha256-${createHash('sha256').update(PNG_1X1).digest('hex')}`, kind: 'png', width: 1, height: 1 });
    await expect(editor.addImage(PNG_1X1, PNG_1X1.length - 1)).rejects.toThrow();
    await expect(editor.addImage(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), 1024)).rejects.toThrow(/unsupported image type: GIF/);
  });
});
