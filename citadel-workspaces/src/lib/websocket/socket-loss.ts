/**
 * "The socket these waits were sent over is gone", as every tab can hear it.
 *
 * Only the leader owns a socket, so only the leader emits 'websocket-disconnected'.
 * A follower's requests ride the leader's socket and are lost with it, but the
 * follower hears that only as the leader's report (multi-instance/agent-socket-state.ts).
 * A leader hears both; a handler must therefore be safe to run twice.
 */
import { eventEmitter } from '../event-emitter';
import type { AgentSocketState } from '../multi-instance/agent-socket-state';

/** Runs `handler` when the socket is lost; returns the function that stops listening. */
export function onSocketLost(handler: () => void): () => void {
  const offDisconnected: () => void = eventEmitter.on('websocket-disconnected', handler);
  const offReport: () => void = eventEmitter.on<AgentSocketState>('agent-socket-state', ({ up }: AgentSocketState): void => { if (!up) handler(); });
  return (): void => { offDisconnected(); offReport(); };
}
