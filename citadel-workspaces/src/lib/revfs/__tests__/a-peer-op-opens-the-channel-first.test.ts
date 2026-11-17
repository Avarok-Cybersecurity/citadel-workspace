/**
 * Every peer-scoped RE-VFS operation opens the P2P channel before it sends.
 *
 * Measured live after a server restart: a chat message to the peer went through
 * -- MessageSender opens the channel first -- while a P2P Storage upload to the
 * same peer failed with "Peer connection for <cid> not found", and kept failing
 * until something else reopened the channel. The file-transfer path had been
 * given this fix (open-peer-channel.ts); RE-VFS, a separate sender, had not.
 *
 * Server-scoped operations (peerCid null) go to the server and must not wait on
 * a peer at all.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { RevfsIO, type RevfsIODeps } from '../revfs-io';
import type { RevfsOperation } from '@/types/revfs-types';

const LOCAL: bigint = 7n;
const PEER: bigint = 9n;
const events: string[] = [];

const deps: RevfsIODeps = {
  openPeerChannel: async (peerCid: bigint): Promise<boolean> => {
    events.push(`open:${peerCid}`);
    return true;
  },
  sendP2PMessageReliable: async (_local: bigint, peerCid: bigint): Promise<void> => {
    events.push(`p2p:${peerCid}`);
  },
  getCurrentCid: async (): Promise<bigint | null> => LOCAL,
  sendInternalServiceRequest: async (request: unknown): Promise<void> => {
    events.push(`request:${Object.keys(request as Record<string, unknown>)[0]}`);
  },
};

const OP: RevfsOperation = {
  op_id: 'op-1',
  op_type: 'PlaceFile',
  path: '/a.bin',
  timestamp: 1,
  origin_cid: LOCAL,
} as RevfsOperation;

async function settled(): Promise<void> {
  for (let i: number = 0; i < 5; i++) await Promise.resolve();
}

describe('a peer-scoped RE-VFS operation', () => {
  beforeEach(() => {
    events.length = 0;
  });

  it('opens the channel before uploading bytes to the peer', async () => {
    void new RevfsIO(deps).execute({ type: 'backend-send-file', cid: LOCAL, peerCid: PEER, fileName: 'a.bin', content: new Uint8Array([1]), virtualDir: '/a.bin' });
    await settled();
    expect(events).toEqual([`open:${PEER}`, 'request:SendFile']);
  });

  it('opens the channel before sending a tree operation', async () => {
    await new RevfsIO(deps).execute({ type: 'send-revfs-op', peerCid: PEER, operation: OP });
    expect(events).toEqual([`open:${PEER}`, `p2p:${PEER}`]);
  });

  it('opens the channel before reading a pulled file\'s bytes from the peer', async () => {
    void new RevfsIO(deps).execute({ type: 'backend-read-pulled-chunk', cid: LOCAL, peerCid: PEER, virtualDir: '/a.bin', offset: 0n, maxLen: 1048576 });
    await settled();
    expect(events).toEqual([`open:${PEER}`, 'request:ReadPulledFileChunk']);
  });

  it('opens the channel before downloading from and deleting on the peer', async () => {
    const io: RevfsIO = new RevfsIO(deps);
    void io.execute({ type: 'backend-download-file', cid: LOCAL, peerCid: PEER, virtualDir: '/a.bin' });
    await settled();
    void io.execute({ type: 'backend-delete-file', cid: LOCAL, peerCid: PEER, virtualDir: '/a.bin' });
    await settled();
    expect(events).toEqual([`open:${PEER}`, 'request:DownloadFile', `open:${PEER}`, 'request:DeleteVirtualFile']);
  });

  it('does not wait on any peer for server storage', async () => {
    void new RevfsIO(deps).execute({ type: 'backend-send-file', cid: LOCAL, peerCid: null, fileName: 'a.bin', content: new Uint8Array([1]), virtualDir: '/a.bin' });
    await settled();
    expect(events).toEqual(['request:SendFile']);
  });
});
