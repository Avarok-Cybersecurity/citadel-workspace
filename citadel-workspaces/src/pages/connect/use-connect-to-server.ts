/**
 * Connecting to a chosen server from the Connect page.
 *
 * This page is where `WorkspaceLoader` sends a user whose connection died — it
 * is the app's designated recovery route. It could not recover anyone.
 *
 * The only authenticated branch tested `session.cid` on the STORED session, but
 * `ConnectionManager.initialize` deliberately clears every stored CID on each
 * load ("Clearing stored CIDs to force fresh connection") and persists that. So
 * after any page load the branch was dead, and the fallthrough navigated into
 * the workspace with no session at all: the loader found zero active sessions,
 * its 5s timer fired, and it sent the user back here. A silent five-second
 * bounce, repeatable forever, at exactly the moment they were already stuck.
 *
 * What actually recovers a user is the live session list on the internal
 * service, which is where a surviving session lives after a page reload — the
 * same list `useOrphanSessions` claims from. If nothing is there, nothing on
 * this device can sign one back in (no credential is kept), so it says so and
 * routes to sign-in rather than into a workspace that will bounce them straight back.
 */
// Imported for its side effect: the listener for the 'session:activated' emitted below.
import '@/lib/session-startup-service';
import { eventEmitter } from '@/lib/event-emitter';
import { connectionManager } from '@/lib/connection';
import { claimSessionForThisTab } from '@/lib/sessions/claim-session';
import { postAuthSetup } from '@/lib/post-auth-setup';
import { setSelectedUser } from '@/lib/tab-context';
import { instanceManager, instanceChannel } from '@/lib/multi-instance';
import type { StoredSession } from '@/types/session-types';
import type { SessionInformation } from 'citadel-workspace-client-ts';
import { sessionIsOnServer } from '@/lib/sessions/same-server';

export type ConnectOutcome =
  | { kind: 'connected'; cid: bigint }
  | { kind: 'needs-sign-in'; reason: string };

async function findSessionForServer(serverAddress: string): Promise<SessionInformation | null> {
  connectionManager.invalidateSessionCache();
  const sessions: SessionInformation[] = await connectionManager.getActiveSessions();
  return sessions.find((s) => sessionIsOnServer(s, serverAddress)) ?? null;
}

/**
 * Adopt an existing session into this tab. Mirrors the orphan-claim path in
 * `useOrphanSessions` step for step — including `setSelectedUser`, which the
 * Connect page's old claim branch omitted, leaving the tab's identity for the
 * loader to guess at from `activeSessions[0]`.
 */
async function adoptSession(session: SessionInformation): Promise<void> {
  await claimSessionForThisTab(session.cid);
  const stored: StoredSession[] = connectionManager.getStoredSessionsArray();
  const index: number = stored.findIndex(
    (s) => s.username === session.username && sessionIsOnServer(session, s.serverAddress),
  );
  if (index >= 0) await connectionManager.setActiveSessionIndex(index);

  await setSelectedUser({
    selectedUsername: session.username,
    selectedServerAddress: session.server_address,
    selectedCid: session.cid,
  });

  instanceManager.setCid(session.cid);
  instanceChannel.announcePresence();

  await postAuthSetup(session.cid);
  eventEmitter.emit('session:activated', {
    cid: session.cid.toString(), username: session.username,
    serverAddress: session.server_address, activationType: 'claim',
  });
}

export async function connectToServer(serverAddress: string): Promise<ConnectOutcome> {
  const live: SessionInformation | null = await findSessionForServer(serverAddress);
  if (live) {
    await adoptSession(live);
    return { kind: 'connected', cid: live.cid };
  }

  const stored: StoredSession | undefined = connectionManager
    .getStoredSessionsArray()
    .find((s) => s.serverAddress === serverAddress);

  if (!stored) {
    return {
      kind: 'needs-sign-in',
      reason: `No session for ${serverAddress} is still open, and there are no saved credentials for it.`,
    };
  }
  return {
    kind: 'needs-sign-in',
    reason: `Your session on ${serverAddress} has ended. Sign in again to open it.`,
  };
}
