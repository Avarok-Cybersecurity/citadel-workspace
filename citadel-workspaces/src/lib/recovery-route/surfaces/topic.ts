/**
 * Ways out of an app's live-topic join that has not happened (RECOVERY-DESIGN.md §2.6 b), one plan
 * per reason of the runtime's waiting state (CAL-SOLO, runtime/topic-rejoin.ts): its `reason` picks
 * the plan, its `owner` is the member the plan's contact-member names, and its `wake` is the plan's
 * primary — a wait that ends by itself within TOPIC_WAIT.forMs, or (refused) only by hand.
 * A wait on yourself is a bug, reported.
 */
import type { DeclaredPlan } from '../route';
import { TOPIC_WAIT, type TopicJoin, type WaitReason } from '@/lib/citadel-apps/runtime/topic-rejoin';

export type TopicWaitReason = WaitReason;

export const TOPIC_SURFACES = {
  'topic.owner-offline': { cause: 'peer', presentation: 'banner', primary: { kind: 'wait', until: 'peer-online', deadlineMs: TOPIC_WAIT.forMs, then: { kind: 'contact-member', about: 'topic-owner' } }, alternatives: [{ kind: 'retry' }] },
  'topic.refused': { cause: 'policy', presentation: 'banner', primary: { kind: 'contact-member', about: 'topic-owner' }, alternatives: [{ kind: 'retry' }] },
  'topic.timeout': { cause: 'peer', presentation: 'banner', primary: { kind: 'wait', until: 'member-opens-app', deadlineMs: TOPIC_WAIT.forMs, then: { kind: 'retry' } }, alternatives: [] },
  'topic.waits-on-self': { cause: 'ours', presentation: 'banner', primary: { kind: 'retry' }, alternatives: [] },
} as const satisfies { readonly [K in TopicWaitReason as `topic.${K}`]: DeclaredPlan } & Record<string, DeclaredPlan>;

export type TopicSurfaceId = keyof typeof TOPIC_SURFACES;

/** The plan for a join the runtime is waiting on: its reason, unless the one waited on is this session. */
export function topicWaitSurface(join: Extract<TopicJoin, { kind: 'waiting' }>, ownCid: bigint | null): TopicSurfaceId {
  if (join.owner !== null && ownCid !== null && join.owner.cid === ownCid) return 'topic.waits-on-self';
  return `topic.${join.reason}`;
}
