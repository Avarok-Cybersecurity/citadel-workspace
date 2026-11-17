/**
 * The spawner starts the scrubbing entry as a same-origin MODULE worker. jsdom has no Worker, so
 * the platform constructor is stood in for by one that records its arguments (the only global
 * replaced in these tests; real-worker.test.ts runs the entry itself in a real thread).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnAppWorker } from '../spawn-app-worker';

const original: unknown = (globalThis as { Worker?: unknown }).Worker;
afterEach(() => {
  (globalThis as { Worker?: unknown }).Worker = original;
});

describe('spawnAppWorker', () => {
  it('starts app-host.worker.ts as a module worker', () => {
    const seen: { url: string; options: WorkerOptions | undefined }[] = [];
    (globalThis as { Worker?: unknown }).Worker = class {
      constructor(url: URL | string, options?: WorkerOptions) {
        seen.push({ url: String(url), options });
      }
    };
    spawnAppWorker();
    expect(seen).toHaveLength(1);
    expect(new URL(seen[0].url).pathname).toMatch(/\/citadel-apps\/host\/app-host\.worker\.ts$/);
    expect(seen[0].options).toEqual({ type: 'module' });
  });
});
