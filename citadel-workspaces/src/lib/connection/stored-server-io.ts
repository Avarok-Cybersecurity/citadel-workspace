/** stored-server.ts's I/O for the connection manager: the agent, its state and store, and the sign-in hand-off. */
import type { ConnectionState } from './state';
import type { ConnectionIO } from './io';
import type { StoredSession } from '@/types/session-types';
import { storeSession } from './session-management';
import { removeSession } from './session-list';
import type { StoredServerIO } from './stored-server';
import { signInNeededFor } from '@/lib/sessions/sign-in-needed';

export function connectionStoredServerIO(state: ConnectionState, io: ConnectionIO): StoredServerIO {
  return {
    agentAccounts: () => io.agentAccounts(),
    backfill: async (filled: StoredSession): Promise<void> => {
      await storeSession(filled, state, io);
      await removeSession(filled.username, '', state, io);
    },
    signInNeeded: (username: string): void => { signInNeededFor.set(username); },
  };
}
