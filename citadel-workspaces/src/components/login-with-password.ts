/**
 * The one password login, shared by the password form and passkey unlock.
 *
 * Moved out of `useLoginHandler` (an exact move of its connect body, now that
 * two callers need it) so a passkey sign-in reaches the agent through the very
 * Connect a typed password does: the password comes from the envelope instead
 * of the keyboard, and nothing past this point can tell the difference.
 */
// Imported for its side effect: it is the listener for the 'session:activated' this
// module emits. Signed in from a freshly loaded landing page, nothing else had loaded
// it yet, the event reached nobody, and the P2P registry never started (live: presence
// unknown for everyone, peer lists empty, on every password sign-in).
import '@/lib/session-startup-service';
import { isConnectAlreadyInProgress } from '@/lib/connection/is-connect-in-progress';
import { websocketService } from "@/lib/websocket-service";
import { connectionManager } from "@/lib/connection";
import { eventEmitter } from "@/lib/event-emitter";
import { startMessagingForSession } from "@/lib/start-messaging";
import { postAuthSetup } from '@/lib/post-auth-setup';
import { setSelectedUser } from "@/lib/tab-context";
import { debugLog } from '@/lib/debug-config';
import { awaitConnectOutcome, type ConnectOutcome } from '@/lib/connection/await-connect-outcome';
import { mapSecuritySettings, type SessionSecuritySettings } from '@/lib/security-utils';
import type { StoredSessions, StoredSession, ActiveSession } from '@/types/session-types';
import { sessionLabel, type SessionLabel } from '@/lib/sessions/session-label';
import type { SecuritySettingsState } from './useLoginHandler';
import { watchKeyChallenges } from '@/lib/sign-in/challenge-watch';
import type { SignInFactors } from '@/lib/sign-in/types';
import { readAgentAccounts, type AgentAccount } from '@/lib/admission/account-servers';
import { askStoredAccounts } from '@/lib/stored-accounts';
import { requireSignInServer } from '@/lib/sessions/sign-in-server';
import { connectRefusal } from '@/lib/connection/connect-refusal';

export type LoginResult =
  | { kind: 'signed-in'; cid: bigint; messagingReady: boolean; serverAddress: string }
  /**
   * A recovery code opened a restricted session: it may only add a key, set the
   * policy or sign out, so nothing that would use the workspace is started.
   */
  | { kind: 'recovery'; cid: bigint; serverAddress: string }
  /** An existing session was claimed instead; the redirect has already run. */
  | { kind: 'redirected' };

export interface LoginContext {
  redirect: (session: { cid: bigint; username: string; server_address: string }) => Promise<void>;
}

const CONNECT_TIMEOUT_MS: 30000 = 30000;

/**
 * `scope`: the server the form is scoped to, or null. The Connect names the server the
 * agent's account of this username is on, and only when that is the scoped one; otherwise
 * it is refused here, typed, before anything is sent (sign-in-server.ts).
 */
export async function loginWithPassword(
  ctx: LoginContext, username: string, factors: SignInFactors, securitySettings: SecuritySettingsState, scope: string | null,
): Promise<LoginResult> {
  const agentAccounts: AgentAccount[] = await askStoredAccounts(readAgentAccounts);
  // Labels the stored session (the label comes from the agent once it has answered, see
  // session-label), and names the server when an older agent reports none.
  const storedSessions: StoredSessions = connectionManager.getStoredSessions();
  const storedSession: StoredSession | undefined = storedSessions.sessions.find(s => s.username === username.trim());
  const server: string = requireSignInServer(agentAccounts, username, scope, storedSession?.serverAddress.trim() || null);
  const labelFor = async (cid: bigint): Promise<SessionLabel> => {
    connectionManager.invalidateSessionCache();
    const live: ActiveSession[] = await connectionManager.getActiveSessions();
    return sessionLabel(cid, username.trim(), live, storedSession);
  };

  const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
  const outcomePromise: Promise<ConnectOutcome> = awaitConnectOutcome(requestId, CONNECT_TIMEOUT_MS);
  // A PasswordAndKey or KeyOnly account asks this window for a touch mid-Connect.
  const unwatch: () => void = watchKeyChallenges(requestId);

  // The settings the user actually chose, not the defaults: `auth-operations`
  // fills `undefined` with `getDefaultSecuritySettings()`, so every choice made
  // in the Security Settings dialog used to die in the hook's state.
  const chosenSettings: SessionSecuritySettings = mapSecuritySettings(securitySettings);
  let outcome: ConnectOutcome;
  try {
    try {
      await websocketService.connect(requestId, username, server, factors, chosenSettings);
    } catch (error) {
      // Nothing will answer a request that was never sent; its timeout must not
      // surface later as an unhandled rejection.
      const _unanswered: Promise<unknown> = outcomePromise.catch((): undefined => undefined);
      throw error;
    }
    outcome = await outcomePromise;
  } finally {
    unwatch();
  }

  if (outcome.kind === 'already-active') {
    // The agent verified the password against the live session: claim it.
    debugLog('Login', `SessionAlreadyActive - ${outcome.message}`);
    const { serverAddress } = await labelFor(outcome.cid);
    await ctx.redirect({ cid: outcome.cid, username: outcome.username || username.trim(), server_address: serverAddress });
    return { kind: 'redirected' };
  }
  if (outcome.kind === 'failed') {
    if (outcome.reasonCode !== null) throw connectRefusal(outcome, username);
    if (!isConnectAlreadyInProgress(outcome.message)) throw new Error(outcome.message);
    if (outcome.cid && outcome.cid !== 0n) {
      const { serverAddress } = await labelFor(outcome.cid);
      await ctx.redirect({ cid: outcome.cid, username: username.trim(), server_address: serverAddress });
      return { kind: 'redirected' };
    }
    let sessions: ActiveSession[];
    try { sessions = await connectionManager.getActiveSessions(); } catch { throw new Error(outcome.message); }
    const match: ActiveSession | undefined = sessions.find(s => s.username === username.trim());
    if (match?.cid === undefined) throw new Error(outcome.message);
    await ctx.redirect({ cid: match.cid, username: match.username ?? username.trim(), server_address: match.server_address });
    return { kind: 'redirected' };
  }

  const cid: bigint = outcome.cid;
  const { serverAddress, fullName } = await labelFor(cid);
  if (factors.recoveryCode !== null) return { kind: 'recovery', cid, serverAddress };
  await connectionManager.handleAuthSuccess({
    username, fullName, serverAddress,
    // Stored as chosen too. Persisting the defaults here meant every
    // reconnect silently downgraded to them as well.
    securitySettings: chosenSettings, cid,
  });

  await setSelectedUser({ selectedUsername: username.trim(), selectedServerAddress: serverAddress, selectedCid: cid });
  await postAuthSetup(cid);

  const messagingReady: boolean = await startMessagingForSession(cid.toString());

  eventEmitter.emit('session:activated', {
    cid: cid.toString(), username: username.trim(),
    serverAddress, activationType: 'login',
  });
  return { kind: 'signed-in', cid, messagingReady, serverAddress };
}
