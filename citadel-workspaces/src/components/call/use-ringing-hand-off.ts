/**
 * A call ringing in a background tab says so where the user can see it: in
 * its own title, and in whichever other Citadel tab is in front. See
 * ringing-hand-off.ts for why the call itself does not move.
 */
import { useEffect } from 'react';
import { toast } from 'sonner';
import { eventEmitter } from '@/lib/event-emitter';
import { instanceChannel } from '@/lib/multi-instance';
import { rosterPeerName } from '@/lib/roster-peer-name';
import {
  RINGING_ELSEWHERE, handOffNotice, readRingingElsewhere, ringingTitle,
  type HandOffNotice, type RingingElsewhere,
} from '@/lib/call/ringing-hand-off';
import type { CallParticipant, CallState } from '@/lib/call/call-state';

function inFront(): boolean {
  return document.visibilityState === 'visible';
}

export function useRingingHandOff(selfCid: bigint | null, call: CallState | null): void {
  const ringing: boolean = call?.status === 'ringing-in';
  const callId: string | null = ringing && call ? call.callId : null;
  const caller: CallParticipant | undefined = ringing && call ? [...call.participants.values()][0] : undefined;
  const callerCid: bigint | null = caller?.cid ?? null;
  const callerUsername: string = caller?.username ?? '';

  // The ringing tab's half.
  useEffect(() => {
    if (selfCid === null || callId === null || callerCid === null) return;
    const callerName: string = rosterPeerName(callerCid) || callerUsername;
    const ownTitle: string = document.title;
    const send = (ringingHere: boolean): void => {
      const event: RingingElsewhere = { cid: selfCid, callId, callerName, ringing: ringingHere };
      instanceChannel.send({ type: RINGING_ELSEWHERE, targetInstanceId: '*', payload: event });
    };
    const announce = (): void => {
      const hidden: boolean = !inFront();
      document.title = hidden ? ringingTitle(callerName) : ownTitle;
      send(hidden);
    };
    announce();
    document.addEventListener('visibilitychange', announce);
    return (): void => {
      document.removeEventListener('visibilitychange', announce);
      document.title = ownTitle;
      send(false);
    };
  }, [selfCid, callId, callerCid, callerUsername]);

  // Every other tab's half. What is ringing elsewhere is kept, so a tab that
  // comes to the front while it still rings shows it: the post that announced
  // it may have arrived while this tab was in the background.
  useEffect(() => {
    const ringingElsewhere: Map<string, RingingElsewhere> = new Map<string, RingingElsewhere>();
    const show = (event: RingingElsewhere): void => {
      const notice: HandOffNotice = handOffNotice(event, selfCid, inFront());
      if (notice.kind === 'show') toast(notice.text, { id: notice.id, duration: Infinity });
      if (notice.kind === 'dismiss') toast.dismiss(notice.id);
    };
    const onFront = (): void => {
      if (inFront()) ringingElsewhere.forEach(show);
    };
    const off: () => void = eventEmitter.on(RINGING_ELSEWHERE, (payload: unknown): void => {
      const event: RingingElsewhere | null = readRingingElsewhere(payload);
      if (!event) return;
      if (event.ringing) ringingElsewhere.set(event.callId, event);
      else ringingElsewhere.delete(event.callId);
      show(event);
    });
    document.addEventListener('visibilitychange', onFront);
    return (): void => {
      off();
      document.removeEventListener('visibilitychange', onFront);
    };
  }, [selfCid]);
}
