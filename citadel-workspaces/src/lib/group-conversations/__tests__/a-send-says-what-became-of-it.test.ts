/**
 * Each of the reader's own peer-group messages says what the server did with it.
 *
 * The server answers a send with a delivery report naming the send's request: who has it now,
 * who it is held for, who it will not reach and why -- or that it was not relayed at all, or was
 * refused. The send minted the message's id, so the request is joined to it when the request
 * goes out, and the bubble shows the latest answer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GroupDelivery } from '@avarok/citadel-protocol-types';

const sent: Array<Record<string, unknown>> = [];

// The two I/O edges of a send: the socket it goes out on, and the session it is sent as.
vi.mock('@/lib/websocket-service', () => ({
  websocketService: { sendMessage: async (request: Record<string, unknown>): Promise<void> => { sent.push(request); } },
}));
vi.mock('../../connection', () => ({
  connectionManager: { getConnectionInfo: (): { cid: bigint } => ({ cid: 7n }) },
}));

const { sendPeerGroupMessage } = await import('../group-requests');
const { toGroupEvents } = await import('../group-events');
const { forgetSendOutcomes, recordSendOutcome, sendOutcomeOf } = await import('../group-send-outcomes');
const { sendOutcomeNote } = await import('../group-send-outcome');
type Outcome = import('../group-send-outcome').GroupSendOutcome;

const names: Record<string, string> = { '8': 'bea', '9': 'cy' };
const nameOf = (cid: bigint): string => names[cid.toString()] ?? `cid-${cid.toString()}`;
const KEY: { cid: bigint; mgid: bigint } = { cid: 7n, mgid: 42n };

function requestIdOfLastSend(): string {
  return (sent[sent.length - 1].GroupMessage as { request_id: string }).request_id;
}

/** The server's report, through the translator and into the outcome store, as the app takes it. */
function report(requestId: string, delivery: GroupDelivery): void {
  const [event] = toGroupEvents({ GroupMessageResponse: { cid: 7n, group_key: KEY, delivery, request_id: requestId } }, 7n, 'me', nameOf);
  expect(event.name).toBe('group:send-outcome');
  const payload: { requestId: string; outcome: Outcome } = event.payload as { requestId: string; outcome: Outcome };
  recordSendOutcome(payload.requestId, payload.outcome);
}

const relayed = (delivered: bigint[], stored: bigint[], not_delivered: Array<[bigint, 'Offline' | 'BacklogFull' | 'Unreachable']>): GroupDelivery =>
  ({ Relayed: { delivered, stored, not_delivered } });

describe("a send's delivery report", () => {
  beforeEach((): void => { sent.length = 0; forgetSendOutcomes(); });

  it('lands on the message the send minted, by the request it names', async () => {
    const messageId: string = await sendPeerGroupMessage('7:42', 'hello');
    report(requestIdOfLastSend(), relayed([8n, 9n], [], []));
    expect(sendOutcomeOf(messageId)).toEqual({ delivery: relayed([8n, 9n], [], []) });
  });

  it("is ignored when it names a request this tab never sent", async () => {
    const messageId: string = await sendPeerGroupMessage('7:42', 'hello');
    report('someone-elses-request', relayed([8n], [], []));
    expect(sendOutcomeOf(messageId)).toBeUndefined();
  });

  it('keeps only the latest answer for a message', async () => {
    const first: string = await sendPeerGroupMessage('7:42', 'one');
    const firstRequest: string = requestIdOfLastSend();
    report(firstRequest, relayed([8n], [9n], []));
    // A second answer to the same request finds the pairing spent: the first stands.
    report(firstRequest, relayed([], [], [[8n, 'Offline']]));
    expect(sendOutcomeOf(first)).toEqual({ delivery: relayed([8n], [9n], []) });
  });
});

describe('what the bubble says', () => {
  const say = (outcome: Outcome): string => sendOutcomeNote(outcome, nameOf).text;

  it('is "Delivered" when everyone has it now', () => {
    expect(sendOutcomeNote({ delivery: relayed([8n, 9n], [], []) }, nameOf)).toEqual({ complete: true, failed: false, text: 'Delivered' });
  });

  it('counts the members it is held for while they are away', () => {
    expect(say({ delivery: relayed([8n], [9n, 10n], []) })).toBe('Delivered to 1 · held for 2 offline');
  });

  it('names each member it will not reach, and why', () => {
    expect(say({ delivery: relayed([], [], [[8n, 'Offline'], [9n, 'BacklogFull'], [10n, 'Unreachable']]) }))
      .toBe("Couldn't reach bea (offline) · Couldn't reach cy (backlog full) · Couldn't reach cid-10 (unreachable)");
  });

  it('says why a message was not relayed at all', () => {
    expect(sendOutcomeNote({ delivery: { NotRelayed: 'SessionEnded' } }, nameOf)).toEqual({ complete: false, failed: true, text: 'Not sent: the session ended' });
    expect(say({ delivery: { NotRelayed: 'UnknownGroup' } })).toBe('Not sent: this group no longer exists');
    expect(say({ delivery: { NotRelayed: 'NoGroupKey' } })).toBe("Not sent: this device does not hold the group's keys yet");
    expect(say({ delivery: { NotRelayed: 'NotPositioned' } })).toBe("Not sent: the server could not place it in the group's order");
  });

  it('does not call a message sent again under its id a failure', () => {
    expect(sendOutcomeNote({ delivery: { NotRelayed: 'AlreadyRelayed' } }, nameOf)).toEqual({ complete: false, failed: false, text: 'Sent already; not sent again' });
  });

  it('hears each reason the server can give', () => {
    for (const why of ['SessionEnded', 'UnknownGroup', 'NoGroupKey', 'AlreadyRelayed', 'NotPositioned'] as const) {
      const [event] = toGroupEvents({ GroupMessageResponse: { cid: 7n, group_key: KEY, delivery: { NotRelayed: why }, request_id: 'r' } }, 7n, 'me', nameOf);
      expect(event?.name).toBe('group:send-outcome');
    }
  });

  it('says why a refused message reached no one', () => {
    expect(say({ refusal: 'NotAMember' })).toBe('Not sent: You are no longer a member of this group');
  });
});

describe('a report that is not one', () => {
  it('is dropped rather than guessed at', () => {
    const malformed: Record<string, unknown>[] = [
      { Relayed: { delivered: ['x'], stored: [], not_delivered: [] } },
      { Relayed: { delivered: [], stored: [], not_delivered: [[8n, 'Asleep']] } },
      { NotRelayed: 'Elsewhere' },
    ];
    for (const delivery of malformed) {
      expect(toGroupEvents({ GroupMessageResponse: { cid: 7n, group_key: KEY, delivery, request_id: 'r' } }, 7n, 'me', nameOf)).toEqual([]);
    }
  });
});
