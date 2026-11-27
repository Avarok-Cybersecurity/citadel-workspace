/**
 * The agent port over this window's agent socket (the one the rest of the app uses, leader tab or
 * not). Requests are the generated `InternalServiceRequest` bodies; answers are matched by
 * `request_id` on `IdentitySuccess` / `IdentityFailure`, the frames captured from a real agent:
 *   {"Response":{"IdentitySuccess":{"cid":0,"request_id":"…","outcome":{"Status":{"state":"None"}}}}}
 *   {"Response":{"IdentityFailure":{"cid":0,"request_id":"…","reason":"no_identity","message":"…"}}}
 */
import type { IdentityFailure, IdentitySuccess } from 'citadel-internal-service-wasm-client';
import type { InternalServiceRequest, RequestType } from 'citadel-workspace-client-ts';
import { eventEmitter } from '@/lib/event-emitter';
import { requestResponse } from '@/lib/websocket/request-response';
import { conversationSender, type RequestSender } from '@/lib/agent-conversations/sender';
import { stringToBytes } from '@/lib/utils/encoding-utils';
import type { AgentAnswer, AgentPort, SignChallenge } from './ports';

/**
 * Create, export and sign each re-prove the unlock password with Argon2id, which the agent tunes to
 * cost seconds; a minute covers a slow machine without leaving a dead socket unreported for long
 * (a lost socket rejects at once, request-response.ts).
 */
export const IDENTITY_REQUEST_MS: number = 60_000;

type IdentityVariant = Extract<RequestType, 'IdentityStatus' | 'IdentityCreate' | 'IdentityExport' | 'IdentitySignChallenge'>;
/** The generated requests this port sends, one variant each. */
type IdentityRequest = Extract<InternalServiceRequest, { [K in IdentityVariant]: Record<K, unknown> }[IdentityVariant]>;

/** The answer to `requestId` in one frame, unwrapped from `Response` when it is wrapped. */
export function identityAnswer(message: Record<string, unknown>, requestId: string): AgentAnswer | undefined {
  const root: Record<string, unknown> = (message.Response as Record<string, unknown> | undefined) ?? message;
  const success: IdentitySuccess | undefined = root.IdentitySuccess as IdentitySuccess | undefined;
  if (success?.request_id === requestId) return { ok: true, outcome: success.outcome };
  const failure: IdentityFailure | undefined = root.IdentityFailure as IdentityFailure | undefined;
  if (failure?.request_id === requestId) return { ok: false, reason: failure.reason, message: failure.message };
  return undefined;
}

function ask(send: RequestSender, requestId: string, request: IdentityRequest, timeoutMs: number): Promise<AgentAnswer> {
  return requestResponse<AgentAnswer>({
    request,
    requestId,
    sendRequest: (body: unknown, id?: string): Promise<void> => send(body as Record<string, unknown>, id),
    timeoutMs,
    operationName: Object.keys(request)[0],
    matcher: { matchSuccess: (message) => identityAnswer(message, requestId), matchFailure: () => undefined },
  });
}

function sendOrFail(): RequestSender {
  const send: RequestSender | null = conversationSender();
  if (send === null) throw new Error('the agent socket is not ready');
  return send;
}

/** True once the agent socket reports a connection, false after `ms` without one. */
function connectedWithin(ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => { off(); resolve(false); }, ms);
    const off: () => void = eventEmitter.on('on-ws-connection-success', () => { clearTimeout(timer); off(); resolve(true); });
  });
}

export function socketAgent(): AgentPort {
  return {
    async status(timeoutMs: number): Promise<AgentAnswer | null> {
      const deadline: number = Date.now() + timeoutMs;
      for (;;) {
        const send: RequestSender | null = conversationSender();
        if (send !== null) {
          const id: string = crypto.randomUUID();
          try {
            return await ask(send, id, { IdentityStatus: { request_id: id } }, Math.max(1, deadline - Date.now()));
          } catch {
            // Not connected yet, or no agent: wait for a connection while the probe has time left.
          }
        }
        const left: number = deadline - Date.now();
        if (left <= 0 || !(await connectedWithin(left))) return null;
      }
    },
    create(password: string): Promise<AgentAnswer> {
      const id: string = crypto.randomUUID();
      return ask(sendOrFail(), id, { IdentityCreate: { request_id: id, unlock_password: stringToBytes(password) } }, IDENTITY_REQUEST_MS);
    },
    exportPhrase(password: string): Promise<AgentAnswer> {
      const id: string = crypto.randomUUID();
      return ask(sendOrFail(), id, { IdentityExport: { request_id: id, unlock_password: stringToBytes(password) } }, IDENTITY_REQUEST_MS);
    },
    signChallenge(request: SignChallenge): Promise<AgentAnswer> {
      const id: string = crypto.randomUUID();
      return ask(sendOrFail(), id, {
        IdentitySignChallenge: {
          request_id: id,
          issuer: request.issuer,
          aud: request.aud,
          nonce: request.nonce,
          challenge: request.challenge,
          unlock_password: stringToBytes(request.password),
        },
      }, IDENTITY_REQUEST_MS);
    },
  };
}
