/**
 * A file sent into a node channel shows how much of it the server has stored, then that it is
 * shared, or the server's reason for refusing it. Before, the toast said "Preparing to send" after
 * the upload had already finished, and a large file showed nothing while it went.
 *
 * Real: the node files port, the send hook, the status strip and the app's Sonner toaster. Stand-in:
 * the workspace server behind the attachment wire, whose answers the test releases one at a time,
 * and the theme provider the toaster reads.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import type { ChatAttachmentRefusal, ChatAttachmentsRequest, ChatAttachmentsResponse } from 'citadel-workspace-client-ts';

vi.mock('next-themes', (): { useTheme: () => { theme: string } } => ({ useTheme: (): { theme: string } => ({ theme: 'light' }) }));

import { Toaster } from '@/components/ui/sonner';
import { useP2PFileTransfer } from '@/components/p2p/hooks/useP2PFileTransfer';
import { nodeFiles } from '@/lib/chat/transport/node-files';
import { CHAT_ATTACHMENT_CHUNK_BYTES } from '@/lib/chat/attachments/attachment-wire';
import type { FilePort } from '@/lib/chat/transport/chat-transport';
import type { NodeChatIO } from '@/lib/chat/transport/node-chat-io';
import { ServerUploadStatus } from '../ServerUploadStatus';

const FOUR_CHUNKS: Uint8Array = new Uint8Array(CHAT_ATTACHMENT_CHUNK_BYTES * 4);

interface HeldServer { io: Pick<NodeChatIO, 'attachments' | 'shareFile' | 'readFile'>; asked: () => Promise<void>; answer: () => void }

/**
 * A server that holds each chunk's answer until `answer()` releases it; `refusal.at` refuses that
 * chunk instead. `asked()` resolves once a chunk is waiting, so the test answers a request that was
 * made rather than one it hopes was made: a fixed sleep there let a loaded machine answer nothing.
 */
function server(refusal: { at: number; refusal: ChatAttachmentRefusal } | null): HeldServer {
  const listeners: Set<(a: ChatAttachmentsResponse) => void> = new Set();
  const held: ChatAttachmentsResponse[] = [];
  let wake: (() => void) | null = null;
  return {
    asked: (): Promise<void> => (held.length > 0 ? Promise.resolve() : new Promise((r: () => void): void => { wake = r; })),
    answer: (): void => {
      const next: ChatAttachmentsResponse | undefined = held.shift();
      if (!next) throw new Error('answered a chunk that was never asked for');
      listeners.forEach((l: (a: ChatAttachmentsResponse) => void): void => l(next));
    },
    io: {
      readFile: async (): Promise<Uint8Array> => FOUR_CHUNKS,
      shareFile: async (): Promise<void> => undefined,
      attachments: {
        answerDeadlineMs: 60_000,
        onAnswer: (l: (a: ChatAttachmentsResponse) => void): (() => void) => { listeners.add(l); return (): void => { listeners.delete(l); }; },
        send: async (request: ChatAttachmentsRequest): Promise<void> => {
          if (!('UploadChunk' in request)) throw new Error('only uploads here');
          const { node_id, sha256, index, total_chunks } = request.UploadChunk;
          held.push(refusal?.at === index
            ? { Refused: { node_id, attachment_id: sha256, refusal: refusal.refusal } }
            : { ChunkStored: { node_id, attachment_id: sha256, index, stored: index + 1 === total_chunks } });
          const woken: (() => void) | null = wake; wake = null; woken?.();
        },
      },
    },
  };
}

function Channel({ files }: { files: FilePort }): JSX.Element {
  const transfer: ReturnType<typeof useP2PFileTransfer> = useP2PFileTransfer({ files, recipient: 'Engine room' });
  return (
    <>
      <button type="button" onClick={(): void => { transfer.handleSendFile(new File(['x'], 'plan.pdf')).catch((): void => undefined); }}>send</button>
      <ServerUploadStatus view={transfer.upload} />
    </>
  );
}

async function answer(wire: HeldServer, times: number): Promise<void> {
  for (let i: number = 0; i < times; i++) {
    // Each chunk is sent only after the last one's answer, so wait until it is asked for.
    await act(async (): Promise<void> => { await wire.asked(); wire.answer(); });
  }
}

afterEach(cleanup);

describe('a channel upload', () => {
  it('shows what the server has stored, then that the file is shared, and never "Preparing to send"', async () => {
    const wire: HeldServer = server(null);
    render(<><Toaster /><Channel files={nodeFiles(wire.io, 'room-1')} /></>);
    act((): void => { screen.getByText('send').click(); });
    await waitFor((): void => { expect(screen.getByRole('progressbar', { name: 'Upload of plan.pdf' })).toHaveAttribute('aria-valuenow', '0'); });
    await answer(wire, 2);
    expect(screen.getByRole('progressbar', { name: 'Upload of plan.pdf' })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByRole('status')).toHaveTextContent('plan.pdf: 50 percent uploaded');
    await answer(wire, 2);
    expect(await screen.findByText('Shared plan.pdf with the channel')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('plan.pdf is shared with the channel');
    expect(screen.queryByText(/Preparing to send/)).toBeNull();
  });

  it('shows the server\'s reason when it refuses, once, and never as shared', async () => {
    const wire: HeldServer = server({ at: 1, refusal: { TooLarge: { max_bytes: 10n * 1024n * 1024n } } });
    render(<><Toaster /><Channel files={nodeFiles(wire.io, 'room-1')} /></>);
    act((): void => { screen.getByText('send').click(); });
    await answer(wire, 2);
    const strip: HTMLElement = await screen.findByTestId('server-upload');
    expect(strip).toHaveTextContent('plan.pdf was not shared');
    expect(strip).toHaveTextContent('Files in this channel can be at most 10 MB.');
    expect(screen.getByRole('status')).toHaveTextContent('plan.pdf was not shared. Files in this channel can be at most 10 MB.');
    expect(screen.queryByText('Failed to send file')).toBeNull();
    act((): void => { screen.getByRole('button', { name: 'Dismiss' }).click(); });
    expect(screen.queryByTestId('server-upload')).toBeNull();
  });
});
