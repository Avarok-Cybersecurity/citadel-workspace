/**
 * The topic plans are the runtime's waiting state (runtime/topic-rejoin.ts), not a second model of
 * it: each reason has its plan, a reason the runtime waits out by itself is a wait for exactly the
 * runtime's window, the one it never waits out (refused) is a manual route, and a wait on this
 * session is the reported bug.
 */
import { describe, expect, it } from 'vitest';
import type { RecoveryRoute } from '../route';
import { TOPIC_SURFACES, topicWaitSurface, type TopicWaitReason } from '../surfaces/topic';
import { TOPIC_WAIT, type TopicJoin } from '@/lib/citadel-apps/runtime/topic-rejoin';

type Waiting = Extract<TopicJoin, { kind: 'waiting' }>;

const waiting = (reason: TopicWaitReason, ownerCid: bigint | null): Waiting => ({
  kind: 'waiting',
  reason,
  owner: ownerCid === null ? null : { username: 'bob', cid: ownerCid },
  wake: reason === 'refused' ? { kind: 'manual' } : { kind: 'auto', deadlineMs: 1_000 },
});

const REASONS: readonly TopicWaitReason[] = ['owner-offline', 'refused', 'timeout'];

describe('a topic wait is the runtime’s wait', () => {
  it('picks the plan of the reason', () => {
    for (const reason of REASONS) expect(topicWaitSurface(waiting(reason, 7n), 1n)).toBe(`topic.${reason}`);
  });

  it('waits by itself exactly where the runtime does, for the runtime’s window', () => {
    for (const reason of REASONS) {
      const primary: RecoveryRoute = TOPIC_SURFACES[`topic.${reason}`].primary;
      const auto: boolean = waiting(reason, 7n).wake.kind === 'auto';
      expect(primary.kind === 'wait').toBe(auto);
      if (primary.kind === 'wait') expect(primary.deadlineMs).toBe(TOPIC_WAIT.forMs);
    }
  });

  it('a wait on this session is the bug, not a wait', () => {
    expect(topicWaitSurface(waiting('timeout', 7n), 7n)).toBe('topic.waits-on-self');
    expect(topicWaitSurface(waiting('timeout', null), 7n)).toBe('topic.timeout');
  });
});
