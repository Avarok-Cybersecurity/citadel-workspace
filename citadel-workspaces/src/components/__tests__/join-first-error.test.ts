/**
 * A refused submit must point at the field to fix.
 *
 * Focus used to stay on the Join button: the error was announced and the field
 * was marked `aria-invalid`, and neither of those moves anyone.
 */
import { describe, it, expect } from 'vitest';
import { firstInvalidField, JOIN_FIELD_ORDER } from '../join-first-error';

const filled: { fullName: string; username: string; password: string; confirmPassword: string; } = {
  fullName: 'Ada Lovelace',
  username: 'ada',
  password: 'password123',
  confirmPassword: 'password123',
};
const noErrors: { fullName: null; username: null; password: null; confirmPassword: null; } = { fullName: null, username: null, password: null, confirmPassword: null };

describe('the first field to fix', () => {
  it('is nothing when the form is submittable', () => {
    expect(firstInvalidField(filled, noErrors)).toBeNull();
  });

  it('is the first EMPTY field, in the order they are rendered', () => {
    expect(firstInvalidField({ ...filled, username: '', password: '' }, noErrors)).toBe('username');
  });

  it('is the first field failing a rule', () => {
    expect(
      firstInvalidField(filled, { ...noErrors, confirmPassword: 'do not match' }),
    ).toBe('confirmPassword');
  });

  it('prefers whichever comes first on screen, not whichever check ran first', () => {
    // A rule failure late in the form must not win over an empty field early in
    // it: the user is taken to the top of the problem, not the bottom.
    expect(
      firstInvalidField({ ...filled, fullName: '' }, { ...noErrors, confirmPassword: 'do not match' }),
    ).toBe('fullName');
  });

  it('orders the fields the way the form renders them', () => {
    expect(JOIN_FIELD_ORDER).toEqual(['fullName', 'username', 'password', 'confirmPassword']);
  });
});
