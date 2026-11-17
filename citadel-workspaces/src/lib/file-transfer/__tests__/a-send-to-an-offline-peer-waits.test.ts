/**
 * A send to an offline peer waits for them, and goes when they are back.
 * The decisions (send-queue.ts) and the lifecycle wiring around them.
 */
import { describe, it, expect } from 'vitest';
import {
  shouldQueue, waitingText, queueRefusal, queuedFor, peersWithQueued, MAX_QUEUED_FILES, MAX_QUEUED_BYTES,
} from '../send-queue';
import type { FileTransfer } from '../types';
import { sendFile, cancelTransfer, type LifecycleDeps } from '../transfer-lifecycle';
import { releaseHeldSends, type SendQueuePort } from '../send-queue-hold';
import { FileTransferState } from '../state';
import { transferView } from '../transfer-view';
import { restoreTransfer } from '../restore-transfer';

function t(id: string, over: Partial<FileTransfer> = {}): FileTransfer {
  return {
    id, fileName: `${id}.png`, fileSize: 10, fileType: 'image/png', state: 'queued', progress: 0,
    senderCid: '7', recipientCid: '42', createdAt: 1, updatedAt: 1, isIncoming: false, ...over,
  };
}

describe('shouldQueue', () => {
  it('waits for a peer known to be offline, without waiting on the channel', () => {
    expect(shouldQueue(false, true)).toBe(true);
  });
  it('sends to a peer known to be online even when the channel was slow to confirm', () => {
    expect(shouldQueue(true, false)).toBe(false);
  });
  it('waits when nothing is known and no channel opened, sends when one did', () => {
    expect(shouldQueue(null, false)).toBe(true);
    expect(shouldQueue(null, true)).toBe(false);
  });
});

describe('the waiting line', () => {
  it('names who it waits for', () => {
    expect(waitingText('Alexi')).toBe('Will send when Alexi is online');
  });
});

describe('queueRefusal', () => {
  it('holds a file while within both bounds', () => {
    expect(queueRefusal([t('a')], 10)).toBeNull();
  });
  it('refuses past the file-count bound', () => {
    const many: FileTransfer[] = Array.from({ length: MAX_QUEUED_FILES }, (_v, i: number) => t(`q${i}`));
    expect(queueRefusal(many, 1)).toMatch(/already waiting/);
  });
  it('refuses past the byte bound, counting only held sends', () => {
    expect(queueRefusal([t('a', { fileSize: MAX_QUEUED_BYTES })], 1)).toMatch(/512 MB/);
    expect(queueRefusal([t('done', { state: 'complete', fileSize: MAX_QUEUED_BYTES })], 1)).toBeNull();
  });
});

describe('what a returning peer releases', () => {
  const held: FileTransfer[] = [
    t('later', { createdAt: 5 }),
    t('first', { createdAt: 2 }),
    t('other-peer', { recipientCid: '99' }),
    t('other-account', { senderCid: '8' }),
    t('incoming', { isIncoming: true }),
    t('sent', { state: 'complete' }),
  ];
  it('is this account\'s held sends to that peer, oldest first', () => {
    expect(queuedFor(held, '7', '42').map((x) => x.id)).toEqual(['first', 'later']);
  });
  it('lists the peers this account is waiting for', () => {
    expect(peersWithQueued(held, '7').sort()).toEqual(['42', '99']);
  });
});

interface World { deps: LifecycleDeps; intents: Array<Record<string, unknown>>; held: Map<string, File>; channelWaits: number }

function world(peerOnline: boolean | null): World {
  const intents: Array<Record<string, unknown>> = [];
  const held: Map<string, File> = new Map<string, File>();
  const w: World = { deps: undefined as unknown as LifecycleDeps, intents, held, channelWaits: 0 };
  const queue: SendQueuePort = {
    peerOnlineStatus: (): boolean | null => peerOnline,
    peerName: (): string => 'Alexi',
    hold: async (id: string, file: File): Promise<boolean> => { held.set(id, file); return true; },
    take: async (id: string): Promise<File | undefined> => held.get(id),
    release: async (id: string): Promise<void> => { held.delete(id); },
  };
  w.deps = {
    state: new FileTransferState(),
    io: {
      getCurrentCid: async (): Promise<bigint> => 7n,
      generateThumbnail: async (): Promise<string> => 't',
      // As the real executor does: the agent holds the file (staging), then the offer goes out.
      executeIntent: async (intent: Record<string, unknown>): Promise<unknown> => {
        intents.push(intent);
        (intent.staging as { onStaged?: () => void } | undefined)?.onStaged?.();
        return undefined;
      },
    },
    emitStateChange: (): void => undefined,
    saveTransfer: async (): Promise<void> => undefined,
    saveSettings: async (): Promise<void> => undefined,
    openPeerChannel: async (): Promise<boolean> => { w.channelWaits += 1; return false; },
    // An agent that does not stage uploads: the inline route, 16 MB.
    agentStagesUploads: async (): Promise<boolean> => false,
    queue,
  } as unknown as LifecycleDeps;
  return w;
}

const FILE: File = new File(['abc'], 'shot.png', { type: 'text/plain' });

describe('a send to an offline peer', () => {
  it('is held, says who it waits for, sends nothing, and does not wait on a channel', async () => {
    const w: World = world(false);
    const id: string = await sendFile(w.deps, '42', FILE);
    const record: FileTransfer | undefined = w.deps.state.getTransfer(id);
    expect(record?.state).toBe('queued');
    expect(transferView({}, record, false, 'sent').reason).toBe('Will send when Alexi is online');
    expect(w.intents).toEqual([]);
    expect(w.held.get(id)).toBe(FILE);
    expect(w.channelWaits).toBe(0);
  });

  it('goes the ordinary way when the peer is back, offer not shown twice, and keeps its File until it ends', async () => {
    const w: World = world(false);
    const id: string = await sendFile(w.deps, '42', FILE);
    await releaseHeldSends(w.deps, '7', '42');
    expect(w.intents).toEqual([expect.objectContaining({ type: 'send-transfer-request', offerAlreadyShown: true })]);
    expect(w.deps.state.getTransfer(id)?.state).toBe('pending');
    // Kept until the transfer ends (send-queue-io drops it then), so a reload
    // before the agent confirms the send can still send it again.
    expect(w.held.has(id)).toBe(true);
  });

  it('fails plainly, rather than sending nothing, when its File was not kept', async () => {
    const w: World = world(false);
    const id: string = await sendFile(w.deps, '42', FILE);
    w.held.clear();
    await releaseHeldSends(w.deps, '7', '42');
    // Says what happened, and offers the sender the one click (reload-recovery.ts).
    expect(w.deps.state.getTransfer(id)).toMatchObject({ state: 'error', errorMessage: expect.stringMatching(/could not keep a copy/), resendable: true });
    expect(w.deps.state.getTransfer(id)?.errorMessage).not.toMatch(/ask/i);
    expect(w.intents).toEqual([]);
  });

  it('cancels without telling a peer it never offered anything to', async () => {
    const w: World = world(false);
    const id: string = await sendFile(w.deps, '42', FILE);
    await cancelTransfer(w.deps, id);
    expect(w.deps.state.getTransfer(id)?.state).toBe('cancelled');
    expect(w.intents).toEqual([]);
    expect(w.held.has(id)).toBe(false);
  });

  it('is sent at once to a peer known to be online', async () => {
    const w: World = world(true);
    const id: string = await sendFile(w.deps, '42', FILE);
    // The bubble is shown first ('preparing'), so the offer is "already shown" when it goes.
    await new Promise((r: (v: unknown) => void) => setTimeout(r, 0));
    expect(w.intents).toEqual([expect.objectContaining({ type: 'send-transfer-request', offerAlreadyShown: true })]);
    expect(w.deps.state.getTransfer(id)?.state).toBe('pending');
  });

  it('comes back from a reload still held, still naming who it waits for', () => {
    const restored: FileTransfer | null = restoreTransfer({ ...t('h'), waitingFor: 'Alexi' });
    expect(restored).toMatchObject({ state: 'queued', waitingFor: 'Alexi' });
  });
});
