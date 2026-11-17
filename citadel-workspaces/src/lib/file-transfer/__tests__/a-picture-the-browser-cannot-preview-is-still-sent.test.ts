/**
 * A file typed as a picture that this browser cannot decode was never sent.
 *
 * `sendFile` awaited the thumbnail, and the thumbnail rejects ("Could not load image") for any
 * image/* file the browser cannot draw: HEIC in Chrome, a damaged JPEG, a file named .jpg that
 * is not one. The rejection escaped `sendFile`, the Send File dialog showed "Could not load
 * image" and stayed open, and nothing was offered: the recipient never saw an offer. CI caught
 * it (a-transfer-survives-a-reload, 3 of 3) with a 165 KB .jpg of 0xab bytes.
 *
 * The thumbnail is a preview. Without one the offer still goes, and the bubble keeps its icon.
 */
import { describe, it, expect } from 'vitest';
import { sendFile } from '../transfer-lifecycle';
import type { FileTransfer } from '../types';
import { ONLINE_PEER_QUEUE } from './online-peer-queue';

const RECIPIENT: string = '900';

interface Recorded {
  intents: string[];
  transfers: FileTransfer[];
}

function deps(thumbnail: () => Promise<string>): { deps: unknown; recorded: Recorded } {
  const recorded: Recorded = { intents: [], transfers: [] };
  return {
    recorded,
    deps: {
      io: {
        getCurrentCid: async (): Promise<bigint> => 100n,
        generateThumbnail: thumbnail,
        executeIntent: async (intent: { type: string }): Promise<unknown> => {
          recorded.intents.push(intent.type);
          return undefined;
        },
      },
      state: {
        setTransfer: (transfer: FileTransfer): void => { recorded.transfers.push(transfer); },
        getSettings: (): { maxFileSize: number } => ({ maxFileSize: 100 * 1024 * 1024 }),
      },
      saveTransfer: async (): Promise<void> => undefined,
      emitStateChange: (): void => undefined,
      openPeerChannel: async (): Promise<boolean> => true,
      // The inline route: the agent does not stage uploads.
      agentStagesUploads: async (): Promise<boolean> => false,
      queue: ONLINE_PEER_QUEUE,
    },
  };
}

function picture(name: string): File {
  const size: number = 165_000;
  return {
    name,
    size,
    type: 'image/jpeg',
    arrayBuffer: async (): Promise<ArrayBuffer> => new ArrayBuffer(size),
  } as unknown as File;
}

/** Lets the send that runs behind the bubble (deliverSend) reach its offer. */
async function settle(): Promise<void> {
  for (let i: number = 0; i < 20; i += 1) await Promise.resolve();
  await new Promise<void>((resolve: () => void): void => { setTimeout(resolve, 0); });
}

describe('a picture this browser cannot preview', () => {
  it('is still offered, without a thumbnail', async (): Promise<void> => {
    const { deps: d, recorded } = deps(async (): Promise<string> => { throw new Error('Could not load image'); });

    await expect(sendFile(d as never, RECIPIENT, picture('harbour.jpg'))).resolves.toEqual(expect.any(String));
    await settle();

    expect(recorded.intents, 'the offer never went out').toContain('send-transfer-request');
    expect(recorded.transfers.at(-1)?.thumbnail).toBeUndefined();
  });

  it('a picture that previews still carries its thumbnail', async (): Promise<void> => {
    // The opposite failure: dropping every thumbnail would pass the case above.
    const { deps: d, recorded } = deps(async (): Promise<string> => 'data:image/jpeg;base64,AAAA');

    await sendFile(d as never, RECIPIENT, picture('quay.jpg'));
    await settle();

    expect(recorded.transfers.at(-1)?.thumbnail).toBe('data:image/jpeg;base64,AAAA');
    expect(recorded.intents).toContain('send-transfer-request');
  });
});
