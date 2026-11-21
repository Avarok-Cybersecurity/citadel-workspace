/**
 * The issuer's HTTP bodies, as the frozen contract defines them
 * (docs/contracts/batch-1116/sign-in-with-citadel.schema.json `$defs`), with the shape checks the
 * page applies to whatever the issuer answers before acting on it.
 *
 * Not a copy of a generated type: these bodies are JSON-Schema contract shapes served by the
 * tenant Worker (deploy/tenant-worker/control/sign-in-*.mjs); nothing generates TypeScript for them.
 * The fixtures under fixtures/sign-in-with-citadel/ are run through these guards by the tests.
 */

/** `ReturnAllowlist`, served at `/sign-in/clients.json`: the SSOT for `aud` and `display_name`. */
export interface AllowlistedClient {
  display_name: string;
  aud: string;
  returns: string[];
}
export interface ReturnAllowlist {
  v: 1;
  clients: Record<string, AllowlistedClient>;
}

export interface SignInBeginRequest { v: 1; client: string; challenge: string; state: string; return: string }
export interface SignInBeginResponse {
  v: 1; attempt: string; nonce: string; issuer: string; aud: string; display_name: string; expires_in_s: number;
}
export interface SignInProveRequest { v: 1; attempt: string; proof: string }
export interface SignInProveResponse { v: 1; code: string; return: string; state: string }

/** The issuer's refusal body: `{error: <reason code>, detail}` (control/http.mjs `refuse`). */
export interface IssuerRefusalBody { error: string; detail: string }

export const CLIENT_ID_SHAPE: RegExp = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/;
export const CHALLENGE_SHAPE: RegExp = /^[A-Za-z0-9_-]{43}$/;
export const STATE_SHAPE: RegExp = /^[A-Za-z0-9_-]{22,43}$/;
export const ATTEMPT_SHAPE: RegExp = /^[A-Za-z0-9_-]{22,43}$/;
export const NONCE_SHAPE: RegExp = /^[A-Za-z0-9_-]{43}$/;
export const CODE_SHAPE: RegExp = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}$/;
/** `ReturnUrl`: https, host, optional port, an absolute path; no query, fragment or userinfo. */
export const RETURN_SHAPE: RegExp = /^https:\/\/[a-z0-9.-]+(?::[1-9][0-9]{0,4})?\/[A-Za-z0-9._~/-]*$/;
const RETURN_MAX_LEN: number = 512;
const ISSUER_SHAPE: RegExp = /^[a-z0-9](?:[a-z0-9-]{0,62})(?:\.[a-z0-9](?:[a-z0-9-]{0,62}))*(?::[1-9][0-9]{0,4})?(?:\/[a-z0-9._~-]+)*$/;
const ISSUER_MAX_LEN: number = 190;
const DISPLAY_NAME_MAX_LEN: number = 64;
const EXPIRES_MAX_S: number = 600;
const RETURNS_MAX: number = 8;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Exactly these keys: the schema's `additionalProperties: false`. */
function exactKeys(value: Json, keys: readonly string[]): boolean {
  const own: string[] = Object.keys(value);
  return own.length === keys.length && keys.every((k: string) => Object.hasOwn(value, k));
}

const matches = (value: unknown, shape: RegExp, max: number = Number.MAX_SAFE_INTEGER): value is string =>
  typeof value === 'string' && value.length <= max && shape.test(value);

const isDisplayName = (value: unknown): value is string => typeof value === 'string' && value.length >= 1 && value.length <= DISPLAY_NAME_MAX_LEN;

export const isReturnUrl = (value: unknown): value is string => matches(value, RETURN_SHAPE, RETURN_MAX_LEN);

function isClient(value: unknown): value is AllowlistedClient {
  return isObject(value) && exactKeys(value, ['display_name', 'aud', 'returns'])
    && isDisplayName(value.display_name) && matches(value.aud, CLIENT_ID_SHAPE)
    && Array.isArray(value.returns) && value.returns.length > 0 && value.returns.length <= RETURNS_MAX
    && new Set(value.returns).size === value.returns.length && value.returns.every(isReturnUrl);
}

export function isReturnAllowlist(value: unknown): value is ReturnAllowlist {
  if (!isObject(value) || !exactKeys(value, ['v', 'clients']) || value.v !== 1 || !isObject(value.clients)) return false;
  const entries: [string, unknown][] = Object.entries(value.clients);
  return entries.length > 0 && entries.every(([id, client]: [string, unknown]) => CLIENT_ID_SHAPE.test(id) && isClient(client));
}

export function isBeginResponse(value: unknown): value is SignInBeginResponse {
  return isObject(value) && exactKeys(value, ['v', 'attempt', 'nonce', 'issuer', 'aud', 'display_name', 'expires_in_s'])
    && value.v === 1 && matches(value.attempt, ATTEMPT_SHAPE) && matches(value.nonce, NONCE_SHAPE)
    && matches(value.issuer, ISSUER_SHAPE, ISSUER_MAX_LEN) && matches(value.aud, CLIENT_ID_SHAPE)
    && isDisplayName(value.display_name) && Number.isInteger(value.expires_in_s)
    && (value.expires_in_s as number) >= 1 && (value.expires_in_s as number) <= EXPIRES_MAX_S;
}

export function isProveResponse(value: unknown): value is SignInProveResponse {
  return isObject(value) && exactKeys(value, ['v', 'code', 'return', 'state'])
    && value.v === 1 && matches(value.code, CODE_SHAPE) && isReturnUrl(value.return) && matches(value.state, STATE_SHAPE);
}

export function isRefusalBody(value: unknown): value is IssuerRefusalBody {
  return isObject(value) && typeof value.error === 'string' && value.error.length > 0 && typeof value.detail === 'string';
}
