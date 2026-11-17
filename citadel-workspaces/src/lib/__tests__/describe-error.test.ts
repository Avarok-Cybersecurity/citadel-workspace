/**
 * A toast must never say `[object Object]`.
 *
 * Eight `toast.error(\`… ${err}\`)` in one file, three different treatments of
 * the same value, and a rejection carrying a structured payload — which the
 * revfs and websocket layers both produce — reached the user as
 * `Failed to delete: [object Object]`.
 */
import { describe, it, expect } from 'vitest';
import { describeError } from '../describe-error';

describe('an unknown thrown value, rendered for a person', () => {
  it('takes the message off an Error, without the class name', () => {
    expect(describeError(new Error('the write timed out'))).toBe('the write timed out');
  });

  it('passes a thrown string through', () => {
    expect(describeError('the write timed out')).toBe('the write timed out');
  });

  it('finds a message on a plain object', () => {
    expect(describeError({ message: 'quota exceeded' })).toBe('quota exceeded');
  });

  it('finds one under `error`, which some layers use instead', () => {
    expect(describeError({ error: 'quota exceeded' })).toBe('quota exceeded');
  });

  it('names the shape rather than quoting [object Object]', () => {
    // The whole point. `[object Object]` is not searchable, reportable or
    // actionable; the field names at least say which layer threw.
    const shown: string = describeError({ code: 5, detail: 'x' });

    expect(shown).not.toContain('[object Object]');
    expect(shown).toContain('code');
  });

  it('never returns [object Object] for anything', () => {
    const odd: unknown[] = [
      {}, [], null, undefined, 0, false, new Error(''), Object.create(null),
    ];
    for (const value of odd) {
      expect(describeError(value)).not.toContain('[object Object]');
      expect(describeError(value)).not.toBe('');
    }
  });
});
