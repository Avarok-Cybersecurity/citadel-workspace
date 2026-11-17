/**
 * The native-picker send shipped offers with no `expiresAt`.
 *
 * The expiry feature exists to remove the eternal live-looking Accept button:
 * every browser-file offer is stamped `Date.now() + FILE_TRANSFER_REQUEST_
 * TTL_MS`, the sweep expires it, and the announcement carries the deadline to
 * the peer as `expiry_timestamp`. The native-picker path builds its transfer
 * record by hand and omitted the field — and `expiredTransferIds` deliberately
 * never expires a record with no `expiresAt` (inventing a deadline for a
 * legacy offer would cancel a transfer its sender still believes is open). So
 * every native-picker offer was immortal on both sides: the twin send path
 * reintroduced exactly the defect the feature was built to close.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendFileWithNativePicker } from '../send-with-native-picker';
import { expiredTransferIds } from '../expire-transfers';
import { FILE_TRANSFER_REQUEST_TTL_MS } from '@/types/messaging-layer';
import type { FileTransfer } from '../types';
import type { LifecycleDeps } from '../transfer-lifecycle';
import { ONLINE_PEER_QUEUE } from './online-peer-queue';

const NOW: number = 1_700_000_000_000;

interface Harness {
  deps: LifecycleDeps;
  stored: FileTransfer[];
  announcedVia: FileTransfer[];
}

function harness(): Harness {
  const stored: FileTransfer[] = [];
  const announcedVia: FileTransfer[] = [];
  const deps: LifecycleDeps = {
    io: {
      getCurrentCid: async (): Promise<bigint> => 100n,
      executeIntent: async (intent: { type: string; transfer?: FileTransfer }): Promise<unknown> => {
        if (intent.type === 'pick-file') {
          return { file_path: '/home/alice/report.pdf', file_name: 'report.pdf', file_size: 2_048n };
        }
        if (intent.type === 'send-file-via-protocol' && intent.transfer) {
          // The executor announces this record; the recipient's bubble — and
          // its expiry_timestamp — is built from it.
          announcedVia.push(intent.transfer);
        }
        return undefined;
      },
    },
    state: { setTransfer: (t: FileTransfer): void => { stored.push(t); } },
    saveTransfer: async (): Promise<void> => undefined,
    emitStateChange: (): void => undefined,
    saveSettings: async (): Promise<void> => undefined,
    // The channel opens at once here; a-file-send-opens-the-peer-channel-first covers it.
    openPeerChannel: async (): Promise<boolean> => true,
    // An agent that does not stage uploads: the inline route, 16 MB.
    agentStagesUploads: async (): Promise<boolean> => false,
    queue: ONLINE_PEER_QUEUE,
  } as unknown as LifecycleDeps;
  return { deps, stored, announcedVia };
}

afterEach((): void => {
  vi.restoreAllMocks();
});

describe('a native-picker offer', () => {
  it('carries the same TTL deadline as the browser-file path', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const { deps, stored, announcedVia } = harness();

    await sendFileWithNativePicker(deps, '42');

    expect(stored).toHaveLength(1);
    expect(
      stored[0].expiresAt,
      'a native-picker offer without expiresAt is immortal: the sweep skips deadline-less records by design',
    ).toBe(NOW + FILE_TRANSFER_REQUEST_TTL_MS);
    // The record handed to the announcing executor is the stamped one.
    expect(announcedVia).toHaveLength(1);
    expect(announcedVia[0].expiresAt).toBe(NOW + FILE_TRANSFER_REQUEST_TTL_MS);
  });

  it('expires under the real sweep predicate once the TTL lapses — and not before', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const { deps, stored } = harness();

    await sendFileWithNativePicker(deps, '42');
    const offer: FileTransfer = stored[0];

    // Not before: an offer that expires the moment it is made would be the
    // opposite over-correction.
    expect(expiredTransferIds([offer], NOW + FILE_TRANSFER_REQUEST_TTL_MS - 1)).toEqual([]);
    expect(expiredTransferIds([offer], NOW + FILE_TRANSFER_REQUEST_TTL_MS)).toEqual([offer.id]);
  });

  it('still starts at pending with the picked file\'s identity', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const { deps, stored } = harness();

    await sendFileWithNativePicker(deps, '42');

    expect(stored[0]).toMatchObject({
      state: 'pending', fileName: 'report.pdf', fileSize: 2048, isIncoming: false,
    });
  });
});
