/**
 * Several tabs of one account ringing for one call: the one that answers or
 * declines tells the rest, and the rest stand down. See call-taken-elsewhere.ts.
 */
import { useCallback, useEffect, type MutableRefObject } from 'react';
import { toast } from 'sonner';
import { eventEmitter } from '@/lib/event-emitter';
import { instanceChannel } from '@/lib/multi-instance';
import { CALL_TAKEN, readCallTaken, standsDown, type CallTaken } from '@/lib/call/call-taken-elsewhere';
import type { CallManager } from '@/lib/call/call-manager';
import type { CallState } from '@/lib/call/call-state';

export const ANSWERED_ELSEWHERE: string = 'This call was answered in another Citadel tab.';

export function useCallTakenElsewhere(
  selfCid: bigint | null,
  managerRef: MutableRefObject<CallManager | null>,
): (callId: string, answered: boolean) => void {
  useEffect(() => {
    return eventEmitter.on(CALL_TAKEN, (payload: unknown): void => {
      const taken: CallTaken | null = readCallTaken(payload);
      const manager: CallManager | null = managerRef.current;
      const state: CallState | null = manager?.getState() ?? null;
      if (!taken || !manager || !state || state.caller === null || !standsDown(taken, selfCid, state)) return;
      // Ended here as the caller leaving would end it: locally, with nothing
      // sent. A CallEnd or CallDecline from THIS tab would reach the caller and
      // undo what the user just chose in the other one.
      void manager.handleSignal(state.caller, '', { kind: 'CallEnd', call_id: state.callId, reason: 'hangup' });
      if (taken.answered) toast(ANSWERED_ELSEWHERE);
    });
  }, [selfCid, managerRef]);

  return useCallback(
    (callId: string, answered: boolean): void => {
      if (selfCid === null) return;
      const taken: CallTaken = { cid: selfCid, callId, answered };
      instanceChannel.send({ type: CALL_TAKEN, targetInstanceId: '*', payload: taken });
    },
    [selfCid],
  );
}
