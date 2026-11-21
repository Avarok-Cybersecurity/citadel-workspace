/**
 * A stalled tab-context write must not silently cancel selecting an account.
 *
 * `setSelectedUser` is an IndexedDB write, and IndexedDB stalls for ordinary
 * reasons: an upgrade blocked by another tab, a busy agent, a private-browsing
 * quota. `handleAuthSuccess` races it against a timeout and continues on expiry;
 * this is that one implementation. */
import { describe, it, expect, vi } from 'vitest';
import { selectUserWithoutBlocking } from '../select-user';

describe('selectUserWithoutBlocking', () => {
  it('reports false when the write does not land', async () => {
    vi.useFakeTimers();
    const io: { setSelectedUser: ReturnType<typeof vi.fn> } = { setSelectedUser: vi.fn((): Promise<void> => new Promise<void>((): void => {})) };
    const result: Promise<boolean> = selectUserWithoutBlocking(io as never, {
      selectedUsername: 'alice', selectedServerAddress: 'x',
    }, (): void => {});
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await result).toBe(false);
    vi.useRealTimers();
  });

  it('reports true when it does', async () => {
    // The positive control: without it, `false` could be a constant.
    const io: { setSelectedUser: ReturnType<typeof vi.fn> } = { setSelectedUser: vi.fn(async (): Promise<void> => {}) };
    expect(
      await selectUserWithoutBlocking(io as never, {
        selectedUsername: 'alice', selectedServerAddress: 'x',
      }, (): void => {}),
    ).toBe(true);
  });

  it('rethrows a real failure, which is not the same as a slow one', async () => {
    // A rejected write means something is wrong with the call, not with the
    // clock. Swallowing both would hide a genuine defect behind a timeout.
    const io: { setSelectedUser: ReturnType<typeof vi.fn> } = { setSelectedUser: vi.fn(async (): Promise<never> => { throw new Error('quota exceeded'); }) };
    await expect(
      selectUserWithoutBlocking(io as never, {
        selectedUsername: 'alice', selectedServerAddress: 'x',
      }, (): void => {}),
    ).rejects.toThrow('quota exceeded');
  });
});
