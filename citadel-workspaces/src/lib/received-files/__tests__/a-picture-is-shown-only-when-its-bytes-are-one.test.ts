/**
 * A chat file is shown as a picture only when its bytes are a raster image of a size the page
 * will decode, and a sender's thumbnail only when it is such a picture inline. Pure.
 */
import { describe, it, expect } from 'vitest';
import { pictureOf, safeThumbnail, looksLikePicture, MAX_PREVIEW_PIXELS } from '../image-preview';
import { headerDimensions } from '../image-dimensions';
import { actionForKey, step } from '../viewer-state';

const PNG_1X1: string = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const bytes = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c: string): number => c.charCodeAt(0));
const ascii = (s: string): number[] => Array.from(s, (c: string): number => c.charCodeAt(0));

function pngOf(width: number, height: number): Uint8Array {
  const b: Uint8Array = bytes(PNG_1X1).slice();
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

describe('a picture', () => {
  it('is a raster image whose header size is within the limits', () => {
    expect(pictureOf(bytes(PNG_1X1))).toEqual({ mime: 'image/png', size: { width: 1, height: 1 } });
    expect(pictureOf(pngOf(4000, 3000))).toMatchObject({ size: { width: 4000, height: 3000 } });
  });
  it('is refused when its header declares a decompression bomb', () => {
    expect(typeof pictureOf(pngOf(60000, 60000))).toBe('string');
    expect(typeof pictureOf(pngOf(20000, 10))).toBe('string');
    expect(4000 * 3000).toBeLessThan(MAX_PREVIEW_PIXELS);
  });
  it('is never SVG or HTML, whatever it is called', () => {
    expect(typeof pictureOf(new Uint8Array(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>')))).toBe('string');
    expect(looksLikePicture('x.svg', 'image/svg+xml', 10)).toBe(false);
  });
  it('reads GIF, JPEG and WebP sizes from their headers', () => {
    expect(headerDimensions(new Uint8Array([...ascii('GIF89a'), 0x20, 0x01, 0x10, 0x00]), 'image/gif')).toEqual({ width: 288, height: 16 });
    const jpeg: Uint8Array = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x00, 0x03, 0x00, 0, 0]);
    expect(headerDimensions(jpeg, 'image/jpeg')).toEqual({ width: 768, height: 512 });
    const vp8x: Uint8Array = new Uint8Array(30);
    vp8x.set(ascii('RIFF'), 0); vp8x.set(ascii('WEBPVP8X'), 8); vp8x.set([0x3f, 0x01, 0x00, 0xef, 0x00, 0x00], 24);
    expect(headerDimensions(vp8x, 'image/webp')).toEqual({ width: 320, height: 240 });
  });
  it('is worth reading only when named or typed as one and small enough', () => {
    expect(looksLikePicture('a.JPG', undefined, 10)).toBe(true);
    expect(looksLikePicture('a', 'image/webp', 10)).toBe(true);
    expect(looksLikePicture('a.pdf', 'application/pdf', 10)).toBe(false);
    expect(looksLikePicture('a.png', 'image/png', 26 * 1024 * 1024)).toBe(false);
  });
});

describe("a sender's thumbnail", () => {
  it('is drawn when it is an inline raster picture of the type it declares', () => {
    const src: string = `data:image/png;base64,${PNG_1X1}`;
    expect(safeThumbnail(src)).toBe(src);
  });
  it('is never a remote URL, an SVG, a mislabelled type, or garbage', () => {
    expect(safeThumbnail('https://tracker.example/pixel.png')).toBeNull();
    expect(safeThumbnail(`data:image/svg+xml;base64,${btoa('<svg onload="alert(1)"/>')}`)).toBeNull();
    expect(safeThumbnail(`data:image/jpeg;base64,${PNG_1X1}`)).toBeNull();
    expect(safeThumbnail('data:image/png;base64,!!!')).toBeNull();
    expect(safeThumbnail(undefined)).toBeNull();
  });
});

describe('the viewer', () => {
  it('moves between pictures with the arrows and resets the zoom', () => {
    expect(step({ index: 0, zoom: 2 }, actionForKey('ArrowRight') ?? 'fit', 3)).toEqual({ index: 1, zoom: null });
    expect(step({ index: 0, zoom: null }, 'previous', 3)).toEqual({ index: 0, zoom: null });
    expect(step({ index: 2, zoom: null }, 'next', 3)).toEqual({ index: 2, zoom: null });
  });
  it('zooms in from fit to natural size and steps, and back out', () => {
    expect(step({ index: 0, zoom: null }, 'zoom-in', 1).zoom).toBe(1);
    expect(step({ index: 0, zoom: 1 }, 'zoom-in', 1).zoom).toBe(1.5);
    expect(step({ index: 0, zoom: 4 }, 'zoom-in', 1).zoom).toBe(4);
    expect(step({ index: 0, zoom: 1 }, 'zoom-out', 1).zoom).toBe(0.5);
    expect(actionForKey('0')).toBe('fit');
    expect(actionForKey('Enter')).toBeNull();
  });
});
