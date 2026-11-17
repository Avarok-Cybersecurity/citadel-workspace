/**
 * The sender sees their own picture full size after a reload, as the receiver does.
 *
 * The picked file was held in this tab's memory only, so a reload left the sender with the
 * 100px thumbnail. It is now kept per conversation in IndexedDB, through SentPictureStore. The
 * store here is a Map: it is the IndexedDB port's stand-in (the I/O boundary), and a "reload"
 * is a second read through the same store with nothing held in memory.
 */
import { describe, it, expect } from 'vitest';
// Node's Blob: jsdom's has no arrayBuffer(), which every browser the app runs in has.
import { Blob as NodeBlob } from 'node:buffer';
import { rememberSentPicture, sentPicture, overBudget, SENT_PICTURE_BUDGET_BYTES, type SentPictureEntry, type SentPictureOf, type SentPictureStore } from '../sent-pictures';

const PNG: Uint8Array = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c: string): number => c.charCodeAt(0));

type MapStore = SentPictureStore & { data: Map<string, SentPictureEntry> };

function mapStore(): MapStore {
  const data: Map<string, SentPictureEntry> = new Map();
  return {
    data,
    put: async (k: string, e: SentPictureEntry): Promise<void> => { data.set(k, e); },
    get: async (k: string): Promise<SentPictureEntry | undefined> => data.get(k),
    keys: async (p: string): Promise<string[]> => [...data.keys()].filter((k: string): boolean => k.startsWith(p)),
    delete: async (k: string): Promise<void> => { data.delete(k); },
  };
}

const of = (transferId: string, peer: string = '42', own: string = '7'): SentPictureOf => ({ own, peer, transferId });

describe('a sent picture', () => {
  it('is read back after a reload, for its own conversation and account only', async () => {
    const store: MapStore = mapStore();
    expect(await rememberSentPicture(store, of('t1'), new NodeBlob([PNG.slice().buffer], { type: 'image/png' }) as unknown as Blob, 1)).toBeNull();
    const back: Blob | undefined = await sentPicture(store, of('t1'));
    expect(back && new Uint8Array(await back.arrayBuffer())).toEqual(PNG);
    expect(await sentPicture(store, of('t1', '43'))).toBeUndefined();
    expect(await sentPicture(store, of('t1', '42', '8'))).toBeUndefined();
  });

  it('is kept only when it is a raster picture within the decode limits', async () => {
    const store: MapStore = mapStore();
    const svg: Blob = new NodeBlob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/svg+xml' }) as unknown as Blob;
    expect(await rememberSentPicture(store, of('s'), svg, 1)).toMatch(/not kept/);
    expect(store.data.size).toBe(0);
  });

  it("keeps a conversation within its budget, dropping that conversation's oldest first", () => {
    const half: number = SENT_PICTURE_BUDGET_BYTES / 2;
    const entries: { key: string; size: number; at: number }[] = [{ key: 'c', size: half, at: 3 }, { key: 'a', size: half, at: 1 }, { key: 'b', size: half, at: 2 }];
    expect(overBudget(entries, SENT_PICTURE_BUDGET_BYTES)).toEqual(['a']);
    expect(overBudget(entries.slice(0, 2), SENT_PICTURE_BUDGET_BYTES)).toEqual([]);
  });
});
