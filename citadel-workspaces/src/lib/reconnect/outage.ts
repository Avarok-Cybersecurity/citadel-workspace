/**
 * When a workspace cannot be shown because of a failure on the service's side, the page says
 * so on its own, in place of the workspace: a centred notice, a stable code for support, and
 * Retry. A workspace drawn half-loaded under a "Reconnecting" strip looked like it worked.
 *
 * An ordinary drop is back in seconds, so it starts as the strip (OfflineBanner) and becomes
 * this only once it has lasted `RECONNECT_ESCALATION_MS`, or at once when the agent gives up.
 */
import { createValueStore, type ValueStore } from '@/lib/value-store';

export type OutageKind = 'reconnect-slow' | 'server-unreachable' | 'workspace-timeout';

/** What support is read over the phone: one per kind, never reused, never a stack trace. */
export const OUTAGE_CODE: Readonly<Record<OutageKind, string>> = {
  'reconnect-slow': 'CW-LINK-SLOW',
  'server-unreachable': 'CW-SRV-UNREACHABLE',
  'workspace-timeout': 'CW-LOAD-TIMEOUT',
};

export const OUTAGE_COPY: { readonly codeLabel: string } = { codeLabel: 'Error code' };

/**
 * Whose failure an outage is, which decides what the page says and what its way out does. The
 * person's own network comes first: offline, every kind reads as offline.
 */
export type OutageCause = 'offline' | 'reconnecting' | 'server-down' | 'load-timeout';

export function outageCause(kind: OutageKind, online: boolean): OutageCause {
  if (!online) return 'offline';
  if (kind === 'reconnect-slow') return 'reconnecting';
  if (kind === 'server-unreachable') return 'server-down';
  return 'load-timeout';
}

/**
 * Owner decision 2026-11-27 (REL-1127, recorded in RECOVERY-DESIGN.md §6): the owner's sentence
 * only when the server is really down; offline says so and that it reconnects by itself; during a
 * reconnect, that it is reconnecting.
 */
export const OUTAGE_TITLE: { readonly [K in OutageCause]: string } = {
  'server-down': 'The error is on us — please check back soon',
  offline: 'You’re offline. Citadel will reconnect automatically when your connection is back.',
  reconnecting: 'Reconnecting to your workspace…',
  'load-timeout': 'Your workspace is taking too long to load',
};

/** How long "Reconnecting" stays a strip over the workspace before it becomes the whole page. */
export const RECONNECT_ESCALATION_MS: number = 15_000;

export interface Outage {
  kind: OutageKind;
  /** The session it is about; null for one that is not a session's (the workspace never loaded). */
  cid: bigint | null;
  /** Where Retry goes when the session is gone and only signing in brings it back; null reloads. */
  signIn: { path: string; message: string } | null;
}

/**
 * Whether `current` already tells the user that session `cid` is gone and how to get it back:
 * the agent's give-up is followed by the session's own end, which must not send them elsewhere.
 */
export function showsSessionGone(current: Outage | null, cid: bigint): boolean {
  return current !== null && current.signIn !== null && current.cid === cid;
}

/** The outage this tab is showing, or null. */
export const outage: ValueStore<Outage | null> = createValueStore<Outage | null>('outage', null);

export interface EscalationIO {
  /** Run `run` after `ms`; the returned function cancels it. */
  after: (ms: number, run: () => void) => () => void;
  show: (next: Outage | null) => void;
}

export interface Escalation {
  /** Show `next` once `ms` have passed, unless `end` or `now` comes first. */
  begin: (next: Outage, ms: number) => void;
  /** Show `next` at once. */
  now: (next: Outage) => void;
  /** Whatever was pending or showing is over. */
  end: () => void;
}

export function createEscalation(io: EscalationIO): Escalation {
  let cancel: (() => void) | null = null;
  const stop = (): void => {
    cancel?.();
    cancel = null;
  };
  return {
    begin: (next: Outage, ms: number): void => {
      stop();
      cancel = io.after(ms, (): void => {
        cancel = null;
        io.show(next);
      });
    },
    now: (next: Outage): void => {
      stop();
      io.show(next);
    },
    end: (): void => {
      stop();
      io.show(null);
    },
  };
}
