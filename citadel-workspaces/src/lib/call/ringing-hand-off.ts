/**
 * A call ringing in a tab the user cannot see.
 *
 * The call rings in the tab whose session is called, and nowhere else: that is
 * where its media will live. When that tab is in the background the card is
 * invisible, so the tab says so in two places the user CAN see -- its own
 * title in the tab strip, and a notice in whichever other Citadel tab is in
 * front -- and the user goes to it. The call is not moved: a MediaStream
 * cannot cross tabs, and answering anywhere else would capture twice.
 */
export const RINGING_ELSEWHERE: 'call-ringing-elsewhere' = 'call-ringing-elsewhere';

export interface RingingElsewhere {
  /** The called session; a tab of that same session rings by itself. */
  cid: bigint;
  callId: string;
  callerName: string;
  /** False once the ringing tab is in front again, answered, or the call ended. */
  ringing: boolean;
}

export type HandOffNotice =
  | { kind: 'show'; id: string; text: string }
  | { kind: 'dismiss'; id: string }
  | { kind: 'none' };

export function ringingTitle(callerName: string): string {
  return `Incoming call · ${callerName}`;
}

function noticeId(callId: string): string {
  return `call-ringing-elsewhere-${callId}`;
}

/** What a tab that is NOT ringing shows for another tab's hidden ringing. */
export function handOffNotice(event: RingingElsewhere, selfCid: bigint | null, inFront: boolean): HandOffNotice {
  const id: string = noticeId(event.callId);
  if (!event.ringing) return { kind: 'dismiss', id };
  if (selfCid !== null && selfCid === event.cid) return { kind: 'none' };
  if (!inFront) return { kind: 'none' };
  return {
    kind: 'show',
    id,
    text: `${event.callerName} is calling you in another Citadel tab. Switch to the tab titled “Incoming call” to answer.`,
  };
}

/** A 'call-ringing-elsewhere' channel payload, or null for anything else. */
export function readRingingElsewhere(payload: unknown): RingingElsewhere | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p: Record<string, unknown> = payload as Record<string, unknown>;
  if (typeof p.cid !== 'bigint' || typeof p.callId !== 'string') return null;
  if (typeof p.callerName !== 'string' || typeof p.ringing !== 'boolean') return null;
  return { cid: p.cid, callId: p.callId, callerName: p.callerName, ringing: p.ringing };
}
