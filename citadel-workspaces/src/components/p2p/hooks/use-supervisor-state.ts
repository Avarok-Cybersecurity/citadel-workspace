/**
 * What the agent's supervisor is doing about this session's link to a peer,
 * for the chat header: re-read each time it reports a change.
 */
import { useEffect, useState } from 'react';
import { eventEmitter } from '@/lib/event-emitter';
import { SUPERVISOR_STATUS_EVENT, supervisorStateFor } from '@/lib/agent-supervisor/status';
import type { SupervisorState } from '@/types/agent-supervisor';

export function useSupervisorState(sessionCid: bigint | null, peerCid: bigint): Exclude<SupervisorState, 'healed'> | null {
  const [state, setState] = useState<Exclude<SupervisorState, 'healed'> | null>(() => supervisorStateFor(sessionCid, peerCid));
  useEffect(() => {
    const refresh = (): void => setState(supervisorStateFor(sessionCid, peerCid));
    refresh();
    return eventEmitter.on(SUPERVISOR_STATUS_EVENT, refresh) as () => void;
  }, [sessionCid, peerCid]);
  return state;
}
