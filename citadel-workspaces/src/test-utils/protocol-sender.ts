/**
 * A ProtocolSender whose sends go to `send`: the injected I/O boundary for tests of the write gate
 * (await-write-response.ts), which sends the request itself.
 */
import type { WorkspaceProtocolRequest } from 'citadel-workspace-client-ts';
import type { ProtocolSender } from '@/lib/workspace-service/workspace-operations';

export function senderOf(send: (request: WorkspaceProtocolRequest, requestId: bigint | null) => Promise<void>): ProtocolSender {
  return { currentCid: 1n, sendProtocolRequest: send };
}

/** A request for tests in which which request is sent does not matter, only its answer. */
export const SOME_REQUEST: WorkspaceProtocolRequest = 'GetServerCapabilities';
