/**
 * A stalled tab-context write must not silently cancel an account switch.
 *
 * `switchAccount` awaited `setSelectedUser` — an IndexedDB write — before
 * disconnecting and reconnecting. IndexedDB stalls for ordinary reasons: an
 * upgrade blocked by another tab, a busy agent, a private-browsing quota. When
 * it did, the user pressed a workspace icon and nothing happened. No error, no
 * switch, the old account still on screen.
 *
 * `handleAuthSuccess` already raced that exact call against a timeout and
 * continued on expiry, with a comment explaining why. It is the same call, in
 * the next file over. One implementation now, so the next caller inherits the
 * lesson rather than repeating the shape.
 */
import { describe, it, expect, vi } from 'vitest';
import { switchAccount } from '../lifecycle';
import { selectUserWithoutBlocking } from '../select-user';

function harness(selectStalls: boolean): { state: { findSession: ReturnType<typeof vi.fn>; isLeader: boolean; updateCurrentConnectionInfo: ReturnType<typeof vi.fn>; }; io: { setSelectedUser: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; }; session: { username: string; serverAddress: string; password: string; cid: bigint; }; remembered: Partial<{ username: string; serverAddress: string; cid: bigint; }>; } {
  const session: { username: string; serverAddress: string; password: string; cid: bigint; } = {
    username: 'alice', serverAddress: '127.0.0.1:12349', password: 'pw', cid: 42n,
  };
  const remembered: Partial<{ username: string; serverAddress: string; cid: bigint }> = {};
  const state: {
    findSession: ReturnType<typeof vi.fn>;
    isLeader: boolean;
    updateCurrentConnectionInfo: ReturnType<typeof vi.fn>;
  } = {
    findSession: vi.fn(() => session),
    isLeader: true,
    updateCurrentConnectionInfo: vi.fn((partial: Record<string, unknown>): void => {
      Object.assign(remembered, partial);
    }),
  };
  const io: { setSelectedUser: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> } = {
    // Never settles, which is what a blocked IndexedDB upgrade looks like.
    setSelectedUser: vi.fn(() => (selectStalls ? new Promise<void>(() => {}) : Promise.resolve())),
    connect: vi.fn(async () => {}),
  };
  return { state, io, session, remembered };
}

describe('switching account while tab context is stalled', () => {
  it('still connects to the new account', async () => {
    vi.useFakeTimers();
    const { state, io, session } = harness(true);
    const done: Promise<void> = switchAccount(
      'alice', '127.0.0.1:12349', state as never, io as never,
      vi.fn(async () => {}), vi.fn(async () => { void session; }),
    );
    await vi.advanceTimersByTimeAsync(60_000);
    await done;
    expect(io.connect).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

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

describe('who this tab is signed in as, when the write never lands', () => {
  it('is still readable in memory', async () => {
    // The whole point of tolerating a stalled write. Without the in-memory
    // mirror, `resolveCurrentUserId()` has two sources and both are empty:
    // `currentConnectionInfo.username`, which switchAccount never set, and the
    // tab-selected session, which is the write that just stalled. Every
    // permission fetch then bails with "nobody is signed in on this tab" and
    // every gated control on the page is refused for its lifetime.
    vi.useFakeTimers();
    const { state, io, session, remembered } = harness(true);
    const done: Promise<void> = switchAccount(
      'alice', '127.0.0.1:12349', state as never, io as never,
      vi.fn(async () => {}), vi.fn(async () => { void session; }),
    );
    await vi.advanceTimersByTimeAsync(60_000);
    await done;

    expect(remembered.username).toBe('alice');
    expect(remembered.cid).toBe(42n);
    vi.useRealTimers();
  });

  it('is remembered by merging, not by replacing the record', async () => {
    // `currentConnectionInfo` is shared with the CID that ConnectSuccess
    // writes. Assigning over it is what round 300 fixed, in this same field.
    vi.useFakeTimers();
    const { state, io, session } = harness(true);
    const done: Promise<void> = switchAccount(
      'alice', '127.0.0.1:12349', state as never, io as never,
      vi.fn(async () => {}), vi.fn(async () => { void session; }),
    );
    await vi.advanceTimersByTimeAsync(60_000);
    await done;

    expect(state.updateCurrentConnectionInfo).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
