/**
 * Whether THIS deployment can create workspaces, and where it asks.
 *
 * Creating a hosted workspace needs the tenant control plane, which exists on
 * the hosted site and nowhere else: a local build and a self-hosted server have
 * none, and on those "Setting up a new workspace" still means the wizard and the
 * server's master password. So the feature is switched on by the deployment,
 * not assumed -- the same `<meta>` mechanism as the loopback agent origin and
 * the default workspace server (see default-workspace-server.ts): the host
 * fills in `<meta name="citadel-control-plane" content="/api">`, and empty
 * means "not here".
 *
 * Only a same-origin PATH is accepted. The page's `connect-src 'self'` would
 * block anything else, and an absolute URL here would be an instruction to post
 * a Turnstile token and a workspace's details to another host.
 */

export const CONTROL_PLANE_META: string = 'citadel-control-plane';

const SAME_ORIGIN_PATH: RegExp = /^\/(?!\/)[A-Za-z0-9._~/-]*$/;

type MetaSource = { querySelector(selector: string): { getAttribute(name: string): string | null } | null };

/** The control plane's base path (e.g. `/api`), or `undefined` when this deployment has none. */
export function readControlPlaneBase(doc: MetaSource): string | undefined {
  const content: string | null | undefined = doc
    .querySelector(`meta[name="${CONTROL_PLANE_META}"]`)
    ?.getAttribute('content');
  const trimmed: string = (content ?? '').trim().replace(/\/+$/, '');
  if (trimmed.length === 0 || !SAME_ORIGIN_PATH.test(trimmed)) return undefined;
  return trimmed;
}

/** Whether the create-workspace flow is offered on this page. */
export function canCreateWorkspaces(doc: MetaSource | undefined): boolean {
  return doc !== undefined && readControlPlaneBase(doc) !== undefined;
}
