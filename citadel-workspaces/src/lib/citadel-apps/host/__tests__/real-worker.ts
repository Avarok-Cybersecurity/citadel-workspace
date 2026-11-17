/**
 * TEST HELPER: the production worker entry (app-host.worker.ts) bundled by Vite into one ES file
 * and run in a real node worker thread, so a guest that never returns blocks a real thread and the
 * scrub runs against a real global. A prelude stands in for the browser's `self` channel; a
 * postlude reports what is reachable on the global after the entry's top level ran.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { build, type Rollup } from 'vite';
import type { HostChannel, ToWorker } from '../worker-protocol';

const SRC: string = resolve(__dirname, '../../../..');
const ENTRY: string = resolve(__dirname, '../app-host.worker.ts');

export const PROBED: readonly string[] = ['fetch', 'XMLHttpRequest', 'WebSocket', 'BroadcastChannel', 'importScripts', 'indexedDB', 'caches', 'EventSource', 'postMessage', 'Request'];

const PRELUDE: string = `
import { parentPort } from 'node:worker_threads';
const before = Object.fromEntries(${JSON.stringify(PROBED)}.map((n) => [n, typeof globalThis[n]]));
globalThis.self = globalThis;
globalThis.postMessage = (m) => parentPort.postMessage(m);
globalThis.addEventListener = (_t, l) => parentPort.on('message', (data) => l({ data }));
globalThis.__probeBefore = before;
`;

const POSTLUDE: string = `
parentPort.postMessage({ probe: { before: globalThis.__probeBefore, after: Object.fromEntries(${JSON.stringify(PROBED)}.map((n) => [n, typeof globalThis[n]])) } });
`;

export interface BundledEntry {
  readonly file: string;
  readonly dispose: () => void;
}

export async function bundleWorkerEntry(): Promise<BundledEntry> {
  const out: Rollup.RollupOutput[] | Rollup.RollupOutput = (await build({
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: { '@': SRC } },
    build: { write: false, minify: false, target: 'node20', lib: { entry: ENTRY, formats: ['es'], fileName: 'app-host' } },
  })) as Rollup.RollupOutput[] | Rollup.RollupOutput;
  const outputs: Rollup.RollupOutput[] = Array.isArray(out) ? out : [out];
  const chunk: Rollup.OutputChunk | undefined = outputs[0].output.find((o): o is Rollup.OutputChunk => o.type === 'chunk');
  if (chunk === undefined) throw new Error('vite produced no chunk');
  if (/^\s*import\s/m.test(chunk.code)) throw new Error('the bundle still imports modules; the prelude would not run first');
  const dir: string = mkdtempSync(join(tmpdir(), 'app-host-'));
  const file: string = join(dir, 'app-host.mjs');
  writeFileSync(file, `${PRELUDE}\n${chunk.code}\n${POSTLUDE}`);
  return { file, dispose: (): void => rmSync(dir, { recursive: true, force: true }) };
}

export interface ThreadChannel extends HostChannel {
  readonly exited: Promise<number>;
  readonly probe: Promise<{ before: Record<string, string>; after: Record<string, string> }>;
}

/** A HostChannel over a node worker thread running the bundled entry. */
export function threadChannel(entry: BundledEntry): ThreadChannel {
  const worker: Worker = new Worker(entry.file);
  let probed: (p: { before: Record<string, string>; after: Record<string, string> }) => void = () => {};
  const probe: ThreadChannel['probe'] = new Promise<{ before: Record<string, string>; after: Record<string, string> }>((r) => { probed = r; });
  worker.on('message', (data: unknown): void => {
    if (typeof data === 'object' && data !== null && 'probe' in data) probed((data as { probe: { before: Record<string, string>; after: Record<string, string> } }).probe);
  });
  const exited: Promise<number> = new Promise<number>((r) => worker.once('exit', r));
  return {
    exited,
    probe,
    postMessage: (message: ToWorker, transfer: Transferable[]): void => worker.postMessage(message, transfer as never[]),
    addEventListener: (_type: 'message', listener: (event: MessageEvent<unknown>) => void): void => {
      worker.on('message', (data: unknown): void => listener({ data } as MessageEvent<unknown>));
    },
    terminate: (): void => {
      void worker.terminate();
    },
  };
}
