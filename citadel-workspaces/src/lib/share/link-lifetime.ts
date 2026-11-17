/**
 * How long a secure link lives, and how the limit on them reads.
 *
 * The presets are the server's: at most 30 days (SECURE_LINK_MAX_TTL_MS), no "never". A one-time
 * link still expires if nobody opens it.
 */
import type { LinkLifetime } from 'citadel-workspace-client-ts';

const HOUR_MS: bigint = 60n * 60n * 1000n;

export type LifetimePreset = '1h' | '24h' | '7d' | '30d';

export const LIFETIME_PRESETS: readonly { id: LifetimePreset; label: string; ttlMs: bigint }[] = [
  { id: '1h', label: '1 hour', ttlMs: HOUR_MS },
  { id: '24h', label: '24 hours', ttlMs: 24n * HOUR_MS },
  { id: '7d', label: '7 days', ttlMs: 7n * 24n * HOUR_MS },
  { id: '30d', label: '30 days', ttlMs: 30n * 24n * HOUR_MS },
];

export function presetOf(id: string): LifetimePreset | null {
  return LIFETIME_PRESETS.find((p) => p.id === id)?.id ?? null;
}

export function ttlOf(preset: LifetimePreset): bigint {
  const found: { ttlMs: bigint } | undefined = LIFETIME_PRESETS.find((p) => p.id === preset);
  if (found === undefined) throw new Error(`No lifetime preset ${preset}`);
  return found.ttlMs;
}

export function lifetimeOf(preset: LifetimePreset, oneTime: boolean): LinkLifetime {
  const ttl_ms: bigint = ttlOf(preset);
  return oneTime ? { OneTime: { ttl_ms } } : { Expires: { ttl_ms } };
}

/** "Expires in 3 days", "Expires in 5 hours", "Expires in under a minute", "Expired". */
export function expiresInText(expiresMs: bigint, nowMs: number): string {
  const left: number = Number(expiresMs) - nowMs;
  if (left <= 0) return 'Expired';
  const minutes: number = Math.floor(left / 60_000);
  if (minutes < 1) return 'Expires in under a minute';
  const plural = (n: number, unit: string): string => `Expires in ${n} ${unit}${n === 1 ? '' : 's'}`;
  if (minutes < 60) return plural(minutes, 'minute');
  const hours: number = Math.floor(minutes / 60);
  if (hours < 48) return plural(hours, 'hour');
  return plural(Math.floor(hours / 24), 'day');
}

/** A workspace's link limits; `null` is no limit (an unlimited plan). */
export interface LinkQuota {
  live: number;
  perMember: number | null;
  pool: number | null;
  poolUsed: number;
}

/** Room for another link: within your own allowance, or the shared pool has space. No limit on either is always room. */
export function atLimit(q: LinkQuota): boolean {
  if (q.perMember === null || q.pool === null) return false;
  return q.live >= q.perMember && q.poolUsed >= q.pool;
}

const links = (n: number): string => `${n} secure link${n === 1 ? '' : 's'}`;

/** "3 of 5 yours", with a pool "12 of 50 yours · 30 of 100 shared pool", and with no limit "12 secure links, no limit". */
export function quotaText(q: LinkQuota): string {
  if (q.perMember === null) return `${links(q.live)}, no limit`;
  const own: string = `${Math.min(q.live, q.perMember)} of ${q.perMember} yours`;
  if (q.pool === null) return `${own} · ${q.poolUsed} from the shared pool, no limit`;
  return q.pool === 0 ? own : `${own} · ${q.poolUsed} of ${q.pool} shared pool`;
}

/** The share of the bar that is used, 0 to 1, across both allowances; null when there is no limit to measure against. */
export function quotaFraction(q: LinkQuota): number | null {
  if (q.perMember === null || q.pool === null) return null;
  const total: number = q.perMember + q.pool;
  if (total === 0) return 1;
  return Math.min(1, (Math.min(q.live, q.perMember) + q.poolUsed) / total);
}

export const LIMIT_COPY: { reached: string; admins: string; manage: string } = {
  reached: 'Limit reached: you have used your secure links and the shared pool is full.',
  admins: 'Workspace admins can add 50-link packs under Admin settings → Manage subscription.',
  manage: 'Limit reached — manage links',
};
