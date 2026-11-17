/**
 * A node channel's files, kept on the workspace server: the real pane over the real node transport
 * and files port, with the server's attachment answers played by a wire held in memory. Two shared
 * files (a long-named PDF and a picture), the composer's destination line, and an upload the check
 * starts through the channel's file picker.
 *
 *   server-files          reads of the picture answer, reads of the PDF never do (so Download stays
 *                         busy), and an upload's first half is stored, then the server goes quiet.
 *   server-files-refusing reads of the PDF and every upload are refused.
 *   server-files-sharing  every upload chunk is stored, so the upload ends shared.
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
import { browserClock } from '@/lib/browser-clock';
import { nodeOpeningPorts } from '@/components/p2p/chat-document/use-chat-documents';
import { sha256Hex } from '@/lib/chat/attachments/attachment-wire';
import { NODE_CHAT_IO } from './scenarios-node-chat.jsx';

const CHANNEL = 'harness-files';
const ROSTER = [{ username: 'me', displayName: 'Me', online: true }, { username: 'ada', displayName: 'Ada Lovelace', online: true }];
const PDF = new TextEncoder().encode('%PDF-1.4 the engine room maintenance schedule');
const PDF_NAME = 'Engine-room-maintenance-schedule-for-the-whole-quarter-final-v3-reviewed.pdf';

/** A 160 x 96 PNG, drawn here so its bytes are a real raster the card's sniffing accepts. */
async function picture() {
  const canvas = document.createElement('canvas');
  Object.assign(canvas, { width: 160, height: 96 });
  const g = canvas.getContext('2d');
  g.fillStyle = '#3b6ea5';
  g.fillRect(0, 0, 160, 96);
  g.fillStyle = '#f2c14e';
  g.fillRect(20, 20, 60, 40);
  const blob = await new Promise((done) => canvas.toBlob(done, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

const at = (minutes) => BigInt(new Date().setHours(10, minutes, 0, 0));
const shared = (id, sender, name, file, minutes) => ({
  id, group_id: CHANNEL, sender_id: sender, sender_name: name, content: file.name, timestamp: at(minutes),
  reply_to: null, reply_count: 0, mentions: [], edited_at: null, reactions: [],
  message_type: { FileShare: { attachment_id: file.id, name: file.name, size_bytes: BigInt(file.bytes.length), mime: file.mime } },
});

/** The server's side of the attachment wire, answering as `mode` says. */
function wire(mode, files) {
  const listeners = new Set();
  const answer = (a) => queueMicrotask(() => listeners.forEach((l) => l(a)));
  return {
    answerDeadlineMs: 600_000,
    onAnswer: (l) => { listeners.add(l); return () => listeners.delete(l); },
    send: async (request) => {
      if ('ReadChunk' in request) {
        const { node_id, attachment_id, index } = request.ReadChunk;
        const file = files.find((f) => f.id === attachment_id);
        if (file.mime === 'application/pdf' && mode === 'server-files') return; // the download stays busy
        if (file.mime === 'application/pdf') return answer({ Refused: { node_id, attachment_id, refusal: 'Denied' } });
        return answer({ Chunk: { node_id, attachment_id, index, total_chunks: 1, size_bytes: BigInt(file.bytes.length), bytes: Array.from(file.bytes) } });
      }
      const { node_id, sha256, index, total_chunks } = request.UploadChunk;
      if (mode === 'server-files-refusing') return answer({ Refused: { node_id, attachment_id: sha256, refusal: { TooLarge: { max_bytes: 10n * 1024n * 1024n } } } });
      if (mode === 'server-files' && index >= total_chunks / 2) return; // half stored, then quiet
      answer({ ChunkStored: { node_id, attachment_id: sha256, index, stored: index + 1 === total_chunks } });
    },
  };
}

function ServerFilesScenario({ mode }) {
  const transport = useMemo(() => {
    const files = [{ name: PDF_NAME, mime: 'application/pdf', bytes: PDF }];
    const ready = (async () => {
      files.push({ name: 'boiler.png', mime: 'image/png', bytes: await picture() });
      for (const f of files) f.id = await sha256Hex(f.bytes);
    })();
    const io = {
      ...NODE_CHAT_IO,
      log: groupLog(CHANNEL),
      latest: async () => {
        await ready;
        groupMessagingManager.handleMessagesLoaded(CHANNEL, [shared('f1', 'ada', 'Ada Lovelace', files[0], 1), shared('f2', 'me', 'Me', files[1], 2)], false);
      },
      signals: { cursors: () => new Map(), subscribe: () => () => {} },
      attachments: wire(mode, files),
      readFile: async (file) => new Uint8Array(await file.arrayBuffer()),
      shareFile: async () => {},
    };
    return createNodeTransport({
      channelId: CHANNEL, nodeId: 'harness-node', channelName: 'Engine room', self: { cid: 1n, username: 'me', displayName: 'Me' },
      sendGate: createValueStore('harness-files-gate', 'allowed'), io, mintLocalId: () => `local-${Date.now()}`, now: Date.now,
      roster: createValueStore('harness-files-roster', ROSTER), clock: browserClock, opening: nodeOpeningPorts('harness-node', () => false),
    });
  }, [mode]);
  return (
    <div style={{ height: '100vh' }} className="bg-background">
      <ConfirmDialogProvider><TooltipProvider>
        <ChatPane transport={transport} pause={null} header={() => <NodeChatHeader roster={ROSTER} typing={[]} rules={null} />} />
      </TooltipProvider></ConfirmDialogProvider>
    </div>
  );
}

export const SERVER_FILE_SCENARIOS = Object.fromEntries(
  ['server-files', 'server-files-refusing', 'server-files-sharing'].map((mode) => [mode, () => <ServerFilesScenario mode={mode} />]),
);
