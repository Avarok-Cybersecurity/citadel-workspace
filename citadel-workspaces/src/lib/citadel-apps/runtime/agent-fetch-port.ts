/**
 * `net.host` (R4.1, R4.2): an app's egress from this machine, carried by the local agent's
 * `AppFetch`. The page never fetches for an app (its CSP stays `connect-src 'self'` + the agent);
 * the agent decides each request with the shared SSRF policy and connects only to an address it
 * checked. The grant travels with the request, copied from the install the server approved.
 * Streams (`HostFetchOpen`) are read against credit, one chunk per credit (agent-fetch-stream.ts).
 */
import type { OpArgs, OpReplies } from '../sdk/generated/AbiConstants';
import type { HostNetPort, PortAnswer, Refused } from '../host/ports';
import { agentAsk, answering, bytesOf, type AgentLink, type AgentOutcome, type Json } from './agent-link';
import { FetchStreams } from './agent-fetch-stream';
import { appFetchRequest, fetchRefusal, headersOf, type HostFetchTarget } from './agent-fetch-wire';

type Fetched = { readonly ok: true; readonly reply: OpReplies['HostFetch'] } | { readonly ok: false; readonly refused: Refused };

function readFetched(message: unknown, requestId: string): Fetched | undefined {
  const got: Json | undefined = answering(message, 'AppFetchResponse', requestId);
  if (got !== undefined) {
    const headers: [string, string][] | null = headersOf(got.headers);
    const body: Uint8Array | null = bytesOf(got.body);
    if (typeof got.status !== 'number' || headers === null || body === null) return { ok: false, refused: { unavailable: 'agent_reply' } };
    return { ok: true, reply: { status: got.status, headers, body } };
  }
  const failed: Json | undefined = answering(message, 'AppFetchFailure', requestId);
  return failed === undefined ? undefined : { ok: false, refused: fetchRefusal(failed.refusal) };
}

export function agentFetchPort(link: AgentLink, target: HostFetchTarget): HostNetPort & { readonly closeAll: () => void } {
  const streams: FetchStreams = new FetchStreams(link, target);
  return {
    HostFetch: async ({ request }: OpArgs['HostFetch']): Promise<PortAnswer<OpReplies['HostFetch']>> => {
      const asked: AgentOutcome<Fetched> = await agentAsk(link, appFetchRequest(target, request, false), readFetched, target.timeoutMs);
      if (!asked.ok) return { refused: { unavailable: 'agent' } };
      return asked.value.ok ? { ok: asked.value.reply } : { refused: asked.value.refused };
    },
    HostFetchOpen: ({ request }: OpArgs['HostFetchOpen']) => streams.open(request),
    NetStreamRead: ({ stream, max }: OpArgs['NetStreamRead']) => streams.read(stream, max),
    NetStreamClose: ({ stream }: OpArgs['NetStreamClose']) => streams.close(stream),
    closeAll: (): void => streams.closeAll(),
  };
}
