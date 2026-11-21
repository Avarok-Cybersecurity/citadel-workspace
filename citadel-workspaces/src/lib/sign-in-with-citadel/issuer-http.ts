/**
 * The issuer port over HTTP: this page's own origin, which is the issuer's
 * (deploy/tenant-worker/control/sign-in-routes.mjs). `begin` and `prove` are answered only to the
 * issuer's own Origin, which a same-origin fetch sends.
 */
import {
  isBeginResponse, isProveResponse, isRefusalBody, isReturnAllowlist,
  type ReturnAllowlist, type SignInBeginResponse, type SignInProveResponse,
} from './issuer-wire';
import type { IssuerAnswer, IssuerPort } from './ports';

export const ISSUER_PATHS: { readonly allowlist: '/sign-in/clients.json'; readonly begin: '/sign-in/begin'; readonly prove: '/sign-in/prove' } = {
  allowlist: '/sign-in/clients.json',
  begin: '/sign-in/begin',
  prove: '/sign-in/prove',
} as const;

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

async function answer<T>(fetchFn: Fetch, path: string, init: RequestInit, shaped: (value: unknown) => value is T): Promise<IssuerAnswer<T>> {
  let response: Response;
  try {
    response = await fetchFn(path, { credentials: 'same-origin', cache: 'no-store', ...init });
  } catch {
    return { ok: false, code: 'unreachable' };
  }
  const body: unknown = await response.json().catch((): null => null);
  if (!response.ok) return { ok: false, code: isRefusalBody(body) ? body.error : `http_${response.status}` };
  return shaped(body) ? { ok: true, value: body } : { ok: false, code: 'unexpected_answer' };
}

const post = (body: object): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export function httpIssuer(fetchFn: Fetch): IssuerPort {
  return {
    allowlist: (): Promise<IssuerAnswer<ReturnAllowlist>> => answer(fetchFn, ISSUER_PATHS.allowlist, { method: 'GET' }, isReturnAllowlist),
    begin: (body): Promise<IssuerAnswer<SignInBeginResponse>> => answer(fetchFn, ISSUER_PATHS.begin, post(body), isBeginResponse),
    prove: (body): Promise<IssuerAnswer<SignInProveResponse>> => answer(fetchFn, ISSUER_PATHS.prove, post(body), isProveResponse),
  };
}
