/**
 * TEST HELPER: a HostChannel with no worker behind it. The test plays the worker: it reads what
 * the handle posted (`sent`) and answers with `reply`, in exactly the order it chooses.
 */
import type { FromWorker, HostChannel, ToWorker } from '../worker-protocol';

export interface Scripted {
  readonly channel: HostChannel;
  readonly sent: ToWorker[];
  readonly reply: (m: FromWorker) => void;
  terminated: number;
}

export function scripted(): Scripted {
  let listener: (e: MessageEvent<unknown>) => void = () => {};
  const s: Scripted = {
    sent: [],
    terminated: 0,
    reply: (m: FromWorker): void => listener({ data: m } as MessageEvent<unknown>),
    channel: {
      postMessage: (m: ToWorker): void => { s.sent.push(m); },
      addEventListener: (_t: 'message', l: (e: MessageEvent<unknown>) => void): void => { listener = l; },
      terminate: (): void => { s.terminated++; },
    },
  };
  return s;
}

export const seqOf = (m: ToWorker | undefined): number => (m !== undefined && 'seq' in m ? m.seq : -1);
