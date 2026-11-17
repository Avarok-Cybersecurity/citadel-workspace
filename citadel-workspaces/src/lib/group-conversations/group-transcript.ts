/**
 * How a peer group's stored transcript changes. Pure, so the dedupe and the cap
 * can be tested without storage; `group-transcript-store` does the I/O.
 *
 * A peer group has no server history: it is owned by no node, and the
 * workspace server refuses to answer for it. Until this existed nothing held a
 * transcript at all -- `group-persistence` stores the group LIST -- so a reload
 * showed "No messages yet" in a group you had just been talking in.
 */
import type { GroupMessage } from '@/types/workspace-entities';
import { sortByTime, removeMessage, reactToGroupMessage } from '@/lib/group-message-list';
import type { ReactionChange } from '@/lib/reactions/reaction-state';

/**
 * Messages kept per group, newest first to survive.
 *
 * 500, for two reasons that both scale with it:
 *   - Each group's transcript is ONE IndexedDB value, and every recorded
 *     message is a read-modify-write of the whole of it, so the cost of each
 *     arrival grows linearly with the cap. At 500 short messages that is a few
 *     hundred KB cloned per write, which stays well inside one frame's budget.
 *   - A peer group cannot page ("Load older messages" is not offered), so
 *     everything stored is rendered at once when the group opens. 500 bubbles
 *     is a thread a person can scroll; an unbounded one is not.
 * It is five times the 100 a direct conversation holds in memory, because for
 * a peer group this IS the history -- there is nothing further back to fetch.
 */
export const TRANSCRIPT_CAP: number = 500;

export type TranscriptChange =
  | { kind: 'add'; message: GroupMessage }
  /** The message as the manager holds it after the edit, not a diff to re-apply. */
  | { kind: 'edit'; message: GroupMessage }
  | { kind: 'delete'; messageId: string }
  /**
   * Folded into the STORED message rather than carrying the manager's copy: a
   * reaction can arrive while the group is not open, when the manager holds no
   * messages for it, and must still be on disk for the next time it is.
   */
  | { kind: 'react'; messageId: string; change: ReactionChange };

/**
 * Apply one change. Returns `transcript` itself when nothing changed, which is
 * how the store knows not to write: ILM redelivers, and a redelivery must be a
 * no-op rather than a second copy or a pointless rewrite.
 */
export function foldTranscript(transcript: GroupMessage[], change: TranscriptChange): GroupMessage[] {
  if (change.kind === 'add') {
    if (transcript.some((m: GroupMessage): boolean => m.id === change.message.id)) return transcript;
    const sorted: GroupMessage[] = sortByTime([...transcript, change.message]);
    return sorted.length > TRANSCRIPT_CAP ? sorted.slice(sorted.length - TRANSCRIPT_CAP) : sorted;
  }
  if (change.kind === 'react') return reactToGroupMessage(transcript, change.messageId, change.change) ?? transcript;
  const id: string = change.kind === 'edit' ? change.message.id : change.messageId;
  if (!transcript.some((m: GroupMessage): boolean => m.id === id)) return transcript;
  return change.kind === 'edit'
    ? transcript.map((m: GroupMessage): GroupMessage => (m.id === id ? change.message : m))
    : removeMessage(transcript, id);
}
