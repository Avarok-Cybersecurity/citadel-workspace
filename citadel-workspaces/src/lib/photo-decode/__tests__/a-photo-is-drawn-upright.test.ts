/**
 * EXIF orientation as a canvas transform: each of the eight puts the source's top-left corner
 * where the orientation says it belongs, on a canvas of the upright size.
 */
import { describe, it, expect } from 'vitest';
import { oriented, type Oriented } from '../orientation';

const W: number = 6;
const H: number = 4;
const at = (o: Oriented, x: number, y: number): [number, number] => {
  const [a, b, c, d, e, f] = o.matrix;
  return [a * x + c * y + e, b * x + d * y + f];
};

describe('an orientation', () => {
  it.each([
    [1, W, H, [0, 0]], [2, W, H, [W, 0]], [3, W, H, [W, H]], [4, W, H, [0, H]],
    [5, H, W, [0, 0]], [6, H, W, [H, 0]], [7, H, W, [H, W]], [8, H, W, [0, W]],
  ])('%i draws on a %i x %i canvas with the top-left corner at %j', (orientation: number, width: number, height: number, corner: number[]) => {
    const o: Oriented = oriented(orientation, W, H);
    expect([o.width, o.height]).toEqual([width, height]);
    expect(at(o, 0, 0)).toEqual(corner);
    const [x, y] = at(o, W, H);
    expect([x, y].every((v: number, i: number): boolean => v >= 0 && v <= [width, height][i])).toBe(true);
  });
});
