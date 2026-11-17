/**
 * Turning the stored sessions into the switcher's list, and picking the active one.
 *
 * Extracted from useWorkspaceSwitcher because it is the whole decision and none
 * of the I/O: which sessions become rows, which row is "you are here", and the
 * precedence between the tab's own selection and the connection's CID. Testable
 * without a connection manager, an IndexedDB read or a React render.
 */

import type { ActiveSession, StoredSession } from '@/types/session-types';
import { dialledHost, sessionHost, sessionIsOnServer } from '@/lib/sessions/same-server';
import { liveSessionCid } from '@/lib/sessions/live-session-cid';

export interface StoredWorkspace {
  id: string;
  username: string;
  serverAddress: string;
  workspaceName?: string;
  isActive: boolean;
  cid?: bigint;
  fullName?: string;
  /** The role's name, as last seen there. */
  role?: string;
  /** Known to hold ManageRoles there. */
  administers: boolean;
  /** Whether the agent holds a session for it; null when the agent has not answered. */
  signedIn: boolean | null;
}


/** The tab's own selection, which outranks the connection's CID. */
export interface TabSelection {
  selectedUsername?: string;
  selectedServerAddress?: string;
}

export function toStoredWorkspaces(
  sessions: readonly StoredSession[],
  workspaceName: string | undefined,
  currentCid: bigint | null,
): StoredWorkspace[] {
  return sessions.map((session) => ({
    id: `${session.serverAddress}-${session.username}`,
    username: session.username,
    serverAddress: session.serverAddress,
    workspaceName: workspaceName || session.username,
    isActive: session.cid === currentCid,
    cid: session.cid,
    fullName: session.fullName,
    role: session.role,
    administers: session.administers === true,
    // Saved is not signed in: only the agent's answer says that (switcherWorkspaces).
    signedIn: null,
  }));
}

/**
 * The tab's selection wins over the connected CID.
 *
 * With several sessions on one WebSocket the connection's CID is whichever
 * session the shared client last touched — not necessarily this tab's. Reading
 * it first would swap the switcher's label out from under the user when another
 * tab connected.
 */
export function pickCurrentWorkspace(
  workspaces: readonly StoredWorkspace[],
  tabSelection: TabSelection | null | undefined,
): StoredWorkspace | undefined {
  const selected: StoredWorkspace | undefined = tabSelection?.selectedUsername
    ? workspaces.find(
        (w) =>
          w.username === tabSelection.selectedUsername &&
          w.serverAddress === tabSelection.selectedServerAddress,
      )
    : undefined;
  return selected ?? workspaces.find((w) => w.isActive);
}

/**
 * The switcher's rows: saved accounts, plus every session the agent holds live that no
 * saved account covers.
 *
 * Saved accounts alone were the list, and a session resumed by claim is never saved: on
 * a second org, the other org's live sessions were unreachable from here (measured live).
 * A row is labelled with the current workspace's name only on the current server; any
 * other server is labelled by its host, since its name is not known here -- it said the
 * current org's name for every group.
 */
export function switcherWorkspaces(
  stored: readonly StoredSession[],
  /** The agent's sessions, or null when it did not answer. */
  live: readonly ActiveSession[] | null,
  workspaceName: string | undefined,
  currentCid: bigint | null,
): StoredWorkspace[] {
  const saved: StoredWorkspace[] = toStoredWorkspaces(stored, workspaceName, currentCid).map(
    (row: StoredWorkspace): StoredWorkspace => withAgentAnswer(row, live),
  );
  const liveOnly: StoredWorkspace[] = (live ?? [])
    .filter((session: ActiveSession) => !stored.some((s: StoredSession) => s.username === session.username && sessionIsOnServer(session, s.serverAddress)))
    .map((session: ActiveSession): StoredWorkspace => {
      const host: string = sessionHost(session);
      return {
        id: `${host}-${session.username}`,
        username: session.username,
        serverAddress: host,
        workspaceName: host,
        isActive: session.cid === currentCid,
        // Never saved, so nothing has recorded their standing there.
        administers: false,
        signedIn: true,
        cid: session.cid,
        fullName: session.full_name,
      };
    });
  const rows: StoredWorkspace[] = [...saved, ...liveOnly];
  const current: StoredWorkspace | undefined = rows.find((row: StoredWorkspace) => row.isActive);
  return rows.map((row: StoredWorkspace): StoredWorkspace => {
    const onCurrent: boolean = current !== undefined && dialledHost(row.serverAddress) === dialledHost(current.serverAddress);
    return { ...row, workspaceName: onCurrent ? (workspaceName || row.username) : dialledHost(row.serverAddress) };
  });
}

/** A saved row as the agent sees it: signed in under the CID it holds, or signed out. */
function withAgentAnswer(row: StoredWorkspace, live: readonly ActiveSession[] | null): StoredWorkspace {
  if (live === null) return row;
  const cid: bigint | undefined = liveSessionCid(live, row);
  return cid === undefined ? { ...row, signedIn: false } : { ...row, signedIn: true, cid };
}

export type SwitchPlan =
  | { kind: 'switch'; cid: bigint }
  /** The agent holds no session for the account: claiming its saved CID can only be refused. */
  | { kind: 'sign-in' }
  | { kind: 'no-cid' };

/**
 * Where a click on a row goes, read against the agent's list at the moment of the
 * click. A saved CID is tried only when the agent could not be asked; when it was
 * asked and did not name the account, that is the answer.
 */
export function planSwitch(
  row: Pick<StoredWorkspace, 'username' | 'serverAddress' | 'cid'>,
  live: readonly ActiveSession[] | null,
  storedCid: bigint | undefined,
): SwitchPlan {
  if (live !== null) {
    const cid: bigint | undefined = liveSessionCid(live, row);
    return cid === undefined ? { kind: 'sign-in' } : { kind: 'switch', cid };
  }
  const cid: bigint | undefined = storedCid ?? row.cid;
  return cid === undefined ? { kind: 'no-cid' } : { kind: 'switch', cid };
}
