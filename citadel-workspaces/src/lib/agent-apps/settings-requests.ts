/**
 * The member's own grants on this agent to the apps it runs for them: read with
 * `AppsGetAgentSettings`, changed with `AppsSetAgentSettings`, both for the signed-in session
 * `cid`, which only its own windows may ask about.
 */
import type { AppsAgentSettings, AppsAgentSettingsFailure } from 'citadel-internal-service-wasm-client';
import { requestResponse } from '../websocket/request-response';
import { conversationSender, type RequestSender } from '../agent-conversations/sender';
import { TIMEOUT } from '../timeout-constants';

function answer<T extends { request_id: string | null }>(message: Record<string, unknown>, key: string, requestId: string): T | undefined {
  const root: Record<string, unknown> = (message.Response as Record<string, unknown> | undefined) ?? message;
  const body: unknown = root[key];
  if (typeof body !== 'object' || body === null) return undefined;
  return (body as T).request_id === requestId ? (body as T) : undefined;
}

function ask(variant: string, body: Record<string, unknown>): Promise<AppsAgentSettings> {
  const send: RequestSender | null = conversationSender();
  if (!send) return Promise.reject(new Error(`${variant}: the websocket service is not ready`));
  const requestId: string = crypto.randomUUID();
  return requestResponse<AppsAgentSettings>({
    request: { [variant]: { request_id: requestId, ...body } },
    requestId,
    sendRequest: (request, id) => send(request as Record<string, unknown>, id),
    timeoutMs: TIMEOUT.LOCALDB_REQUEST_MS,
    operationName: variant,
    matcher: {
      matchSuccess: (message) => answer<AppsAgentSettings>(message, 'AppsAgentSettings', requestId),
      matchFailure: (message) => answer<AppsAgentSettingsFailure>(message, 'AppsAgentSettingsFailure', requestId)?.message,
    },
  });
}

/** What the agent holds for session `cid`. */
export function readAgentAppSettings(cid: bigint): Promise<AppsAgentSettings> {
  return ask('AppsGetAgentSettings', { cid });
}

/** Turn session `cid`'s private-network grant on or off; resolves with what the agent then holds. */
export function setAppsPrivateNetwork(cid: bigint, on: boolean): Promise<AppsAgentSettings> {
  return ask('AppsSetAgentSettings', { cid, private_network: on });
}
