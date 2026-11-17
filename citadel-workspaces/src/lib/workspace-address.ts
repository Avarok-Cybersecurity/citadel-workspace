/**
 * The workspace address a user types, and the port they should not have to.
 *
 * The address reaches the agent as `host:port` -- it dials a socket, so a port
 * is always sent. But requiring the user to TYPE one made the commonest case
 * the fiddly one: somebody handed a workspace called `citadel.example.com` had
 * to know a number nobody told them, and a bare hostname failed after a
 * thirty-second timeout.
 *
 * So the port is assumed unless given. Typing `citadel.example.com` and typing
 * `citadel.example.com:12400` do the same thing; typing
 * `citadel.example.com:9000` still goes to 9000.
 *
 * AMBIGUOUS INPUT IS NOT GUESSED AT. A bare IPv6 literal (`::1`) has colons
 * that are not a port separator, and there is no honest way to tell it from a
 * typo. Those are returned unchanged so the address is refused by something
 * that can say why, rather than silently turned into a different address.
 */

/**
 * The port assumed when the user gives none.
 *
 * 12400 is what a Citadel workspace server listens on publicly -- it is the
 * port `citadel.avarok.net` serves, the one in every example, and the one an
 * operator publishing a bare hostname means. A local development server on
 * 12349 is reached by typing its port, which is the case that is already
 * explicit and stays that way.
 */
export const DEFAULT_WORKSPACE_PORT: number = 12400;

/**
 * Hosted workspaces: `<org>.work.avarok.net`, one label before the suffix.
 *
 * These are served by a Cloudflare Worker over `wss://` on 443, not by a
 * server listening on a port of its own, so appending DEFAULT_WORKSPACE_PORT
 * would send the agent to a port nothing answers on. The agent maps a bare
 * host of this shape to `wss://<host>/`.
 */
const TENANT_HOST: RegExp = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.work\.avarok\.net$/i;

/** `ws://...` or `wss://...` -- a full URL the agent dials as given. */
const WEBSOCKET_URL: RegExp = /^wss?:\/\//i;

/** True for a `ws://` or `wss://` URL, which the agent dials exactly as given. */
export function isWebSocketUrl(address: string): boolean {
  return WEBSOCKET_URL.test(address.trim());
}

/** True for a hosted workspace host (`acme.work.avarok.net`), port-less by design. */
export function isTenantHost(address: string): boolean {
  return TENANT_HOST.test(address.trim());
}

/** `[::1]:443` or `host:443` -- a port is already present. */
const HAS_PORT: RegExp = /^(\[[^\]]+\]|[^:]+):[0-9]{1,5}$/;

/** `[::1]` or `host` -- no port, and unambiguously so. */
const NEEDS_PORT: RegExp = /^(\[[^\]]+\]|[^:]+)$/;

/** True when the address already names a port. */
export function hasExplicitPort(address: string): boolean {
  return HAS_PORT.test(address.trim());
}

/**
 * Add the assumed port when the address does not name one.
 *
 * Returns the input trimmed and otherwise unchanged when it already has a
 * port, when it is ambiguous -- see the note on IPv6 above -- when it is a
 * `ws://`/`wss://` URL, or when it is a hosted workspace host, which has no
 * port to add.
 */
export function normalizeWorkspaceAddress(input: string): string {
  const trimmed: string = input.trim();
  if (trimmed.length === 0) return trimmed;
  if (WEBSOCKET_URL.test(trimmed)) return trimmed;
  if (TENANT_HOST.test(trimmed)) return trimmed;
  if (HAS_PORT.test(trimmed)) return trimmed;
  if (NEEDS_PORT.test(trimmed)) return `${trimmed}:${DEFAULT_WORKSPACE_PORT}`;
  return trimmed;
}
