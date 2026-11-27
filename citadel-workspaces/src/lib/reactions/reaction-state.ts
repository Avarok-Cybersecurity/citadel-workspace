/**
 * Message reactions: what a message holds, and how one change folds into it.
 *
 * Shared by P2P chat and peer groups, which carry the change on different wires
 * (a MessagingLayer variant, a group-body envelope) but must agree on what it
 * means. Pure, so every rule below is tested without a socket or a store.
 *
 * One entry per (reactor, emoji). A change carries the reactor's own clock
 * (`at`) and the entry keeps the latest one, so:
 *   - a redelivery (same `at`) is a no-op: applied once, however often it lands;
 *   - an add that arrives after its own removal (ILM reorders) cannot bring the
 *     reaction back, because the removal is KEPT as `active: false` rather than
 *     deleted. Tombstones are never rendered.
 *
 * Who reacted is never read from a body. Every caller passes the CID the
 * TRANSPORT says spoke, so a peer can only ever touch its own entries -- which
 * is the whole of "only the reactor can remove their own".
 */

import type { GroupReaction, Reaction } from 'citadel-workspace-client-ts';

export type { GroupReaction, Reaction };

/** The fixed set offered by the picker and accepted off the wire. */
export const REACTION_EMOJIS: readonly string[] = ['👍', '❤️', '😂', '😮', '😢', '🎉'];

/**
 * One reaction entry is the agent's `Reaction`: `at` is the reactor's clock, in milliseconds, when
 * they last changed it (orders and dedupes); `active: false` is a retraction, kept so a late copy
 * of the add cannot resurrect it. A change is the entry it produces.
 */
export type ReactionChange = Reaction;

/**
 * A node channel's entry, from the workspace protocol, whose clock is a u64 (a bigint on the
 * page). A stored transcript written before that may hold it as a number: either is read.
 */
export function fromServerReaction(entry: GroupReaction): Reaction {
  return { emoji: entry.emoji, reactorCid: entry.reactorCid, at: Number(entry.at), active: entry.active };
}

export function toServerReaction(entry: Reaction): GroupReaction {
  return { emoji: entry.emoji, reactorCid: entry.reactorCid, at: BigInt(entry.at), active: entry.active };
}

export interface ReactionChip {
  emoji: string;
  count: number;
  /** Whether the viewing user is among the reactors. */
  mine: boolean;
  reactorCids: bigint[];
}

export function isReactionEmoji(value: unknown): value is string {
  return typeof value === 'string' && REACTION_EMOJIS.includes(value);
}

function sameSlot(entry: Reaction, change: ReactionChange): boolean {
  return entry.reactorCid === change.reactorCid && entry.emoji === change.emoji;
}

/**
 * The reactions after `change`, or null when it changes nothing -- a
 * redelivery, a copy older than what is held, or an emoji outside the set.
 * Null rather than the same array so a caller can skip the write and the event.
 */
export function foldReaction(
  current: readonly Reaction[] | undefined,
  change: ReactionChange,
): Reaction[] | null {
  if (!isReactionEmoji(change.emoji) || !Number.isFinite(change.at)) return null;
  const list: readonly Reaction[] = current ?? [];
  const held: Reaction | undefined = list.find((entry) => sameSlot(entry, change));
  if (held && held.at >= change.at) return null;
  const entry: Reaction = { emoji: change.emoji, reactorCid: change.reactorCid, at: change.at, active: change.active };
  return held ? list.map((e) => (sameSlot(e, change) ? entry : e)) : [...list, entry];
}

/**
 * What pressing `emoji` means for `self`: remove it when they already have it,
 * add it otherwise. `at` always moves past the held entry, so two presses in the
 * same millisecond are still two changes rather than a dropped second one.
 */
export function toggleReaction(
  current: readonly Reaction[] | undefined,
  emoji: string,
  self: bigint,
  now: number,
): ReactionChange {
  const held: Reaction | undefined = (current ?? []).find((e) => e.reactorCid === self && e.emoji === emoji);
  return {
    emoji,
    reactorCid: self,
    at: held ? Math.max(now, held.at + 1) : now,
    active: !(held?.active ?? false),
  };
}

/** One chip per emoji with at least one live reaction, in picker order. */
export function reactionChips(current: readonly Reaction[] | undefined, self: bigint | null): ReactionChip[] {
  const live: Reaction[] = (current ?? []).filter((e) => e.active);
  return REACTION_EMOJIS.flatMap((emoji: string): ReactionChip[] => {
    const reactorCids: bigint[] = live.filter((e) => e.emoji === emoji).map((e) => e.reactorCid);
    if (reactorCids.length === 0) return [];
    return [{ emoji, count: reactorCids.length, mine: self !== null && reactorCids.includes(self), reactorCids }];
  });
}
