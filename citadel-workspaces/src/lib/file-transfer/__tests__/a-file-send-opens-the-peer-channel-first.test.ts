/**
 * After an agent reconnect or a server restart the P2P channels are gone until
 * something reopens them. A text message reopened them; a file send did not,
 * so the DM dialog said "Peer Connection Not Found" and a group share said
 * "failed — No messaging handle found" for a registered peer, while a DM to
 * the same peer went straight through.
 *
 * Two halves, both through the paths every file send uses:
 *   - the lifecycle opens the recipient's channel before anything is sent;
 *   - every in-band signal (offer, accept, decline, cancel) opens this
 *     session's messenger before sending, via the message path's own send.
 * The WebSocket service is the only double: it is the socket.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: string[] = vi.hoisted((): string[] => []);
const world: { failFirstSend: boolean } = vi.hoisted(() => ({ failFirstSend: false }));

vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    ensureMessengerOpen: async (cid: bigint): Promise<boolean> => { calls.push(`open-messenger:${cid}`); return false; },
    sendP2PMessageReliable: async (from: bigint, to: bigint): Promise<void> => {
      calls.push(`send:${from}->${to}`);
      if (world.failFirstSend) { world.failFirstSend = false; throw new Error('No messaging handle found for local CID: 100'); }
    },
  },
}));
vi.mock('@/lib/p2p-auto-connect-service', () => ({
  p2pAutoConnectService: {
    waitForPeerConnected: async (cid: bigint, timeoutMs: number): Promise<boolean> => { calls.push(`wait:${cid}:${timeoutMs}`); return true; },
  },
}));

import { sendFile, type LifecycleDeps } from '../transfer-lifecycle';
import { sendLayerPayload } from '../in-band-signals';
import { sendFileWithNativePicker } from '../send-with-native-picker';
import { openPeerChannelViaAutoConnect, FILE_SEND_CONNECT_TIMEOUT_MS } from '../open-peer-channel';
import { buildTransferAnnouncement } from '../transfer-announcement';
import type { FileTransfer } from '../types';
import { fileTransferService } from '../service';
import { ONLINE_PEER_QUEUE } from './online-peer-queue';

function deps(opened: boolean): LifecycleDeps {
  return {
    io: {
      getCurrentCid: async (): Promise<bigint> => 100n,
      generateThumbnail: async (): Promise<string> => 't',
      executeIntent: async (intent: { type: string }): Promise<unknown> => { calls.push(`intent:${intent.type}`); return undefined; },
    },
    state: { setTransfer: (): void => undefined, getSettings: (): { maxFileSize: number } => ({ maxFileSize: 1 << 30 }) },
    saveTransfer: async (): Promise<void> => undefined,
    emitStateChange: (): void => undefined,
    saveSettings: async (): Promise<void> => undefined,
    openPeerChannel: async (cid: bigint): Promise<boolean> => { calls.push(`channel:${cid}`); return opened; },
    // An agent that does not stage uploads: the inline route, 16 MB.
    agentStagesUploads: async (): Promise<boolean> => false,
    queue: ONLINE_PEER_QUEUE,
  } as unknown as LifecycleDeps;
}

const file: File = new File(['abc'], 'a.txt', { type: 'text/plain' });

beforeEach((): void => { calls.length = 0; world.failFirstSend = false; });

describe('a file send', () => {
  it('opens the recipient\'s P2P channel before sending anything', async () => {
    await sendFile(deps(true), '900', file);
    expect(calls).toEqual(['channel:900', 'intent:send-transfer-request']);
  });

  it('does the same for a standard send', async () => {
    await sendFile(deps(true), '900', file);
    expect(calls).toEqual(['channel:900', 'intent:send-transfer-request']);
  });

  it('still sends when the channel is not confirmed, so the send reports the real outcome', async () => {
    await sendFile(deps(false), '900', file);
    expect(calls).toEqual(['channel:900', 'intent:send-transfer-request']);
  });

  it('opens it before the native picker, the third way a file leaves', async () => {
    const d: LifecycleDeps = deps(true);
    (d.io as unknown as { executeIntent: (i: { type: string }) => Promise<unknown> }).executeIntent = async (i: { type: string }): Promise<unknown> => {
      calls.push(`intent:${i.type}`);
      return i.type === 'pick-file' ? { file_path: '/tmp/a', file_name: 'a', file_size: 3n } : undefined;
    };
    await sendFileWithNativePicker(d, '900');
    expect(calls.slice(0, 2)).toEqual(['channel:900', 'intent:pick-file']);
  });

  it('is wired to the auto-connect opener in the service every send goes through', async () => {
    // `deps` is private; read here because the wiring is exactly what broke.
    expect((fileTransferService as unknown as { deps: LifecycleDeps }).deps.openPeerChannel).toBe(openPeerChannelViaAutoConnect);
  });

  it('opens it through the auto-connect service the message path uses, with the explicit timeout', async () => {
    expect(await openPeerChannelViaAutoConnect(900n)).toBe(true);
    expect(calls).toEqual([`wait:900:${FILE_SEND_CONNECT_TIMEOUT_MS}`]);
  });
});

describe('an in-band file signal', () => {
  const transfer: FileTransfer = {
    id: 'x', fileName: 'a.txt', fileSize: 3, fileType: 'text/plain', state: 'pending', progress: 0,
    senderCid: '100', recipientCid: '900', createdAt: 0, updatedAt: 0, isIncoming: false,
  };

  it('opens this session\'s messenger before sending', async () => {
    await sendLayerPayload(buildTransferAnnouncement(transfer));
    expect(calls).toEqual(['open-messenger:100', 'send:100->900']);
  });

  it('retries once when the messenger was still opening', async () => {
    world.failFirstSend = true;
    await sendLayerPayload(buildTransferAnnouncement(transfer));
    expect(calls).toEqual(['open-messenger:100', 'send:100->900', 'open-messenger:100', 'send:100->900']);
  });
});
