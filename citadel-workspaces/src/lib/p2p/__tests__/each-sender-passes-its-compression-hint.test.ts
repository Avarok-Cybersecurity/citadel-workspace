/**
 * Every road into the reliable send carries the hint its payload was built
 * with, and a caller that gives none sends none.
 *
 * Stood in: the websocket service (the agent socket beneath it; the service's
 * own threading is covered in websocket-service/__tests__), the auto-connect
 * service (it dials peers), and the RE-VFS deps (they are its I/O by design).
 * The senders, the command builders and the hint table are production code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CompressionHint } from 'citadel-workspace-client-ts';

const OURS: bigint = 8001n;
const PEER: bigint = 8002n;

const sends: Array<{ peer: bigint; hint: CompressionHint | undefined; args: number }> = [];
vi.mock('../../websocket-service', () => ({
  websocketService: {
    ensureMessengerOpen: async (): Promise<boolean> => false,
    sendP2PMessageReliable: async (...args: [bigint, bigint, Uint8Array, unknown, CompressionHint | undefined]): Promise<void> => {
      sends.push({ peer: args[1], hint: args[4], args: args.length });
    },
  },
}));
vi.mock('../../p2p-auto-connect-service', () => ({
  p2pAutoConnectService: { ensurePeerConnectedInBackground: async (): Promise<void> => {} },
}));

const { sendAllowingForAConcurrentOpen, sendP2PCommand, sendRawMessage } = await import('../message-send-operations');
const { sendTransferResponseSignal } = await import('../../file-transfer/in-band-signals');
const { CheckStateManager } = await import('../checkstate-manager');
const { RevfsIO } = await import('../../revfs/revfs-io');
const { createMessagingLayerCommand } = await import('@/types/p2p-commands');
const { createMessage, createTyping } = await import('@/types/messaging-layer');

type SenderConfig = Parameters<typeof sendP2PCommand>[0];
const config: SenderConfig = {
  getCurrentCid: async (): Promise<bigint> => OURS,
  getOrCreateConversation: () => ({ lastMessageIndex: 0 }),
} as unknown as SenderConfig;

describe('a reliable send', () => {
  beforeEach((): void => { sends.length = 0; localStorage.clear(); });

  it('of a chat command carries cbor-command', async () => {
    await sendP2PCommand(config, PEER, createMessagingLayerCommand(createMessage('hi'), OURS, PEER, 0));
    expect(sends).toEqual([{ peer: PEER, hint: 'cbor-command', args: 5 }]);
  });

  it('of a raw layer (typing, presence) carries cbor-command', async () => {
    await sendRawMessage(config, PEER, createTyping());
    expect(sends.map((s) => s.hint)).toEqual(['cbor-command']);
  });

  it('of a file-transfer signal carries cbor-command', async () => {
    await sendTransferResponseSignal(OURS, PEER, 'transfer-1', true);
    expect(sends.map((s) => s.hint)).toEqual(['cbor-command']);
  });

  it('with no hint from its caller sends none', async () => {
    await sendAllowingForAConcurrentOpen(OURS, PEER, new Uint8Array([1]));
    expect(sends).toEqual([{ peer: PEER, hint: undefined, args: 5 }]);
  });
});

describe('the senders that take bytes through their own deps', () => {
  it('CheckState hands its transport the hint of the command it built', async () => {
    const seen: Array<CompressionHint | undefined> = [];
    const manager: InstanceType<typeof CheckStateManager> = new CheckStateManager({
      timeout: 1_000,
      sendToP2P: async (_peer: bigint, _bytes: Uint8Array, hint: CompressionHint | undefined): Promise<void> => { seen.push(hint); },
      getCurrentCid: async (): Promise<bigint> => OURS,
      getLastMessageIndex: (): number => 0,
    });
    await manager.sendCheckStateResponse(PEER);
    expect(seen).toEqual(['cbor-command']);
  });

  it('RE-VFS hands its transport json for a tree operation', async () => {
    const seen: Array<CompressionHint | undefined> = [];
    const io: InstanceType<typeof RevfsIO> = new RevfsIO({
      openPeerChannel: async (): Promise<boolean> => true,
      sendP2PMessageReliable: async (_l: bigint, _p: bigint, _b: Uint8Array, hint: CompressionHint | undefined): Promise<void> => { seen.push(hint); },
      getCurrentCid: async (): Promise<bigint> => OURS,
      sendInternalServiceRequest: async (): Promise<void> => {},
    });
    await io.execute({ type: 'send-revfs-op', peerCid: PEER, operation: { op_id: 'o', op_type: 'Mkdir', path: '/d', timestamp: 1 } as never });
    expect(seen).toEqual(['json']);
  });
});

/**
 * The two places those deps are wired to the real transport are closures in a
 * singleton constructor and a React effect; neither can run without the app.
 * So the wiring itself is read: each must pass the hint it is given onward.
 */
describe('the wiring of those deps', () => {
  const SRC: string = join(__dirname, '../../..');
  it('the messenger manager passes CheckState’s hint to sendRawBytes', () => {
    const src: string = readFileSync(join(SRC, 'lib/p2p/p2p-messenger-manager.ts'), 'utf8');
    expect(src).toMatch(/sendToP2P: \(peerCid, bytes, compressionHint\)[^\n]*sendRawBytes\(peerCid, bytes, compressionHint\)/);
  });
  it('the connection handler passes RE-VFS’s hint to the reliable send', () => {
    const src: string = readFileSync(join(SRC, 'components/hooks/useConnectionHandler.ts'), 'utf8');
    expect(src).toMatch(/sendP2PMessageReliable: \(localCid, peerCid, message, compressionHint\) =>\s*websocketService\.sendP2PMessageReliable\(localCid, peerCid, message, undefined, compressionHint\)/);
  });
});
