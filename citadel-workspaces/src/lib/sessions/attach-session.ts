/**
 * Opening a session here too: joining it beside the window that holds it.
 *
 * `ClaimSession` and a password `Connect` MOVE a live session, and the window
 * it came from stops receiving. `AttachSession` (agent 0.8.6) adds this socket
 * to the session's subscribers instead, so both windows stay live. It always
 * needs a proof: the password once, then the token that earns (join-token.ts),
 * so a browser that has joined is not asked again while the session lives.
 */
import type { AttachProof, SessionRole } from 'citadel-internal-service-wasm-client';
import { requestResponse } from '../websocket/request-response';
import { TIMEOUT } from '../timeout-constants';
import { debugLog } from '../debug-config';
import { rememberJoin, recallJoin, forgetJoin, browserJoinTokens, type JoinTokenStorage } from './join-token';
import { websocketService } from '../websocket-service';

export type Send = (request: Record<string, unknown>, requestId: string) => Promise<void>;

export interface AttachDeps {
  send: Send;
  tokens: JoinTokenStorage;
}

/** The agent's refusal of a stale token (connection_management_attach.rs TOKEN_REFUSED): drop it, ask for the password. */
const TOKEN_REFUSED: string = 'session token is not valid any more';

function field(message: Record<string, unknown>, variant: string, requestId: string): Record<string, unknown> | undefined {
  const inner: unknown = ((message.Response as Record<string, unknown> | undefined) ?? message)[variant];
  if (typeof inner !== 'object' || inner === null) return undefined;
  return (inner as Record<string, unknown>).request_id === requestId ? (inner as Record<string, unknown>) : undefined;
}

async function attach(deps: AttachDeps, cid: bigint, proof: AttachProof): Promise<{ role: SessionRole; token: Uint8Array }> {
  const requestId: string = crypto.randomUUID();
  return requestResponse({
    request: { ConnectionManagement: { request_id: requestId, management_command: { AttachSession: { session_cid: cid, proof } } } },
    requestId,
    sendRequest: (request: unknown, id?: string) => deps.send(request as Record<string, unknown>, id ?? requestId),
    timeoutMs: TIMEOUT.SESSION_MANAGEMENT_MS,
    operationName: 'AttachSession',
    matcher: {
      matchSuccess: (m) => {
        const a: Record<string, unknown> | undefined = field(m, 'SessionAttached', requestId);
        return a ? { role: a.role as SessionRole, token: Uint8Array.from(a.token as number[]) } : undefined;
      },
      matchFailure: (m) => {
        const f: Record<string, unknown> | undefined = field(m, 'ConnectionManagementFailure', requestId);
        return f ? String(f.error ?? 'The agent refused to open this session here') : undefined;
      },
    },
  });
}

/** Join with the password, and remember that this browser did. */
export async function joinWithPassword(deps: AttachDeps, cid: bigint, password: string): Promise<SessionRole> {
  const proof: AttachProof = { Password: Array.from(new TextEncoder().encode(password)) };
  const joined: { role: SessionRole; token: Uint8Array } = await attach(deps, cid, proof);
  await rememberJoin(deps.tokens, cid, joined.token);
  return joined.role;
}

/**
 * Join silently, with the token an earlier join earned. `false` when there is
 * none, or the agent no longer honours it (it restarted, or the session ended
 * and was opened again); the token is then forgotten and the caller asks.
 */
export async function joinWithRememberedToken(deps: AttachDeps, cid: bigint): Promise<boolean> {
  const token: Uint8Array | null = await recallJoin(deps.tokens, cid);
  if (!token) return false;
  try {
    await attach(deps, cid, { Token: Array.from(token) });
    return true;
  } catch (error: unknown) {
    if (!String(error).includes(TOKEN_REFUSED)) throw error;
    debugLog('AttachSession', `The agent no longer honours this browser's token for ${cid}; asking again`);
    await forgetJoin(deps.tokens, cid);
    return false;
  }
}

/** This browser's: requests on its agent socket, tokens sealed in its IndexedDB. */
export const browserAttach: AttachDeps = {
  send: (request: Record<string, unknown>): Promise<void> => websocketService.sendRequest(request),
  tokens: browserJoinTokens,
};
