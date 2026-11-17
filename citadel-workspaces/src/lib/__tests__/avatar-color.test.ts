import { describe, it, expect } from 'vitest';
import { AVATAR_COLORS, avatarColor, memberAvatarColor } from '../avatar-color';

/**
 * The property under test is CONSISTENCY. Three palettes of differing lengths
 * meant `index % length` gave the same member different colours on different
 * screens, so these pin that one index maps to one colour, everywhere.
 */
describe('avatarColor', () => {
  it('gives the same index the same colour every time', () => {
    for (const i of [0, 1, 6, 7, 100]) {
      expect(avatarColor(i)).toBe(avatarColor(i));
    }
  });

  it('wraps rather than running off the end', () => {
    expect(avatarColor(AVATAR_COLORS.length)).toBe(avatarColor(0));
    expect(avatarColor(AVATAR_COLORS.length * 3 + 2)).toBe(avatarColor(2));
  });

  it('never returns undefined for a hostile index', () => {
    // `%` on a negative or fractional index returns NaN, and indexing with NaN
    // yields undefined — which reaches the DOM as backgroundColor: undefined.
    for (const i of [-1, -8, 2.7, NaN, Infinity]) {
      expect(AVATAR_COLORS).toContain(avatarColor(i));
    }
  });

  it('has no gold in the rotation', () => {
    // Gold was first in two of the three old palettes and commented "Owner",
    // but both used it as an ordinary rotation entry, so a member at index 0
    // was dressed as the owner. Rank is signalled by role colour alone.
    expect(AVATAR_COLORS).not.toContain('#FFD700');
  });
});

describe('memberAvatarColor', () => {
  it('lets an explicit role colour win', () => {
    expect(memberAvatarColor({ role: { color: '#123456' } }, 3)).toBe('#123456');
  });

  it('falls back to the rotation when a role has no colour', () => {
    expect(memberAvatarColor({ role: {} }, 3)).toBe(avatarColor(3));
    expect(memberAvatarColor(null, 3)).toBe(avatarColor(3));
    expect(memberAvatarColor(undefined, 3)).toBe(avatarColor(3));
  });
});
