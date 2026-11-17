/**
 * The agent's conversation store parses a transfer's state as its own enum, which
 * has no 'queued' or 'preparing' (and still has the retired 'uploading' and
 * 'staged'). A browser state written there verbatim is a write an installed agent
 * refuses; an entry from an older page must still render.
 */
import { describe, it, expect } from 'vitest';
import { toStoredState, fromStoredState } from '../stored-state';

describe('the conversation store boundary', () => {
  it('stores the browser-only states as pending, and the rest as they are', () => {
    expect(toStoredState('queued')).toBe('pending');
    expect(toStoredState('preparing')).toBe('pending');
    expect(toStoredState('transferring')).toBe('transferring');
    expect(toStoredState('error')).toBe('error');
  });

  it('reads a retired state as an offer that can no longer be answered', () => {
    expect(fromStoredState('staged')).toBe('expired');
    expect(fromStoredState('uploading')).toBe('expired');
    expect(fromStoredState('complete')).toBe('complete');
  });
});
