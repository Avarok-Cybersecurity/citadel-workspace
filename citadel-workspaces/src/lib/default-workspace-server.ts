/**
 * The workspace server a hosted deployment belongs to.
 *
 * Why this exists
 * ---------------
 * A person who opens a hosted Citadel page cold has no way to find out which
 * workspace server it serves. The address is `host:port`, and it is NOT
 * derivable from `window.location`: the UI and the server are deliberately
 * different hosts (work.avarok.net and citadel.avarok.net:12400). The join
 * wizard asks for it, and the onboarding dialog tells a member they "will need
 * its address" -- and then nothing on the page ever says what it is. Every new
 * user has had to be told out of band.
 *
 * So the operator publishes it the same way they publish the loopback agent
 * origin: nginx fills in a `<meta>` at request time, from one environment
 * variable, and the page reads it here. See `readLoopbackAgentOrigin` in
 * websocket-service/resolve-url.ts, which this mirrors on purpose -- one
 * mechanism, learned once.
 *
 * Empty means "ask the user", which is right for a local build and for any
 * deployment whose operator has not set it. It is a PRE-FILL, never a lock:
 * the field stays editable, because a hosted page is a perfectly good way to
 * reach somebody else's server.
 */

import { normalizeWorkspaceAddress } from '@/lib/workspace-address';

/** The `<meta name>` the hosting nginx fills in. */
export const DEFAULT_SERVER_META: string = 'citadel-default-server';

/**
 * `host` or `host:port`. The port is OPTIONAL: `normalizeWorkspaceAddress`
 * assumes DEFAULT_WORKSPACE_PORT when none is given, so an operator publishing
 * `citadel.example.com` means the same thing as `citadel.example.com:12400`.
 *
 * Deliberately the same shape the address field accepts and the error message
 * describes. A value that would not be accepted if typed must not be offered
 * as if it would: a bad injection has to fail here, visibly, and leave the
 * field empty, rather than pre-filling something the user must first notice is
 * wrong and then delete.
 */
const SERVER_SHAPE: RegExp = /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?(:[0-9]{1,5})?$/;

/** True for a `host` or `host:port` the address field would accept as typed. */
export function isWorkspaceServerShape(value: string): boolean {
  return SERVER_SHAPE.test(value);
}

/** Read the published default workspace server, or `undefined` when none is set. */
export function readDefaultWorkspaceServer(
  doc: { querySelector(selector: string): { getAttribute(name: string): string | null } | null },
): string | undefined {
  const content: string | null | undefined = doc
    .querySelector(`meta[name="${DEFAULT_SERVER_META}"]`)
    ?.getAttribute('content');
  const trimmed: string = (content ?? '').trim();
  if (trimmed.length === 0) return undefined;
  if (!isWorkspaceServerShape(trimmed)) return undefined;
  // Hand back what the field should contain, port included.
  return normalizeWorkspaceAddress(trimmed);
}
