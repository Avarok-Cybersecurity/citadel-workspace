/**
 * The page's side of the photo decoder: starts the worker on the first photo, sends each photo
 * once, and ends the worker when it has been idle a while, because a wasm module's memory only
 * ever grows and a large photo leaves it large. Every request has a deadline: past it the worker
 * is ended (which stops the decode) and the photo is refused, so no preview waits forever. A photo
 * still waiting when the worker ends is refused as a decoder failure, whose way on is to retry.
 *
 * Pure over the worker (SBIO): `spawn` is handed in; photo-decoder-browser.ts gives the real one.
 */
import type { PhotoMime } from '@/lib/received-files/raster-sniff';
import type { DecodedPhoto, PhotoLimits } from './decode-photo';
import type { PhotoRefusal } from './photo-refusal';
import { isPhotoResponse, type PhotoRequest, type PhotoResponse } from './protocol';

export type PhotoAnswer = DecodedPhoto | PhotoRefusal;

export interface PhotoDecoder {
  decode(bytes: Uint8Array, mime: PhotoMime): Promise<PhotoAnswer>;
}

/** The parts of a Worker this uses. */
export interface PhotoWorker {
  postMessage(message: PhotoRequest, transfer: Transferable[]): void;
  addEventListener(type: 'message' | 'error', listener: (event: MessageEvent<unknown> | ErrorEvent) => void): void;
  terminate(): void;
}

export interface PhotoDecoderOptions {
  readonly spawn: () => PhotoWorker;
  readonly limits: PhotoLimits;
  /** How long one photo may take, from being sent, before it is refused. */
  readonly deadlineMs: number;
  /** How long the worker is kept with nothing to do. */
  readonly idleMs: number;
  readonly timers: {
    readonly set: (run: () => void, ms: number) => number;
    readonly clear: (id: number) => void;
  };
}

interface Pending {
  readonly resolve: (answer: PhotoAnswer) => void;
  readonly deadline: number;
}

export function createPhotoDecoder(options: PhotoDecoderOptions): PhotoDecoder {
  let worker: PhotoWorker | null = null;
  let idle: number | null = null;
  let nextId: number = 1;
  const pending: Map<number, Pending> = new Map();

  const settle = (id: number, answer: PhotoAnswer): void => {
    const job: Pending | undefined = pending.get(id);
    if (job === undefined) return;
    pending.delete(id);
    options.timers.clear(job.deadline);
    job.resolve(answer);
    if (pending.size === 0) idle = options.timers.set(stop, options.idleMs);
  };

  /** Ends the worker; anything still waiting on it is refused with `detail`. */
  function end(detail: string): void {
    const ended: PhotoWorker | null = worker;
    worker = null;
    ended?.terminate();
    for (const id of [...pending.keys()]) settle(id, { kind: 'decoder-failed', detail });
  }

  function stop(): void {
    idle = null;
    if (pending.size === 0) end('the decoder was stopped');
  }

  function started(): PhotoWorker {
    if (worker !== null) return worker;
    const spawned: PhotoWorker = options.spawn();
    spawned.addEventListener('message', (event: MessageEvent<unknown> | ErrorEvent): void => {
      const data: unknown = 'data' in event ? event.data : undefined;
      if (!isPhotoResponse(data)) return;
      const response: PhotoResponse = data;
      settle(response.id, response.answer);
      // The worker closes itself after a failure inside the module: the rest start afresh.
      if (response.answer.kind === 'decoder-failed' && worker === spawned) end('the decoder stopped after an error');
    });
    spawned.addEventListener('error', (event: MessageEvent<unknown> | ErrorEvent): void => {
      if (worker === spawned) end('message' in event && typeof event.message === 'string' && event.message !== '' ? event.message : 'the decoder stopped');
    });
    worker = spawned;
    return spawned;
  }

  return {
    decode(bytes: Uint8Array, mime: PhotoMime): Promise<PhotoAnswer> {
      if (idle !== null) {
        options.timers.clear(idle);
        idle = null;
      }
      const id: number = nextId++;
      const copy: ArrayBuffer = bytes.slice().buffer;
      return new Promise<PhotoAnswer>((resolve: (answer: PhotoAnswer) => void): void => {
        const deadline: number = options.timers.set((): void => end(`it took longer than ${Math.round(options.deadlineMs / 1000)} s`), options.deadlineMs);
        pending.set(id, { resolve, deadline });
        started().postMessage({ id, bytes: copy, mime, limits: options.limits }, [copy]);
      });
    },
  };
}
