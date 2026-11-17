/**
 * Writing the tab's selected user has to announce itself.
 *
 * `resolveCurrentUserId` reads that record, so until it exists every permission
 * fetch bails with "nobody is signed in on this tab". `usePermission` retries
 * four times across about 4.6 seconds and then stops, and it restarts that
 * budget only on reconnection, a CID change, or a role change — none of which
 * happen when a tab simply learns who it is.
 *
 * So a budget spent during start-up was never spent again, however long the tab
 * then ran knowing exactly who it was. The gate stayed refused, and the reason
 * it showed was the first failure, cached, describing a state that had gone
 * away. CI reported it as the workspace admin's own Edit button disabled for
 * sixty seconds under a sentence that was no longer true.
 *
 * `use-permission` listening for the event is only half of it; this is the
 * other half, and without it removing the emit breaks nothing that any test
 * would notice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setSelectedUser } from '../tab-context';
import { eventEmitter } from '../event-emitter';

vi.mock('../storage-utils', () => ({
  dbPut: vi.fn(async (): Promise<void> => {}),
  dbGet: vi.fn(async (): Promise<undefined> => undefined),
  dbDelete: vi.fn(async (): Promise<void> => {}),
}));

const SELECTION: { selectedUsername: string; selectedServerAddress: string } = {
  selectedUsername: 'alice',
  selectedServerAddress: '127.0.0.1:12349',
};

beforeEach((): void => {
  vi.clearAllMocks();
});

describe('recording who this tab is using', () => {
  it('announces it, so a spent retry budget can start again', async () => {
    const heard: unknown[] = [];
    const listener = (payload: unknown): void => { heard.push(payload); };
    eventEmitter.on('tab:selected-user-changed', listener);

    await setSelectedUser(SELECTION);
    eventEmitter.off('tab:selected-user-changed', listener);

    expect(heard).toHaveLength(1);
  });

  it('announces AFTER the write, not before', async () => {
    // Order matters: a listener that re-reads the selection has to find it
    // there. Announcing first would have every listener read the old value and
    // conclude nothing had changed.
    const order: string[] = [];
    const storage: { dbPut: ReturnType<typeof vi.fn> } = await import('../storage-utils') as never;
    storage.dbPut.mockImplementation(async (): Promise<void> => { order.push('write'); });
    const listener = (): void => { order.push('announce'); };
    eventEmitter.on('tab:selected-user-changed', listener);

    await setSelectedUser(SELECTION);
    eventEmitter.off('tab:selected-user-changed', listener);

    expect(order).toEqual(['write', 'announce']);
  });
});
