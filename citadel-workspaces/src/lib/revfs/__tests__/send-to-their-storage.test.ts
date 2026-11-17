/**
 * "Send to their storage" is its own action, not a transfer mode: it places the
 * file in the peer-pair shared tree, within that route's own size ceiling.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  sendToTheirStorage, sharedStorageRefusal, SHARED_STORAGE_DIR, SHARED_STORAGE_LIMIT_BYTES,
  type SharedStoragePorts,
} from '../send-to-their-storage';

const ME: bigint = 7n;
const PEER: bigint = 42n;

function ports(): SharedStoragePorts & { upload: ReturnType<typeof vi.fn> } {
  return {
    currentCid: async (): Promise<bigint> => ME,
    newFileId: (): string => 'file-1',
    upload: vi.fn(async (): Promise<boolean> => true),
  };
}

describe('sharedStorageRefusal', () => {
  it('accepts a file within the ceiling', () => {
    expect(sharedStorageRefusal({ name: 'a.png', size: SHARED_STORAGE_LIMIT_BYTES })).toBeNull();
  });
  it('names the ceiling and the alternative for a larger file', () => {
    const reason: string | null = sharedStorageRefusal({ name: 'film.mov', size: SHARED_STORAGE_LIMIT_BYTES + 1 });
    expect(reason).toMatch(/up to 16 MB/);
    expect(reason).toMatch(/Send it instead/);
  });
  it('refuses an empty file', () => {
    expect(sharedStorageRefusal({ name: 'e.txt', size: 0 })).toMatch(/empty/);
  });
});

describe('sendToTheirStorage', () => {
  it('places the file at the shared tree root, as mine, with its bytes', async () => {
    const p: ReturnType<typeof ports> = ports();
    // jsdom's File has no arrayBuffer(); the shape the browser gives is all this reads.
    const file: File = { name: 'notes.txt', size: 3, type: 'text/plain', arrayBuffer: async (): Promise<ArrayBuffer> => new Uint8Array([97, 98, 99]).buffer } as File;
    const ok: boolean = await sendToTheirStorage(p, PEER, file);
    expect(ok).toBe(true);
    const [mine, peer, dir, name, meta, content] = p.upload.mock.calls[0] as [bigint, bigint, string, string, { uploadedByCid: bigint; fileSize: number }, Uint8Array];
    expect([mine, peer, dir, name]).toEqual([ME, PEER, SHARED_STORAGE_DIR, 'notes.txt']);
    expect(meta).toMatchObject({ uploadedByCid: ME, fileSize: 3 });
    expect(Array.from(content)).toEqual([97, 98, 99]);
  });
  it('uploads nothing for a file it refuses', async () => {
    const p: ReturnType<typeof ports> = ports();
    const big: File = { name: 'big.bin', size: SHARED_STORAGE_LIMIT_BYTES + 1, type: '' } as File;
    await expect(sendToTheirStorage(p, PEER, big)).rejects.toThrow(/Send it instead/);
    expect(p.upload).not.toHaveBeenCalled();
  });
});
