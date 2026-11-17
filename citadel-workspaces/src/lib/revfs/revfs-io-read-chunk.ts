/**
 * Reading a pulled file's bytes back from the agent: InternalServiceRequest::ReadPulledFileChunk,
 * answered by ReadPulledFileChunkSuccess or ReadPulledFileChunkFailure with the same request_id.
 *
 * The request and the answer are pure (readChunkRequest, readChunkAnswer); only
 * backendReadPulledChunk sends and listens. The agent keeps a pull's record for 30 minutes and
 * answers at most MAX_READ_CHUNK_BYTES per chunk; offset 0 (re)starts a read and every later
 * offset must follow the previous chunk.
 */
import type {
  InternalServiceRequest,
  ReadPulledFileChunkFailure,
  ReadPulledFileChunkSuccess,
} from 'citadel-internal-service-wasm-client';
import type { ReadChunkAnswer, RevfsIntentResult } from '@/types/revfs-intents';
import { eventEmitter } from '../event-emitter';
import { debugLog } from '@/lib/debug-config';
import { BACKEND_TIMEOUT_MS, type NetworkIODeps } from './revfs-io-network';

export interface ReadChunkAsk {
  readonly cid: bigint;
  readonly peerCid: bigint | null;
  readonly virtualDir: string;
  readonly offset: bigint;
  readonly maxLen: number;
}

export function readChunkRequest(requestId: string, ask: ReadChunkAsk): InternalServiceRequest {
  return {
    ReadPulledFileChunk: {
      request_id: requestId,
      cid: ask.cid,
      peer_cid: ask.peerCid,
      virtual_directory: ask.virtualDir,
      offset: ask.offset,
      max_len: ask.maxLen,
    },
  };
}

const isRecord: (value: unknown) => value is Record<string, unknown> = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function bytesOf(data: unknown): Uint8Array | null {
  if (!Array.isArray(data)) return null;
  const out: Uint8Array = new Uint8Array(data.length);
  for (let i: number = 0; i < data.length; i++) {
    const byte: unknown = data[i];
    if (typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255) return null;
    out[i] = byte;
  }
  return out;
}

/**
 * This request's answer in an agent message, or null when the message is not one. A Success
 * whose fields are not the declared types is a failure, never a chunk.
 */
export function readChunkAnswer(message: unknown, requestId: string): ReadChunkAnswer | null {
  if (!isRecord(message)) return null;
  const success: unknown = message.ReadPulledFileChunkSuccess;
  if (isRecord(success) && success.request_id === requestId) {
    const answer: Partial<ReadPulledFileChunkSuccess> = success;
    const data: Uint8Array | null = bytesOf(answer.data);
    if (typeof answer.total_size !== 'bigint' || typeof answer.offset !== 'bigint' || data === null) {
      return { kind: 'failed', message: 'the agent answered with a malformed chunk' };
    }
    return { kind: 'chunk', chunk: { totalSize: answer.total_size, offset: answer.offset, data } };
  }
  const failure: unknown = message.ReadPulledFileChunkFailure;
  if (isRecord(failure) && failure.request_id === requestId) {
    const answer: Partial<ReadPulledFileChunkFailure> = failure;
    return { kind: 'failed', message: typeof answer.message === 'string' ? answer.message : 'the agent refused the read' };
  }
  return null;
}

export function backendReadPulledChunk(deps: NetworkIODeps, ask: ReadChunkAsk): Promise<RevfsIntentResult> {
  const requestId: string = crypto.randomUUID();
  debugLog('RevfsIO', `backendReadPulledChunk: virtualDir=${ask.virtualDir} offset=${ask.offset} requestId=${requestId}`);
  return new Promise((resolve) => {
    const settle = (answer: ReadChunkAnswer): void => {
      clearTimeout(timeout);
      eventEmitter.off('websocket-message', handleMessage);
      resolve({ type: 'backend-read-pulled-chunk', answer });
    };
    const timeout: ReturnType<typeof setTimeout> = setTimeout((): void => settle({
      kind: 'failed',
      message: `the agent did not answer within ${BACKEND_TIMEOUT_MS / 1000} s (an agent older than this page cannot read files to it)`,
    }), BACKEND_TIMEOUT_MS);
    const handleMessage = (message: unknown): void => {
      const answer: ReadChunkAnswer | null = readChunkAnswer(message, requestId);
      if (answer !== null) settle(answer);
    };
    eventEmitter.on('websocket-message', handleMessage);
    deps.sendInternalServiceRequest(readChunkRequest(requestId, ask)).catch((error: unknown): void => {
      settle({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
    });
  });
}
