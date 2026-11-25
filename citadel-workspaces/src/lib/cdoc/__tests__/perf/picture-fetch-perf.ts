/**
 * Typing and scrolling in a reopened document of many pictures while none of them has arrived:
 * the store holds every fetch open, so a keystroke or a page paint that waited for a picture
 * would never finish. Through the production path minus the thread hop (EditorSession, the
 * worker host on the real cdoc-edit, the worker renderer into a no-op canvas). Shared by
 * paint-perf-cli.ts (prints) and picture-fetch-perf.test.ts (asserts what ran, never a time).
 */
import { performance } from 'node:perf_hooks';
import { InProcessCdocClient } from '../../worker/clients';
import { WorkerPageRenderer } from '../../paint/page-renderer';
import { EditorSession } from '../../editor/editor-session';
import { MAX_IMAGE_BYTES } from '../../engine/engine-limits';
import type { EditorState } from '../../editor/controller';
import { DocumentPictures, type PictureAccess } from '../../pictures/document-pictures';
import { sha256ContentId } from '../../pictures/content-id';
import { PICTURE_LIMITS, type PictureLimits } from '../../pictures/picture-config';
import { memoryPictures, PNG_4X3, type MemoryPictures } from '../../pictures/__tests__/doubles/memory-pictures';
import { realHost } from '../wasm-rig';
import { nullPort, nullTarget } from './null-canvas';

export interface PictureFetchPerf {
  readonly pictures: number;
  readonly pages: number;
  /** Keystroke to repaint of the caret's page, while every fetch is held. */
  readonly keyP50Ms: number;
  readonly keyP95Ms: number;
  /** One page painted (scrolled to) while its pictures are held. */
  readonly pageP50Ms: number;
  /** Fetches the store saw while everything was held: at most the concurrency limit. */
  readonly heldGets: number;
  /** Fetches once released and every page settled: each picture once. */
  readonly totalGets: number;
  readonly distinctGets: number;
}

const percentile = (xs: number[], p: number): number => [...xs].sort((a: number, b: number) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];
const DOC = { kind: 'page', nodeId: 'perf' } as const;

/** A distinct PNG per index: bytes after IEND change the content id, not the picture. */
const nth = (n: number): Uint8Array => Uint8Array.from([...PNG_4X3, n & 0xff, n >> 8]);

function access(store: MemoryPictures, limits: PictureLimits): PictureAccess {
  return { kind: 'stored', pictures: new DocumentPictures({ port: store, doc: DOC, contentIdOf: sha256ContentId, now: (): number => performance.now(), limits }) };
}

function open(store: MemoryPictures, limits: PictureLimits, from: Parameters<typeof EditorSession.open>[2]): Promise<{ editor: EditorSession; renderer: WorkerPageRenderer }> {
  const client: InProcessCdocClient = new InProcessCdocClient(realHost(nullPort, (): typeof nullTarget => nullTarget));
  const renderer: WorkerPageRenderer = new WorkerPageRenderer(client, (): OffscreenCanvas => ({}) as OffscreenCanvas);
  return EditorSession.open({ client, renderer, pictures: access(store, limits) }, 1n, from).then((editor: EditorSession) => ({ editor, renderer }));
}

/** `limits`: the production limits; a control passes others. */
export async function measurePictureFetch(pictures: number, keystrokes: number, limits: PictureLimits = PICTURE_LIMITS): Promise<PictureFetchPerf> {
  const store: MemoryPictures = memoryPictures();
  const writer = await open(store, limits, { kind: 'blank' });
  for (let n: number = 0; n < pictures; n++) {
    const { contentId } = await writer.editor.addImage(nth(n), MAX_IMAGE_BYTES);
    await writer.editor.execute({ name: 'insertImageFitted', contentId });
    await writer.editor.execute({ name: 'insertText', text: `\nPicture ${n} and a line about it.\n` });
  }
  const snapshot: Uint8Array = await writer.editor.snapshot();
  writer.editor.dispose();
  const putGets: number = store.gets.length;

  const release: () => void = store.hold();
  const { editor, renderer } = await open(store, limits, { kind: 'snapshot', snapshot });
  await renderer.mount(0, {} as HTMLCanvasElement);
  const pageTimes: number[] = [];
  for (let page: number = 0; page < editor.state.pageCount; page++) {
    const t: number = performance.now();
    await renderer.paint(0, page, 1, 2, 'visible');
    pageTimes.push(performance.now() - t);
  }
  const keyTimes: number[] = [];
  for (let i: number = 0; i < keystrokes; i++) {
    const t: number = performance.now();
    const state: EditorState = await editor.execute({ name: 'insertText', text: 'e' });
    if (state.caretPage !== null) await renderer.paint(0, state.caretPage, 1, 2, 'visible');
    keyTimes.push(performance.now() - t);
  }
  const heldGets: number = store.gets.length - putGets;
  release();
  // Each arrival repaints its pages: paint every page until none still has a picture on its way.
  for (let round: number = 0; round <= pictures; round++) {
    let waiting: number = 0;
    for (let page: number = 0; page < editor.state.pageCount; page++) waiting += (await renderer.paint(0, page, 1, 2, 'visible')).pendingImages.length;
    if (waiting === 0) break;
    await new Promise<void>((resolve: () => void): void => { setTimeout(resolve, 0); });
  }
  const gets = store.gets.slice(putGets);
  editor.dispose();
  return {
    pictures, pages: editor.state.pageCount, keyP50Ms: percentile(keyTimes, 0.5), keyP95Ms: percentile(keyTimes, 0.95), pageP50Ms: percentile(pageTimes, 0.5),
    heldGets, totalGets: gets.length, distinctGets: new Set(gets.map((g) => g.contentId)).size,
  };
}
