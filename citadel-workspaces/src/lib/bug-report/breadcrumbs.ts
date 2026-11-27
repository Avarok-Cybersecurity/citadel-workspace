/**
 * The last requests and answers on the workspace protocol, by KIND only: `Telemetry.GetMyConsent`
 * went out, `Error` came back. Never a payload, a name, an id or a CID (RECOVERY-DESIGN.md §3.1).
 */

export interface Crumb {
  readonly at: number;
  readonly dir: 'sent' | 'received';
  readonly kind: string;
}

export const CRUMB_LIMIT: number = 50;

const crumbs: Crumb[] = [];

/** A message's kind: its variant name, and one level of sub-variant when there is one. */
export function kindOf(message: unknown): string {
  if (typeof message === 'string') return message;
  if (typeof message !== 'object' || message === null) return typeof message;
  const outer: string | undefined = Object.keys(message)[0];
  if (outer === undefined) return 'object';
  const inner: unknown = (message as Record<string, unknown>)[outer];
  if (typeof inner === 'string') return `${outer}.${inner}`;
  if (typeof inner === 'object' && inner !== null && !Array.isArray(inner)) {
    const sub: string | undefined = Object.keys(inner)[0];
    // A sub-key that starts with a capital is a variant; a lower-case one is a field, and stays out.
    if (sub !== undefined && /^[A-Z]/u.test(sub)) return `${outer}.${sub}`;
  }
  return outer;
}

export function recordCrumb(dir: Crumb['dir'], message: unknown, at: number): void {
  crumbs.push({ at, dir, kind: kindOf(message) });
  if (crumbs.length > CRUMB_LIMIT) crumbs.splice(0, crumbs.length - CRUMB_LIMIT);
}

export function crumbsSnapshot(): readonly Crumb[] {
  return [...crumbs];
}
