import type { FileTransfer } from '@/lib/file-transfer/types';

/** What the Stats tab can truthfully say about a conversation's history. */
export interface ConversationFacts {
  /** The earliest message or transfer with this peer; null when there is none. */
  firstContact: number | null;
  /** Bytes of the transfers that finished; null when none has. */
  transferredBytes: number | null;
}

/**
 * Derived from the conversation's own records.
 *
 * The panel used to print two inventions: "Storage Used" as
 * `quota - quota * 0.85` (15% of the quota slider, whatever was stored), and
 * "First Connected" as the first time THIS browser opened the panel, written
 * to localStorage during render.
 */
export function conversationFacts(oldestMessageTimestamp: number | null, transfers: readonly FileTransfer[]): ConversationFacts {
  const times: number[] = transfers.map((t: FileTransfer) => t.createdAt).filter((t: number) => t > 0);
  if (oldestMessageTimestamp !== null && oldestMessageTimestamp > 0) times.push(oldestMessageTimestamp);
  const finished: FileTransfer[] = transfers.filter((t: FileTransfer) => t.state === 'complete' && t.fileSize > 0);
  return {
    firstContact: times.length > 0 ? Math.min(...times) : null,
    transferredBytes: finished.length > 0 ? finished.reduce((sum: number, t: FileTransfer) => sum + t.fileSize, 0) : null,
  };
}
