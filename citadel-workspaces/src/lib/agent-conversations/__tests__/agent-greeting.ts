/**
 * The one stand-in every test needs for "which agent is this tab's socket
 * talking to": its greeting, and its answer to the declaration. Every agent
 * hosts the account's ILM and conversations; `extra` overrides what else the
 * greeting says (a native picker, a version), as production code learns it at
 * start.
 */
import type { InternalServiceRequest, InternalServiceResponse } from 'citadel-workspace-client-ts';
import { declareOnLeaderSocket, forgetCapabilities, watchGreeting, type Greeting } from '../capabilities';

export async function greetAs(extra: Record<string, unknown> = {}): Promise<void> {
  forgetCapabilities();
  const greeting: Greeting = watchGreeting();
  greeting.observe({
    ServiceConnectionAccepted: { cid: 0n, request_id: null, ...extra },
  });
  let extract: (m: InternalServiceResponse) => unknown = () => undefined;
  let settle: (v: unknown) => void = () => undefined;
  await declareOnLeaderSocket({
    nextResponse: <T,>(e: (m: InternalServiceResponse) => T | undefined): Promise<T> => {
      extract = e;
      return new Promise<T>((resolve) => { settle = resolve as (v: unknown) => void; });
    },
    sendDirectToInternalService: async (request: InternalServiceRequest): Promise<void> => {
      const id: string = (request as { ConnectionManagement: { request_id: string } }).ConnectionManagement.request_id;
      settle(extract({ AgentCapabilities: { request_id: id } } as unknown as InternalServiceResponse));
    },
  }, greeting);
}
