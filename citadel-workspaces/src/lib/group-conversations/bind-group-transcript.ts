/**
 * Record every peer-group message change in the stored transcript.
 *
 * Bound to the messaging manager rather than to the places messages come from.
 * A sent message and a received one both reach the thread through
 * `deliverPeerGroupMessage`, edits and deletes through the manager's own
 * handlers, and every one of those ends as a manager event -- after the
 * manager's in-memory dedupe, so a redelivery the open thread already holds
 * never reaches here. One that arrives after a reload does, and
 * `foldTranscript` refuses it by id.
 *
 * Peer groups only. A node-backed channel's history lives on the workspace
 * server, and a second copy here would be a second answer to what it said.
 */
import { groupMessagingManager, type GroupMessageEvent } from '@/lib/group-messaging-manager';
import { debugLog } from '@/lib/debug-config';
import { groupSendTransport } from './group-send-transport';
import type { TranscriptChange } from './group-transcript';
import { recordTranscriptChange } from './group-transcript-store';

function changeFor(event: GroupMessageEvent): TranscriptChange | null {
  if (event.type === 'new_message' && event.message) return { kind: 'add', message: event.message };
  if (event.type === 'message_edited' && event.message) return { kind: 'edit', message: event.message };
  if (event.type === 'message_deleted' && event.messageId) return { kind: 'delete', messageId: event.messageId };
  // `messages_loaded` is the transcript being READ back; recording it would
  // only write the same thing again.
  return null;
}

export function bindGroupTranscript(): () => void {
  return groupMessagingManager.subscribe((event: GroupMessageEvent): void => {
    if (groupSendTransport(event.groupId) !== 'peer') return;
    const change: TranscriptChange | null = changeFor(event);
    if (!change) return;
    recordTranscriptChange(event.groupId, change).catch((error: unknown): void => {
      debugLog('GroupTranscript', 'Recording a transcript change failed', error);
    });
  });
}
