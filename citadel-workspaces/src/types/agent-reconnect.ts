/**
 * The agent's notifications about its connection to a workspace server: the generated
 * `ServerConnectionLost`, `ServerReconnected` and `ServerReconnectFailed` variants of
 * `InternalServiceResponse`, read off the wire into those generated shapes.
 *
 * All three name the session in `cid`: the recipient, like MessageNotification,
 * so they are routed to the tab that owns the session (routing-rules.ts). Their
 * `request_id` is always null: they answer no request. A failure is followed by
 * a DisconnectNotification for the session.
 */
import type { ResponseType, ServerConnectionLost, ServerReconnected, ServerReconnectFailed } from 'citadel-workspace-client-ts';
import { admissionReasonOf, type AdmissionReason } from '@/lib/admission/refusal';

/**
 * A `ServerReconnectFailed` as read here: `reason_code` narrowed to the admission codes the UI
 * acts on (the server's check refused the reconnect, so only a sign-in that passes it brings the
 * session back), null for every other give-up and from an agent that does not send it.
 */
export type ReadServerReconnectFailed = Omit<ServerReconnectFailed, 'reason_code'> & { reason_code: AdmissionReason | null };

export const AGENT_RECONNECT_NOTIFICATIONS = ['ServerConnectionLost', 'ServerReconnected', 'ServerReconnectFailed'] as const satisfies readonly ResponseType[];

export type AgentReconnectNotification = (typeof AGENT_RECONNECT_NOTIFICATIONS)[number];

export type AgentReconnectEvent =
  | { kind: 'lost'; cid: bigint; reconnecting: boolean }
  | { kind: 'reconnected'; cid: bigint }
  | { kind: 'failed'; cid: bigint; reason: string; reasonCode: AdmissionReason | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The notification's body under `name`, whether or not the wire wrapped it in `Response`. */
function bodyOf(message: unknown, name: AgentReconnectNotification): (Record<string, unknown> & { cid: bigint; request_id: string | null }) | null {
  const unwrapped: unknown = isRecord(message) && isRecord(message.Response) ? message.Response : message;
  if (!isRecord(unwrapped)) return null;
  const body: unknown = unwrapped[name];
  if (!isRecord(body)) return null;
  const cid: unknown = body.cid;
  // The agent sends `null`, but the WASM client hands JavaScript `undefined` for a Rust
  // `None` (serde-wasm-bindgen), so both mean "no request". Accepting only null dropped
  // every real notification: measured end to end, the banner never appeared.
  const requestId: unknown = body.request_id ?? null;
  const requestIdOk: boolean = requestId === null || typeof requestId === 'string';
  return typeof cid === 'bigint' && requestIdOk ? { ...body, cid, request_id: requestId as string | null } : null;
}

export function readServerConnectionLost(message: unknown): ServerConnectionLost | null {
  const body: (Record<string, unknown> & { cid: bigint; request_id: string | null }) | null = bodyOf(message, 'ServerConnectionLost');
  const reconnecting: unknown = body?.reconnecting;
  return body && typeof reconnecting === 'boolean' ? { cid: body.cid, reconnecting, request_id: body.request_id } : null;
}

export function readServerReconnected(message: unknown): ServerReconnected | null {
  const body: (Record<string, unknown> & { cid: bigint; request_id: string | null }) | null = bodyOf(message, 'ServerReconnected');
  return body ? { cid: body.cid, request_id: body.request_id } : null;
}

export function readServerReconnectFailed(message: unknown): ReadServerReconnectFailed | null {
  const body: (Record<string, unknown> & { cid: bigint; request_id: string | null }) | null = bodyOf(message, 'ServerReconnectFailed');
  const reason: unknown = body?.reason;
  return body && typeof reason === 'string'
    ? { cid: body.cid, reason, request_id: body.request_id, reason_code: admissionReasonOf(body) }
    : null;
}

/** One of the three, read into a single shape, or null for anything else. */
export function readAgentReconnectEvent(message: unknown): AgentReconnectEvent | null {
  const lost: ServerConnectionLost | null = readServerConnectionLost(message);
  if (lost) return { kind: 'lost', cid: lost.cid, reconnecting: lost.reconnecting };
  const back: ServerReconnected | null = readServerReconnected(message);
  if (back) return { kind: 'reconnected', cid: back.cid };
  const failed: ReadServerReconnectFailed | null = readServerReconnectFailed(message);
  return failed ? { kind: 'failed', cid: failed.cid, reason: failed.reason, reasonCode: failed.reason_code } : null;
}
