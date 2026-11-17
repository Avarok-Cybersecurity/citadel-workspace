/**
 * What a node channel's members report besides messages: how far each has read, and who is
 * typing. The response handler writes here; the node channel's transport reads it.
 *
 * Cursors arrive two ways, with each history page (every member's, as the server holds them) and
 * as single moves broadcast to the channel, so a page replaces this tab's view of them and a move
 * updates one member. Typing is an event, never state: how long a name stays on screen is the
 * reader's decision (lib/chat/transport/typing-names), not the wire's.
 */
import type { GroupReadCursor } from 'citadel-workspace-client-ts';
import { notifyEach } from '@/lib/notify-listeners';

export type ChannelSignal =
  | { readonly kind: 'cursors' }
  | { readonly kind: 'typing'; readonly member: string };

export interface ChannelSignals {
  /** Member username to the last message they have read. */
  cursors(groupId: string): ReadonlyMap<string, string>;
  replaceCursors(groupId: string, cursors: readonly GroupReadCursor[]): void;
  moveCursor(groupId: string, cursor: GroupReadCursor): void;
  typing(groupId: string, member: string): void;
  subscribe(groupId: string, listener: (signal: ChannelSignal) => void): () => void;
}

const EMPTY: ReadonlyMap<string, string> = new Map();

export function createChannelSignals(): ChannelSignals {
  const cursors: Map<string, Map<string, string>> = new Map();
  const listeners: Map<string, Set<(signal: ChannelSignal) => void>> = new Map();
  const emit = (groupId: string, signal: ChannelSignal): void => {
    const held: Set<(signal: ChannelSignal) => void> | undefined = listeners.get(groupId);
    if (held !== undefined) notifyEach(held, 'channel signals', signal);
  };
  return {
    cursors: (groupId: string): ReadonlyMap<string, string> => cursors.get(groupId) ?? EMPTY,
    replaceCursors: (groupId: string, list: readonly GroupReadCursor[]): void => {
      cursors.set(groupId, new Map(list.map((c: GroupReadCursor): [string, string] => [c.member, c.upto_message_id])));
      emit(groupId, { kind: 'cursors' });
    },
    moveCursor: (groupId: string, cursor: GroupReadCursor): void => {
      const held: Map<string, string> = new Map(cursors.get(groupId) ?? EMPTY);
      if (held.get(cursor.member) === cursor.upto_message_id) return; // a redelivery
      held.set(cursor.member, cursor.upto_message_id);
      cursors.set(groupId, held);
      emit(groupId, { kind: 'cursors' });
    },
    typing: (groupId: string, member: string): void => emit(groupId, { kind: 'typing', member }),
    subscribe: (groupId: string, listener: (signal: ChannelSignal) => void): (() => void) => {
      const held: Set<(signal: ChannelSignal) => void> = listeners.get(groupId) ?? new Set();
      held.add(listener);
      listeners.set(groupId, held);
      return (): void => {
        held.delete(listener);
        if (held.size === 0) listeners.delete(groupId);
      };
    },
  };
}

/** The one this tab's response handler writes. */
export const channelSignals: ChannelSignals = createChannelSignals();
