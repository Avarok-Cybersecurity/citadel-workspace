/**
 * The account menu must have a name even when the user has a profile picture.
 *
 * Radix unmounts `AvatarFallback` once the image loads, so the initials that
 * were carrying the person's name disappear at exactly the moment a real
 * picture exists. This button has no text content of its own, so the only route
 * to Profile, Settings and Sign out was announced as "button". Its `title` was
 * admin-only, so non-admins had nothing at all.
 *
 * Asserts on the BUTTON's accessible name rather than on the avatar, because
 * that is what survives both the fallback unmounting and the image failing to
 * load.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const topBar: string = readFileSync(
  join(process.cwd(), 'src/components/layout/sidebar/TopBar.tsx'),
  'utf8'
);

describe('the account-menu button', () => {
  it('carries an aria-label', () => {
    const button: string = topBar.slice(topBar.indexOf('data-testid="user-avatar-button"') - 600);
    expect(button).toMatch(/aria-label=/);
  });

  it('names the user, not just the role', () => {
    // `title={isAdmin ? ... : undefined}` left every non-admin unnamed, so the
    // label must not be conditional on being an admin.
    expect(topBar).toMatch(/aria-label=\{[^}]*username[^}]*\}/);
  });
});
