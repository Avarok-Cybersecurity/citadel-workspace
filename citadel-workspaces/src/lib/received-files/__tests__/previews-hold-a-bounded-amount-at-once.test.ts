/**
 * Picture previews hold a bounded amount at once: never two RAW files, never more than the cap in
 * total, in arrival order, and a failed read gives its share back. The PictureCache reads through
 * the gate, so a conversation of RAW files is read one at a time. No mocks: the gate is pure and
 * the cache's I/O is handed in (SBIO); the reads here are promises the test resolves.
 */
import { describe, it, expect } from 'vitest';
import { createPreviewGate } from '../preview-gate';
import { MAX_IN_FLIGHT_PREVIEW_BYTES, MAX_PREVIEW_BYTES, MAX_RAW_PREVIEW_BYTES, previewReservation } from '../image-preview';
import { PictureCache, type PictureIO } from '../picture-load';
import type { FileTransfer } from '@/lib/file-transfer/types';

interface Pending<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
}

function pending<T>(): Pending<T> {
  let resolve: (value: T) => void = (): void => undefined;
  let reject: (error: Error) => void = (): void => undefined;
  const promise: Promise<T> = new Promise<T>((yes: (value: T) => void, no: (error: Error) => void): void => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const settle = (): Promise<void> => new Promise<void>((done: () => void): void => { setTimeout(done, 0); });

describe('the preview gate', () => {
  it('reserves a file\'s limit, not its declared size, and marks RAW files', () => {
    expect(previewReservation('IMG_0001.CR2')).toEqual({ bytes: MAX_RAW_PREVIEW_BYTES, raw: true });
    expect(previewReservation('photo.heic')).toEqual({ bytes: MAX_PREVIEW_BYTES, raw: false });
    expect(MAX_IN_FLIGHT_PREVIEW_BYTES).toBe(MAX_RAW_PREVIEW_BYTES + MAX_PREVIEW_BYTES);
  });

  it('reads one RAW file at a time', async () => {
    const gate = createPreviewGate(MAX_IN_FLIGHT_PREVIEW_BYTES * 4n);
    const started: string[] = [];
    const first: Pending<void> = pending<void>();
    const a: Promise<void> = gate.run(previewReservation('a.dng'), async (): Promise<void> => { started.push('a'); await first.promise; });
    const b: Promise<void> = gate.run(previewReservation('b.nef'), async (): Promise<void> => { started.push('b'); });
    await settle();
    expect(started).toEqual(['a']);
    first.resolve();
    await Promise.all([a, b]);
    expect(started).toEqual(['a', 'b']);
  });

  it('runs a RAW beside an ordinary picture, and holds the next one until the total fits', async () => {
    const gate = createPreviewGate(MAX_IN_FLIGHT_PREVIEW_BYTES);
    const started: string[] = [];
    const raw: Pending<void> = pending<void>();
    const heic: Pending<void> = pending<void>();
    const runs: Promise<void>[] = [
      gate.run(previewReservation('a.arw'), async (): Promise<void> => { started.push('raw'); await raw.promise; }),
      gate.run(previewReservation('b.heic'), async (): Promise<void> => { started.push('heic'); await heic.promise; }),
      gate.run(previewReservation('c.tif'), async (): Promise<void> => { started.push('tif'); }),
    ];
    await settle();
    expect(started).toEqual(['raw', 'heic']);
    heic.resolve();
    await settle();
    expect(started).toEqual(['raw', 'heic', 'tif']);
    raw.resolve();
    await Promise.all(runs);
  });

  it('keeps arrival order: a small read never overtakes one waiting ahead of it', async () => {
    const gate = createPreviewGate(MAX_IN_FLIGHT_PREVIEW_BYTES);
    const started: string[] = [];
    const first: Pending<void> = pending<void>();
    const runs: Promise<void>[] = [
      gate.run(previewReservation('a.dng'), async (): Promise<void> => { started.push('a.dng'); await first.promise; }),
      gate.run(previewReservation('b.dng'), async (): Promise<void> => { started.push('b.dng'); }),
      gate.run(previewReservation('c.png'), async (): Promise<void> => { started.push('c.png'); }),
    ];
    await settle();
    expect(started).toEqual(['a.dng']);
    first.resolve();
    await Promise.all(runs);
    expect(started).toEqual(['a.dng', 'b.dng', 'c.png']);
  });

  it('gives a failed read\'s share back', async () => {
    const gate = createPreviewGate(MAX_IN_FLIGHT_PREVIEW_BYTES);
    await expect(gate.run(previewReservation('a.dng'), async (): Promise<void> => { throw new Error('agent went away'); })).rejects.toThrow('agent went away');
    let ran: boolean = false;
    await gate.run(previewReservation('b.dng'), async (): Promise<void> => { ran = true; });
    expect(ran).toBe(true);
  });

  it('refuses a reservation that could never fit, rather than waiting forever', async () => {
    const gate = createPreviewGate(MAX_PREVIEW_BYTES);
    await expect(gate.run(previewReservation('a.dng'), async (): Promise<void> => undefined)).rejects.toThrow('can never fit');
  });
});

function sentTransfer(id: string, fileName: string): FileTransfer {
  return {
    id, fileName, fileSize: 1, fileType: '', state: 'complete', progress: 100, sender_cid: '1', recipient_cid: '2',
    createdAt: 0, updatedAt: 0, isIncoming: false,
  };
}

describe('the picture cache', () => {
  it('reads a conversation of RAW files one at a time', async () => {
    const asked: string[] = [];
    const reads: Map<string, Pending<Blob | undefined>> = new Map();
    const io: PictureIO = {
      received: { readChunk: (): never => { throw new Error('no received files here'); }, save: (): void => undefined },
      sent: (transfer: FileTransfer): Promise<Blob | undefined> => {
        asked.push(transfer.id);
        const read: Pending<Blob | undefined> = pending<Blob | undefined>();
        reads.set(transfer.id, read);
        return read.promise;
      },
      decode: (): never => { throw new Error('nothing is decoded here'); },
      objectUrl: (): string => 'blob:x',
      release: (): void => undefined,
    };
    const cache: PictureCache = new PictureCache(io, createPreviewGate(MAX_IN_FLIGHT_PREVIEW_BYTES));
    const first = cache.get(sentTransfer('a', 'a.dng'));
    const second = cache.get(sentTransfer('b', 'b.cr2'));
    await settle();
    expect(asked).toEqual(['a']);
    reads.get('a')?.resolve(undefined);
    expect(await first).toEqual({ unavailable: 'the full picture was not kept on this device' });
    await settle();
    expect(asked).toEqual(['a', 'b']);
    reads.get('b')?.resolve(undefined);
    await second;
  });
});
