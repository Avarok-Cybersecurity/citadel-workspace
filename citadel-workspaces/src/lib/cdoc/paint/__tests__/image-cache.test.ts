/** The decoded-image cache: least recently drawn out first, pixels freed, the byte cap held. */
import { describe, expect, it } from 'vitest';
import { ImageCache, type DecodedImage, type PaintableImage } from '../image-cache';

function picture(side: number, closed: string[], name: string): PaintableImage {
  const image: DecodedImage = { source: {} as CanvasImageSource, width: side, height: side, close: (): void => { closed.push(name); } };
  return { kind: 'drawn', image };
}

describe('the image cache', () => {
  it('drops the least recently drawn first, closing it, to stay under the cap', () => {
    const closed: string[] = [];
    // Three 10x10 images are 400 bytes each; the cap holds two.
    const cache: ImageCache = new ImageCache(800);
    cache.set('a', picture(10, closed, 'a'));
    cache.set('b', picture(10, closed, 'b'));
    expect(cache.get('a')?.kind).toBe('drawn');
    cache.set('c', picture(10, closed, 'c'));
    expect(closed).toEqual(['b']);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.heldBytes).toBe(800);
  });

  it('keeps a placeholder for free, and closes everything on clear', () => {
    const closed: string[] = [];
    const cache: ImageCache = new ImageCache(400);
    cache.set('gif', { kind: 'placeholder', label: 'image/gif' });
    cache.set('a', picture(10, closed, 'a'));
    expect(cache.has('gif')).toBe(true);
    cache.clear();
    expect(closed).toEqual(['a']);
    expect(cache.heldBytes).toBe(0);
  });
});
