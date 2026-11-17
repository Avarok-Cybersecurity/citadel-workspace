/**
 * An office's or room's chat: the shared chat pane over the node channel's transport.
 *
 * The channel's header (its roster, who is typing, its rules) sits where a direct chat has its
 * peer's header. Everything else (the transcript, markdown, replies, edits, reactions, receipts,
 * retry, drafts, history paging) is the pane's, the same code a direct chat runs.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChatPane, type ChatPaneStatus } from '@/components/chat/pane/ChatPane';
import { NodeChatHeader } from '@/components/chat/pane/NodeChatHeader';
import { useLiveGate } from '@/components/chat/pane/use-live-gate';
import type { GroupRestriction } from '@/components/chat/group-restriction';
import { createNodeTransport } from '@/lib/chat/transport/node-transport';
import { nodeChatIO } from '@/lib/chat/transport/node-chat-io';
import { rosterEntries, type Roster } from '@/lib/chat/transport/node-signals';
import type { ChatSelf, ChatTransport } from '@/lib/chat/transport/chat-transport';
import type { RosterEntry } from '@/lib/chat/transport/read-receipts';
import { browserClock } from '@/lib/browser-clock';
import { nodeOpeningPorts } from '@/components/p2p/chat-document/use-chat-documents';
import { createValueStore, type ValueStore } from '@/lib/value-store';
import type { User } from '@/types/workspace-entities';

interface NodeChatProps {
  /** The office or room the channel belongs to, whose page its live documents sit beside. */
  nodeId: string;
  channelId: string;
  channelName: string;
  /** Null until the tab knows its account; the reader can read, and sending says why it waits. */
  self: ChatSelf | null;
  sendRestriction: GroupRestriction;
  /** The channel's rules, shown above its messages; null when it has none. */
  rules: string | null;
  /** The node's members (use-node-roster); null until they are known. */
  members: readonly User[] | null;
  /** Whether the reader may manage the workspace's subscription, so a limit notice says where packs are bought. */
  managesSubscription: boolean;
}

const mintLocalId = (): string => `local-${crypto.randomUUID()}`;

/** The roster as the live value a transport holds, which is built once per channel. */
function useRosterStore(channelId: string, members: readonly User[] | null): Roster {
  const [roster] = useState<ValueStore<readonly RosterEntry[] | null>>(() => createValueStore(`node-roster:${channelId}`, rosterEntries(members)));
  useEffect((): void => roster.set(rosterEntries(members)), [roster, members]);
  return roster;
}

export function NodeChat({ nodeId, channelId, channelName, self, sendRestriction, rules, members, managesSubscription }: NodeChatProps): JSX.Element {
  const sendGate: ValueStore<GroupRestriction> = useLiveGate(`node-send-gate:${channelId}`, sendRestriction);
  const manages: ValueStore<boolean> = useLiveGate(`node-manages-subscription:${channelId}`, managesSubscription);
  const roster: Roster = useRosterStore(channelId, members);
  const transport: ChatTransport = useMemo((): ChatTransport => createNodeTransport({
    channelId, nodeId, channelName, self, sendGate, roster, io: nodeChatIO(channelId, nodeId), mintLocalId, now: Date.now, clock: browserClock,
    opening: nodeOpeningPorts(nodeId, (): boolean => manages.get()),
  }), [nodeId, channelId, channelName, self, sendGate, roster, manages]);
  const shown: readonly RosterEntry[] | null = useMemo(() => rosterEntries(members), [members]);
  return (
    <ChatPane
      transport={transport}
      pause={null}
      header={(status: ChatPaneStatus): JSX.Element => <NodeChatHeader roster={shown} typing={status.typing} rules={rules} />}
    />
  );
}
