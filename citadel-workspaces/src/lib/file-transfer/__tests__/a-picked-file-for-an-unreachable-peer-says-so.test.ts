/**
 * A file chosen with Browse Files, for a peer whose channel cannot be opened, is
 * neither sent anyway nor lost: its bubble fails with the reason.
 *
 * The native-picker path awaited openChannelBeforeSending and dropped the answer,
 * so the send went ahead to a peer nobody could reach. The offline hold cannot keep
 * it (it holds browser Files; a pick is a path on the agent), so it says so.
 * The executor and the queue's view of the peer are the stand-ins.
 */
import { describe, it, expect, vi } from 'vitest';
import { sendFileWithNativePicker, unreachableReason } from '../send-with-native-picker';
import { eventEmitter } from '@/lib/event-emitter';
import { FILE_TRANSFER_EVENTS, type OfferAnnounced } from '../events';
import { FileTransferState } from '../state';
import type { LifecycleDeps } from '../transfer-lifecycle';

function deps(peerOnline: boolean | null, channelOpens: boolean): { d: LifecycleDeps; intents: string[] } {
  const intents: string[] = [];
  const d: LifecycleDeps = {
    state: new FileTransferState(),
    io: {
      getCurrentCid: async (): Promise<bigint> => 7n,
      executeIntent: async (intent: { type: string }): Promise<unknown> => {
        intents.push(intent.type);
        return intent.type === 'pick-file' ? { file_path: '/home/a/video.mov', file_name: 'video.mov', file_size: 3n } : undefined;
      },
    },
    saveTransfer: async (): Promise<void> => undefined,
    emitStateChange: (): void => undefined,
    saveSettings: async (): Promise<void> => undefined,
    openPeerChannel: async (): Promise<boolean> => channelOpens,
    // An agent that does not stage: not consulted by a picked send.
    agentStagesUploads: async (): Promise<boolean> => false,
    queue: { peerOnlineStatus: (): boolean | null => peerOnline, peerName: (): string => 'Bob', hold: vi.fn(), take: vi.fn(), release: vi.fn() },
  } as unknown as LifecycleDeps;
  return { d, intents };
}

describe('a picked file', () => {
  it.each([[false, false], [null, false]])('for a peer offline (%s) whose channel does not open fails in its bubble, sending nothing', async (online: boolean | null, opens: boolean) => {
    const { d, intents } = deps(online, opens);
    const shown: OfferAnnounced[] = [];
    const off: () => void = eventEmitter.on<OfferAnnounced>(FILE_TRANSFER_EVENTS.OFFER_ANNOUNCED, (o: OfferAnnounced) => { shown.push(o); });
    const id: string = await sendFileWithNativePicker(d, '42');
    off();
    expect(intents).toEqual(['pick-file']);
    expect(d.state.getTransfer(id)).toMatchObject({ state: 'error', errorMessage: unreachableReason('Bob'), fileName: 'video.mov' });
    expect(shown).toHaveLength(1);
  });

  it('for a peer whose channel opens is sent', async () => {
    const { d, intents } = deps(null, true);
    await sendFileWithNativePicker(d, '42');
    expect(intents).toEqual(['pick-file', 'send-file-via-protocol']);
  });
});
