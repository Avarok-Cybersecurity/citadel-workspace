/**
 * "Open here too": join a session another window holds, then open it in this
 * tab exactly as switching to any session does.
 *
 * The join is the only new step. Opening goes through `switchToSession`, whose
 * claim now finds the session held by this connection too and adopts it -- one
 * sequence for every way into a session, not a second copy of it here.
 */
import { connectionManager } from '@/lib/connection';
import { withoutForgotten } from './forgotten-sessions';
import { withWorkspaceNames } from './with-workspace';
import { readLastAccessed } from './last-accessed';
import { browserAttach, joinWithPassword } from './attach-session';
import { switchToSession, type SwitchCallbacks, type SwitchTarget } from './switch-to-session';

export interface OpenHereTooDeps {
  findTarget: (username: string) => Promise<SwitchTarget | null>;
  join: (cid: bigint, password: string) => Promise<unknown>;
  open: (target: SwitchTarget) => Promise<void>;
}

export async function openHereToo(deps: OpenHereTooDeps, username: string, password: string): Promise<void> {
  const target: SwitchTarget | null = await deps.findTarget(username);
  if (!target) throw new Error(`${username} is no longer signed in to the Citadel agent on this computer`);
  await deps.join(target.cid, password);
  await deps.open(target);
}

/** This browser's: the agent's session list, its socket, and the switch sequence. */
export function browserOpenHereToo(callbacks: SwitchCallbacks): OpenHereTooDeps {
  return {
    findTarget: async (username: string): Promise<SwitchTarget | null> => {
      const { ok, sessions } = await connectionManager.getActiveSessionsResult();
      if (!ok) throw new Error('The Citadel agent did not list its sessions');
      const named: SwitchTarget[] = withWorkspaceNames(withoutForgotten(sessions), connectionManager.getStoredSessions().sessions, readLastAccessed);
      return named.find((s: SwitchTarget) => s.username === username) ?? null;
    },
    join: (cid: bigint, password: string) => joinWithPassword(browserAttach, cid, password),
    open: (target: SwitchTarget) => switchToSession(target, callbacks),
  };
}
