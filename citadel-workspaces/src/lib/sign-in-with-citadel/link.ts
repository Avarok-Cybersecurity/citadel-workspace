/**
 * The sign-in link a client sends the person to (sign-in-with-citadel.md §1 step 1, `SignInLink`):
 * `?client=&challenge=&state=&return=`, exactly those four, each once. The page refuses anything
 * else, and refuses a `return` its client is not allowlisted for, before it asks the agent or the
 * issuer anything: a bad link creates no state anywhere.
 */
import {
  CHALLENGE_SHAPE, CLIENT_ID_SHAPE, STATE_SHAPE, isReturnUrl,
  type AllowlistedClient, type ReturnAllowlist,
} from './issuer-wire';

export interface SignInLink {
  client: string;
  /** `SHA3-256(verifier)`, base64url without padding (43 characters). */
  challenge: string;
  state: string;
  return: string;
}

/** The issuer's own reason codes for a bad link, so the page and the issuer say the same thing. */
export type LinkRefusal = 'malformed_link' | 'unknown_client' | 'return_not_allowlisted';

export type LinkCheck<T> = { ok: true; value: T } | { ok: false; reason: LinkRefusal };

const PARAMS: readonly (keyof SignInLink)[] = ['client', 'challenge', 'state', 'return'];

/** The link in `search` (`location.search`), or why it is not one. */
export function parseSignInLink(search: string): LinkCheck<SignInLink> {
  const query: URLSearchParams = new URLSearchParams(search);
  const keys: string[] = [...query.keys()];
  const exact: boolean = keys.length === PARAMS.length && PARAMS.every((name: string) => query.getAll(name).length === 1);
  if (!exact) return { ok: false, reason: 'malformed_link' };
  const link: SignInLink = {
    client: query.get('client') ?? '',
    challenge: query.get('challenge') ?? '',
    state: query.get('state') ?? '',
    return: query.get('return') ?? '',
  };
  const shaped: boolean = CLIENT_ID_SHAPE.test(link.client) && CHALLENGE_SHAPE.test(link.challenge)
    && STATE_SHAPE.test(link.state) && isReturnUrl(link.return);
  return shaped ? { ok: true, value: link } : { ok: false, reason: 'malformed_link' };
}

/** The registered client the link names, if its `return` is one of that client's, exactly. */
export function allowlistedClient(link: SignInLink, allowlist: ReturnAllowlist): LinkCheck<AllowlistedClient> {
  const client: AllowlistedClient | undefined = Object.hasOwn(allowlist.clients, link.client) ? allowlist.clients[link.client] : undefined;
  if (client === undefined) return { ok: false, reason: 'unknown_client' };
  if (!client.returns.includes(link.return)) return { ok: false, reason: 'return_not_allowlisted' };
  return { ok: true, value: client };
}
