/**
 * What the page holds to talk to cdoc-wasm. WorkerCdocClient runs it in a Web Worker (the
 * product); InProcessCdocClient runs the same host, the same engine and the same wasm on the
 * calling thread (tests under node/jsdom, where there is no Worker).
 */
import type { CdocKind, CdocResults, RequestOf } from './protocol';

export interface CdocClient {
  request<K extends CdocKind>(body: RequestOf<K>): Promise<CdocResults[K]>;
  /** Ends the worker; every pending request rejects, and so does every later one. */
  dispose(): void;
  /** Whether dispose has run: the worker, and every canvas it held, is gone. */
  readonly disposed: boolean;
}

export class CdocRequestError extends Error {
  constructor(kind: string, message: string) {
    super(`cdoc ${kind}: ${message}`);
    this.name = 'CdocRequestError';
  }
}
