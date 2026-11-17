/**
 * LocalDB Operations
 *
 * Handles LocalDB key-value storage operations via the internal service.
 */

import { requestResponse } from './request-response';
import { wireMapEntries } from '@/lib/wire-map';
import { TIMEOUT } from '../timeout-constants';

export interface LocalDBConfig {
  init: () => Promise<void>;
  sendRequest: (request: unknown, requestId?: string) => Promise<void>;
}

export class LocalDBOperations {
  private readonly config: LocalDBConfig;

  constructor(config: LocalDBConfig) {
    this.config = config;
  }

  async get(cid: bigint, key: string): Promise<{ value: number[] } | null> {
    await this.config.init();

    const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
    const request: { LocalDBGetKV: { request_id: `${string}-${string}-${string}-${string}-${string}`; cid: bigint; peer_cid: null; key: string; }; } = {
      LocalDBGetKV: { request_id: requestId, cid, peer_cid: null, key }
    };

    return requestResponse<{ value: number[] }>({
      request, requestId, timeoutMs: TIMEOUT.LOCALDB_REQUEST_MS,
      sendRequest: this.config.sendRequest,
      operationName: 'LocalDBGetKV',
      matcher: {
        matchSuccess: (msg) => {
          const r: { LocalDBGetKVSuccess?: { request_id: string; value: number[]; }; } = msg as { LocalDBGetKVSuccess?: { request_id: string; value: number[] } };
          return r.LocalDBGetKVSuccess?.request_id === requestId
            ? { value: r.LocalDBGetKVSuccess.value }
            : undefined;
        },
        matchFailure: (msg) => {
          const r: { LocalDBGetKVFailure?: { request_id: string; message?: string; }; } = msg as { LocalDBGetKVFailure?: { request_id: string; message?: string } };
          return r.LocalDBGetKVFailure?.request_id === requestId
            ? (r.LocalDBGetKVFailure.message || 'LocalDB get failed')
            : undefined;
        },
      },
    });
  }

  async set(cid: bigint, key: string, value: number[]): Promise<void> {
    await this.config.init();

    const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
    const request: { LocalDBSetKV: { request_id: `${string}-${string}-${string}-${string}-${string}`; cid: bigint; peer_cid: null; key: string; value: number[]; }; } = {
      LocalDBSetKV: { request_id: requestId, cid, peer_cid: null, key, value }
    };

    await requestResponse<true>({
      request, requestId, timeoutMs: TIMEOUT.LOCALDB_REQUEST_MS,
      sendRequest: this.config.sendRequest,
      operationName: 'LocalDBSetKV',
      matcher: {
        matchSuccess: (msg) => {
          const r: { LocalDBSetKVSuccess?: { request_id: string; }; } = msg as { LocalDBSetKVSuccess?: { request_id: string } };
          return r.LocalDBSetKVSuccess?.request_id === requestId ? true : undefined;
        },
        matchFailure: (msg) => {
          const r: { LocalDBSetKVFailure?: { request_id: string; message?: string; }; } = msg as { LocalDBSetKVFailure?: { request_id: string; message?: string } };
          return r.LocalDBSetKVFailure?.request_id === requestId
            ? (r.LocalDBSetKVFailure.message || 'LocalDB set failed')
            : undefined;
        },
      },
    });
  }

  async delete(cid: bigint, key: string): Promise<void> {
    await this.config.init();

    const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
    const request: { LocalDBDeleteKV: { request_id: `${string}-${string}-${string}-${string}-${string}`; cid: bigint; peer_cid: null; key: string; }; } = {
      LocalDBDeleteKV: { request_id: requestId, cid, peer_cid: null, key }
    };

    await requestResponse<true>({
      request, requestId, timeoutMs: TIMEOUT.LOCALDB_REQUEST_MS,
      sendRequest: this.config.sendRequest,
      operationName: 'LocalDBDeleteKV',
      matcher: {
        matchSuccess: (msg) => {
          const r: { LocalDBDeleteKVSuccess?: { request_id: string; }; } = msg as { LocalDBDeleteKVSuccess?: { request_id: string } };
          return r.LocalDBDeleteKVSuccess?.request_id === requestId ? true : undefined;
        },
        matchFailure: (msg) => {
          const r: { LocalDBDeleteKVFailure?: { request_id: string; message?: string; }; } = msg as { LocalDBDeleteKVFailure?: { request_id: string; message?: string } };
          return r.LocalDBDeleteKVFailure?.request_id === requestId
            ? (r.LocalDBDeleteKVFailure.message || 'LocalDB delete failed')
            : undefined;
        },
      },
    });
  }

  async listKeys(cid: bigint, prefix?: string): Promise<string[]> {
    await this.config.init();

    const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
    const request: { LocalDBGetAllKV: { request_id: `${string}-${string}-${string}-${string}-${string}`; cid: bigint; peer_cid: null; }; } = {
      LocalDBGetAllKV: { request_id: requestId, cid, peer_cid: null }
    };

    return requestResponse<string[]>({
      request, requestId, timeoutMs: TIMEOUT.LOCALDB_REQUEST_MS,
      sendRequest: this.config.sendRequest,
      operationName: 'LocalDBGetAllKV',
      matcher: {
        matchSuccess: (msg) => {
          const r: { LocalDBGetAllKVSuccess?: { request_id: string; map?: Record<string, unknown>; }; } = msg as { LocalDBGetAllKVSuccess?: { request_id: string; map?: Record<string, unknown> } };
          if (r.LocalDBGetAllKVSuccess?.request_id !== requestId) return undefined;
          // A Rust HashMap arrives as a JS Map, and Object.keys() on a Map is
          // []. So this returned NO keys — and message-pagination-store reads
          // its persisted page index through here, meaning a reload found no
          // stored history and silently started from empty.
          let keys: string[] = wireMapEntries<unknown>(r.LocalDBGetAllKVSuccess.map, 'LocalDBGetAllKV.map')
            .map(([key]) => key);
          if (prefix) {
            keys = keys.filter(k => k.startsWith(prefix));
          }
          return keys;
        },
        matchFailure: (msg) => {
          const r: { LocalDBGetAllKVFailure?: { request_id: string; message?: string; }; } = msg as { LocalDBGetAllKVFailure?: { request_id: string; message?: string } };
          return r.LocalDBGetAllKVFailure?.request_id === requestId
            ? (r.LocalDBGetAllKVFailure.message || 'LocalDB get all failed')
            : undefined;
        },
      },
    });
  }
}
