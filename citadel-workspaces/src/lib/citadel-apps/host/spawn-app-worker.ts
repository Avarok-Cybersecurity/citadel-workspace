/**
 * Starts one app instance's worker: the one place `new Worker` is called for apps. Same-origin
 * module worker (allowed by `worker-src 'self'`; wasm compiles under `'wasm-unsafe-eval'`), so the
 * Content-Security-Policy needs nothing new.
 */
import type { HostChannel } from './worker-protocol';

export function spawnAppWorker(): HostChannel {
  // The options must be a static literal: Vite parses them at build time to bundle the worker.
  return new Worker(new URL('./app-host.worker.ts', import.meta.url), { type: 'module' });
}
