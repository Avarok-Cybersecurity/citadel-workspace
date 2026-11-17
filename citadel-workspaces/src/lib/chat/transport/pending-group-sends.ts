/**
 * The reader's own channel messages between pressing Send and the server's copy arriving.
 *
 * The workspace server mints a channel message's id and answers the sender with the same
 * notification it broadcasts, so until then the only copy is the one shown here. Without it the
 * composer cleared and nothing appeared for a round trip, and a refused send ("Please slow down")
 * left no bubble to retry from: the text was simply gone.
 *
 * An echo settles the oldest unfailed local copy with the same text, reply and kind. Two identical sends
 * in flight may settle in either order, and the result is the same two messages either way.
 * Pure state, no I/O: the adapter decides when to send and what to tell the pane.
 */
import type { GroupMessage } from '@/types/workspace-entities';
import type { ChatMessage } from './chat-transport';

type EchoFields = Pick<GroupMessage, 'content' | 'reply_to' | 'message_type'>;

interface Pending {
  message: ChatMessage;
  readonly key: string;
}

const keyOf = (echo: EchoFields): string => `${echo.message_type}\u0000${echo.reply_to ?? ''}\u0000${echo.content}`;

export interface PendingSends {
  /** Holds `message` as the local copy of a send of `echo`. */
  add(message: ChatMessage, echo: EchoFields): void;
  /** The local id an echo of the reader's own message settles, or null when none is waiting. */
  settle(echo: EchoFields): string | null;
  /** Updates a local copy; null when it has already been settled. */
  update(id: string, change: Partial<Pick<ChatMessage, 'status' | 'error'>>): ChatMessage | null;
  get(id: string): ChatMessage | null;
  all(): ChatMessage[];
}

export function pendingGroupSends(): PendingSends {
  const held: Map<string, Pending> = new Map<string, Pending>();
  return {
    add: (message: ChatMessage, echo: EchoFields): void => { held.set(message.id, { message, key: keyOf(echo) }); },
    settle: (echo: EchoFields): string | null => {
      const key: string = keyOf(echo);
      for (const [id, entry] of held) {
        // A refused send has no echo coming; a later identical send's echo is that send's.
        if (entry.key !== key || entry.message.status === 'failed') continue;
        held.delete(id);
        return id;
      }
      return null;
    },
    update: (id: string, change: Partial<Pick<ChatMessage, 'status' | 'error'>>): ChatMessage | null => {
      const entry: Pending | undefined = held.get(id);
      if (entry === undefined) return null;
      entry.message = { ...entry.message, ...change };
      return entry.message;
    },
    get: (id: string): ChatMessage | null => held.get(id)?.message ?? null,
    all: (): ChatMessage[] => [...held.values()].map((entry: Pending): ChatMessage => entry.message),
  };
}
