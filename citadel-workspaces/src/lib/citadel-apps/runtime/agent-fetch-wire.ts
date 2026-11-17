/**
 * The `AppFetch` wire as the page writes and reads it: the request (with the install's grant),
 * the agent's closed refusals, and its headers. Shared by buffered and streamed host fetches.
 */
import type { HttpRequest } from '../sdk/generated/HttpRequest';
import type { Refused } from '../host/ports';
import type { Json } from './agent-link';

export interface HostFetchTarget {
  readonly cid: bigint;
  readonly appId: string;
  readonly installId: string;
  readonly grant: { readonly hosts: readonly string[]; readonly private: boolean };
  readonly timeoutMs: number;
}

/** The agent's closed `AppFetchRefusal` as the app reads it: never upstream text. */
export function fetchRefusal(refusal: unknown): Refused {
  const r: { kind?: unknown; detail?: unknown } = (typeof refusal === 'object' && refusal !== null ? refusal : {}) as { kind?: unknown; detail?: unknown };
  const detail: string = typeof r.detail === 'string' ? r.detail.toLowerCase() : 'unknown';
  if (r.kind === 'Policy') return { policy: 'denied' };
  if (r.kind === 'Limit') return { limit: detail };
  return { unavailable: detail };
}

export function headersOf(value: unknown): [string, string][] | null {
  if (!Array.isArray(value)) return null;
  const out: [string, string][] = [];
  for (const h of value) {
    if (typeof h !== 'object' || h === null || typeof (h as Json).name !== 'string' || typeof (h as Json).value !== 'string') return null;
    out.push([(h as Json).name as string, (h as Json).value as string]);
  }
  return out;
}

export function appFetchRequest(target: HostFetchTarget, request: HttpRequest, stream: boolean): (requestId: string) => Json {
  return (request_id: string): Json => ({
    AppFetch: {
      request_id, cid: target.cid, app_id: target.appId, install_id: target.installId,
      grant: { hosts: [...target.grant.hosts], private: target.grant.private },
      request: { method: request.method, url: request.url, headers: request.headers.map(([name, value]: [string, string]) => ({ name, value })), body: Array.from(request.body) },
      stream,
    },
  });
}
