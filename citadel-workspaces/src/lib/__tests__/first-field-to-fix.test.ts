/**
 * One rule for "which field do we take them to", used by both forms.
 *
 * The join form got focus-on-refusal in round 230; the login form did not, and
 * announced "Username and password are required" with focus on the Sign In
 * button and no field marked invalid. Two copies of this decision is how that
 * happens, so there is one.
 */
import { describe, it, expect } from 'vitest';
import { firstFieldToFix } from '../first-field-to-fix';

const LOGIN: readonly ["username", "password"] = ['username', 'password'] as const;

describe('the first field to fix', () => {
  it('is nothing when every field is filled', () => {
    expect(firstFieldToFix(LOGIN, { username: 'ada', password: 'hunter2' })).toBeNull();
  });

  it('is the first empty one, in render order', () => {
    expect(firstFieldToFix(LOGIN, { username: '', password: '' })).toBe('username');
    expect(firstFieldToFix(LOGIN, { username: 'ada', password: '' })).toBe('password');
  });

  it('treats whitespace as empty, because the form does', () => {
    // `!username.trim()` is the check the login handler makes; a rule that
    // disagreed with it would point at the wrong field.
    expect(firstFieldToFix(LOGIN, { username: '   ', password: 'hunter2' })).toBe('username');
  });

  it('prefers an earlier empty field over a later rule failure', () => {
    // The user is taken to the top of the problem, not the bottom of it.
    expect(
      firstFieldToFix(LOGIN, { username: '', password: 'hunter2' }, { password: 'too short' }),
    ).toBe('username');
  });

  it('reports a rule failure when nothing is empty', () => {
    expect(
      firstFieldToFix(LOGIN, { username: 'ada', password: 'x' }, { password: 'too short' }),
    ).toBe('password');
  });

  it('needs no errors argument at all', () => {
    // The login form has no per-field rules, only emptiness.
    expect(firstFieldToFix(LOGIN, { username: 'ada', password: '' })).toBe('password');
  });
});
