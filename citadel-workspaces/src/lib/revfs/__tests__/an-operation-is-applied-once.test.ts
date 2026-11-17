/**
 * A redelivered operation is not a second operation.
 *
 * Run 33304689050: seven `SyncRequest`s sent, one hundred handled; one `Mkdir`
 * applied twice 21ms apart under a single op id. Each redelivered request cost
 * a fresh 564-byte `SyncResponse` on the reliable channel, and the `PlaceFile`
 * and `Rmdir` behind that flood never reached the peer at all.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { isNewOperation, forgetSeenOperations } from '../seen-operations';

describe('an operation arriving twice', () => {
  beforeEach((): void => { forgetSeenOperations(); });

  it('is new once and never again', () => {
    expect(isNewOperation('a_b', 'op-1')).toBe(true);
    expect(isNewOperation('a_b', 'op-1')).toBe(false);
    expect(isNewOperation('a_b', 'op-1')).toBe(false);
  });

  it('does not confuse two peers that mint ids independently', () => {
    // Positive control, and the reason this is keyed per pair: dropping a
    // second peer's operation because the first used the same id would lose
    // work silently.
    expect(isNewOperation('a_b', 'op-1')).toBe(true);
    expect(isNewOperation('a_c', 'op-1')).toBe(true);
  });

  it('still admits genuinely different operations', () => {
    expect(isNewOperation('a_b', 'op-1')).toBe(true);
    expect(isNewOperation('a_b', 'op-2')).toBe(true);
  });

  it('forgets the oldest rather than growing without bound', () => {
    for (let i: number = 0; i < 600; i += 1) isNewOperation('a_b', `op-${i}`);
    // The earliest is gone, so it reads as new again -- the deliberate cost of
    // a bounded memory, and far outside any redelivery window.
    expect(isNewOperation('a_b', 'op-0')).toBe(true);
    // The most recent is still remembered.
    expect(isNewOperation('a_b', 'op-599')).toBe(false);
  });
});
