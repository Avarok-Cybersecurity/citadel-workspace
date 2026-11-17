/**
 * The directory marked the reader online unconditionally. Their own presence is
 * what their own session can do: unknown with no session, offline when the
 * agent cannot be reached.
 */
import { describe, it, expect } from 'vitest';
import { ownPresence } from '../presence';

describe('ownPresence', () => {
  it('is unknown before the session is known', () => {
    expect(ownPresence(undefined, true)).toBeNull();
  });
  it('is online with a session that reaches the agent', () => {
    expect(ownPresence(7n, true)).toBe(true);
  });
  it('is offline with a session that cannot', () => {
    expect(ownPresence(7n, false)).toBe(false);
  });
});
