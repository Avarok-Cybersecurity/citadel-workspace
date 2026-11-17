/**
 * A peer group's conversation: the shared chat pane over the peer group's transport.
 *
 * The page above it owns the group's header, call and settings; this is the transcript and the
 * composer, the same code a direct chat and a node channel run.
 */
import { useMemo } from 'react';
import { ChatPane } from '@/components/chat/pane/ChatPane';
import { useLiveGate } from '@/components/chat/pane/use-live-gate';
import type { GroupRestriction } from '@/components/chat/group-restriction';
import { createPeerGroupTransport } from '@/lib/chat/transport/peer-group-transport';
import { peerGroupChatIO } from '@/lib/chat/transport/peer-group-chat-io';
import { chatSelf } from '@/lib/tab-identity';
import type { ChatSelf, ChatTransport } from '@/lib/chat/transport/chat-transport';
import type { ValueStore } from '@/lib/value-store';

interface PeerGroupChatProps {
  groupId: string;
  groupName: string;
  readerId: string;
  readerName: string;
  /** Undefined until this tab knows its CID; until then no message reads as the reader's own. */
  readerCid: bigint | undefined;
  sendRestriction: GroupRestriction;
}

export function PeerGroupChat({ groupId, groupName, readerId, readerName, readerCid, sendRestriction }: PeerGroupChatProps): JSX.Element {
  const sendGate: ValueStore<GroupRestriction> = useLiveGate(`peer-group-send-gate:${groupId}`, sendRestriction);
  const self: ChatSelf | null = useMemo(
    (): ChatSelf | null => chatSelf({ id: readerId, displayName: readerName }, readerCid),
    [readerId, readerName, readerCid],
  );
  const transport: ChatTransport = useMemo((): ChatTransport => createPeerGroupTransport({
    groupId, groupName, self, sendGate, io: peerGroupChatIO(groupId),
  }), [groupId, groupName, self, sendGate]);
  return <ChatPane transport={transport} pause={null} header={(): null => null} />;
}
