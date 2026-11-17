/**
 * A reaction is applied once per (reactor, emoji), however often it arrives, in
 * whatever order, and nobody but the reactor can take it away.
 *
 * ILM redelivers -- round 465 measured one operation retransmitted 91 times --
 * and reorders, so every rule here is about a copy arriving that was already
 * applied, or arriving after the change that superseded it.
 */
import { describe, it, expect } from 'vitest';
import {
  foldReaction,
  reactionChips,
  toggleReaction,
  REACTION_EMOJIS,
  type MessageReaction,
  type ReactionChange,
} from '../reaction-state';

const ME: bigint = 10n;
const ALICE: bigint = 20n;
const BOB: bigint = 30n;
const THUMBS: string = REACTION_EMOJIS[0];
const HEART: string = REACTION_EMOJIS[1];

const add = (reactorCid: bigint, emoji: string, at: number): ReactionChange => ({ reactorCid, emoji, at, active: true });
const remove = (reactorCid: bigint, emoji: string, at: number): ReactionChange => ({ reactorCid, emoji, at, active: false });

function fold(changes: ReactionChange[]): MessageReaction[] | undefined {
  let list: MessageReaction[] | undefined;
  for (const change of changes) list = foldReaction(list, change) ?? list;
  return list;
}

describe('applying a reaction', () => {
  it('adds one entry for a new reactor and emoji', () => {
    expect(foldReaction(undefined, add(ALICE, THUMBS, 1))).toEqual([add(ALICE, THUMBS, 1)]);
  });

  it('treats a redelivery as no change at all', () => {
    const once: MessageReaction[] | null = foldReaction(undefined, add(ALICE, THUMBS, 1));
    expect(foldReaction(once ?? undefined, add(ALICE, THUMBS, 1))).toBeNull();
  });

  it('counts one per reactor, however many copies arrive', () => {
    const list: MessageReaction[] | undefined = fold([add(ALICE, THUMBS, 1), add(ALICE, THUMBS, 1), add(BOB, THUMBS, 2), add(BOB, THUMBS, 2)]);
    expect(reactionChips(list, ME)).toEqual([{ emoji: THUMBS, count: 2, mine: false, reactorCids: [ALICE, BOB] }]);
  });

  it('does not bring a removed reaction back when the add is redelivered late', () => {
    const list: MessageReaction[] | undefined = fold([add(ALICE, THUMBS, 1), remove(ALICE, THUMBS, 2), add(ALICE, THUMBS, 1)]);
    expect(reactionChips(list, ME)).toEqual([]);
  });

  it('honours a removal that overtook its add', () => {
    const list: MessageReaction[] | undefined = fold([remove(ALICE, THUMBS, 2), add(ALICE, THUMBS, 1)]);
    expect(reactionChips(list, ME)).toEqual([]);
  });

  it("never lets one reactor's removal touch another's reaction", () => {
    // The reactor on a change is the transport's sender, so "Bob removes
    // Alice's thumbs" can only ever be expressed as Bob removing his own.
    const list: MessageReaction[] | undefined = fold([add(ALICE, THUMBS, 1), remove(BOB, THUMBS, 5)]);
    expect(reactionChips(list, ME)).toEqual([{ emoji: THUMBS, count: 1, mine: false, reactorCids: [ALICE] }]);
  });

  it('refuses an emoji outside the offered set', () => {
    expect(foldReaction(undefined, add(ALICE, '<img src=x>', 1))).toBeNull();
  });
});

describe('toggling your own', () => {
  it('adds when you have not reacted, and removes when you have', () => {
    const first: ReactionChange = toggleReaction(undefined, HEART, ME, 100);
    expect(first).toEqual(add(ME, HEART, 100));
    const held: MessageReaction[] | undefined = foldReaction(undefined, first) ?? undefined;
    expect(toggleReaction(held, HEART, ME, 200)).toEqual(remove(ME, HEART, 200));
  });

  it('moves the clock past the held entry, so a same-millisecond second press still lands', () => {
    const held: MessageReaction[] | undefined = foldReaction(undefined, add(ME, HEART, 100)) ?? undefined;
    const second: ReactionChange = toggleReaction(held, HEART, ME, 100);
    expect(second.at).toBe(101);
    expect(foldReaction(held, second)).not.toBeNull();
  });
});

describe('chips', () => {
  it('highlights your own and orders by the picker', () => {
    const list: MessageReaction[] | undefined = fold([add(ALICE, HEART, 1), add(ME, THUMBS, 2)]);
    expect(reactionChips(list, ME).map((c) => [c.emoji, c.mine])).toEqual([[THUMBS, true], [HEART, false]]);
  });
});
