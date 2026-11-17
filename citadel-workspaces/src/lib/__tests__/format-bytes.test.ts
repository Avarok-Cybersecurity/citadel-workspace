/**
 * The one byte formatter, and what the four disagreeing ones did.
 */

import { describe, it, expect } from 'vitest';
import { formatBytes } from '../format-bytes';

describe('formatBytes', () => {
  it('formats each unit', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 ** 2)).toBe('1 MB');
    expect(formatBytes(1024 ** 3)).toBe('1 GB');
    expect(formatBytes(1024 ** 4)).toBe('1 TB');
  });

  it('shows no fractional bytes', () => {
    // "1.5 B" is not a size; the previous formatters produced it.
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(999)).toBe('999 B');
  });

  it('drops a trailing zero rather than printing 1.0 MB', () => {
    expect(formatBytes(2 * 1024 ** 2)).toBe('2 MB');
  });

  it('gives the same answer for the same number, everywhere', () => {
    // The defect: a transfer bubble said "1.5 MB" and the transfer lifecycle
    // said "1.46 MB" about the same file, in the same view, because one used
    // toFixed(1) and the other toFixed(2).
    const oneAndAHalfIsh: number = 1_530_000;
    expect(formatBytes(oneAndAHalfIsh)).toBe(formatBytes(oneAndAHalfIsh));
    expect(formatBytes(oneAndAHalfIsh)).toBe('1.5 MB');
  });

  it('does not render NaN for a nonsensical size', () => {
    // Math.log of a negative is NaN, which the previous versions rendered as
    // "NaN undefined" -- a size field showing the word NaN to a user.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatBytes(bad), String(bad)).toBe('0 B');
    }
  });

  it('does not run off the end of the unit list', () => {
    // A petabyte has no unit here; it must clamp to TB rather than print
    // "undefined".
    expect(formatBytes(1024 ** 6)).toMatch(/TB$/);
  });
});
