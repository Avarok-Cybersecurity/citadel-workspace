/**
 * The formats added beside the five raster ones: BMP and icons, which every browser draws itself,
 * and HEIC/HEIF and TIFF (with the camera RAW files built on it), which the page decodes in its
 * own worker. Each is recognised by its bytes alone and held to the same size limits. Fixtures:
 * crates/photo-decode/tests/fixtures (PROVENANCE.md there says how each was made).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sniffPhoto, sniffRaster, HEIF_BRANDS } from '../raster-sniff';
import { headerDimensions } from '../image-dimensions';
import { looksLikePicture, pictureOf, pictureSourceOf, previewByteLimit, MAX_PREVIEW_BYTES, MAX_RAW_PREVIEW_BYTES } from '../image-preview';

const CRATE: string = join(process.cwd(), '..', 'crates', 'photo-decode');
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(CRATE, 'tests', 'fixtures', name)));

/** An icon of one entry pointing at `image` (a PNG or a header-less BMP). */
function icon(entryWidth: number, image: Uint8Array): Uint8Array {
  const out: Uint8Array = new Uint8Array(22 + image.length);
  out.set([0, 0, 1, 0, 1, 0], 0);
  out.set([entryWidth, entryWidth, 0, 0, 1, 0, 32, 0], 6);
  new DataView(out.buffer).setUint32(6 + 8, image.length, true);
  new DataView(out.buffer).setUint32(6 + 12, 22, true);
  out.set(image, 22);
  return out;
}

function pngDeclaring(width: number, height: number): Uint8Array {
  const png: Uint8Array = fixture('quadrants-48.png').slice();
  new DataView(png.buffer).setUint32(16, width);
  new DataView(png.buffer).setUint32(20, height);
  return png;
}

describe('a BMP', () => {
  it('is drawn by the browser, at the size its header declares', () => {
    expect(pictureOf(fixture('quadrants-48.bmp'))).toEqual({ mime: 'image/bmp', size: { width: 48, height: 48 } });
  });
  it('declaring a decompression bomb is refused', () => {
    const bomb: Uint8Array = fixture('quadrants-48.bmp').slice();
    new DataView(bomb.buffer).setInt32(18, 60000, true);
    new DataView(bomb.buffer).setInt32(22, -60000, true);
    expect(headerDimensions(bomb, 'image/bmp')).toEqual({ width: 60000, height: 60000 });
    expect(typeof pictureOf(bomb)).toBe('string');
  });
});

describe('an icon', () => {
  it('is checked at the largest size anything in it declares', () => {
    expect(sniffRaster(icon(16, pngDeclaring(16, 16)))).toBe('image/x-icon');
    expect(headerDimensions(icon(16, pngDeclaring(16, 16)), 'image/x-icon')).toEqual({ width: 16, height: 16 });
    expect(headerDimensions(icon(0, pngDeclaring(16, 16)), 'image/x-icon')).toEqual({ width: 256, height: 256 });
  });
  it('whose entry says 16 px but whose PNG declares a bomb is refused', () => {
    expect(typeof pictureOf(icon(16, pngDeclaring(60000, 60000)))).toBe('string');
  });
  it('whose BMP image counts its mask in its height is read at half that height', () => {
    const dib: Uint8Array = new Uint8Array(40);
    new DataView(dib.buffer).setUint32(0, 40, true);
    new DataView(dib.buffer).setInt32(4, 32, true);
    new DataView(dib.buffer).setInt32(8, 64, true);
    expect(headerDimensions(icon(32, dib), 'image/x-icon')).toEqual({ width: 32, height: 32 });
  });
});

describe('a photo the page decodes', () => {
  it('is known by its bytes: HEIC by its brand, TIFF by its byte order', () => {
    expect(sniffPhoto(fixture('checker-64.heic'))).toBe('image/heic');
    expect(sniffPhoto(fixture('quadrants-48-lzw.tif'))).toBe('image/tiff');
    expect(sniffPhoto(new Uint8Array([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8]))).toBe('image/tiff');
    expect(sniffPhoto(fixture('quadrants-48.jpg'))).toBeNull();
    expect(pictureSourceOf(fixture('checker-64.heic'))).toEqual({ kind: 'decode', mime: 'image/heic' });
    expect(pictureSourceOf(fixture('quadrants-48.jpg'))).toMatchObject({ kind: 'native', picture: { mime: 'image/jpeg' } });
  });
  it('names the same HEIF brands the decoder accepts', () => {
    const rust: string = readFileSync(join(CRATE, 'src', 'lib.rs'), 'utf8');
    const declared: RegExpExecArray | null = /const HEIF_BRANDS: \[&\[u8; 4\]; \d+\] = \[([^\]]+)\];/.exec(rust);
    expect(declared).not.toBeNull();
    const brands: string[] = [...(declared?.[1] ?? '').matchAll(/b"([a-z0-9]{4})"/g)].map((m: RegExpMatchArray): string => m[1]);
    expect(brands).toEqual([...HEIF_BRANDS]);
  });
  it('is never AVIF, which the browser draws itself', () => {
    const avif: Uint8Array = new Uint8Array([0, 0, 0, 0x1c, ...Array.from('ftypavif', (c: string): number => c.charCodeAt(0))]);
    expect(sniffPhoto(avif)).toBeNull();
    expect(sniffRaster(avif)).toBe('image/avif');
  });
  it('is worth reading by its name, a camera RAW up to its own larger limit', () => {
    for (const name of ['IMG_0001.HEIC', 'a.heif', 'scan.tif', 'scan.tiff', 'DSC_1.NEF', 'a.dng', 'a.cr2', 'a.arw', 'a.bmp', 'favicon.ico']) {
      expect(looksLikePicture(name, undefined, 10)).toBe(true);
    }
    expect(previewByteLimit('DSC_1.NEF')).toBe(MAX_RAW_PREVIEW_BYTES);
    expect(previewByteLimit('IMG_0001.HEIC')).toBe(MAX_PREVIEW_BYTES);
    expect(looksLikePicture('DSC_1.NEF', undefined, 60 * 1024 * 1024)).toBe(true);
    expect(looksLikePicture('IMG_0001.HEIC', undefined, 60 * 1024 * 1024)).toBe(false);
  });
});
