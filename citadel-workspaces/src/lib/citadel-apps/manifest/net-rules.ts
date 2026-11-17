/**
 * Hosts and URLs as the egress policy reads them (citadel-app-net-policy's url.rs and grant.rs),
 * for the manifest's publisher contact, artifact locations and network capabilities. Strict:
 * anything the policy would not recognise is refused here too, not repaired.
 *
 * Relative imports only: scripts/check-app-catalogue.mjs in the parent repository bundles this
 * directory to check the global catalogue with the same rules the marketplace reads it with.
 */

export const MAX_HOSTS: number = 8;
const MAX_URL_BYTES: number = 8 * 1024;

function canonicalIpv4(text: string): boolean {
  const parts: string[] = text.split('.');
  return parts.length === 4 && parts.every((p: string) => /^(0|[1-9][0-9]{0,2})$/.test(p) && Number(p) <= 255);
}

function hostOk(text: string): boolean {
  const host: string = text.toLowerCase();
  if (canonicalIpv4(host)) return true;
  if (host.length === 0 || host.length > 253) return false;
  const labels: string[] = host.split('.');
  const labelOk = (l: string): boolean => l.length >= 1 && l.length <= 63 && !l.startsWith('-') && !l.endsWith('-') && /^[a-z0-9-]+$/.test(l);
  if (!labels.every(labelOk)) return false;
  const last: string = labels[labels.length - 1];
  return /[a-z]/.test(last) && !last.startsWith('0x');
}

function portOk(text: string): boolean {
  if (!/^[0-9]+$/.test(text) || (text.length > 1 && text.startsWith('0'))) return false;
  const port: number = Number(text);
  return port >= 1 && port <= 65535;
}

/** `host` or `host:port`, as `split_host_port` reads it. */
function hostPortOk(authority: string): boolean {
  if (authority.startsWith('[')) return false;
  const colon: number = authority.lastIndexOf(':');
  if (colon === -1) return hostOk(authority);
  return hostOk(authority.slice(0, colon)) && portOk(authority.slice(colon + 1));
}

/** An `https://` URL of at most `max` bytes that the policy's `TargetUrl::parse` accepts. */
export function isHttpsUrl(text: string, max: number): boolean {
  if (text.length > Math.min(max, MAX_URL_BYTES) || !/^[\x21-\x7e]+$/.test(text) || text.includes('\\') || text.includes('#')) return false;
  if (!text.startsWith('https://')) return false;
  const rest: string = text.slice('https://'.length);
  const end: number = rest.search(/[/?]/);
  const authority: string = end === -1 ? rest : rest.slice(0, end);
  return !authority.includes('@') && hostPortOk(authority);
}

/** One allow-listed entry: `api.acme.com` or `api.acme.com:8080`, lowercase, no wildcard. */
export function isAllowedHostEntry(entry: string): boolean {
  if (entry.includes('*') || /[/@?#]/.test(entry) || entry !== entry.toLowerCase()) return false;
  return hostPortOk(entry);
}

/** One to eight distinct explicit entries: what `NetGrant::new` accepts. */
export function isHostList(hosts: readonly string[]): boolean {
  return hosts.length >= 1 && hosts.length <= MAX_HOSTS && new Set(hosts).size === hosts.length && hosts.every(isAllowedHostEntry);
}
