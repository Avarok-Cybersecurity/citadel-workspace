/**
 * What a workspace icon may be, checked where /create receives it.
 *
 * The same rules the kernel applies to UpdateWorkspaceProfile
 * (citadel-workspace-server-kernel/src/kernel/command_processor/workspace_logo.rs), so an icon
 * the kernel would refuse is refused here, before a tenant is provisioned with it:
 * - a WebP, PNG or JPEG data URL (never SVG, which can carry script);
 * - at most MAX_LOGO_BYTES once decoded;
 * - bytes that begin with the declared type's signature.
 */

export const MAX_LOGO_BYTES = 32 * 1024;

const startsWith = (bytes, prefix) => prefix.every((b, i) => bytes[i] === b);
const ascii = (bytes, from, to) => String.fromCharCode(...bytes.slice(from, to));
const FORMATS = {
  "image/webp": (b) => b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP",
  "image/png": (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/jpeg": (b) => startsWith(b, [0xff, 0xd8, 0xff]),
};
const DATA_URL = /^data:(image\/(?:webp|png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/;

/** The data URL when `value` is an icon a workspace may be created with, otherwise null. */
export function logoOf(value) {
  if (typeof value !== "string") return null;
  const m = DATA_URL.exec(value);
  if (!m) return null;
  // Bounded before decoding, so an oversized payload is refused without allocating for it.
  if (m[2].length > Math.ceil(MAX_LOGO_BYTES / 3) * 4) return null;
  let bytes;
  try {
    bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  return bytes.length <= MAX_LOGO_BYTES && FORMATS[m[1]](bytes) ? value : null;
}
