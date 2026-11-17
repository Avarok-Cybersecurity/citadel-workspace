/**
 * Sending a 0-byte file announced the offer and then threw.
 *
 * `send-operations` gates the inline path on `params.source instanceof File &&
 * params.source.size > 0`; a zero-byte File falls through to the else and throws
 * "requires ... a non-empty browser File object". That throw landed AFTER
 * `announceTransfer`, which is the message that makes the transfer appear in the
 * recipient's conversation.
 *
 * So the recipient got an offer for bytes that would never arrive — a bubble
 * they could neither accept (nothing to fetch) nor usefully decline — and the
 * sender's transfer sat on 'pending' until its TTL expired. An action that half
 * happened, reported as neither success nor failure.
 *
 * Refused at the entry now, before the transfer record exists and long before
 * anything is announced. Supporting empty files instead would mean confirming
 * the service accepts an empty ByteContents payload; that is a backend question,
 * and guessing at it here is how the half-action got shipped.
 */
import { describe, it, expect, vi } from 'vitest';
import { sendFile } from '../transfer-lifecycle';
import { ONLINE_PEER_QUEUE } from './online-peer-queue';

const RECIPIENT: string = '900';

interface Recorded {
  intents: string[];
  saved: number;
  stateChanges: number;
}

function deps(): { deps: unknown; recorded: Recorded } {
  const recorded: Recorded = { intents: [], saved: 0, stateChanges: 0 };
  return {
    recorded,
    deps: {
      io: {
        getCurrentCid: async (): Promise<bigint> => 100n,
        generateThumbnail: async (): Promise<string> => 'thumb',
        executeIntent: async (intent: { type: string }): Promise<unknown> => {
          recorded.intents.push(intent.type);
          return undefined;
        },
      },
      state: {
        setTransfer: (): void => { recorded.stateChanges += 1; },
        getSettings: (): { maxFileSize: number } => ({ maxFileSize: 100 * 1024 * 1024 }),
      },
      saveTransfer: async (): Promise<void> => { recorded.saved += 1; },
      emitStateChange: (): void => { recorded.stateChanges += 1; },
      // The channel opens at once here; a-file-send-opens-the-peer-channel-first covers it.
      openPeerChannel: async (): Promise<boolean> => true,
      // An agent that does not stage uploads: the inline route, 16 MB.
      agentStagesUploads: async (): Promise<boolean> => false,
      queue: ONLINE_PEER_QUEUE,
    },
  };
}

function file(name: string, size: number): File {
  return {
    name,
    size,
    type: 'text/plain',
    arrayBuffer: async (): Promise<ArrayBuffer> => new ArrayBuffer(size),
  } as unknown as File;
}

describe('sending an empty file', () => {
  it('is refused with a reason naming the file', async (): Promise<void> => {
    const { deps: d } = deps();

    await expect(sendFile(d as never, RECIPIENT, file('notes.txt', 0))).rejects.toThrow(
      /"notes\.txt" is empty/,
    );
  });

  it('announces nothing and records nothing', async (): Promise<void> => {
    // The whole defect: the offer reached the recipient before the throw.
    const { deps: d, recorded } = deps();

    await expect(sendFile(d as never, RECIPIENT, file('notes.txt', 0))).rejects.toThrow();

    expect(recorded.intents, 'the transfer was announced before it failed').toEqual([]);
    expect(recorded.saved, 'a doomed transfer was persisted').toBe(0);
    expect(recorded.stateChanges, 'a doomed transfer entered the UI state').toBe(0);
  });

  it('still sends a file that has contents', async (): Promise<void> => {
    // The opposite failure: refusing everything would pass both assertions above.
    const { deps: d, recorded } = deps();

    await expect(sendFile(d as never, RECIPIENT, file('notes.txt', 12))).resolves.toEqual(
      expect.any(String),
    );
    expect(recorded.intents).toContain('send-transfer-request');
  });
});

void vi;
