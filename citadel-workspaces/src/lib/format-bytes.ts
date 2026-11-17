/**
 * One byte-size format, because four disagreed.
 *
 * There were four implementations and they produced different strings for the
 * same number:
 *
 *   file-transfer-helpers   toFixed(1), "0 Bytes"    1.46 MB -> "1.5 MB"
 *   transfer-format         toFixed(2), "0 Bytes"    1.46 MB -> "1.46 MB"
 *   vfs-content-helpers     toFixed(1), "0 B"        units B/KB/MB/GB
 *   lib/utils               toLocaleString, adds TB
 *
 * The first two are the same feature: a transfer bubble and the transfer
 * lifecycle showed the same file at two different sizes, in the same view.
 *
 * One decimal place, because the second digit of a megabyte is noise to the
 * person reading it and the disagreement it caused was not. TB is kept from the
 * utils version — a workspace can hold one.
 */

const UNITS: readonly ["B", "KB", "MB", "GB", "TB"] = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number): string {
  // Guard the whole non-positive range, not just zero: a negative size is a
  // bug upstream, and Math.log of it is NaN, which rendered as "NaN undefined".
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const exponent: number = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    UNITS.length - 1,
  );
  const value: number = bytes / 1024 ** exponent;

  // Whole numbers read better without a trailing .0, and bytes have no
  // fractional part to show at all.
  const rounded: number = exponent === 0 ? Math.round(value) : parseFloat(value.toFixed(1));

  return `${rounded} ${UNITS[exponent]}`;
}
