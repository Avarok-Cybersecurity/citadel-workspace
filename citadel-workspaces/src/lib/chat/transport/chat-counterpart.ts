/**
 * Who a conversation is with, as its pane names them: in sentences, in the empty transcript, and
 * by the roster key behind a peer's picture. Each transport states every field (chat-transport.ts).
 */

/** The empty transcript's heading in a conversation with someone; the scratchpad has none. */
export const NO_MESSAGES_YET: string = 'No messages yet';

/** Who the conversation is with: one peer, or a channel's readers. */
export interface ChatCounterpart {
  /** What the pane calls them in a sentence ("Say hello to …", "Shared live with …"). */
  readonly name: string;
  /** The roster key behind a single peer's picture; null for a channel. */
  readonly username: string | null;
  /** The empty transcript's sentence: who to greet, and how the messages travel. */
  readonly greeting: string;
  /** The empty transcript's heading above the greeting; null where the greeting says it all (the scratchpad). */
  readonly emptyHeading: string | null;
}
