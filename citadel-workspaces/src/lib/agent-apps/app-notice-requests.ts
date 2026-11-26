/**
 * Apps' notices handed to the agent (agent kernel/reminders): one to show now
 * (`AppNoticePost`), or a session's reminders for an app, synced whole
 * (`AppRemindersSync`), which the agent fires with no window open. Only the session's own
 * windows may send either. A refusal rejects with `AgentNoticeRefused`, which names why.
 */
import type { AppNotice, AppNoticeAccepted, AppNoticeFailure, AppNoticeRefusal } from 'citadel-internal-service-wasm-client';
import { requestResponse } from '../websocket/request-response';
import { conversationSender, type RequestSender } from '../agent-conversations/sender';
import { TIMEOUT } from '../timeout-constants';

export class AgentNoticeRefused extends Error {
  constructor(readonly reason: AppNoticeRefusal) {
    super(`The Citadel agent refused the notice: ${describeRefusal(reason)}`);
    this.name = 'AgentNoticeRefused';
  }
}

export function describeRefusal(reason: AppNoticeRefusal): string {
  if (typeof reason === 'string') return reason;
  if ('CapExceeded' in reason) return `more than ${reason.CapExceeded.cap} reminders`;
  return `its store failed (${reason.Store})`;
}

function answer<T extends { request_id: string | null }>(message: Record<string, unknown>, key: string, requestId: string): T | undefined {
  const root: Record<string, unknown> = (message.Response as Record<string, unknown> | undefined) ?? message;
  const body: unknown = root[key];
  if (typeof body !== 'object' || body === null) return undefined;
  return (body as T).request_id === requestId ? (body as T) : undefined;
}

async function ask(variant: string, body: Record<string, unknown>): Promise<void> {
  const send: RequestSender | null = conversationSender();
  if (!send) throw new Error(`${variant}: the websocket service is not ready`);
  const requestId: string = crypto.randomUUID();
  let refused: AppNoticeRefusal | null = null;
  try {
    await requestResponse<AppNoticeAccepted>({
      request: { [variant]: { request_id: requestId, ...body } },
      requestId,
      sendRequest: (request, id) => send(request as Record<string, unknown>, id),
      timeoutMs: TIMEOUT.LOCALDB_REQUEST_MS,
      operationName: variant,
      matcher: {
        matchSuccess: (message) => answer<AppNoticeAccepted>(message, 'AppNoticeAccepted', requestId),
        matchFailure: (message): string | undefined => {
          const failure: AppNoticeFailure | undefined = answer<AppNoticeFailure>(message, 'AppNoticeFailure', requestId);
          if (failure === undefined) return undefined;
          refused = failure.reason;
          return describeRefusal(failure.reason);
        },
      },
    });
  } catch (error: unknown) {
    if (refused !== null) throw new AgentNoticeRefused(refused);
    throw error;
  }
}

/** Show `notice` (no `fire_at_ms`) through the agent now, for session `cid`. */
export function postAppNotice(cid: bigint, notice: AppNotice): Promise<void> {
  return ask('AppNoticePost', { cid, notice });
}

/** Replace session `cid`'s reminders for `appId` with `reminders`, each with its `fire_at_ms`. */
export function syncAppReminders(cid: bigint, appId: string, reminders: readonly AppNotice[]): Promise<void> {
  return ask('AppRemindersSync', { cid, app_id: appId, reminders });
}
