import { TENANT_DOMAIN } from './slug';

/**
 * Whether `serverAddress` (`host` or `host:port`, as the wizard holds it) is a workspace Avarok
 * hosts: the tenant domain itself or any `<slug>.<tenant domain>`. Avarok's terms are shown, and
 * accepted, only there; a server someone runs themselves is not Avarok's to put terms on.
 */
export function isAvarokHosted(serverAddress: string): boolean {
  const host: string = serverAddress.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split(/[/:]/)[0] ?? '';
  return host === TENANT_DOMAIN || host.endsWith(`.${TENANT_DOMAIN}`);
}
