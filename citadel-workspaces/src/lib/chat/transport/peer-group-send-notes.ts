/**
 * A peer group's history, with what the server said became of each of the reader's own messages.
 *
 * The answer arrives after the message is shown (group-send-outcomes), so it reaches the pane as
 * an update; a message shown after its answer arrived, or reloaded, carries it from the start.
 * Only the latest answer for a message is kept, so a reload shows the same line the update did.
 */
import { sendOutcomeNote, type SendOutcomeNote } from '@/lib/group-conversations/group-send-outcome';
import { sendOutcomeOf, subscribeSendOutcomes } from '@/lib/group-conversations/group-send-outcomes';
import type { GroupSendOutcome } from '@/lib/group-conversations/group-send-outcome';
import type { ChatMessage, HistoryEvent, HistoryPage, HistoryPort, PaneMessage } from './chat-transport';

type SendNote = NonNullable<PaneMessage['sendNote']>;

function noteOf(messageId: string, nameOf: (cid: bigint) => string): SendNote | undefined {
  const outcome: GroupSendOutcome | undefined = sendOutcomeOf(messageId);
  if (outcome === undefined) return undefined;
  const note: SendOutcomeNote = sendOutcomeNote(outcome, nameOf);
  return { text: note.text, failed: note.failed };
}

function stamped(message: ChatMessage, nameOf: (cid: bigint) => string): ChatMessage {
  if (!message.author.own) return message;
  const sendNote: SendNote | undefined = noteOf(message.id, nameOf);
  return sendNote === undefined ? message : { ...message, sendNote };
}

function stampedEvent(event: HistoryEvent, nameOf: (cid: bigint) => string): HistoryEvent {
  switch (event.kind) {
    case 'arrived':
    case 'recorded':
    case 'replaced':
      return { ...event, message: stamped(event.message, nameOf) };
    default:
      return event;
  }
}

export function withSendNotes(port: HistoryPort, groupId: string, nameOf: (cid: bigint) => string): HistoryPort {
  const page = (loaded: HistoryPage): HistoryPage => ({ ...loaded, messages: loaded.messages.map((m: ChatMessage): ChatMessage => stamped(m, nameOf)) });
  return {
    ...port,
    loadLatest: async (): Promise<HistoryPage> => page(await port.loadLatest()),
    loadOlder: async (cursor): Promise<HistoryPage> => page(await port.loadOlder(cursor)),
    cached: (): readonly ChatMessage[] => port.cached().map((m: ChatMessage): ChatMessage => stamped(m, nameOf)),
    subscribe: (listener: (event: HistoryEvent) => void): (() => void) => {
      const stopHistory: () => void = port.subscribe((event: HistoryEvent): void => listener(stampedEvent(event, nameOf)));
      const stopOutcomes: () => void = subscribeSendOutcomes((sent: { groupId: string; messageId: string }): void => {
        if (sent.groupId !== groupId) return;
        const sendNote: SendNote | undefined = noteOf(sent.messageId, nameOf);
        if (sendNote !== undefined) listener({ kind: 'updated', message: { id: sent.messageId, sendNote } });
      });
      return (): void => { stopHistory(); stopOutcomes(); };
    },
  };
}
