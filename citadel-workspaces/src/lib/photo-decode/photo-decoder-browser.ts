/**
 * The page's photo decoder: the real worker, the preview limits (image-preview.ts holds them, for
 * the browser's own formats and these alike) and the browser's timers. Importing this costs a few
 * hundred bytes; the worker, its glue and the binary are fetched on the first HEIC, TIFF or RAW.
 */
import { MAX_PREVIEW_EDGE, MAX_PREVIEW_PIXELS } from '@/lib/received-files/image-preview';
import { createPhotoDecoder, type PhotoDecoder, type PhotoWorker } from './photo-decoder';

/** One photo's longest decode: a 40-megapixel HEIC takes a few seconds in a slow phone's worker. */
const PHOTO_DEADLINE_MS: number = 60_000;
/** The worker (and the memory its module grew to) is kept this long after the last photo. */
const PHOTO_WORKER_IDLE_MS: number = 20_000;

export const photoDecoder: PhotoDecoder = createPhotoDecoder({
  // The options must be a static literal: Vite parses them at build time to bundle the worker.
  spawn: (): PhotoWorker => new Worker(new URL('./photo.worker.ts', import.meta.url), { type: 'module' }) as PhotoWorker,
  limits: { maxPixels: MAX_PREVIEW_PIXELS, maxEdge: MAX_PREVIEW_EDGE },
  deadlineMs: PHOTO_DEADLINE_MS,
  idleMs: PHOTO_WORKER_IDLE_MS,
  timers: {
    set: (run: () => void, ms: number): number => window.setTimeout(run, ms),
    clear: (id: number): void => window.clearTimeout(id),
  },
});
