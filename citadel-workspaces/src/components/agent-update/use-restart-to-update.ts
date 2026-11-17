/** Asking the agent to install the downloaded update and restart (`UpdateApply`). */
import { useCallback, useState } from 'react';
import { askUpdater } from '@/lib/agent-update/requests';
import { describeFailure } from '@/lib/failure-message';
import { CONNECTION_LOST } from '@/lib/websocket/request-response';

export type RestartPhase = { kind: 'idle' } | { kind: 'restarting' } | { kind: 'failed'; message: string };

export interface RestartControl {
  phase: RestartPhase;
  apply: () => void;
}

export function useRestartToUpdate(): RestartControl {
  const [phase, setPhase] = useState<RestartPhase>({ kind: 'idle' });
  const apply: () => void = useCallback((): void => {
    setPhase({ kind: 'restarting' });
    askUpdater('UpdateApply')
      .then((status): void => { if (status.last_error) setPhase({ kind: 'failed', message: status.last_error }); })
      // The agent restarting closes the socket before it can answer: that is the success case.
      .catch((e: unknown): void => {
        if (!String(e).includes(CONNECTION_LOST)) setPhase({ kind: 'failed', message: describeFailure(e, 'The update did not start.') });
      });
  }, []);
  return { phase, apply };
}
