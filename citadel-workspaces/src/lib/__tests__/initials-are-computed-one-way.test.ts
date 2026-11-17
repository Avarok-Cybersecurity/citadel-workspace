/**
 * The same name gave different initials on different surfaces: the member list
 * and workspace badge took first and last words, call tiles and notifications
 * the first two, and a blank name was "?" in one and "??" in the other.
 */
import { describe, it, expect } from 'vitest';
import { initialsOf } from '../initials';
import { getInitials } from '@/components/chat/shared/formatters';
import { getUserInitials, getWorkspaceInitials } from '../workspace-metadata-service';

describe('initials', () => {
  it('take the first and last words', () => {
    expect(initialsOf('Ada Byron Lovelace')).toBe('AL');
    expect(initialsOf('  ada   lovelace ')).toBe('AL');
  });

  it('take one letter from one word, and a mark from nothing', () => {
    expect(initialsOf('ada')).toBe('A');
    expect(initialsOf('')).toBe('?');
    expect(initialsOf('   ')).toBe('?');
  });

  it('are the same on every surface', () => {
    for (const name of ['Ada Byron Lovelace', 'ada', '', 'Grace  Hopper']) {
      expect(getInitials(name)).toBe(initialsOf(name));
      expect(getUserInitials(name)).toBe(initialsOf(name));
      expect(getWorkspaceInitials(name)).toBe(initialsOf(name));
    }
  });
});
