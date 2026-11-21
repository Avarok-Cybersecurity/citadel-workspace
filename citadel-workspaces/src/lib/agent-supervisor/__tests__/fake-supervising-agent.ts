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
import { declareOnLeaderSocket, forgetCapabilities, watchGreeting, type DeclaringClient, type Greeting } from '@/lib/agent-conversations/capabilities';
import { registerConversationSender } from '@/lib/agent-conversations/sender';
import { eventEmitter } from '@/lib/event-emitter';
import { SUPERVISES_P2P_CAPABILITY } from '@/types/agent-supervisor';

export type AgentKind = 'supervising' | 'older';

export interface InterestSeen {
  sessionCid: bigint;
  peerCid: bigint;
  until: bigint;
}

/** The leader's socket to an agent that answers the declaration, as every agent does. */
export function answeringSocket(): DeclaringClient {
  let extract: (m: InternalServiceResponse) => unknown = () => undefined;
  let settle: (v: unknown) => void = () => undefined;
  return {
    nextResponse: <T,>(e: (m: InternalServiceResponse) => T | undefined): Promise<T> => {
      extract = e;
      return new Promise<T>((resolve) => { settle = resolve as (v: unknown) => void; });
    },
    sendDirectToInternalService: async (request: InternalServiceRequest): Promise<void> => {
      const id: string = (request as { ConnectionManagement: { request_id: string } }).ConnectionManagement.request_id;
      settle(extract({ AgentCapabilities: { request_id: id } } as unknown as InternalServiceResponse));
    },
  };
}

export class FakeAgent {
  readonly sent: Record<string, unknown>[] = [];
  /** When set, the agent never answers: a send that waited for it would hang. */
  silent: boolean = false;

  async greet(kind: AgentKind): Promise<void> {
    forgetCapabilities();
    const greeting: Greeting = watchGreeting();
    greeting.observe({
      ServiceConnectionAccepted: { cid: 0n, request_id: null, ...(kind === 'supervising' ? { [SUPERVISES_P2P_CAPABILITY]: true } : {}) },
    });
    registerConversationSender((request: Record<string, unknown>): Promise<void> => {
      this.sent.push(request);
      return this.silent ? new Promise<void>(() => undefined) : Promise.resolve();
    });
    await declareOnLeaderSocket(answeringSocket(), greeting);
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
