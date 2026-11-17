/**
 * Keeps the published Online Status choice on the user's member record equal
 * to the local setting, which is what this client obeys when it sends presence.
 *
 * Other members' clients can only honour a choice they can read (presence.ts
 * `shownPresence`), and the setting is per device while the record is per
 * account. So the choice is published when the switch changes, and again when
 * the user's own record arrives saying something else -- which is what a
 * sign-in produces for a record published elsewhere, or never.
 */

import WorkspaceService from '@/lib/workspace-service';
import { getPrivacySettings } from '@/lib/privacy-settings';
import { SHOWS_ONLINE_STATUS_WHEN_UNSET } from '@/lib/profile-privacy';
import { warnLog } from '@/lib/debug-config';

export interface OnlineStatusPublisher {
  publish: (shows: boolean) => Promise<void>;
  localChoice: () => boolean;
}

const workspacePublisher: OnlineStatusPublisher = {
  publish: (shows: boolean): Promise<void> => WorkspaceService.updateUserProfile({ showsOnlineStatus: shows }),
  localChoice: (): boolean => getPrivacySettings().showOnlineStatus,
};

export function publishOnlineStatus(shows: boolean): Promise<void> {
  return workspacePublisher.publish(shows);
}

let inFlight: boolean = false;

/**
 * Publishes the local choice when the own record's differs. One at a time:
 * the members list can arrive twice in quick succession, and a second write of
 * the same value would be noise, not a correction.
 */
export function reconcileOnlineStatusWith(publisher: OnlineStatusPublisher, published: boolean | undefined): void {
  const local: boolean = publisher.localChoice();
  if ((published ?? SHOWS_ONLINE_STATUS_WHEN_UNSET) === local || inFlight) return;
  inFlight = true;
  void publisher.publish(local)
    .catch((error: unknown): void => { warnLog('OnlineStatusPublication', 'could not publish Online Status:', error); })
    .finally((): void => { inFlight = false; });
}

export function reconcileOnlineStatus(published: boolean | undefined): void {
  reconcileOnlineStatusWith(workspacePublisher, published);
}
