/**
 * A send the agent never confirmed goes again by itself after a reload; one
 * that cannot is said plainly, with a one-click resend for the sender only.
 *
 * The browser cannot re-read a picked File after a reload, so a send still being
 * staged on the agent when the page went away had nothing to go again from: it
 * was restored as failed with "Ask them to send it again" -- on the sender's own
 * bubble. Now its bytes are kept in this browser while it is open, within the
 * held-send budget (send-queue.ts), and a restored send goes again under the
 * same transfer id and offer message id, so the recipient sees one transfer.
 *
 * Real: the lifecycle, the hold/release logic, restore and the views. Doubled:
 * the agent (executeIntent) and the File store (a Map, as send-queue-io's
 * in-memory half).
 */
import { describe, it, expect, vi } from 'vitest';
import type { FileTransfer } from '../types';
import { sendFile, type LifecycleDeps } from '../transfer-lifecycle';
import { releaseHeldSends, type SendQueuePort } from '../send-queue-hold';
import { canKeepBytes, MAX_QUEUED_BYTES } from '../send-queue';
import { FileTransferState } from '../state';
import { transferView } from '../transfer-view';
import { restoreTransfer } from '../restore-transfer';
import { buildTransferAnnouncement } from '../transfer-announcement';
import { resendLostTransfer } from '../resend-transfer';
import { getStatusContent } from '@/components/p2p/bubbles/file-transfer-helpers';

const FILE: File = new File(['jpeg bytes'], 'photo.jpg', { type: 'image/jpeg' });

interface World { deps: LifecycleDeps; intents: Array<Record<string, unknown>>; held: Map<string, File> }

function world(): World {
  const intents: Array<Record<string, unknown>> = [];
  const held: Map<string, File> = new Map<string, File>();
  const queue: SendQueuePort = {
    peerOnlineStatus: (): boolean => true,
    peerName: (): string => 'Alexi',
    hold: async (id: string, file: File): Promise<boolean> => { held.set(id, file); return true; },
    take: async (id: string): Promise<File | undefined> => held.get(id),
    release: async (id: string): Promise<void> => { held.delete(id); },
  };
  const deps: LifecycleDeps = {
    state: new FileTransferState(),
    io: {
      getCurrentCid: async (): Promise<bigint> => 7n,
      generateThumbnail: async (): Promise<string> => 't',
      executeIntent: async (intent: Record<string, unknown>): Promise<unknown> => { intents.push(intent); return undefined; },
    },
    emitStateChange: (): void => undefined,
    saveTransfer: async (): Promise<void> => undefined,
    saveSettings: async (): Promise<void> => undefined,
    openPeerChannel: async (): Promise<boolean> => true,
    agentStagesUploads: async (): Promise<boolean> => false,
    queue,
  } as unknown as LifecycleDeps;
  return { deps, intents, held };
}

/** A record as the page before the reload persisted it. */
function persisted(over: Partial<FileTransfer>): Partial<FileTransfer> {
  return {
    id: 'out-1', fileName: 'photo.jpg', fileSize: 10, fileType: 'image/jpeg', progress: 30,
    senderCid: '7', recipientCid: '42', createdAt: 1, updatedAt: 2, isIncoming: false,
    offerMessageId: 'offer-msg-1', ...over,
  };
}

describe('a send, while it is open', () => {
  it('keeps its bytes so a reload can send it again', async () => {
    const w: World = world();
    const id: string = await sendFile(w.deps, '42', FILE);
    await vi.waitFor(() => expect(w.deps.state.getTransfer(id)?.bytesKept).toBe(true));
    expect(w.held.get(id)).toBe(FILE);
  });

  it('keeps them only within what this browser keeps for held sends', () => {
    const big: FileTransfer = { ...(persisted({ state: 'transferring', bytesKept: true }) as FileTransfer), fileSize: MAX_QUEUED_BYTES };
    expect(canKeepBytes([], 10)).toBe(true);
    expect(canKeepBytes([big], 1)).toBe(false);
    expect(canKeepBytes([{ ...big, state: 'complete' }], 1), 'a finished send no longer holds its share').toBe(true);
  });
});

describe('after a reload, a send the agent never confirmed', () => {
  it('goes again by itself, as the same transfer and the same offer', async () => {
    const restored: FileTransfer | null = restoreTransfer(persisted({ state: 'preparing', bytesKept: true }));
    expect(restored).toMatchObject({ state: 'queued', resuming: true });
    expect(transferView({}, restored ?? undefined, false, 'sent').resuming).toBe(true);
    expect(getStatusContent('queued', true, undefined, true).text).toBe('Resuming…');

    const w: World = world();
    w.deps.state.setTransfer(restored as FileTransfer);
    w.held.set('out-1', FILE);
    await releaseHeldSends(w.deps, '7', '42');

    expect(w.intents).toEqual([expect.objectContaining({ type: 'send-transfer-request', transfer: expect.objectContaining({ id: 'out-1' }) })]);
    expect(buildTransferAnnouncement(restored as FileTransfer).message_id).toBe('offer-msg-1');
    expect(w.deps.state.getTransfer('out-1')?.resuming).toBe(false);
  });

  it('that was offered but not confirmed goes again too, rather than failing', () => {
    expect(restoreTransfer(persisted({ state: 'pending', bytesKept: true }))).toMatchObject({ state: 'queued', resuming: true });
  });
});

describe('after a reload, a send with nothing kept', () => {
  const lost: FileTransfer | null = restoreTransfer(persisted({ state: 'preparing' }));

  it('says plainly what happened, and never tells anyone to ask', () => {
    expect(lost?.state).toBe('error');
    expect(lost?.errorMessage).toMatch(/reloaded before this file was sent/);
    expect(lost?.errorMessage).not.toMatch(/ask/i);
  });

  it('offers the sender, and only the sender, one click to send it again', () => {
    expect(transferView({}, lost ?? undefined, false, 'sent').resendable).toBe(true);
    expect(transferView({}, lost ?? undefined, false, 'received').resendable).toBe(false);
  });

  it('sends the picked file to the same person once, then stops offering', async () => {
    const record: FileTransfer = { ...(lost as FileTransfer) };
    const sendFileTo: ReturnType<typeof vi.fn> = vi.fn(async (): Promise<string> => 'new-id');
    const deps: Parameters<typeof resendLostTransfer>[0] = {
      getTransfer: (id: string): FileTransfer | undefined => (id === record.id ? record : undefined),
      sendFile: sendFileTo, saveTransfer: async (): Promise<void> => undefined, emitStateChange: (): void => undefined,
    };
    await expect(resendLostTransfer(deps, record.id, FILE)).resolves.toBe('new-id');
    expect(sendFileTo).toHaveBeenCalledWith('42', FILE);
    await expect(resendLostTransfer(deps, record.id, FILE)).rejects.toThrow(/could not be resumed/);
  });
});
