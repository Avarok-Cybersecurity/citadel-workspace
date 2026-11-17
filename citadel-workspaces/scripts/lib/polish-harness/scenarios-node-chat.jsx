/**
 * An office channel's whole chat: the real pane over the real node transport, with the server
 * replaced by a page of messages held in memory (the harness has no workspace server). Senders
 * named, the reader's own messages on the right, a markdown message, a reply, a long unbroken
 * token, a system line, a reaction, a shared live document, one message seen by everyone, and the
 * channel's header: its roster, a member typing and its rules.
 */
import { useMemo } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { ChatPane } from '@/components/chat/pane/ChatPane';
import { NodeChatHeader } from '@/components/chat/pane/NodeChatHeader';
import { createNodeTransport } from '@/lib/chat/transport/node-transport';
import { groupLog } from '@/lib/chat/transport/group-log';
import { groupMessagingManager } from '@/lib/group-messaging-manager';
import { createValueStore } from '@/lib/value-store';
import { createChannelSignals } from '@/lib/group-conversations/channel-signals';
import { browserClock } from '@/lib/browser-clock';
import { nodeOpeningPorts } from '@/components/p2p/chat-document/use-chat-documents';

const CHANNEL = 'harness-channel';
const at = (minutes) => BigInt(new Date().setHours(10, minutes, 0, 0));
const message = (id, sender, name, content, minutes, extra) => ({
  id, group_id: CHANNEL, sender_id: sender, sender_name: name, message_type: 'Text', content, timestamp: at(minutes),
  reply_to: null, reply_count: 0, mentions: [], edited_at: null, ...extra,
});
const MESSAGES = [
  message('g1', 'ada', 'Ada Lovelace', 'Morning all. The analytical engine notes are in the shared folder.', 0, {}),
  message('g2', 'grace', 'Grace Hopper', 'Thanks Ada. There is a very long identifier in section four: a-very-long-unbroken-token-that-must-wrap-inside-the-bubble-and-not-push-the-layout.', 2, {}),
  message('s1', 'system', 'System', 'Grace Hopper joined the room', 3, { message_type: 'System' }),
  message('g3', 'me', 'Me', 'Sounds good. I will **review** after.', 5, { message_type: 'Markdown', reply_to: 'g1' }),
  message('g4', 'me', 'Me', 'One more thing: can someone check the build?', 6, {
    reactions: [{ emoji: '👍', reactorCid: 2n, at: 1, active: true }],
  }),
  message('g5', 'ada', 'Ada Lovelace', 'Engine notes, second draft', 7, {
    message_type: { LiveDocument: { document_id: 'cdoc-3f2a9c1e-7b4d-4e8a-9f01-2c3d4e5f6a7b' } },
  }),
];
const ROSTER = [
  { username: 'me', displayName: 'Me', online: true },
  { username: 'ada', displayName: 'Ada Lovelace', online: true },
  { username: 'grace', displayName: 'Grace Hopper', online: false },
];
// Everyone has read up to g3, so it shows read; g4 is seen by one of two.
const signals = createChannelSignals();
signals.replaceCursors(CHANNEL, [{ member: 'ada', upto_message_id: 'g4' }, { member: 'grace', upto_message_id: 'g3' }]);

const io = {
  log: groupLog(CHANNEL),
  latest: async () => { groupMessagingManager.handleMessagesLoaded(CHANNEL, MESSAGES, false); },
  older: async () => {},
  send: async () => {},
  edit: async () => {},
  remove: async () => {},
  focus: () => () => {},
  react: async () => {},
  markRead: async () => {},
  typing: async () => {},
  share: async () => {},
  onDocumentActivity: () => () => {},
  signals: { cursors: () => signals.cursors(CHANNEL), subscribe: (listener) => signals.subscribe(CHANNEL, listener) },
  clearNotices: () => {},
  privacy: () => ({ sendReadReceipts: false, showTypingIndicators: false }),
};

export function NodeChatScenario() {
  const transport = useMemo(() => createNodeTransport({
    channelId: CHANNEL, channelName: 'Engine room', self: { cid: 1n, username: 'me', displayName: 'Me' },
    sendGate: createValueStore('harness-gate', 'allowed'), io, mintLocalId: () => `local-${Date.now()}`, now: Date.now,
    roster: createValueStore('harness-roster', ROSTER), clock: browserClock, opening: nodeOpeningPorts('harness-node', () => false),
  }), []);
  return (
    <div style={{ height: '100vh' }} className="bg-background">
      <ConfirmDialogProvider><TooltipProvider>
        <ChatPane
          transport={transport} pause={null}
          // Grace's typing line is held up so the header's longest state is the one measured.
          header={() => <NodeChatHeader roster={ROSTER} typing={['Grace Hopper']} rules="Keep it about the engine." />}
        />
      </TooltipProvider></ConfirmDialogProvider>
    </div>
  );
}

/** The channel's server, for a scenario that replaces only what it is about (scenarios-server-files). */
export { io as NODE_CHAT_IO };

export const NODE_CHAT_SCENARIOS = { 'node-chat': NodeChatScenario };
