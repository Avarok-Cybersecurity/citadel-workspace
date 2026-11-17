/**
 * Two accounts, each in its own browser, joined by the real P2P routing.
 *
 * Bob is the app's engine singleton, started by `startRevfs` as WorkspaceApp
 * does, and reached only through `handleMessagingLayerCommand` — the path an
 * inbound P2P message takes, from whatever page his tab is on. Alice is a
 * second service instance. Each has its own in-memory OPFS (separate browser
 * contexts). Bytes cross as serialized P2P commands; only the agent that
 * carries them, and the file bytes' own transfer, are simulated.
 */
import { vi } from 'vitest';
import { RevfsService } from '../revfs-service';
import { RevfsOpfsStorage } from '../opfs-storage';
import { startRevfs, forgetRevfsLoad } from '../revfs-loader';
import { revfsService as bobsEngine } from '../index';
import { installFakeOpfs } from './fake-opfs';
import { deserializeP2PCommand } from '@/types/p2p-commands';
import { handleMessagingLayerCommand } from '@/lib/p2p/message-handler-routing';
import { MessagingLayerType } from '@/types/messaging-layer';
import type { P2PCommand, P2PMessagingLayerPayload } from '@/types/p2p-types';
import type { MessageHandlerConfig } from '@/lib/p2p/message-handler-types';
import type { FileTransferMessageHandler } from '@/lib/p2p/file-transfer-message-handler';
import type { RevfsIntent, RevfsIntentResult } from '@/types/revfs-intents';
import type { RevfsIODeps } from '../revfs-io';

export const ALICE: bigint = 300n;
export const BOB: bigint = 200n;

type Deliver = (bytes: Uint8Array) => Promise<void>;

/** Give a service's IO its own disk, and answer the file-bytes transfer. */
function ownDisk(service: RevfsService): void {
  const root: ReturnType<typeof installFakeOpfs> = installFakeOpfs();
  const io: { storage: RevfsOpfsStorage; execute: (i: RevfsIntent) => Promise<RevfsIntentResult> } =
    (service as unknown as { io: { storage: RevfsOpfsStorage; execute: (i: RevfsIntent) => Promise<RevfsIntentResult> } }).io;
  const storage: RevfsOpfsStorage = io.storage;
  (storage as unknown as { getRootDir: () => Promise<unknown> }).getRootDir =
    (): Promise<unknown> => root.getDirectoryHandle('revfs', { create: true });
  const real: (i: RevfsIntent) => Promise<RevfsIntentResult> = io.execute.bind(io);
  io.execute = async (intent: RevfsIntent): Promise<RevfsIntentResult> =>
    intent.type === 'backend-send-file' ? { type: 'backend-send-file', success: true } : real(intent);
}

function deps(me: bigint, deliver: () => Deliver): RevfsIODeps {
  return {
    sendP2PMessageReliable: async (_local: bigint, _peer: bigint, bytes: Uint8Array): Promise<void> => {
      // Asynchronous, as a real network hop is.
      setTimeout((): void => { void deliver()(bytes); }, 0);
    },
    getCurrentCid: async (): Promise<bigint> => me,
    sendInternalServiceRequest: vi.fn(async (): Promise<void> => {}),
    // The channel is up: these tests are about what travels over it.
    openPeerChannel: async (): Promise<boolean> => true,
  };
}

/** Bob's tab: the inbound P2P path, exactly as message-handler hands it on. */
async function intoBobsTab(bytes: Uint8Array): Promise<void> {
  const command: P2PCommand = deserializeP2PCommand(bytes);
  const config: MessageHandlerConfig = {
    getCurrentCid: async (): Promise<bigint> => BOB,
    markPeerReady: (): void => {},
  } as unknown as MessageHandlerConfig;
  await handleMessagingLayerCommand(config, {} as FileTransferMessageHandler, command.payload as P2PMessagingLayerPayload, ALICE, BOB);
}

export interface TwoAccounts { alice: RevfsService; bob: RevfsService }

export async function twoAccounts(): Promise<TwoAccounts> {
  forgetRevfsLoad();
  const alice: RevfsService = new RevfsService();
  const intoAlicesTab: Deliver = async (bytes: Uint8Array): Promise<void> => {
    const payload: P2PMessagingLayerPayload = deserializeP2PCommand(bytes).payload as P2PMessagingLayerPayload;
    if (payload.layer.type === MessagingLayerType.RevfsOperation) {
      await alice.handleRevfsOperation(BOB, ALICE, payload.layer.operation);
    }
  };
  alice.initialize(deps(ALICE, () => intoBobsTab));
  ownDisk(alice);
  await startRevfs(deps(BOB, () => intoAlicesTab));
  ownDisk(bobsEngine);
  return { alice, bob: bobsEngine };
}
