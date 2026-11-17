/**
 * The real `StagePort`: one `StageUploadChunk` request per chunk over the agent
 * socket, answered by `StageUploadChunkSuccess` / `StageUploadChunkFailure` with
 * the same request_id. Each chunk is bounded by the same budget as a SendFile ack.
 */
import { requestResponse } from '../../websocket/request-response';
import { TIMEOUT } from '../../timeout-constants';
import type { StageChunk, StagePort } from './stage-file';

export type SendToAgent = (request: Record<string, unknown>) => Promise<void>;

function answer(message: Record<string, unknown>, variant: string, requestId: string): Record<string, unknown> | undefined {
  const inner: unknown = message[variant];
  if (typeof inner !== 'object' || inner === null) return undefined;
  return (inner as Record<string, unknown>).request_id === requestId ? (inner as Record<string, unknown>) : undefined;
}

export function agentStagePort(cid: bigint, send: SendToAgent): StagePort {
  return {
    newUploadId: (): string => crypto.randomUUID(),
    sendChunk: (chunk: StageChunk): Promise<number> => {
      const requestId: string = crypto.randomUUID();
      return requestResponse<number>({
        request: {
          StageUploadChunk: {
            request_id: requestId,
            cid,
            upload_id: chunk.uploadId,
            file_name: chunk.fileName,
            total_size: BigInt(chunk.totalSize),
            offset: BigInt(chunk.offset),
            // Vec<u8> on the wire: a number array, as ByteContents.data.
            data: Array.from(chunk.data),
          },
        },
        requestId,
        sendRequest: (request: unknown): Promise<void> => send(request as Record<string, unknown>),
        timeoutMs: TIMEOUT.FILE_SEND_MS,
        operationName: 'StageUploadChunk',
        matcher: {
          matchSuccess: (m: Record<string, unknown>): number | undefined => {
            const ok: Record<string, unknown> | undefined = answer(m, 'StageUploadChunkSuccess', requestId);
            return ok ? Number(ok.received) : undefined;
          },
          matchFailure: (m: Record<string, unknown>): string | undefined => {
            const no: Record<string, unknown> | undefined = answer(m, 'StageUploadChunkFailure', requestId);
            return no ? String(no.message ?? 'The agent refused the chunk') : undefined;
          },
        },
      });
    },
  };
}
