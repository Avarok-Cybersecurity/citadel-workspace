/**
 * The photo decoder's Web Worker: the Rust module and the canvas, off the main thread. This file
 * is the only wiring of real adapters to decode-photo.ts. Requests are answered one at a time, in
 * order. A failure inside the module (a trap) leaves its memory in an unknown state, so the worker
 * answers and then closes; the page starts a fresh one for the next photo.
 */
import { canvasPorts } from './canvas-ports';
import { decodePhoto, type DecodePorts, type NativeMemo } from './decode-photo';
import { loadPhotoModule } from './load-module';
import { isPhotoRequest, type PhotoRequest, type PhotoResponse } from './protocol';

interface WorkerScope {
  postMessage(message: PhotoResponse): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  close(): void;
}

const scope: WorkerScope = self as unknown as WorkerScope;
const memo: NativeMemo = new Map();
let module: Promise<DecodePorts['module']> | null = null;
let queue: Promise<void> = Promise.resolve();

async function answer(request: PhotoRequest): Promise<void> {
  try {
    module ??= loadPhotoModule();
    const ports: DecodePorts = { ...canvasPorts, module: await module };
    scope.postMessage({ id: request.id, answer: await decodePhoto(new Uint8Array(request.bytes), request.mime, request.limits, ports, memo) });
  } catch (error: unknown) {
    const detail: string = error instanceof Error ? error.message : String(error);
    scope.postMessage({ id: request.id, answer: { kind: 'decoder-failed', detail } });
    scope.close();
  }
}

scope.addEventListener('message', (event: MessageEvent<unknown>): void => {
  const request: unknown = event.data;
  if (!isPhotoRequest(request)) {
    console.error('photo worker: ignored a message that is not a photo request');
    return;
  }
  queue = queue.then((): Promise<void> => answer(request));
});
