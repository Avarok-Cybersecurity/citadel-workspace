/**
 * The owner's report (REL-1124 item 2): a picture renders after it is inserted, and after the
 * document is closed and opened again there is a box saying "image not available". The editor
 * keeps picture bytes only in memory; these tests insert a picture, close the document, open it
 * in a fresh editor (a new runtime, its image library empty), and expect the picture drawn from
 * the document's store, for another member's replica too, and inside an exported file.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES } from '../../engine/engine-limits';
import type { AddedImage, EditorEvents } from '../../editor/controller';
import type { PictureDocument } from '../picture-port';
import { memoryPictures, PNG_4X3, type MemoryPictures } from './doubles/memory-pictures';
import { close, drawnImages, heldBytes, labels, openWith, paintSettled, storedAccess, type Opened } from './picture-rig';
import { UNAVAILABLE_IMAGE_LABEL } from '../../paint/image-resolve';

const PAGE: PictureDocument = { kind: 'page', nodeId: 'node-1' };
const opened: Opened[] = [];
const track = (o: Opened): Opened => { opened.push(o); return o; };

afterEach((): void => {
  for (const o of opened.splice(0)) close(o);
});

async function insertPicture(store: MemoryPictures): Promise<{ readonly snapshot: Uint8Array; readonly added: AddedImage }> {
  const a: Opened = track(await openWith(storedAccess(store, PAGE), { kind: 'blank' }));
  const added: AddedImage = await a.editor.addImage(PNG_4X3, MAX_IMAGE_BYTES);
  await a.editor.execute({ name: 'insertImageFitted', contentId: added.contentId });
  expect(drawnImages(await paintSettled(a))).toBe(1);
  return { snapshot: await a.editor.snapshot(), added };
}

describe('a picture inserted into a document', () => {
  it('is drawn again after the document is closed and opened in a fresh editor', async () => {
    const store: MemoryPictures = memoryPictures();
    const { snapshot, added } = await insertPicture(store);
    const b: Opened = track(await openWith(storedAccess(store, PAGE), { kind: 'snapshot', snapshot }));
    const calls = await paintSettled(b);
    expect(labels(calls)).not.toContain(UNAVAILABLE_IMAGE_LABEL);
    expect(drawnImages(calls)).toBe(1);
    expect(await heldBytes(b, added.contentId)).toEqual(PNG_4X3);
  });

  it('is stored before the update that places it can be relayed', async () => {
    const store: MemoryPictures = memoryPictures();
    const a: Opened = track(await openWith(storedAccess(store, PAGE), { kind: 'blank' }));
    const changes: Array<EditorEvents['change']> = [];
    a.editor.on('change', (c: EditorEvents['change']): void => { changes.push(c); });
    const added: AddedImage = await a.editor.addImage(PNG_4X3, MAX_IMAGE_BYTES);
    expect(store.puts).toEqual([{ doc: PAGE, contentId: added.contentId }]);
    expect(changes).toEqual([]);
  });

  it('is not inserted when it cannot be stored, and the member is told why', async () => {
    const store: MemoryPictures = memoryPictures();
    store.fail({ kind: 'notPermitted' });
    const a: Opened = track(await openWith(storedAccess(store, PAGE), { kind: 'blank' }));
    await expect(a.editor.addImage(PNG_4X3, MAX_IMAGE_BYTES)).rejects.toThrow(/do not have access/);
  });

  it("is drawn in another member's replica that receives the update", async () => {
    const store: MemoryPictures = memoryPictures();
    const base: Opened = track(await openWith(storedAccess(store, PAGE), { kind: 'blank' }));
    const snapshot: Uint8Array = await base.editor.snapshot();
    const a: Opened = track(await openWith(storedAccess(store, PAGE), { kind: 'snapshot', snapshot }));
    const c: Opened = track(await openWith(storedAccess(store, PAGE), { kind: 'snapshot', snapshot }, 'main-thread'));
    const updates: Uint8Array[] = [];
    a.editor.on('change', ({ update }: EditorEvents['change']): void => { updates.push(update); });
    const added: AddedImage = await a.editor.addImage(PNG_4X3, MAX_IMAGE_BYTES);
    await a.editor.execute({ name: 'insertImageFitted', contentId: added.contentId });
    for (const update of updates) await c.editor.applyRemote(update);
    expect(drawnImages(await paintSettled(c))).toBe(1);
    expect(await heldBytes(c, added.contentId)).toEqual(PNG_4X3);
  });

  it('is inside a file exported after reopening', async () => {
    const store: MemoryPictures = memoryPictures();
    const { snapshot, added } = await insertPicture(store);
    const b: Opened = track(await openWith(storedAccess(store, PAGE), { kind: 'snapshot', snapshot }));
    const docx = await b.editor.exportAs({ format: 'docx' });
    const imported: Opened = track(await openWith({ kind: 'none', reason: 'a test reads the file' }, { kind: 'bytes', bytes: docx.bytes, format: 'docx' }));
    expect(await heldBytes(imported, added.contentId)).toEqual(PNG_4X3);
  });
});
