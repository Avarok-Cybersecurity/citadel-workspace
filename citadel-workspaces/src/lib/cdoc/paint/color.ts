/** A display-list colour (packed 0xRRGGBBAA, straight alpha) as a CSS colour, memoised. */
import type { Rgba } from '../display-list/types';

const cache: Map<Rgba, string> = new Map<Rgba, string>();

export function cssColor(rgba: Rgba): string {
  let css: string | undefined = cache.get(rgba);
  if (css === undefined) {
    const a: number = rgba & 0xff;
    css = `rgba(${rgba >>> 24},${(rgba >>> 16) & 0xff},${(rgba >>> 8) & 0xff},${a === 255 ? 1 : +(a / 255).toFixed(4)})`;
    cache.set(rgba, css);
  }
  return css;
}
