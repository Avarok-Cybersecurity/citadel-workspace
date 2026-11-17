/**
 * The I/O half of the relay lookup: `GetIceServers` sent on one session, and
 * that session's answer picked out of the inbound stream.
 *
 * The workspace protocol carries no request id (see
 * workspace-service/await-write-response), so the answer is matched by what it
 * can be matched on: the envelope's session `cid`, and a response that parses
 * as an answer to this request. An `Error` for the same session in the same
 * window is taken as the refusal; the cost of that confusion is one minute
 * without a relay, never a wrong credential.
 */
import { eventEmitter } from '@/lib/event-emitter';
import { extractWorkspaceResponse } from '@/lib/workspace-response-handler/message-extraction';
import { getVariant, narrowWebSocketMessage } from '@/lib/ws-message-boundary';
import type { WebSocketMessage } from '@/types/ws-message-types';
import type { WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';
import type { IceServersPort } from './cache';
import { parseIceServersAnswer } from './parse';
import { LEADER_WIRE_EVENT } from '@/lib/websocket/leader-inbound-handler';

export interface WorkspaceIcePortDeps {
  /** `websocketService.sendWorkspaceRequest`, or its leader/follower equivalent. */
  send: (cid: bigint, request: 'GetIceServers') => Promise<void>;
  timeoutMs: number;
}

function envelopeCid(raw: unknown): bigint | null {
  const message: WebSocketMessage | null = narrowWebSocketMessage(raw);
  if (!message) return null;
  const cid: unknown = getVariant(message, 'MessageNotification')?.cid;
  return typeof cid === 'bigint' ? cid : null;
}

export function workspaceIceServersPort(deps: WorkspaceIcePortDeps): IceServersPort {
  return {
    request(cid: bigint): Promise<unknown> {
      return new Promise<unknown>((resolve, reject): void => {
        const cleanup = (): void => {
          clearTimeout(timer);
          eventEmitter.off('websocket-message', onMessage);
          eventEmitter.off(LEADER_WIRE_EVENT, onMessage);
          eventEmitter.off('websocket-disconnected', onDisconnected);
        };
        const onMessage = (raw: unknown): void => {
          if (envelopeCid(raw) !== cid) return;
          const response: WorkspaceProtocolResponse | null = extractWorkspaceResponse(raw);
          if (parseIceServersAnswer(response) === null) return;
          cleanup();
          resolve(response);
        };
        const onDisconnected = (): void => {
          cleanup();
          reject(new Error('GetIceServers: the connection to the Citadel agent was lost'));
        };
        const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
          cleanup();
          reject(new Error(`GetIceServers: no answer within ${deps.timeoutMs}ms`));
        }, deps.timeoutMs);

        // Subscribed before sending: a warm local socket can answer in the same tick.
        // Both: the answer reaches this tab's bus when the session is this tab's, and only
        // the leader's wire when the leader asked for a follower's session.
        eventEmitter.on('websocket-message', onMessage);
        eventEmitter.on(LEADER_WIRE_EVENT, onMessage);
        eventEmitter.on('websocket-disconnected', onDisconnected);
        deps.send(cid, 'GetIceServers').catch((error: unknown): void => {
          cleanup();
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });
    },
  };
}
