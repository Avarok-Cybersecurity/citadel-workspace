/**
 * shown-picture.ts: the browser's own formats are drawn as they are and never reach the decoder;
 * a photo format goes to the decoder once, is drawn from its answer, and is still saved as the
 * original; a refusal reads as a clause naming the way on. The decoder is faked: it is a worker
 * (a-photo-decode-always-ends.test.ts) over a wasm binary (the vendored decoder's own test).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { drawnPictureOf, drawnOrRefused, type DecodePhoto } from '../shown-picture';
import type { PhotoAnswer } from '@/lib/photo-decode/photo-decoder';
import { avatarSource } from '@/lib/image-processor';
// Node's Blob: jsdom's has no arrayBuffer(), which every browser the app runs in has.
import { Blob as NodeBlob } from 'node:buffer';

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(process.cwd(), '..', 'crates', 'photo-decode', 'tests', 'fixtures', name)));
const decoding = (answer: PhotoAnswer) => vi.fn<DecodePhoto>(async (): Promise<PhotoAnswer> => answer);
const DECODED: Blob = new Blob(['jpeg'], { type: 'image/jpeg' });

describe('a picture to draw', () => {
  it('in a format the browser draws never reaches the decoder', async () => {
    const decode = decoding({ kind: 'decoded', blob: DECODED, width: 1, height: 1 });
    const drawn = await drawnPictureOf(fixture('quadrants-48.jpg'), decode);
    expect(drawn).toMatchObject({ size: { width: 48, height: 48 } });
    expect(typeof drawn !== 'string' && drawn.display.type).toBe('image/jpeg');
    expect(decode).not.toHaveBeenCalled();
  });

  it('in a photo format is drawn from the decoder and saved as the original', async () => {
    const decode = decoding({ kind: 'decoded', blob: DECODED, width: 64, height: 64 });
    const drawn = await drawnPictureOf(fixture('checker-64.heic'), decode);
    expect(decode).toHaveBeenCalledWith(expect.any(Uint8Array), 'image/heic');
    if (typeof drawn === 'string') throw new Error(drawn);
    expect(drawn.display).toBe(DECODED);
    expect(drawn.original.type).toBe('image/heic');
    expect(drawn.original.size).toBe(fixture('checker-64.heic').length);
  });

  it('that the browser draws natively is drawn from the original', async () => {
    const drawn = await drawnPictureOf(fixture('quadrants-48-lzw.tif'), decoding({ kind: 'decoded', blob: null, width: 48, height: 48 }));
    if (typeof drawn === 'string') throw new Error(drawn);
    expect(drawn.display).toBe(drawn.original);
    expect(drawn.original.type).toBe('image/tiff');
  });

  it('refused by the decoder reads as a clause with the way on, and keeps the refusal and its bytes for others', async () => {
    const decode = decoding({ kind: 'too-large', width: 8064, height: 6048 });
    const heic: Uint8Array = fixture('checker-64.heic');
    expect(await drawnPictureOf(heic, decode)).toContain('Download saves it for your photo app');
    const refused = await drawnOrRefused(heic, decode);
    if (typeof refused === 'string' || !('refusal' in refused)) throw new Error('expected a refusal');
    expect(refused.refusal).toEqual({ kind: 'too-large', width: 8064, height: 6048 });
    // Still the file: Download saves these bytes, typed by what they are.
    expect(refused.original.type).toBe('image/heic');
    expect(refused.original.size).toBe(heic.byteLength);
  });
});

describe('an avatar', () => {
  it('from a HEIC photo is the decoder\'s conversion of it', async () => {
    const source = await avatarSource(new NodeBlob([fixture('checker-64.heic').slice().buffer]) as unknown as Blob, decoding({ kind: 'decoded', blob: DECODED, width: 64, height: 64 }));
    expect(source).toBe(DECODED);
  });
  it('from a photo too large is the refusal, for the picker to draw with its surface', async () => {
    const source = await avatarSource(new NodeBlob([fixture('checker-64.heic').slice().buffer]) as unknown as Blob, decoding({ kind: 'too-large', width: 9000, height: 9000 }));
    expect(source).toEqual({ kind: 'too-large', width: 9000, height: 9000 });
  });
  it('from a file that is no picture names the formats that are', async () => {
    const source = await avatarSource(new NodeBlob(['<svg/>']) as unknown as Blob, decoding({ kind: 'decoded', blob: DECODED, width: 1, height: 1 }));
    expect(source).toBe('Please upload a JPEG, PNG, GIF, WebP, HEIC or TIFF image');
  });
});
