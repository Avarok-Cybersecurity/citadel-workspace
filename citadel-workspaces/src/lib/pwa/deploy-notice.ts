import { createValueStore, type ValueStore } from '@/lib/value-store';

/**
 * That a newer build of the app is out, and what "Reload" should do about it.
 *
 * This used to be a toast. A toast can be dismissed, fades from memory, and sits
 * among ordinary notifications — while a page left open across a deploy keeps
 * running code the server no longer serves: its lazy chunks 404, and the agent it
 * talks to may already speak the newer protocol. So it is a banner that stays
 * until the page is reloaded (DeployBanner).
 *
 * - `waiting`: the service worker has the new build installed; accepting hands it
 *   control (SKIP_WAITING) and reloads.
 * - `activated-elsewhere`: another window accepted it; this one only reloads.
 * - `deployed`: found by polling `/version.json` in a page no worker controls;
 *   a plain reload fetches the new build.
 * - `stale`: another open tab runs a newer build (multi-instance/tab-staleness.ts), or the
 *   kill switch could not reload this one. Accepting applies any waiting worker, then reloads.
 */
export type DeployNoticeReason = 'waiting' | 'activated-elsewhere' | 'deployed' | 'stale';

export interface DeployNotice {
  readonly reason: DeployNoticeReason;
  readonly accept: () => void;
}

const store: ValueStore<DeployNotice | null> = createValueStore<DeployNotice | null>('deploy-notice', null);

/**
 * Raise the notice. A `waiting` offer is not replaced by a `deployed` one: both
 * describe the same build, and only the former activates the worker that serves
 * it — a plain reload under that worker would load the old build again.
 */
export function offerDeployNotice(notice: DeployNotice): void {
  const current: DeployNotice | null = store.get();
  if (current?.reason === 'waiting' && notice.reason === 'deployed') return;
  // Any other notice already names the newer build, and says how to get it.
  if (current !== null && notice.reason === 'stale') return;
  store.set(notice);
}

export const getDeployNotice: () => DeployNotice | null = store.get;
export const subscribeDeployNotice: (listener: () => void) => () => void = store.subscribe;

export function clearDeployNoticeForTests(): void {
  store.set(null);
}
