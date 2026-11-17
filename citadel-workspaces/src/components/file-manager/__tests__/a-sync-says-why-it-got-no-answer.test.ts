/**
 * A sync that brought nothing back says which of two things happened.
 *
 * Live: "The peer did not answer — Your changes were sent. Their file list has
 * not arrived yet; try again in a moment", and a retry ten seconds later the
 * same. A request that never LEFT was reported the same way as one nobody
 * answered, and neither said what an answer needs.
 *
 * The real service's `requestSync` against a stubbed I/O boundary, and the real
 * wording function.
 */
import { describe, it, expect } from 'vitest';
import { createTestService, defaultIntentHandler, ALICE, BOB } from '@/lib/revfs/__tests__/revfs-service-test-helpers';
import type { RevfsService, SyncOutcome } from '@/lib/revfs/revfs-service';
import { syncNotice, type SyncNotice } from '../sync-notice';

describe('a sync with no tree back', () => {
  it('that never left is reported as unsent, not unanswered', async () => {
    const service: RevfsService = createTestService(defaultIntentHandler({
      'send-revfs-op': () => ({ type: 'send-revfs-op', success: false }),
    }));
    const outcome: SyncOutcome = await service.requestSync(ALICE, BOB, 10);
    expect(outcome).toEqual({ kind: 'unsent' });
    const notice: SyncNotice | null = syncNotice(outcome, 'Bob');
    expect(notice?.title).toBe('Could not reach Bob');
    expect(notice?.description).toMatch(/was not sent/);
  });

  it('that left and got nothing says how long it waited and what an answer needs', async () => {
    const service: RevfsService = createTestService(defaultIntentHandler());
    const outcome: SyncOutcome = await service.requestSync(ALICE, BOB, 10);
    expect(outcome).toEqual({ kind: 'unanswered', waitedMs: 10 });
    const notice: SyncNotice | null = syncNotice({ kind: 'unanswered', waitedMs: 15_000 }, 'Bob');
    expect(notice?.title).toBe('Bob did not answer');
    expect(notice?.description).toMatch(/15 s/);
    expect(notice?.description).toMatch(/signed in with Citadel open/);
  });

  it('that was answered warns about nothing', () => {
    expect(syncNotice({ kind: 'answered' }, 'Bob')).toBeNull();
  });
});
