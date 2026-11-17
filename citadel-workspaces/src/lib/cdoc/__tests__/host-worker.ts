/**
 * The product's WorkerCdocClient over a stand-in for the Worker: requests are posted to the real
 * CdocHost (engine, wasm) and its replies dispatched back as message events, a macrotask later as
 * a thread hop would deliver them. Only the thread and the canvas transfer are stood in for, so
 * the client's own lifecycle (dispose terminating the worker, pending requests rejecting) is the
 * production one. `answer` replaces the host's reply for a request kind, to make one fail.
 */
import type { CdocHost, HostReply } from '../worker/cdoc-host';
import { WorkerCdocClient, type WorkerLike } from '../worker/clients';
import { isCdocRequest, type CdocResponse } from '../worker/protocol';

export interface HostWorker {
  readonly client: WorkerCdocClient;
  /** Whether dispose terminated the stand-in worker. */
  readonly terminated: () => boolean;
}

type Listener = (event: MessageEvent<unknown>) => void;

export function hostWorker(host: CdocHost, answer: (kind: string, id: number) => CdocResponse | null): HostWorker {
  const listeners: Set<Listener> = new Set<Listener>();
  let terminated: boolean = false;
  const deliver = (response: CdocResponse): void => {
    setTimeout((): void => {
      if (terminated) return;
      for (const listener of listeners) listener(new MessageEvent<unknown>('message', { data: response }));
    }, 0);
  };
  const worker: WorkerLike = {
    postMessage(message: unknown): void {
      if (terminated) throw new Error('posted to a terminated worker');
      if (!isCdocRequest(message)) throw new Error('posted a message that is not a protocol request');
      const replaced: CdocResponse | null = answer(message.kind, message.id);
      if (replaced !== null) return deliver(replaced);
      void host.handle(message).then((reply: HostReply): void => deliver(reply.response));
    },
    addEventListener(_type: 'message', listener: Listener): void {
      listeners.add(listener);
    },
    removeEventListener(_type: 'message', listener: Listener): void {
      listeners.delete(listener);
    },
  };
  const client: WorkerCdocClient = new WorkerCdocClient(worker, (): void => {
    terminated = true;
  });
  return { client, terminated: (): boolean => terminated };
}
