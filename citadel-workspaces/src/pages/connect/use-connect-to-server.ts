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
 * same list `useOrphanSessions` claims from. If nothing is there, auto-connect
 * is asked to re-establish one from stored credentials. Only if BOTH fail does
 * this give up, and then it says so and routes to sign-in rather than into a
 * workspace that will bounce them straight back.
 */
// Imported for its side effect: the listener for the 'session:activated' emitted below.
import '@/lib/session-startup-service';
import { eventEmitter } from '@/lib/event-emitter';
import { connectionManager } from '@/lib/connection';
import { claimSessionForThisTab, SESSION_OWNED_ELSEWHERE , type ClaimOutcome } from '@/lib/sessions/claim-session';
import { postAuthSetup } from '@/lib/post-auth-setup';
import { setSelectedUser } from '@/lib/tab-context';
import { instanceManager, instanceChannel } from '@/lib/multi-instance';
import { debugLog } from '@/lib/debug-config';
import type { ActiveSession, StoredSession } from '@/types/session-types';
import { sessionIsOnServer } from '@/lib/sessions/same-server';

/** How long to wait for auto-connect to produce a session before giving up. */
const RECONNECT_WAIT_MS: number = 8000;
const RECONNECT_POLL_MS: number = 500;

export type ConnectOutcome =
  | { kind: 'connected'; cid: bigint }
  | { kind: 'needs-sign-in'; reason: string };

async function findSessionForServer(serverAddress: string): Promise<ActiveSession | null> {
  connectionManager.invalidateSessionCache();
  const sessions: ActiveSession[] = await connectionManager.getActiveSessions();
  return sessions.find((s) => sessionIsOnServer(s, serverAddress)) ?? null;
}

async function waitForSession(serverAddress: string): Promise<ActiveSession | null> {
  const deadline: number = Date.now() + RECONNECT_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, RECONNECT_POLL_MS));
    const found: ActiveSession | null = await findSessionForServer(serverAddress);
    if (found) return found;
  }
  return null;
}

/**
 * Adopt an existing session into this tab. Mirrors the orphan-claim path in
 * `useOrphanSessions` step for step — including `setSelectedUser`, which the
 * Connect page's old claim branch omitted, leaving the tab's identity for the
 * loader to guess at from `activeSessions[0]`.
 */
async function adoptSession(session: ActiveSession): Promise<void> {
  const outcome: ClaimOutcome = await claimSessionForThisTab(session.cid);
  if (outcome.status === 'owned-by-another-tab') {
    // Thrown rather than toasted: this is a module function with no toast in
    // scope, and its callers already surface what it throws. Returning quietly
    // would leave the caller believing the session was adopted.
    throw new Error(SESSION_OWNED_ELSEWHERE.description);
  }

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
  const live: ActiveSession | null = await findSessionForServer(serverAddress);
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
  if (!stored.password) {
    // The user declined "Remember Credentials", so there is nothing to sign in
    // with on their behalf. Say that rather than spinning.
    return {
      kind: 'needs-sign-in',
      reason: `Your session on ${serverAddress} has ended, and credentials were not saved for it.`,
    };
  }

  debugLog('Connect', `No live session for ${serverAddress}; asking auto-connect to re-establish one`);
  await connectionManager.triggerAutoConnect();

  const revived: ActiveSession | null = await waitForSession(serverAddress);
  if (revived) {
    await adoptSession(revived);
    return { kind: 'connected', cid: revived.cid };
  }

  return {
    kind: 'needs-sign-in',
    reason: `Could not re-establish a session on ${serverAddress}.`,
  };
}
