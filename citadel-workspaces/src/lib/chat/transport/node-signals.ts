/**
 * The node channel's reactions, receipts and typing, built from its IO port, the reader and the
 * channel's roster. Kept beside node-transport so each port reads as one decision.
 */
import type { Clock } from '@/lib/cdoc/collab/ports';
import type { ValueStore } from '@/lib/value-store';
import type { GroupMessage, User } from '@/types/workspace-entities';
import type { GroupMessageEvent } from '@/lib/group-messaging-manager';
import type { ChannelSignal } from '@/lib/group-conversations/channel-signals';
import { senderUsernameOf } from '@/components/chat/shared/sender-username';
import { groupAuthor } from './group-chat-message';
import type { GroupReceipts } from './group-history';
import { readReceipts, type ReceiptStamp, type RosterEntry } from './read-receipts';
import { readCursor, type ReadCursor } from './node-read-cursor';
import { nodeStatus } from './node-status';
import type { NodeChatIO } from './node-chat-io';
import type { ChatSelf, StatusPort } from './chat-transport';

export type Roster = ValueStore<readonly RosterEntry[] | null>;

/** A node's member list as receipts and the header count it; null stays null (not known yet). */
export function rosterEntries(members: readonly User[] | null): readonly RosterEntry[] | null {
  return members?.map((user: User): RosterEntry => ({ username: user.username || user.id, displayName: user.displayName, online: user.isOnline })) ?? null;
}

/** A member's name as the roster has it, else the username the server named them by. */
export const rosterName = (roster: Roster, member: string): string =>
  roster.get()?.find((entry: RosterEntry): boolean => entry.username === member)?.displayName || member;

/** Toggles the reader's own `emoji` on a stored message, as the server holds it. */
export function nodeReact(io: NodeChatIO, self: ChatSelf | null): (messageId: string, emoji: string) => Promise<void> {
  return async (messageId: string, emoji: string): Promise<void> => {
    if (self === null) throw new Error('This tab has not finished signing in, so the reaction was not sent.');
    const held: GroupMessage | undefined = io.log.messages().find((m: GroupMessage): boolean => m.id === messageId);
    const mine: boolean = held?.reactions?.some((r) => r.active && r.emoji === emoji && r.reactorCid === self.cid) ?? false;
    await io.react(messageId, emoji, !mine);
  };
}

export function nodeReceipts(io: NodeChatIO, self: ChatSelf, roster: Roster): GroupReceipts {
  return {
    stamp: (held: readonly GroupMessage[]): ReadonlyMap<string, ReceiptStamp> => readReceipts({
      messages: held.map((m: GroupMessage) => ({ id: m.id, own: groupAuthor(m, self).own })),
      cursors: io.signals.cursors(), roster: roster.get(), selfUsername: self.username,
    }),
    subscribe: (listener: () => void): (() => void) => {
      const stops: (() => void)[] = [
        io.signals.subscribe((signal: ChannelSignal): void => { if (signal.kind === 'cursors') listener(); }),
        roster.subscribe(listener),
      ];
      return (): void => { for (const stop of stops) stop(); };
    },
  };
}

export function nodeReadCursor(io: NodeChatIO, self: ChatSelf | null, clock: Clock, report: (error: unknown) => void): ReadCursor {
  if (self === null) return { read: (): void => undefined };
  return readCursor({
    clock, report,
    newest: (): string | null => io.log.messages().at(-1)?.id ?? null,
    held: (): string | null => io.signals.cursors().get(self.username) ?? null,
    sendsReceipts: (): boolean => io.privacy().sendReadReceipts,
    write: (upto: string): Promise<void> => io.markRead(upto, self.username),
  });
}

export function nodeTyping(io: NodeChatIO, self: ChatSelf | null, roster: Roster, clock: Clock, report: (error: unknown) => void): StatusPort {
  return nodeStatus({
    clock,
    sendTyping: (): void => { io.typing().catch(report); },
    showsTyping: (): boolean => io.privacy().showTypingIndicators,
    selfUsername: self?.username ?? null,
    nameOf: (member: string): string => rosterName(roster, member),
    listen: (heard: (member: string) => void, wrote: (member: string) => void): (() => void) => {
      const stops: (() => void)[] = [
        io.signals.subscribe((signal: ChannelSignal): void => { if (signal.kind === 'typing') heard(signal.member); }),
        io.log.subscribe((event: GroupMessageEvent): void => {
          if (event.type === 'new_message' && event.message !== undefined) wrote(senderUsernameOf(event.message));
        }),
      ];
      return (): void => { for (const stop of stops) stop(); };
    },
  });
}
