/**
 * An app's icon, drawn only when it is what the manifest says: standard padded base64 of a PNG
 * (by its magic bytes) no larger than its declared `max_bytes`, itself at most 64 KiB. Anything
 * else draws the generic icon. The size is bounded before decoding, from the base64's length.
 * `img-src data:` is already allowed, so a validated icon needs no CSP change.
 */
import type { AppIcon } from 'citadel-workspace-client-ts';

export const MAX_ICON_BYTES: bigint = 64n * 1024n;
const PNG_MAGIC: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const BASE64: RegExp = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** The `data:` URL to draw, or null for the generic icon. */
export function appIconSrc(icon: AppIcon): string | null {
  const cap: bigint = icon.max_bytes;
  if (cap < 1n || cap > MAX_ICON_BYTES) return null;
  const text: string = icon.png_base64;
  const limit: number = Number(cap);
  if (text.length > Math.ceil(limit / 3) * 4 || !BASE64.test(text)) return null;
  let decoded: string;
  try {
    decoded = atob(text);
  } catch {
    return null;
  }
  if (decoded.length > limit || decoded.length < PNG_MAGIC.length) return null;
  if (!PNG_MAGIC.every((byte: number, i: number) => decoded.charCodeAt(i) === byte)) return null;
  return `data:image/png;base64,${text}`;
}
