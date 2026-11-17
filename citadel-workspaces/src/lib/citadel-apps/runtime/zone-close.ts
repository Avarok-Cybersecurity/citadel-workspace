/**
 * How a mounted zone ends, in order: its watchers and input stop (no event or frame reaches the
 * app again); the instance closes (instance.ts: the worker cancels the app's internal-HTTP
 * streams, runs app_close, delivers the replies it waits on, and is terminated, its
 * OffscreenCanvas with it, at the latest when the install's close grace runs out); the instance's
 * advertisement is withdrawn and its renewal stopped; the canvas element goes; the ports drop
 * what they hold open; and one audit line says how it went.
 *
 * Failures are told apart by whether anyone is there to act on them: on a live page a refused
 * withdrawal is reported; on a page that is going away (`leaving`) nothing is, since the session
 * the request needed may already be gone. Nothing here is caught that is not then reported or
 * named as the page going away.
 */
import type { AppsFailure, AppsResult } from '@/lib/workspace-service/apps-operations';
import type { AppInstance, CloseEnding, CloseOutcome } from '../host/instance';
import type { CloseReason } from '../sdk/generated/CloseReason';
import type { BoundPorts } from './host-ports';

/** What the zone's withdrawal came to: the streams the server ended, or why there was none. */
export type Withdrawal = { readonly ended: number } | 'never-served' | 'not-started' | { readonly refused: AppsFailure };

export interface ZoneAudit {
  readonly appId: string;
  readonly installId: string;
  readonly zoneId: string;
  readonly reason: CloseReason;
  /** How the instance ended; `not-started` when no instance was ever launched. */
  readonly ending: CloseEnding;
  readonly closeResult: number | null;
  readonly ms: number;
  readonly withdrawal: Withdrawal;
}

export interface ZoneCloseDeps {
  readonly audit: (line: ZoneAudit) => void;
  readonly report: (what: string, detail: unknown) => void;
}

export interface ZoneParts {
  readonly ids: Pick<ZoneAudit, 'appId' | 'installId' | 'zoneId'>;
  readonly instance: AppInstance | null;
  readonly bound: BoundPorts | null;
  /** Stops the watchers and detaches input (frames with it). */
  readonly quiesce: () => void;
  readonly disposeSurface: () => void;
  /** True once the page is going away. */
  readonly leaving: () => boolean;
}

async function withdrawOf(bound: BoundPorts | null): Promise<Withdrawal> {
  if (bound === null) return 'not-started';
  const r: AppsResult<number> | null = await bound.withdraw();
  if (r === null) return 'never-served';
  return r.ok ? { ended: r.value } : { refused: r.refusal };
}

export async function closeZone(p: ZoneParts, reason: CloseReason, deps: ZoneCloseDeps): Promise<void> {
  p.quiesce();
  const outcome: CloseOutcome | null = p.instance === null ? null : await p.instance.close(reason);
  const withdrawal: Withdrawal = await withdrawOf(p.bound);
  if (typeof withdrawal === 'object' && 'refused' in withdrawal && !p.leaving()) {
    deps.report(`[apps] ${p.ids.appId} could not withdraw its service when it closed; its callers learn when the advertisement expires`, withdrawal.refused);
  }
  p.disposeSurface();
  // Awaited: a zone's close settles only once its topics are left, so an instance started after it
  // (AppZone.tsx waits for this) never has its joins undone by this one's leaves.
  await p.bound?.stop();
  deps.audit({
    ...p.ids, reason, withdrawal,
    ending: outcome?.ending ?? 'not-started', closeResult: outcome?.closeResult ?? null, ms: outcome?.ms ?? 0,
  });
}
