/**
 * The one stand-in the supervisor tests need for "which agent is this tab's
 * socket talking to", and what it is sent.
 *
 * `greet` is the agent's greeting, as the websocket service reads it at
 * start-up: a supervising agent says `supervises_p2p`, an older one says
 * nothing about it. `FakeAgent.wire` puts a notification on the same event the
 * real socket's messages arrive on, and `sent` is every request the window sent
 * to the agent, recorded where the websocket would send it.
 */
import type { InternalServiceRequest, InternalServiceResponse } from 'citadel-workspace-client-ts';
import { declareOnLeaderSocket, forgetCapabilities, watchGreeting, type Greeting } from '@/lib/agent-conversations/capabilities';
import { registerConversationSender } from '@/lib/agent-conversations/sender';
import { eventEmitter } from '@/lib/event-emitter';
import { SUPERVISES_P2P_CAPABILITY } from '@/types/agent-supervisor';

export type AgentKind = 'supervising' | 'older';

export interface InterestSeen {
  sessionCid: bigint;
  peerCid: bigint;
  until: bigint;
}

export class FakeAgent {
  readonly sent: Record<string, unknown>[] = [];
  /** When set, the agent never answers: a send that waited for it would hang. */
  silent: boolean = false;

  async greet(kind: AgentKind): Promise<void> {
    forgetCapabilities();
    const greeting: Greeting = watchGreeting();
    greeting.observe({
      ServiceConnectionAccepted: { cid: 0n, request_id: null, agent_ilm: false, ...(kind === 'supervising' ? { [SUPERVISES_P2P_CAPABILITY]: true } : {}) },
    });
    registerConversationSender((request: Record<string, unknown>): Promise<void> => {
      this.sent.push(request);
      return this.silent ? new Promise<void>(() => undefined) : Promise.resolve();
    });
    // agent_ilm is false, so nothing is declared and nothing is awaited from the socket.
    await declareOnLeaderSocket({
      sendDirectToInternalService: (_request: InternalServiceRequest): Promise<void> => Promise.reject(new Error('nothing is declared to this agent')),
      nextResponse: <T,>(_extract: (m: InternalServiceResponse) => T | undefined): Promise<T> => new Promise<T>(() => undefined),
    }, greeting);
  }

  /** A notification arriving from the agent. */
  wire(message: unknown): void {
    eventEmitter.emit('websocket-message', message);
  }

  /** The Interest requests sent, in order. */
  interests(): InterestSeen[] {
    return this.sent.flatMap((request: Record<string, unknown>): InterestSeen[] => {
      const command: unknown = (request.ConnectionManagement as { management_command?: { Interest?: unknown } } | undefined)?.management_command?.Interest;
      if (command === undefined) return [];
      const wire: { session_cid: bigint; peer_cid: bigint; until: bigint } = command as { session_cid: bigint; peer_cid: bigint; until: bigint };
      return [{ sessionCid: wire.session_cid, peerCid: wire.peer_cid, until: wire.until }];
    });
  }
}
