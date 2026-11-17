/**
 * A peer whose SyncResponse was lost asked again for ever and was told nothing.
 *
 * The duplicate guard re-acknowledges an operation it has already applied, for
 * the reason its own comment gives: "a receiver that has already applied it and
 * stays silent leaves that sender retrying for ever". SyncRequest was excluded —
 * an Ack is the wrong shape for a query — so it got the exact failure that
 * sentence describes.
 *
 * CI showed it plainly: the same op id arriving once a second for a whole test,
 * every one logged "already applied", every one answered with silence, while the
 * file being synced never appeared on the other side. `Peer Sees File: FAIL`.
 *
 * Answering every duplicate is not the fix either. That is the flood the dedupe
 * was added for — seven SyncRequests became a hundred handled, each answered
 * with a fresh 564-byte SyncResponse on the reliable channel, starving the
 * PlaceFile and Rmdir the user had actually asked for. So: answer again, at most
 * once per peer per interval.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mayAnswerSyncAgain,
  forgetSyncAnswers,
  SYNC_ANSWER_INTERVAL_MS,
} from '../sync-answer-rate';

const ALICE_BOB: string = 'peer:1:2';
const ALICE_CAROL: string = 'peer:1:3';

describe('answering a repeated sync request', () => {
  beforeEach((): void => { forgetSyncAnswers(); });

  it('answers the first repeat, so a lost response is recoverable', () => {
    expect(mayAnswerSyncAgain(ALICE_BOB, 0)).toBe(true);
  });

  it('does not answer a storm of them', () => {
    mayAnswerSyncAgain(ALICE_BOB, 0);

    let answered: number = 0;
    // The observed rate: one arrival per second, for ten seconds.
    for (let t: number = 1_000; t < 10_000; t += 1_000) {
      if (mayAnswerSyncAgain(ALICE_BOB, t)) answered += 1;
    }

    expect(answered, 'every redelivery was answered with a fresh tree').toBeLessThanOrEqual(5);
  });

  it('answers again once the interval has passed', () => {
    // The opposite failure: answering exactly once would leave a peer whose
    // SECOND response was also lost stranded for ever — which is the bug this
    // fixes, one round later.
    mayAnswerSyncAgain(ALICE_BOB, 0);

    expect(mayAnswerSyncAgain(ALICE_BOB, SYNC_ANSWER_INTERVAL_MS - 1)).toBe(false);
    expect(mayAnswerSyncAgain(ALICE_BOB, SYNC_ANSWER_INTERVAL_MS)).toBe(true);
  });

  it('rate-limits per peer, not globally', () => {
    // Two peers re-requesting at once are two conversations; limiting one
    // because of the other would strand it.
    mayAnswerSyncAgain(ALICE_BOB, 0);

    expect(mayAnswerSyncAgain(ALICE_CAROL, 0)).toBe(true);
  });
});

/**
 * And the handler has to send one.
 *
 * The rate limiter above passes whether or not `revfs-inbound` consults it, and
 * whether or not it sends anything when it does. This drives the real duplicate
 * path.
 */
import { createTestService, defaultIntentHandler, getState, ALICE, BOB } from './revfs-service-test-helpers';
import { RevfsOpType } from '@/types/revfs-types';
import type { RevfsOperation } from '@/types/revfs-types';
import type { RevfsIntent, RevfsIntentResult } from '@/types/revfs-intents';
import type { RevfsService } from '../revfs-service';
import { createDefaultTree, peerTreeKey } from '../tree-queries';
import { forgetSeenOperations } from '../seen-operations';

function serviceRecording(sent: RevfsOperation[]): RevfsService {
  return createTestService((intent: RevfsIntent): RevfsIntentResult => {
    if (intent.type === 'send-revfs-op') {
      sent.push(intent.operation);
      return { type: 'send-revfs-op', success: true };
    }
    return defaultIntentHandler()(intent);
  });
}

const SYNC: RevfsOperation = {
  op_id: 'sync-repeat', op_type: RevfsOpType.SyncRequest, path: '/', timestamp: 1,
} as RevfsOperation;

describe('a SyncRequest arriving twice', () => {
  beforeEach((): void => { forgetSeenOperations(); forgetSyncAnswers(); });
  afterEach((): void => { vi.restoreAllMocks(); });

  // Date.now is stubbed rather than using fake timers: the handler awaits real
  // promises, and freezing the timer queue around them risks a test that hangs
  // instead of one that fails.
  function atTime(ms: number): void {
    vi.spyOn(Date, 'now').mockReturnValue(ms);
  }

  it('answers a repeat that arrives after the interval', async (): Promise<void> => {
    const sent: RevfsOperation[] = [];
    const service: RevfsService = serviceRecording(sent);
    getState(service).setTree(peerTreeKey(ALICE, BOB), createDefaultTree());
    const responses: () => number = (): number =>
      sent.filter((o: RevfsOperation): boolean => o.op_type === RevfsOpType.SyncResponse).length;

    atTime(10_000);
    await service.handleRevfsOperation(BOB, ALICE, SYNC);
    expect(responses(), 'the first request went unanswered').toBe(1);

    atTime(10_000 + SYNC_ANSWER_INTERVAL_MS);
    await service.handleRevfsOperation(BOB, ALICE, SYNC);

    expect(
      responses(),
      'the repeat was answered with silence, so a peer whose response was lost \
asks for ever and never sees the file',
    ).toBe(2);
  });

  it('answers a burst inside the interval only once', async (): Promise<void> => {
    // The flood the dedupe exists to stop: seven requests became a hundred
    // handled, each answered with a fresh tree on the reliable channel.
    const sent: RevfsOperation[] = [];
    const service: RevfsService = serviceRecording(sent);
    getState(service).setTree(peerTreeKey(ALICE, BOB), createDefaultTree());

    atTime(10_000);
    await service.handleRevfsOperation(BOB, ALICE, SYNC);
    await service.handleRevfsOperation(BOB, ALICE, SYNC);
    atTime(10_000 + SYNC_ANSWER_INTERVAL_MS - 1);
    await service.handleRevfsOperation(BOB, ALICE, SYNC);
    // The fresh answer starts the interval; without that the first redelivery
    // would open a new window and a burst would cost two full trees.

    expect(
      sent.filter((o: RevfsOperation): boolean => o.op_type === RevfsOpType.SyncResponse).length,
      'a burst got more than one full-tree response back',
    ).toBe(1);
  });
});
