/**
 * The I/O behind held sends (send-queue.ts): where the Files are kept, and how
 * a returning peer is noticed.
 *
 * Kept in memory and in IndexedDB (structured clone stores a File as is), so a
 * held send survives a reload. If storage refuses it, it is kept in memory only
 * and a reload loses it; the release then says so instead of sending nothing.
 *
 * A peer is "back" when its message channel comes up, when a message from it
 * arrives, or when the presence poll reports it online -- checked every
 * RELEASE_CHECK_MS, and only while something is held.
 */
import { eventEmitter } from '../event-emitter';
import { debugLog } from '@/lib/debug-config';
import { dbDelete, dbGet, dbPut } from '../storage-utils';
import { listedPeerUsername } from '../member-names';
import { FILE_TRANSFER_EVENTS } from './events';
import { peersWithQueued } from './send-queue';
import { releaseHeldSends, type HoldDeps, type SendQueuePort } from './send-queue-hold';
import type { FileTransfer } from './types';
import { isTerminalTransferState } from './transfer-outcome';

/** How often held sends are checked against the presence poll. */
export const RELEASE_CHECK_MS: number = 30_000;

const keyFor = (transferId: string): string => `citadel:held-file:${transferId}`;

interface Presence { peerOnlineStatus: (peerCid: bigint) => boolean | null }

const inMemory: Map<string, File> = new Map<string, File>();
let presence: Presence | null = null;

export const sendQueuePort: SendQueuePort = {
  peerOnlineStatus: (peerCid: bigint): boolean | null => presence?.peerOnlineStatus(peerCid) ?? null,
  peerName: (peerCid: string): string => listedPeerUsername(BigInt(peerCid)) ?? 'your contact',
  hold: async (transferId: string, file: File): Promise<boolean> => {
    inMemory.set(transferId, file);
    try {
      await dbPut('keyValue', keyFor(transferId), file);
      return true;
    } catch (error) {
      debugLog('SendQueue', 'held file kept in memory only; a reload will lose it', error);
      return false;
    }
  },
  take: async (transferId: string): Promise<File | undefined> =>
    inMemory.get(transferId) ?? (await dbGet<File>('keyValue', keyFor(transferId)).catch((): undefined => undefined)),
  release: async (transferId: string): Promise<void> => {
    inMemory.delete(transferId);
    await dbDelete('keyValue', keyFor(transferId)).catch((error: unknown): void => debugLog('SendQueue', 'could not delete a held file', error));
  },
};

/** Release, wire triggers, and drop the File of a held send that ended another way. */
export function wireSendQueue(deps: HoldDeps, currentCid: () => Promise<bigint | null>): void {
  const releasing: Set<string> = new Set<string>();
  const release = async (peerCid: bigint): Promise<void> => {
    const own: bigint | null = await currentCid();
    const key: string = peerCid.toString();
    if (own === null || releasing.has(key)) return;
    releasing.add(key);
    try {
      await releaseHeldSends(deps, own.toString(), key);
    } finally {
      releasing.delete(key);
    }
  };
  const onPeer = (payload: { peerCid?: unknown } | undefined): void => {
    if (typeof payload?.peerCid === 'bigint') release(payload.peerCid).catch((e: unknown): void => debugLog('SendQueue', 'release failed', e));
  };
  eventEmitter.on('p2p:channel-ready', onPeer);
  eventEmitter.on('p2p:message-received', onPeer);
  // Cancelled or expired while held: its File must not stay in storage.
  eventEmitter.on<FileTransfer>(FILE_TRANSFER_EVENTS.STATE_CHANGED, (t: FileTransfer): void => {
    if (!t.isIncoming && isTerminalTransferState(t.state)) void sendQueuePort.release(t.id);
  });
  void import('../p2p-auto-connect-service').then(({ p2pAutoConnectService }): void => { presence = p2pAutoConnectService; });
  setInterval((): void => {
    void currentCid().then((own: bigint | null): void => {
      if (own === null) return;
      for (const peer of peersWithQueued(deps.state.getAllTransfers(), own.toString())) {
        if (sendQueuePort.peerOnlineStatus(BigInt(peer)) === true) onPeer({ peerCid: BigInt(peer) });
      }
    });
  }, RELEASE_CHECK_MS);
}
