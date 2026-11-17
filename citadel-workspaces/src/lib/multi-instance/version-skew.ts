/**
 * What a message from another build means for this tab, decided before any handler runs.
 *
 * - compatible, newer seq: this tab is stale (tab-staleness.ts), and a leader here hands over.
 * - their protocol too new for us: this tab is inert, and their traffic is not ours to read.
 * - their protocol too old for us: not read. Protocol 1 is the exception, handled as
 *   `legacy` by the election (legacy-v1-put-down.ts), because those tabs are still open.
 */
import type { ChannelMessage } from './channel-types';
import { compatibilityOf, readEnvelope, type ChannelEnvelope, type Compatibility } from './channel-envelope';
import { BUILD_SEQ } from './build-identity';
import { forgetTab, markInert, noteNewerTab } from './tab-staleness';
import { isOlderThanFollowed } from './leadership-epoch';
import { debugLog } from '@/lib/debug-config';

/** Whether the channel should go on to route `message`. */
export function admitByVersion(message: ChannelMessage): boolean {
  if (message.type === 'instance-goodbye') forgetTab(message.senderInstanceId);
  const theirs: ChannelEnvelope | null = readEnvelope(message);
  const compatibility: Compatibility = compatibilityOf(theirs);
  if (compatibility === 'too-new-for-us') markInert();
  if (compatibility === 'too-new-for-us' || compatibility === 'too-old-for-us') {
    debugLog('InstanceChannel', `Ignoring ${message.type} from ${message.senderInstanceId}: protocol ${compatibility}`);
    return false;
  }
  if (theirs !== null && theirs.seq > BUILD_SEQ && message.type !== 'instance-goodbye') {
    noteNewerTab(message.senderInstanceId);
  }
  return true;
}

/**
 * A leader's report of its own state (its socket, its notices) from a leadership older than
 * the one this tab follows: a leader that was frozen and woke, whose word is no longer news.
 * Requests' answers and forwarded messages are not fenced: they report work that was done.
 */
export function isFromAnOlderLeadership(message: ChannelMessage): boolean {
  const theirs: ChannelEnvelope | null = readEnvelope(message);
  return theirs !== null && isOlderThanFollowed(theirs.epoch);
}

/** A contender for leadership: its build and its instance id. */
export interface LeaderRank {
  readonly seq: number;
  readonly id: bigint;
}

/**
 * Whether `a` should lead rather than `b`: the newer build first, then, within one build, the
 * older tab (the lower instance id, which already holds the socket and every pending request).
 */
export function outranks(a: LeaderRank, b: LeaderRank): boolean {
  if (a.seq !== b.seq) return a.seq > b.seq;
  return a.id < b.id;
}

/** The sender's instance id as the election compares it; null when it is not a number. */
export function instanceIdOf(senderInstanceId: string): bigint | null {
  try {
    return BigInt(senderInstanceId);
  } catch {
    return null;
  }
}

export function ownRank(id: bigint): LeaderRank {
  return { seq: BUILD_SEQ, id };
}
