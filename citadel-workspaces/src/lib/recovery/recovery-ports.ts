/**
 * The recovery flows' one port to the agent: send a request, hear what comes back. The browser
 * adapter (browserAgentPort) is the websocket service and the app's message bus; tests pass a fake
 * agent that answers as the Rust one does.
 */
import * as wsModule from '@/lib/websocket-service';
import { eventEmitter } from '@/lib/event-emitter';

export interface AgentPort {
  send: (request: Record<string, unknown>) => Promise<void>;
  /** Calls `handler` with every message from the agent until the returned function is called. */
  listen: (handler: (message: unknown) => void) => () => void;
}

export function browserAgentPort(): AgentPort {
  return {
    // Namespace import, as lib/sign-in does, to stay out of the websocket-service import cycle.
    send: (request: Record<string, unknown>): Promise<void> => wsModule.websocketService.sendRequest(request),
    listen: (handler: (message: unknown) => void): (() => void) => eventEmitter.on('websocket-message', handler),
  };
}
