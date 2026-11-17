import { describe, it, expect } from 'vitest';
import { isConnectAlreadyInProgress } from '@/lib/connection/is-connect-in-progress';

/**
 * Three sites tested for this with three different needles and all three missed
 * what the agent sends: "Connection already in progress for user X".
 * `check-connect-in-progress-matches-the-agent.mjs` pins that against the Rust;
 * these pin the discrimination, which a cross-repo gate cannot see.
 */
describe('the connect-already-in-progress predicate', () => {
  it('matches what the agent sends for a duplicate connect', () => {
    expect(isConnectAlreadyInProgress('Connection already in progress for user bob')).toBe(true);
  });

  it('is case-insensitive, since the wording is prose', () => {
    expect(isConnectAlreadyInProgress('CONNECTION ALREADY IN PROGRESS for user bob')).toBe(true);
  });

  it('does NOT match a wrong password', () => {
    // The control. A predicate that matched everything would satisfy the
    // cross-repo gate and route a bad credential into the claim-session path.
    expect(isConnectAlreadyInProgress('Invalid username or password')).toBe(false);
  });

  it('does NOT match an unrelated failure', () => {
    expect(isConnectAlreadyInProgress('Socket error: deadline has elapsed')).toBe(false);
  });

  it('handles undefined', () => {
    expect(isConnectAlreadyInProgress(undefined)).toBe(false);
  });
});
