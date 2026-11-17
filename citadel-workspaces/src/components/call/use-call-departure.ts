/**
 * The tab a call lives in, closing: the peer is told, not left to time out.
 * See call-departure.ts.
 */
import { useEffect, type MutableRefObject } from 'react';
import { eventEmitter } from '@/lib/event-emitter';
import { instanceChannel, instanceManager } from '@/lib/multi-instance';
import { warnLog } from '@/lib/debug-config';
import { CALL_DEPARTED, departureOf, endForDepartedTab, readCallDeparted, type CallDeparted } from '@/lib/call/call-departure';
import { addDepartureStep } from '@/lib/multi-instance/departure-steps';
import { holdRelease } from '@/lib/multi-instance/release-holds';
import { WebSocketCallTransport } from '@/lib/call/websocket-call-transport';
import type { CallManager } from '@/lib/call/call-manager';
import type { MessageSenderConfig } from '@/lib/p2p/message-sender-types';

export function useCallDeparture(
  selfCid: bigint | null,
  senderConfig: MessageSenderConfig,
  managerRef: MutableRefObject<CallManager | null>,
): void {
  useEffect(() => {
    const onPageHide = (): void => {
      const manager: CallManager | null = managerRef.current;
      const departed: CallDeparted | null = departureOf(manager?.getState() ?? null, selfCid);
      if (!manager || !departed) return;
      // The leader's own socket closes with it: nobody is left to hand to, so
      // it starts its own hang-up and the peer's heartbeat timeout backs it.
      if (instanceManager.isLeader) {
        void manager.end('hangup');
        return;
      }
      instanceChannel.send({ type: CALL_DEPARTED, targetInstanceId: 'leader', payload: departed });
    };
    // A departure step, not a pagehide listener: it must reach the leader before the
    // session-release that the channel sends on the same pagehide (departure-steps.ts).
    const removeStep: () => void = addDepartureStep(onPageHide);
    const off: () => void = eventEmitter.on(CALL_DEPARTED, (payload: unknown): void => {
      const departed: CallDeparted | null = readCallDeparted(payload);
      if (!departed || !instanceManager.isLeader) return;
      // The release that follows waits for this goodbye (release-holds.ts).
      holdRelease(departed.cid, endForDepartedTab(payload, {
        isLeader: (): boolean => instanceManager.isLeader,
        transportFor: (cid: bigint): WebSocketCallTransport => new WebSocketCallTransport({ selfCid: cid, senderConfig }),
        reportFailure: (peerCid: bigint, error: unknown): void =>
          warnLog('Call', `could not end a closed tab's call with ${peerCid}:`, error instanceof Error ? error.message : String(error)),
      }));
    });
    return (): void => {
      removeStep();
      off();
    };
  }, [selfCid, senderConfig, managerRef]);
}
