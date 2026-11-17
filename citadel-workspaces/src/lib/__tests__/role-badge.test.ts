import { describe, it, expect } from 'vitest';
import { roleBadgeClass } from '../role-badge';

/**
 * The property that matters: a badge never gets a text-bearing FILL without the
 * foreground that was contrast-checked against it. Two copies of this logic
 * existed and only one was fixed, so these pin the rule rather than the strings.
 */
describe('roleBadgeClass', () => {
  const ROLES: string[] = ['owner', 'admin', 'member', 'guest'];

  it.each(ROLES)('%s always carries an explicit text colour', (role) => {
    expect(roleBadgeClass(role)).toMatch(/\btext-[a-z-]+\b/);
  });

  it.each(ROLES)('%s never fills with primary-accent, which is a text token', (role) => {
    // bg-primary-accent under the Badge default (white) measures 2.86:1 in dark.
    expect(roleBadgeClass(role)).not.toMatch(/\bbg-primary-accent\b/);
  });

  it.each(ROLES)('%s never fills with success, which is a status token', (role) => {
    // bg-success under white measures 2.59:1 in dark.
    expect(roleBadgeClass(role)).not.toMatch(/\bbg-success\b/);
  });

  it('is case-insensitive, since roles arrive from the wire in either case', () => {
    expect(roleBadgeClass('Admin')).toBe(roleBadgeClass('admin'));
  });

  it('falls back rather than returning nothing for an unknown or absent role', () => {
    for (const value of [undefined, null, '', 'wizard']) {
      expect(roleBadgeClass(value as string | null | undefined)).toMatch(/text-muted-foreground/);
    }
  });
});
