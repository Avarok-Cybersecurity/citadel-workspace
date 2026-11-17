/**
 * Who has seen the reader's own messages in a node channel, derived from the members' read
 * cursors and the channel's roster.
 *
 * The node chat's receipts never worked: `read_by` existed only in the UI, nothing on the wire
 * filled it, and the member total defaulted to 2 when a caller omitted it, so a channel of forty
 * said everyone had seen a message once one person had. The server now keeps one cursor per
 * member ("read up to and including this message"); here a message is seen by every member whose
 * cursor is at it or later. Pure: the cursors, the roster and the order of the held messages
 * arrive as values.
 *
 * Nothing is guessed. A cursor naming a message this tab does not hold says nothing about the
 * held ones, so it counts for none of them. Without a roster there is no "of N" and no "seen by
 * everyone", only the names of whoever reported.
 */
import type { MessageStatus } from 'citadel-internal-service-wasm-client';

/** One member of the channel, as its roster lists them. */
export interface RosterEntry {
  readonly username: string;
  readonly displayName: string;
  /** True, false, or null when nobody has said. */
  readonly online: boolean | null;
}

export interface ReadReceipt {
  /** Display names of the other members who have seen it, in roster order where known. */
  readonly seenBy: readonly string[];
  /** How many other members could see it; null when the roster is not known. */
  readonly of: number | null;
}

export interface ReceiptStamp {
  readonly status: MessageStatus;
  readonly receipt: ReadReceipt;
}

export interface ReceiptInputs {
  /** The held messages' ids and senders, oldest first. */
  readonly messages: readonly { readonly id: string; readonly own: boolean }[];
  /** Member username to the id of the last message they have read. */
  readonly cursors: ReadonlyMap<string, string>;
  /** Null while the channel's members are not known. */
  readonly roster: readonly RosterEntry[] | null;
  readonly selfUsername: string;
}

/** Each own message's receipt, by message id. Messages written by others have none. */
export function readReceipts({ messages, cursors, roster, selfUsername }: ReceiptInputs): ReadonlyMap<string, ReceiptStamp> {
  const position: Map<string, number> = new Map(messages.map((m: { readonly id: string }, i: number): [string, number] => [m.id, i]));
  const others: { username: string; name: string }[] = roster !== null
    ? roster.filter((r: RosterEntry): boolean => r.username !== selfUsername).map((r: RosterEntry) => ({ username: r.username, name: r.displayName || r.username }))
    : [...cursors.keys()].filter((u: string): boolean => u !== selfUsername).map((u: string) => ({ username: u, name: u }));
  const readUpTo: { name: string; at: number }[] = others.flatMap((member: { username: string; name: string }) => {
    const upto: string | undefined = cursors.get(member.username);
    const at: number | undefined = upto === undefined ? undefined : position.get(upto);
    return at === undefined ? [] : [{ name: member.name, at }];
  });
  const of: number | null = roster === null ? null : others.length;
  const stamps: Map<string, ReceiptStamp> = new Map();
  messages.forEach((message: { readonly id: string; readonly own: boolean }, index: number): void => {
    if (!message.own) return;
    const seenBy: string[] = readUpTo.filter((r: { at: number }): boolean => r.at >= index).map((r: { name: string }): string => r.name);
    const everyone: boolean = of !== null && of > 0 && seenBy.length === of;
    stamps.set(message.id, { status: everyone ? 'read' : 'sent', receipt: { seenBy, of } });
  });
  return stamps;
}

/** What the details panel says about a receipt: "Seen by 1 of 3", or just who, without a total. */
export function receiptSummary(receipt: ReadReceipt): string {
  if (receipt.of === null) return receipt.seenBy.length === 0 ? 'Not seen yet' : `Seen by ${receipt.seenBy.length}`;
  return `Seen by ${receipt.seenBy.length} of ${receipt.of}`;
}
