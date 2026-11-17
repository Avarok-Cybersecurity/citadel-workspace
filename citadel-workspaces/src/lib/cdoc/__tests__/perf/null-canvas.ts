/**
 * A no-op canvas platform for the perf measurements: node has no canvas, so "paint" measures
 * the painter's own work (decode, placement, rounding, atlas bookkeeping, the calls it
 * issues), not the browser's rasterisation.
 */
import type { CanvasPort, Ctx2D, PaintTarget } from '../../paint/canvas-port';
import type { DecodedImage } from '../../paint/image-cache';

const noop = (): void => undefined;
const nullCtx: Ctx2D = new Proxy({}, { get: () => noop, set: () => true }) as unknown as Ctx2D;

export const nullPort: CanvasPort = {
  createSurface: () => ({ ctx: nullCtx, image: {} as CanvasImageSource }),
  createPath: () => new Proxy({}, { get: () => noop }) as unknown as Path2D,
  decodeImage: async (_bytes: Uint8Array, _mime: string): Promise<DecodedImage> => ({ source: {} as CanvasImageSource, width: 1, height: 1, close: noop }),
};

export const nullTarget: PaintTarget = { ctx: nullCtx, resize: noop };
