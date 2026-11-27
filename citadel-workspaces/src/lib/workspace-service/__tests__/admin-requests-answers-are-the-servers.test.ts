/**
 * The admin-request calls resolve with the server's answer of the kind they asked for. The
 * "Waiting" nudge an admin receives is a push and never settles a request, even one in flight.
 *
 * Doubled: the send (the wire) and the inbound event, as every write-gate test here does.
 */
import { describe, expect, it, vi } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import type { AdminRequestEntry, WorkspaceProtocolRequest } from 'citadel-workspace-client-ts';
import { ackAdminRequests, askAdmins, takeAdminRequests } from '../admin-requests-operations';
import type { ProtocolSender } from '../workspace-operations';

type Sender = ProtocolSender & { sent: WorkspaceProtocolRequest[] };

function sender(answers: unknown[]): Sender {
  const sent: WorkspaceProtocolRequest[] = [];
  return {
    sent,
    currentCid: 7n,
    sendProtocolRequest: vi.fn(async (request: WorkspaceProtocolRequest): Promise<void> => {
      sent.push(request);
      for (const response of answers) setTimeout(() => eventEmitter.emit('workspace:raw-response', response), 0);
    }),
  };
}

const ENTRY: AdminRequestEntry = { id: 'a.1', from_user: 'alice', at_ms: 5n, text: 'Asks for the permission “Edit rooms”.' };

describe('the admin-request calls', () => {
  it('ask: a Waiting push first does not settle it; the Asked answer does', async () => {
    const s: Sender = sender([{ AdminRequests: 'Waiting' }, { AdminRequests: { Asked: { admins: 2 } } }]);
    expect(await askAdmins(s, 'hello')).toEqual({ kind: 'asked', admins: 2 });
    expect(s.sent).toEqual([{ AdminRequests: { Ask: { text: 'hello' } } }]);
  });

  it('ask: a refusal is an answer, not a failure', async () => {
    expect(await askAdmins(sender([{ AdminRequests: { Refused: 'NoAdmins' } }]), 'x')).toEqual({ kind: 'refused', refusal: 'NoAdmins' });
  });

  it('take and ack resolve with what the server holds and removed', async () => {
    expect(await takeAdminRequests(sender([{ AdminRequests: { Pending: { entries: [ENTRY] } } }]))).toEqual([ENTRY]);
    const ack: Sender = sender([{ AdminRequests: { Acked: { removed: 1 } } }]);
    expect(await ackAdminRequests(ack, ['a.1'])).toBe(1);
    expect(ack.sent).toEqual([{ AdminRequests: { Ack: { ids: ['a.1'] } } }]);
  });
});
