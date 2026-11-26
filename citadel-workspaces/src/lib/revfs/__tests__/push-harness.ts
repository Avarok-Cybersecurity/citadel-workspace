/**
 * Drives one RE-VFS push through the real transport (backendSendFile) with the agent's frames
 * emitted by hand, addressed to the request id the push chose.
 */
import { eventEmitter } from '@/lib/event-emitter';
import { backendSendFile } from '../revfs-io-network';
import type { RevfsIntentResult } from '@/types/revfs-intents';

const CONTENT: Uint8Array<ArrayBuffer> = new Uint8Array([1, 2, 3]);

export interface StartedPush {
  readonly pending: Promise<RevfsIntentResult>;
  readonly requestId: () => string;
}

/** Start a push of notes.txt from `cid`, capturing the request id it was sent under. */
export function startUpload(cid: bigint, peerCid: bigint | null, pushId: string): StartedPush {
  let requestId: string = '';
  const deps: { sendInternalServiceRequest: (request: unknown) => Promise<void>; } = {
    sendInternalServiceRequest: async (request: unknown): Promise<void> => {
      const payload: Record<string, string> = (request as Record<string, Record<string, string>>).SendFile;
      requestId = payload.request_id;
    },
  };
  const pending: Promise<RevfsIntentResult> = backendSendFile(deps, cid, peerCid, 'notes.txt', CONTENT, '/docs/notes.txt', pushId);
  return { pending, requestId: (): string => requestId };
}

export const emit = (message: Record<string, unknown>): void =>
  eventEmitter.emit('websocket-message', message);

export const dispatchAck = (requestId: string): void =>
  emit({ SendFileRequestSuccess: { request_id: requestId } });

export const tick = (requestId: string, status: unknown): void =>
  emit({ FileTransferTickNotification: { request_id: requestId, status } });

/** Has `pending` settled yet? Checked without awaiting any timeout. */
export async function settled(pending: Promise<unknown>): Promise<boolean> {
  let done: boolean = false;
  void pending.then(() => {
    done = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  return done;
}
