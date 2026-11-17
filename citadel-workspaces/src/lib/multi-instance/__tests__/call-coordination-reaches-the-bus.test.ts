/**
 * Call coordination between tabs -- answered elsewhere, ringing in a hidden
 * tab, a call tab closing -- arrives on the receiving tab's bus unchanged,
 * where the call hooks listen for it.
 */
import { describe, it, expect } from 'vitest';
import { dispatchChannelMessage } from '../channel-message-dispatch';
import { eventEmitter } from '../../event-emitter';
import { CALL_TAKEN } from '@/lib/call/call-taken-elsewhere';
import { RINGING_ELSEWHERE } from '@/lib/call/ringing-hand-off';
import { CALL_DEPARTED } from '@/lib/call/call-departure';
import type { ChannelMessage } from '../channel-types';
import type { LeaderElectionState } from '../channel-leader-election';

describe('the instance channel', () => {
  it.each([CALL_TAKEN, RINGING_ELSEWHERE, CALL_DEPARTED])('puts %s on this tab\'s bus', (type) => {
    const seen: unknown[] = [];
    const off: () => void = eventEmitter.on(type, (p: unknown): void => { seen.push(p); });
    const message: ChannelMessage = { type, targetInstanceId: '*', senderInstanceId: 'other', timestamp: 0, payload: { cid: 4n } };
    dispatchChannelMessage(message, {} as LeaderElectionState, () => {});
    off();
    expect(seen).toEqual([{ cid: 4n }]);
  });
});
