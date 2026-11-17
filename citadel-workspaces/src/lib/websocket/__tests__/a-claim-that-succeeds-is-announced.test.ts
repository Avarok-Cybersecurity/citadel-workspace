/**
 * Every claim that succeeds is announced, and only those.
 *
 * What a window has in front is said to the agent per connection (ReportFocus),
 * and a connection that claimed a session knows nothing of it until it is said
 * again. The claim is the moment; this is how the rest of the page hears of it.
 */
import { describe, it, expect, vi } from 'vitest';
import { SessionManagement } from '../session-management';
import { eventEmitter } from '@/lib/event-emitter';
import { SESSION_CLAIMED, type ClaimedEvent } from '@/lib/multi-instance/claim-relay';

const CID: bigint = 31n;

function answering(answer: (requestId: string) => Record<string, unknown>): SessionManagement {
  return new SessionManagement({
    init: async (): Promise<void> => {},
    getClient: () => null,
    sendRequest: async (request: unknown): Promise<void> => {
      const id: string = (request as { ConnectionManagement: { request_id: string } }).ConnectionManagement.request_id;
      queueMicrotask(() => eventEmitter.emit('websocket-message', answer(id)));
    },
  });
}

function heard(): ClaimedEvent[] {
  const out: ClaimedEvent[] = [];
  eventEmitter.on<ClaimedEvent>(SESSION_CLAIMED, (e) => { out.push(e); });
  return out;
}

describe('a claim', () => {
  it('that the agent grants is announced with its session', async () => {
    const events: ClaimedEvent[] = heard();
    await answering((id) => ({ ConnectionManagementSuccess: { request_id: id, cid: CID } })).claimSession(CID, true);
    expect(events).toEqual([{ cid: CID }]);
  });

  it('that the agent refuses is not', async () => {
    const events: ClaimedEvent[] = heard();
    const refused: Promise<unknown> = answering((id) => ({ ConnectionManagementFailure: { request_id: id, error: `Session ${CID} is not orphaned` } })).claimSession(CID, true);
    await expect(refused).rejects.toThrow();
    await vi.waitFor(() => expect(events).toEqual([]));
  });
});
