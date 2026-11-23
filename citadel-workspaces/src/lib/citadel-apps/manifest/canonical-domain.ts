/**
 * Whether a server name is already a canonical domain (identity-api §3): what
 * `citadel_identity::canonical_domain` makes of it is itself. The manifest's `citadel.session`
 * `servers` must be, so the consent screen, the grant and the agent name a server one way.
 *
 * A predicate, not a second canonicaliser: anything `canonical_domain` would change (a scheme, an
 * upper-case letter, a trailing `/`, `:443`, an IPv6 address not in its compressed form) is
 * refused, never repaired. Held to the contract's known answers (identity-kat.json) and to the
 * shared manifest cases. Relative imports only: scripts/lib/app-catalogue-rules.mjs loads this.
 */

/** identity-api §3: the result is at most this many bytes. */
const MAX_DOMAIN_BYTES: number = 190;

const LABEL: RegExp = /^[a-z0-9-]{1,63}$/;
const PATH_SEGMENT: RegExp = /^[a-z0-9._~-]+$/;

function hostOk(host: string): boolean {
  return host.length > 0 && host.split('.').every((l: string) => LABEL.test(l) && !l.startsWith('-') && !l.endsWith('-'));
}

/** `Ipv6Addr`'s Display: compressed lowercase, with an IPv4-mapped address in dotted form. */
function ipv6Display(literal: string): string | null {
  let host: string;
  try {
    host = new URL(`http://[${literal}]/`).hostname;
  } catch {
    return null;
  }
  const inner: string = host.slice(1, -1);
  const mapped: RegExpExecArray | null = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(inner);
  if (mapped === null) return inner;
  const [hi, lo] = [parseInt(mapped[1], 16), parseInt(mapped[2], 16)];
  return `::ffff:${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

function portOk(port: string): boolean {
  return /^[1-9][0-9]{0,4}$/.test(port) && Number(port) <= 65535 && port !== '443';
}

function authorityOk(authority: string): boolean {
  if (authority.startsWith('[')) {
    const close: number = authority.indexOf(']');
    if (close === -1) return false;
    const literal: string = authority.slice(1, close);
    const after: string = authority.slice(close + 1);
    if (ipv6Display(literal) !== literal) return false;
    return after === '' || (after.startsWith(':') && portOk(after.slice(1)));
  }
  const colon: number = authority.lastIndexOf(':');
  if (colon === -1) return hostOk(authority);
  return hostOk(authority.slice(0, colon)) && portOk(authority.slice(colon + 1));
}

export function isCanonicalServer(text: string): boolean {
  if (text.length === 0 || text.length > MAX_DOMAIN_BYTES || !/^[\x21-\x7e]+$/.test(text) || /[@?#%\\]/.test(text)) return false;
  if (text !== text.toLowerCase() || text.includes('://')) return false;
  const slash: number = text.indexOf('/');
  const authority: string = slash === -1 ? text : text.slice(0, slash);
  const path: string[] = slash === -1 ? [] : text.slice(slash + 1).split('/');
  return authorityOk(authority) && path.every((s: string) => PATH_SEGMENT.test(s) && s !== '.' && s !== '..');
}
