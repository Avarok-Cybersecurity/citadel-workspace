/**
 * Tab-close lifecycle policy for the instance channel.
 *
 * Owns the decision made when the page goes away: if this is the LAST tab
 * holding a CID, the session must be released (directly when leader, via the
 * leader otherwise) before the goodbye goes out. Split from instance-channel.ts
 * so the channel stays transport wiring and this policy is legible on its own.
 *
 * On `pagehide`, not `beforeunload`, which it used to be:
 * - `beforeunload` can be cancelled. The editor's unsaved-changes guard
 *   (use-unsaved-mdx-guard) prompts from it, and a user who chose Stay kept a
 *   tab that had already said goodbye and released its session.
 * - It does not fire on much of mobile Safari, nor when a page enters the
 *   back/forward cache, so those tabs never said goodbye and the leader kept
 *   their CIDs.
 * `pagehide` fires however a document goes away. With `persisted` set the page
 * is kept in the bfcache and may come back: it says goodbye and gives up
 * leadership (a frozen tab can answer nothing) but keeps its session, and on
 * `pageshow` from the cache it announces itself again.
 */

import { eventEmitter } from '../event-emitter';
import { instanceManager } from './instance-manager';
import { debugLog, errorLog } from '@/lib/debug-config';
import { runDepartureSteps } from './departure-steps';
import type { ChannelMessage } from './channel-types';
import type { InstanceInfo } from '@/lib/multi-instance/instance-manager-types';

export interface UnloadChannel {
  send(message: Omit<ChannelMessage, 'senderInstanceId' | 'timestamp'>): void;
  announceGoodbye(): void;
  relinquishLeadership(): void;
  announcePresence(): void;
  broadcastCid(): void;
}

function releaseIfLastTab(channel: UnloadChannel): void {
  const myCid: bigint | null = instanceManager.cid;
  if (!myCid) return;
  const otherInstancesWithSameCid: InstanceInfo[] = instanceManager.getAllInstances()
    .filter(i => i.instanceId !== instanceManager.instanceId && i.cid === myCid);
  if (otherInstancesWithSameCid.length > 0) return;

  debugLog('InstanceChannel', `[InstanceChannel] Last tab with CID ${myCid} closing, releasing session`);
  if (instanceManager.isLeader) {
    eventEmitter.emit('session:release-request', { cid: myCid });
  } else {
    channel.send({ type: 'session-release', targetInstanceId: 'leader', payload: { cid: myCid } });
  }
}

/** The page lifecycle events this listens to; `window` in the app. */
export type PageEvents = Pick<Window, 'addEventListener'>;

export function setupPageDepartureHandlers(channel: UnloadChannel, page: PageEvents): void {
  page.addEventListener('pagehide', (event: PageTransitionEvent): void => {
    // Hand-overs first: the release below takes the session off the leader's connection.
    runDepartureSteps((error: unknown): void => errorLog('InstanceChannel', 'a departure step failed:', error));
    if (event.persisted) {
      debugLog('InstanceChannel', '[InstanceChannel] Entering the back/forward cache: leaving, keeping the session');
      // Relinquishing broadcasts the goodbye itself; a follower only needs the goodbye.
      if (instanceManager.isLeader) channel.relinquishLeadership();
      else channel.announceGoodbye();
      return;
    }
    releaseIfLastTab(channel);
    channel.announceGoodbye();
  });

  page.addEventListener('pageshow', (event: PageTransitionEvent): void => {
    if (!event.persisted) return;
    debugLog('InstanceChannel', '[InstanceChannel] Restored from the back/forward cache: announcing again');
    channel.announcePresence();
    channel.broadcastCid();
  });
}
