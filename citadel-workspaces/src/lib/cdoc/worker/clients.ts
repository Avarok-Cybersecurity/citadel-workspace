/**
 * The two CdocClients. WorkerCdocClient posts each request with its buffers in the transfer
 * list and matches replies by id. InProcessCdocClient calls a CdocHost directly: it is the test
 * double that still runs the production host, engine and wasm, minus only the thread hop, and
 * that refuses every request once disposed exactly as the worker client does.
 */
import { CdocRequestError, type CdocClient } from './cdoc-client';
import type { CdocHost, HostReply } from './cdoc-host';
import { isCdocResponse, transferablesOf, type CdocKind, type CdocResponse, type CdocResults, type RequestOf } from './protocol';

/** The slice of Worker (or MessagePort) the client uses. */
export interface WorkerLike {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
}

const DISPOSED: string = 'the client was disposed';

interface Pending {
  readonly kind: string;
  readonly resolve: (result: CdocResults[CdocKind]) => void;
  readonly reject: (error: Error) => void;
}

export class WorkerCdocClient implements CdocClient {
  private next: number = 0;
  private readonly pending: Map<number, Pending> = new Map<number, Pending>();
  private ended: boolean = false;
  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    const response: unknown = event.data;
    if (!isCdocResponse(response)) return;
    const waiting: Pending | undefined = this.pending.get(response.id);
    if (waiting === undefined) return;
    this.pending.delete(response.id);
    if (response.ok) waiting.resolve(response.result);
    else waiting.reject(new CdocRequestError(waiting.kind, response.error));
  };

  constructor(private readonly worker: WorkerLike, private readonly terminate: () => void) {
    worker.addEventListener('message', this.onMessage);
  }

  request<K extends CdocKind>(body: RequestOf<K>): Promise<CdocResults[K]> {
    if (this.ended) return Promise.reject(new CdocRequestError(body.kind, DISPOSED));
    const id: number = ++this.next;
    return new Promise<CdocResults[K]>((resolve: (r: CdocResults[K]) => void, reject: (e: Error) => void): void => {
      this.pending.set(id, { kind: body.kind, resolve: resolve as (r: CdocResults[CdocKind]) => void, reject });
      this.worker.postMessage({ ...body, id }, transferablesOf(body));
    });
  }

  get disposed(): boolean {
    return this.ended;
  }

  dispose(): void {
    this.ended = true;
    this.worker.removeEventListener('message', this.onMessage);
    this.terminate();
    for (const [, waiting] of this.pending) waiting.reject(new CdocRequestError(waiting.kind, DISPOSED));
    this.pending.clear();
  }
}

export class InProcessCdocClient implements CdocClient {
  private next: number = 0;
  private ended: boolean = false;

  constructor(private readonly host: CdocHost) {}

  get disposed(): boolean {
    return this.ended;
  }

  async request<K extends CdocKind>(body: RequestOf<K>): Promise<CdocResults[K]> {
    if (this.ended) throw new CdocRequestError(body.kind, DISPOSED);
    const reply: HostReply = await this.host.handle({ ...body, id: ++this.next });
    const response: CdocResponse = reply.response;
    if (!response.ok) throw new CdocRequestError(body.kind, response.error);
    return response.result as CdocResults[K];
  }

  dispose(): void {
    this.ended = true;
  }
}
