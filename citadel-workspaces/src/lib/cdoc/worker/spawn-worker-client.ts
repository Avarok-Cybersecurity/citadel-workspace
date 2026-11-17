/**
 * Starts the Citadel Docs worker. The one place `new Worker` is called; Vite bundles the entry
 * as its own module chunk, fetched only when a document opens. Alongside the client, the worker's
 * engine download (engine-load.ts) as a store the page's loading bar reads.
 */
import type { CdocClient } from './cdoc-client';
import { WorkerCdocClient } from './clients';
import { createValueStore, type ValueStore } from '@/lib/value-store';
import { isEngineLoadMessage, type EngineLoad } from './engine-load';

export interface SpawnedCdocWorker {
  readonly client: CdocClient;
  readonly engineLoad: ValueStore<EngineLoad>;
}

export function spawnCdocWorkerClient(): SpawnedCdocWorker {
  // The options must be a static literal: Vite parses them at build time to bundle the worker
  // (a constant there fails the build). No `name`: it is cosmetic, and a `name: '…'` literal
  // reads to check-event-listeners-have-emitters as an emitted event.
  const worker: Worker = new Worker(new URL('./cdoc.worker.ts', import.meta.url), { type: 'module' });
  const engineLoad: ValueStore<EngineLoad> = createValueStore<EngineLoad>('cdoc-engine-load', { kind: 'waiting' });
  const onLoad = (event: MessageEvent<unknown>): void => {
    if (isEngineLoadMessage(event.data)) engineLoad.set(event.data.engineLoad);
  };
  worker.addEventListener('message', onLoad);
  const client: CdocClient = new WorkerCdocClient(worker, (): void => {
    worker.removeEventListener('message', onLoad);
    worker.terminate();
  });
  return { client, engineLoad };
}
