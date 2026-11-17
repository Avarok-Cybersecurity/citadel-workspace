/**
 * The agent's updater requests. Each is answered with `UpdateStatus`, which is
 * applied to the stores (update-state.ts) before it resolves.
 */
import type { UpdateStatus } from 'citadel-internal-service-wasm-client';
import { requestResponse } from '../websocket/request-response';
import { conversationSender, type RequestSender } from '../agent-conversations/sender';
import { TIMEOUT } from '../timeout-constants';
import { applyUpdaterMessage } from './update-state';

export type UpdaterRequest = 'UpdateGetStatus' | 'UpdateCheckNow' | 'UpdateApply' | 'UpdateSetSettings';

function answered(message: Record<string, unknown>, requestId: string): UpdateStatus | undefined {
  const root: Record<string, unknown> = (message.Response as Record<string, unknown> | undefined) ?? message;
  const status: unknown = root.UpdateStatus;
  if (typeof status !== 'object' || status === null) return undefined;
  return (status as UpdateStatus).request_id === requestId ? (status as UpdateStatus) : undefined;
}

export async function askUpdater(variant: UpdaterRequest, body: Record<string, unknown> = {}): Promise<UpdateStatus> {
  const send: RequestSender | null = conversationSender();
  if (!send) throw new Error(`${variant}: the websocket service is not ready`);
  const requestId: string = crypto.randomUUID();
  const status: UpdateStatus = await requestResponse<UpdateStatus>({
    request: { [variant]: { request_id: requestId, ...body } },
    requestId,
    sendRequest: (request, id) => send(request as Record<string, unknown>, id),
    timeoutMs: variant === 'UpdateCheckNow' ? TIMEOUT.AGENT_UPDATE_CHECK_MS : TIMEOUT.AGENT_UPDATE_REQUEST_MS,
    operationName: variant,
    matcher: {
      matchSuccess: (message) => answered(message, requestId),
      matchFailure: () => undefined,
    },
  });
  applyUpdaterMessage({ UpdateStatus: status });
  return status;
}
