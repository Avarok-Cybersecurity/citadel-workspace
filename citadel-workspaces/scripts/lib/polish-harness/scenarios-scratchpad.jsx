/**
 * The scratchpad as it is shown (ScratchpadPane): the real pane over the real scratchpad
 * transport, with the messenger replaced by notes held in memory (the harness has no agent).
 * One with notes (plain, markdown, a long unbroken token, a live document, one still saving) and
 * one empty, whose transcript says what the scratchpad is.
 */
import { useMemo } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { ScratchpadPane } from '@/components/scratchpad/ScratchpadChat';
import { createScratchpadTransport, scratchpadGate } from '@/lib/chat/transport/scratchpad-transport';
import { scratchpadBlobs } from '@/lib/scratchpad/scratchpad-blobs';
import { sha256Hex } from '@/lib/chat/attachments/attachment-wire';
import { readBrowserFile } from '@/lib/chat/transport/node-chat-io';

const ME = 5n;
const NOON = new Date().setHours(12, 0, 0, 0);
const note = (index, content, extra) => ({
  id: `n${index}`, content, sender_cid: ME, recipient_cid: ME, timestamp: NOON + index * 60_000, index, status: 'sent', message_type: 'text', ...extra,
});
const NOTES = [
  note(0, 'Buy oat milk'),
  note(1, 'Ideas for the **launch**: a short video, then the changelog.', { message_type: 'markdown' }),
  note(2, 'Draft link: a-very-long-unbroken-token-that-must-wrap-inside-the-bubble-and-not-push-the-layout'),
  note(3, 'Created live document: Launch plan', { message_type: 'live_document', document_id: 'doc-1', document_title: 'Launch plan' }),
  note(4, 'Call the venue back', { status: 'pending' }),
];

function harnessMessenger(notes) {
  const off = () => () => {};
  return {
    waitForReady: async () => {}, syncConnectionsFromBackend: async () => {},
    getConversationMetadata: async () => (notes.length === 0 ? null : { latestPage: 0 }),
    loadLatestMessages: async () => notes, loadMessagePage: async () => null,
    getConversation: () => ({ messages: notes }), onMessage: off, onMessageStatusChange: off,
    setActiveConversation: () => {}, markMessagesAsRead: async () => {},
    sendMessage: async () => {}, editMessage: async () => {}, deleteMessage: async () => {}, reactToMessage: async () => {}, resendMessage: async () => {},
  };
}
const nowhere = { get: async (_c, k) => { throw new Error(`Key not found: ${k}`); }, set: async () => {} };

function Scratchpad({ notes }) {
  const transport = useMemo(() => createScratchpadTransport({
    messenger: harnessMessenger(notes), self: { cid: ME, username: 'me', displayName: 'Me' },
    opening: { opener: async () => { throw new Error('the harness opens no documents'); } },
    blobs: scratchpadBlobs(ME, nowhere, sha256Hex), readFile: readBrowserFile, sendGate: scratchpadGate(ME),
  }), [notes]);
  return (
    <div style={{ height: '100vh' }} className="bg-background">
      <ConfirmDialogProvider><TooltipProvider><ScratchpadPane transport={transport} /></TooltipProvider></ConfirmDialogProvider>
    </div>
  );
}

export const SCRATCHPAD_SCENARIOS = {
  scratchpad: () => <Scratchpad notes={NOTES} />,
  'scratchpad-empty': () => <Scratchpad notes={[]} />,
};
