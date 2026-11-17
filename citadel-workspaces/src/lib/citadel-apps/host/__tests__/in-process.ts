/**
 * TEST HELPER: an AppInstance wired to the production worker host over a real node MessageChannel
 * (structured clone and WebAssembly.Module cloning are the platform's), minus only the thread.
 * Guest code that never returns would hang this thread, so watchdog tests use real-worker.ts.
 */
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import type { DispatchClock } from '../dispatch';
import { startWorkerHost } from '../worker-host';
import type { FromWorker, HostChannel, ToWorker } from '../worker-protocol';

export const realClock: DispatchClock = {
  now: (): number => performance.now(),
  after: (ms: number, fire: () => void): (() => void) => {
    const id: ReturnType<typeof setTimeout> = setTimeout(fire, ms);
    return (): void => clearTimeout(id);
  },
};

export interface InProcess {
  readonly spawn: () => HostChannel;
  readonly terminated: () => number;
  readonly close: () => void;
}

export function inProcess(): InProcess {
  const ports: MessagePort[] = [];
  let terminated: number = 0;
  const spawn = (): HostChannel => {
    const { port1, port2 } = new MessageChannel();
    ports.push(port1, port2);
    startWorkerHost(
      { post: (m: FromWorker): void => port2.postMessage(m), listen: (h: (m: unknown) => void): void => { port2.on('message', h); } },
      realClock,
      () => null,
    );
    return {
      postMessage: (message: ToWorker): void => port1.postMessage(message),
      addEventListener: (_type: 'message', listener: (event: MessageEvent<unknown>) => void): void => {
        port1.on('message', (data: unknown): void => listener({ data } as MessageEvent<unknown>));
      },
      terminate: (): void => {
        terminated++;
        port1.close();
        port2.close();
      },
    };
  };
  return { spawn, terminated: () => terminated, close: () => ports.forEach((p: MessagePort) => p.close()) };
}

/** Resolves when `predicate` holds, polling; rejects after `ms`. */
export async function until(predicate: () => boolean, ms: number): Promise<void> {
  const start: number = Date.now();
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error('until: condition not met in time');
    await new Promise<void>((r) => setTimeout(r, 5));
  }
}
