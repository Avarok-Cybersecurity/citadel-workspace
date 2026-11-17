/**
 * A received file's bubble does what its hint says.
 *
 * Live (admin-lab): a completed direct P2P transfer read "Downloaded — Click to
 * open file", and clicking did nothing: the click required `virtual_path`,
 * which only a staged (server) transfer carries. It now hands the transfer to
 * the chat, which downloads the original (useP2PFileTransfer). Mocked
 * as in a-transfer-bubble-tells-the-truth: the agent socket and the tab's
 * session lookup, the two I/O boundaries the bubble's service reaches.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@/lib/tab-context', () => ({
  getSelectedUser: async (): Promise<{ selectedCid: bigint }> => ({ selectedCid: 7n }),
}));
vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendRequest: async (): Promise<void> => undefined,
    sendP2PMessageReliable: async (): Promise<void> => undefined,
    ensureMessengerOpen: async (): Promise<boolean> => false,
    canSendRequests: (): boolean => false,
  },
}));

import { FileTransferBubble } from '../FileTransferBubble';
import type { P2PMessage } from '@/lib/p2p';

afterEach(cleanup);

function received(): P2PMessage {
  return {
    id: 'msg-t1', content: 'File transfer: a.bin', senderCid: 42n, recipientCid: 7n,
    timestamp: 1, status: 'delivered', message_type: 'file_transfer', transfer_id: 't1',
    file_name: 'a.bin', file_size: 3000, transfer_mode: 'p2p', transfer_state: 'complete',
  } as P2PMessage;
}

describe('a received file', () => {
  it('opens by transfer even though a direct transfer has no virtual path', () => {
    const opened: string[] = [];
    render(<FileTransferBubble message={received()} isOwn={false} onOpen={(id: string): void => { opened.push(id); }} />);
    fireEvent.click(screen.getByText('a.bin'));
    expect(opened).toEqual(['t1']);
  });

  it('says what the click does', () => {
    render(<FileTransferBubble message={received()} isOwn={false} onOpen={(): void => undefined} />);
    expect(screen.getByText(/click to download/i)).toBeInTheDocument();
    expect(screen.queryByText(/click to open file/i)).toBeNull();
  });
});
