/**
 * Whether a zone's app should be running or suspended, and why, from what the page observes: the
 * zone in or out of view, the page visible or in the background, the page kept for back/forward.
 * Pure; zone-watchers.ts is where the page's observers feed it.
 */
import type { SuspendReason } from '../sdk/generated/SuspendReason';

export class ZonePresence {
  /** In view until an observer says otherwise: a zone is mounted where it is seen. */
  inView: boolean = true;
  pageVisible: boolean = true;
  /** pagehide with `persisted`: the page sits in the back/forward cache until pageshow. */
  kept: boolean = false;

  /** Null: it should run. Otherwise why it should be suspended; the page's reason outranks the zone's. */
  get reason(): SuspendReason | null {
    if (!this.pageVisible || this.kept) return 'backgrounded';
    if (!this.inView) return 'hidden';
    return null;
  }
}
