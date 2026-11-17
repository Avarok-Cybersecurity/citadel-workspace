/**
 * The one stand-in every test needs for "which agent is this tab's socket
 * talking to": its greeting, and its answer to the declaration.
 *
 * `'older'` is an agent before 0.8.6, whose greeting has no `agent_ilm` and
 * which is never declared to: the browser-written store and the browser ILM.
 * `true` is a 0.8.6 agent that hosts the account. A test of the browser path
 * says which agent it is talking to, as production code learns it at start.
 */
import type { InternalServiceRequest, InternalServiceResponse } from 'citadel-workspace-client-ts';
import { declareOnLeaderSocket, forgetCapabilities, watchGreeting, type Greeting } from '../capabilities';

export async function greetAs(agent: 'older' | boolean, extra: Record<string, unknown> = {}): Promise<void> {
  forgetCapabilities();
  const greeting: Greeting = watchGreeting();
  greeting.observe({
    ServiceConnectionAccepted: agent === 'older' ? { cid: 0n, request_id: null } : { cid: 0n, request_id: null, agent_ilm: agent, ...extra },
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
      settle(extract({ AgentCapabilities: { request_id: id, agent_ilm: agent === true } } as unknown as InternalServiceResponse));
    },
  }, greeting);
}
