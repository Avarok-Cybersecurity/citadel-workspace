/**
 * EXIF orientation (1-8) as the canvas size and the transform that draws a `width` x `height`
 * source upright. Pure. A camera RAW states its orientation in its own first directory, and the
 * JPEG preview inside usually does not, so the page applies it.
 */

export interface Oriented {
  readonly width: number;
  readonly height: number;
  /** Arguments to CanvasRenderingContext2D.transform(a, b, c, d, e, f). */
  readonly matrix: readonly [number, number, number, number, number, number];
}

export function oriented(orientation: number, width: number, height: number): Oriented {
  const w: number = width;
  const h: number = height;
  switch (orientation) {
    case 2: return { width: w, height: h, matrix: [-1, 0, 0, 1, w, 0] };
    case 3: return { width: w, height: h, matrix: [-1, 0, 0, -1, w, h] };
    case 4: return { width: w, height: h, matrix: [1, 0, 0, -1, 0, h] };
    case 5: return { width: h, height: w, matrix: [0, 1, 1, 0, 0, 0] };
    case 6: return { width: h, height: w, matrix: [0, 1, -1, 0, h, 0] };
    case 7: return { width: h, height: w, matrix: [0, -1, -1, 0, h, w] };
    case 8: return { width: h, height: w, matrix: [0, -1, 1, 0, 0, w] };
    default: return { width: w, height: h, matrix: [1, 0, 0, 1, 0, 0] };
  }
}
