/**
 * Editor sessions over the real cdoc-wasm with a picture store, for the reopen tests: each
 * `open` is a fresh runtime (a new editor whose image library starts empty, as a reopened tab's
 * does), painting into recording canvases, so a test can read what a page drew.
 */
import { inProcessRuntime, type TestRuntime } from '../../__tests__/wasm-rig';
import { EditorSession } from '../../editor/editor-session';
import type { EditorOrigin } from '../../editor/controller';
import type { Call } from '../../paint/__tests__/recording-canvas';
import type { PaintOutcome } from '../../paint/page-rasterizer';
import { LOADING_IMAGE_LABEL } from '../../paint/image-resolve';
import { DocumentPictures, type PictureAccess } from '../document-pictures';
import { PICTURE_LIMITS } from '../picture-config';
import type { PictureDocument, PicturePort } from '../picture-port';
import { sha256ContentId } from '../content-id';
import { decodeImage } from '../../editor/wire/decode-v4-records';

export interface Opened {
  readonly runtime: TestRuntime;
  readonly editor: EditorSession;
}

let nextClient: bigint = 1n;

/** The store as the app gives it to a document: `doc`'s pictures over `port`. */
export function storedAccess(port: PicturePort, doc: PictureDocument): PictureAccess {
  return { kind: 'stored', pictures: new DocumentPictures({ port, doc, contentIdOf: sha256ContentId, now: (): number => Date.now(), limits: PICTURE_LIMITS }) };
}

export async function openWith(access: PictureAccess, from: EditorOrigin, renderer: 'worker' | 'main-thread' = 'worker'): Promise<Opened> {
  const runtime: TestRuntime = inProcessRuntime(renderer);
  const editor: EditorSession = await EditorSession.open({ client: runtime.client, renderer: runtime.renderer, pictures: access }, nextClient++, from);
  await runtime.renderer.mount(0, {} as HTMLCanvasElement);
  return { runtime, editor };
}

export function close(opened: Opened): void {
  opened.editor.dispose();
  opened.runtime.client.dispose();
}

/** Resolves at the next `pages` event naming `page`: the session repaints a page whose picture arrived. */
export function repainted(editor: EditorSession, page: number): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    const off: () => void = editor.on('pages', ({ dirtyPages }: { readonly dirtyPages: readonly number[] }): void => {
      if (!dirtyPages.includes(page)) return;
      off();
      resolve();
    });
  });
}

/** Each picture's arrival repaints its pages once: a page of several settles over several paints. */
const MAX_SETTLING_PAINTS: number = 10;

/** Paints page 0 as the page view would: again on every repaint, until no picture is on its way. Answers the last paint's calls. */
export async function paintSettled(opened: Opened): Promise<Call[]> {
  const calls: Call[] = opened.runtime.painted[opened.runtime.painted.length - 1].calls;
  for (let n: number = 0; n < MAX_SETTLING_PAINTS; n++) {
    const arrived: Promise<void> = repainted(opened.editor, 0);
    const from: number = calls.length;
    const outcome: PaintOutcome = await opened.runtime.renderer.paint(0, 0, 1, 1, 'visible');
    // Settled: nothing is being fetched. A picture that failed in a way that may pass stays wanted, under its own label.
    if (outcome.pendingImages.length === 0 || !labels(calls.slice(from)).includes(LOADING_IMAGE_LABEL)) return calls.slice(from);
    await arrived;
  }
  throw new Error(`page 0 still had pictures on their way after ${MAX_SETTLING_PAINTS} paints`);
}

export const drawnImages = (calls: readonly Call[]): number => calls.filter((c: Call): boolean => c.name === 'drawImage').length;

/** The labels written on the page: a placeholder box's label among them. */
export const labels = (calls: readonly Call[]): string[] => calls.filter((c: Call): boolean => c.name === 'fillText').map((c: Call): string => String(c.args[0]));

/** The bytes the editor of `o` holds under `contentId`, or null when it holds none. */
export async function heldBytes(o: Opened, contentId: string): Promise<Uint8Array | null> {
  const { lookup } = await o.runtime.client.request({ kind: 'image', contentId });
  return lookup.kind === 'held' ? decodeImage(lookup.record).bytes : null;
}

export interface OwnerScenario {
  /** Page 0 of the reopened document, settled: what it drew. */
  readonly reopenedCalls: Call[];
  readonly reopenedBytes: Uint8Array | null;
  /** The same picture in a docx exported from the reopened document, read back; or why the export was refused. */
  readonly exported: { readonly bytes: Uint8Array | null } | { readonly refused: string };
}

/**
 * The owner's scenario over one backend: insert `picture` through `writer`'s access, close the
 * document, reopen its snapshot in a fresh editor through `reader`'s (another tab, member or
 * device of the same store), and export the reopened document.
 */
export async function insertCloseReopen(writer: () => PictureAccess, reader: () => PictureAccess, picture: Uint8Array): Promise<OwnerScenario> {
  const a: Opened = await openWith(writer(), { kind: 'blank' });
  let snapshot: Uint8Array;
  let contentId: string;
  try {
    contentId = (await a.editor.addImage(picture)).contentId;
    await a.editor.execute({ name: 'insertImageFitted', contentId });
    snapshot = await a.editor.snapshot();
  } finally {
    close(a);
  }
  const b: Opened = await openWith(reader(), { kind: 'snapshot', snapshot });
  try {
    const reopenedCalls: Call[] = await paintSettled(b);
    const reopenedBytes: Uint8Array | null = await heldBytes(b, contentId);
    let docx: Uint8Array;
    try {
      docx = (await b.editor.exportAs({ format: 'docx' })).bytes;
    } catch (error: unknown) {
      return { reopenedCalls, reopenedBytes, exported: { refused: error instanceof Error ? error.message : String(error) } };
    }
    const imported: Opened = await openWith({ kind: 'none', reason: 'a test reads the exported file' }, { kind: 'bytes', bytes: docx, format: 'docx' });
    try {
      return { reopenedCalls, reopenedBytes, exported: { bytes: await heldBytes(imported, contentId) } };
    } finally {
      close(imported);
    }
  } finally {
    close(b);
  }
}
