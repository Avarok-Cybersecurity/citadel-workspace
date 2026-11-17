/**
 * The first file offer from a peer asks whether to always accept their files, once.
 *
 * Owner: "When a download request is sent to a user to accept for the first time, show a modal
 * asking the user if they want to always accept, as well as directions on how to change that
 * option in the chat settings modal in the future." Before this, nothing asked: the only way to
 * stop answering every offer was to find the switch in Chat settings unprompted.
 *
 * The answer is stored where the chat settings keep it (the real service, over jsdom's
 * localStorage). An offer arrives through handleTransferRequest, the function the service runs
 * on an incoming FileTransferRequest, so the dialog hears whatever that emits: it once listened
 * for STATE_CHANGED, which an arrival never emits, and CI saw no dialog until an offer had been
 * accepted by hand. Mocked: the agent socket the service module would otherwise open; the
 * service's list of this peer's transfers, which that arrival writes to its own state; and the
 * arrival's session lookup (its only use of the IO port).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendRequest: async (): Promise<void> => undefined,
    sendP2PMessageReliable: async (): Promise<void> => undefined,
    canSendRequests: (): boolean => false,
  },
}));

import { fileTransferService } from '@/lib/file-transfer';
import { handleTransferRequest, type AsyncTransferDeps } from '@/lib/file-transfer/async-transfers';
import { FileTransferState } from '@/lib/file-transfer/state';
import type { FileTransferIO } from '@/lib/file-transfer/io';
import { MessagingLayerType } from '@/types/messaging-layer';
import type { FileTransfer } from '@/lib/file-transfer/types';
import { AlwaysAcceptDialog } from '../AlwaysAcceptDialog';
import { useAlwaysAcceptPrompt } from '../hooks/useAlwaysAcceptPrompt';

// A fresh peer per test: the service keeps settings in memory as well as in storage.
let PEER: bigint = 4242n;
let transfers: FileTransfer[] = [];

function offer(id: string, at: number): FileTransfer {
  return {
    id, fileName: `${id}.pdf`, fileSize: 10, fileType: 'application/pdf', state: 'pending', progress: 0,
    senderCid: PEER.toString(), recipientCid: '7', createdAt: at, updatedAt: at, isIncoming: true,
  };
}

function Harness({ accept }: { accept: (id: string) => Promise<void> }): JSX.Element {
  return <AlwaysAcceptDialog prompt={useAlwaysAcceptPrompt(PEER, accept)} peerName="Bob" />;
}

const OWN_CID: bigint = 7n;
const arrival: AsyncTransferDeps = {
  state: new FileTransferState(),
  io: { getCurrentCid: async (): Promise<bigint> => OWN_CID } as unknown as FileTransferIO,
  emitStateChange: (): void => undefined,
  saveTransfer: async (): Promise<void> => undefined,
};

async function arrive(t: FileTransfer): Promise<void> {
  transfers = [...transfers, t];
  const layer = { type: MessagingLayerType.FileTransferRequest, transfer_id: t.id, file_name: t.fileName, file_size: t.fileSize, file_type: t.fileType, timestamp: t.createdAt } as const;
  await act(async (): Promise<void> => {
    await handleTransferRequest(arrival, layer, t.senderCid, (): boolean => false, async (): Promise<void> => undefined);
  });
}

beforeEach((): void => {
  PEER += 1n;
  localStorage.clear();
  transfers = [];
  vi.spyOn(fileTransferService, 'getTransfersForPeer').mockImplementation((): FileTransfer[] => transfers);
});
afterEach((): void => { cleanup(); vi.restoreAllMocks(); });

describe('the first offer from a peer', () => {
  it('asks, with directions to the chat settings switch', async () => {
    render(<Harness accept={async (): Promise<void> => undefined} />);
    await arrive(offer('first', 1));
    expect(screen.getByRole('dialog', { name: 'Always accept files from Bob?' })).toBeTruthy();
    const directions: string = screen.getByTestId('always-accept-directions').textContent ?? '';
    expect(directions).toMatch(/Chat settings.*File.*Auto-accept files from Bob/);
  });

  it('"always" turns on the chat setting, accepts this offer, and never asks again', async () => {
    const accepted: string[] = [];
    render(<Harness accept={async (id: string): Promise<void> => { accepted.push(id); }} />);
    await arrive(offer('first', 1));
    fireEvent.click(screen.getByRole('button', { name: 'Always accept from Bob' }));
    await waitFor((): void => expect(accepted).toEqual(['first']));
    expect(fileTransferService.getSettings(PEER.toString())).toMatchObject({ autoAccept: true, autoAcceptAnswered: true });
    await arrive(offer('second', 2));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('"ask me each time" keeps asking per file, but never shows this question again', async () => {
    const accepted: string[] = [];
    const { unmount } = render(<Harness accept={async (id: string): Promise<void> => { accepted.push(id); }} />);
    await arrive(offer('first', 1));
    fireEvent.click(screen.getByRole('button', { name: 'Ask me each time' }));
    await waitFor((): void => expect(fileTransferService.getSettings(PEER.toString()).autoAcceptAnswered).toBe(true));
    expect(accepted).toEqual([]);
    expect(fileTransferService.getAutoAccept(PEER.toString())).toBe(false);
    unmount();
    render(<Harness accept={async (): Promise<void> => undefined} />);
    await arrive(offer('second', 2));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closing without an answer asks again on the next offer, not this one', async () => {
    render(<Harness accept={async (): Promise<void> => undefined} />);
    await arrive(offer('first', 1));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    transfers = transfers.map((t: FileTransfer): FileTransfer => ({ ...t, state: 'declined' }));
    await arrive(offer('second', 2));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
