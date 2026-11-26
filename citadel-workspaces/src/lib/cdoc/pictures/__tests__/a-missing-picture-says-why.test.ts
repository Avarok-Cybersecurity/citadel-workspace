/**
 * What a reopened document draws while a picture is on its way and when it cannot come: a box
 * saying it is loading, then the picture, or a box saying why it is not there; never the old
 * "image not available" for a picture the store could still give. An imported file's pictures
 * are stored when it opens, so a reopen finds them.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddedImage } from '../../editor/controller';
import type { PaintOutcome } from '../../paint/page-rasterizer';
import { LOADING_IMAGE_LABEL } from '../../paint/image-resolve';
import { pictureMissingLabel, type PictureDocument } from '../picture-port';
import { memoryPictures, PNG_4X3, type MemoryPictures } from './doubles/memory-pictures';
import type { Call } from '../../paint/__tests__/recording-canvas';
import { close, drawnImages, labels, openWith, paintSettled, repainted, storedAccess, type Opened } from './picture-rig';

const PAGE: PictureDocument = { kind: 'page', nodeId: 'node-2' };
const opened: Opened[] = [];
const track = (o: Opened): Opened => { opened.push(o); return o; };
afterEach((): void => { for (const o of opened.splice(0)) close(o); });

async function withPicture(store: MemoryPictures): Promise<Uint8Array> {
  const a: Opened = track(await openWith(storedAccess(store, PAGE), { kind: 'blank' }));
  const added: AddedImage = await a.editor.addImage(PNG_4X3);
  await a.editor.execute({ name: 'insertImageFitted', contentId: added.contentId });
  return a.editor.snapshot();
}

describe('a picture the editor does not hold yet', () => {
  it('is drawn as loading while it is fetched, then drawn', async () => {
    const store: MemoryPictures = memoryPictures();
    const snapshot: Uint8Array = await withPicture(store);
    const release: () => void = store.hold();
    const b: Opened = track(await openWith(storedAccess(store, PAGE), { kind: 'snapshot', snapshot }));
    const arrived: Promise<void> = repainted(b.editor, 0);
    const first: PaintOutcome = await b.runtime.renderer.paint(0, 0, 1, 1, 'visible');
    expect(first.pendingImages).toHaveLength(1);
    expect(labels(b.runtime.painted[0].calls)).toContain(LOADING_IMAGE_LABEL);
    release();
    await arrived;
    const from: number = b.runtime.painted[0].calls.length;
    await b.runtime.renderer.paint(0, 0, 1, 1, 'visible');
    expect(drawnImages(b.runtime.painted[0].calls.slice(from))).toBe(1);
  });

  it.each([
    [{ kind: 'notPermitted' } as const],
    [{ kind: 'notFound' } as const],
    [{ kind: 'offline' } as const],
  ])('is drawn as a box saying why when the store answers %o', async (failure) => {
    const store: MemoryPictures = memoryPictures();
    const snapshot: Uint8Array = await withPicture(store);
    store.fail(failure);
    const b: Opened = track(await openWith(storedAccess(store, PAGE), { kind: 'snapshot', snapshot }));
    const calls: Call[] = await paintSettled(b);
    expect(drawnImages(calls)).toBe(0);
    expect(labels(calls)).toContain(pictureMissingLabel(failure));
  });

  it('is never handed to the editor when the stored bytes are not the picture', async () => {
    const store: MemoryPictures = memoryPictures();
    const snapshot: Uint8Array = await withPicture(store);
    const b: Opened = track(await openWith(storedAccess(store, PAGE), { kind: 'snapshot', snapshot }));
    store.tamper(store.puts[0].contentId, Uint8Array.from([...PNG_4X3, 0]));
    const calls: Call[] = await paintSettled(b);
    expect(drawnImages(calls)).toBe(0);
    expect(labels(calls)).toContain(pictureMissingLabel({ kind: 'damaged' }));
  });
});

describe('an imported file', () => {
  it('has its pictures stored when it opens, so a reopen of its replica draws them', async () => {
    const store: MemoryPictures = memoryPictures();
    const docx: Uint8Array = new Uint8Array(readFileSync(join(process.cwd(), 'src/lib/cdoc/__tests__/fixtures/png-jpeg-gif.docx')));
    const a: Opened = track(await openWith(storedAccess(store, PAGE), { kind: 'bytes', bytes: docx, format: 'docx' }));
    expect(store.puts.length).toBeGreaterThanOrEqual(2);
    const snapshot: Uint8Array = await a.editor.snapshot();
    const b: Opened = track(await openWith(storedAccess(store, PAGE), { kind: 'snapshot', snapshot }));
    expect(drawnImages(await paintSettled(b))).toBeGreaterThanOrEqual(2);
  });
});
