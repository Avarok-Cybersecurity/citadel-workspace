/**
 * The kill switch: `/version.json` names a `minSeq` above this build's seq, so this build must
 * not keep running. It reloads at once, visible or not, keeping drafts.
 *
 * For a defect that cannot be left running in open tabs until people happen to reload them.
 * The reload first asks the service worker for the new build and hands it control, since a
 * plain reload under the old worker would serve the old build again. If it still comes back
 * on the old build (the new worker was not installed yet), it does not reload a second time
 * for that build: that would be a loop. It shows the reload banner instead.
 */
import { reloadKeepingDrafts, type HandoffStorage } from '@/lib/chat/draft-handoff';
import { debugLog } from '@/lib/debug-config';

export const KILL_SWITCH_KEY: string = 'citadel:kill-switch-reloaded';

export interface KillSwitchIO {
  readonly runningSeq: number;
  /** This tab's sessionStorage, or null where it is refused. */
  readonly storage: HandoffStorage | null;
  checkWorker: () => Promise<void>;
  applyWaitingUpdate: () => Promise<boolean>;
  reload: () => void;
  /** Already reloaded once for this build, or no storage to remember it: ask instead. */
  offerReload: () => void;
}

/** True the first time this tab is told to reload for build `mark`, and remembers it. */
function firstReloadFor(storage: HandoffStorage | null, mark: string): boolean {
  if (storage === null) return false;
  try {
    if (storage.getItem(KILL_SWITCH_KEY) === mark) return false;
    storage.setItem(KILL_SWITCH_KEY, mark);
    return true;
  } catch (error: unknown) {
    debugLog('PWA', 'Kill switch: cannot remember the reload, so it is not made', error);
    return false;
  }
}

export async function runKillSwitch(io: KillSwitchIO): Promise<void> {
  const mark: string = String(io.runningSeq);
  if (!firstReloadFor(io.storage, mark)) {
    debugLog('PWA', `Kill switch: build ${mark} is below the minimum and was not replaced by reloading`);
    io.offerReload();
    return;
  }
  try {
    await io.checkWorker();
    // Not taking control is not a reason to stay: a page no worker controls loads from the
    // network, and one still under the old worker is caught by the once-per-build guard above.
    const tookControl: boolean = await io.applyWaitingUpdate();
    if (!tookControl) debugLog('PWA', 'Kill switch: no waiting worker took control; reloading anyway');
  } catch (error: unknown) {
    debugLog('PWA', 'Kill switch: the service worker could not be updated first', error);
  }
  reloadKeepingDrafts(io.storage, io.reload);
}
