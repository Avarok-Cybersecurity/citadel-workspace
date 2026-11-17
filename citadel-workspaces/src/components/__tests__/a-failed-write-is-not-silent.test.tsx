/**
 * A workspace change that never reached the disk has to say so.
 *
 * `persistTree` emits `revfs:persist-failed` when the write fails, under a
 * comment explaining that throwing would be wrong — the operation DID happen,
 * only its durability failed — and that "whoever wires a 'changes may not
 * survive a reload' notice does it here rather than at twenty call sites".
 * Nobody wired it. The tree changed on screen, the write failed, and the only
 * record was a debug line.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { PersistFailureNotice } from '../PersistFailureNotice';
import { eventEmitter } from '@/lib/event-emitter';
import {
  PERSIST_NOTICE_COOLDOWN_MS,
  recordTold,
  shouldTell,
  type NoticeState,
} from '@/lib/persist-failure-notice';

const toast: ReturnType<typeof vi.fn> = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: (): { toast: ReturnType<typeof vi.fn> } => ({ toast }),
}));

afterEach((): void => { cleanup(); toast.mockClear(); });

describe('the cooldown', () => {
  it('tells the user the first time a tree fails', () => {
    const state: NoticeState = { lastToldAtMs: new Map<string, number>() };
    expect(shouldTell(state, 'tree-a', 1_000)).toBe(true);
  });

  it('stays quiet while the same tree keeps failing', () => {
    // A disk that has stopped accepting writes fails every one of them, and the
    // second notice tells the user nothing the first did not.
    const state: NoticeState = { lastToldAtMs: new Map<string, number>() };
    recordTold(state, 'tree-a', 1_000);
    expect(shouldTell(state, 'tree-a', 1_000 + PERSIST_NOTICE_COOLDOWN_MS - 1)).toBe(false);
  });

  it('speaks again once the problem has had time to be a new one', () => {
    const state: NoticeState = { lastToldAtMs: new Map<string, number>() };
    recordTold(state, 'tree-a', 1_000);
    expect(shouldTell(state, 'tree-a', 1_000 + PERSIST_NOTICE_COOLDOWN_MS)).toBe(true);
  });

  it('does not silence a different tree', () => {
    const state: NoticeState = { lastToldAtMs: new Map<string, number>() };
    recordTold(state, 'tree-a', 1_000);
    expect(shouldTell(state, 'tree-b', 1_000)).toBe(true);
  });
});

describe('the notice', () => {
  it('raises a toast when a tree fails to persist', () => {
    render(<PersistFailureNotice />);

    act((): void => { eventEmitter.emit('revfs:persist-failed', { treeKey: 'tree-a' }); });

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({
      variant: 'destructive',
      title: 'Changes may not survive a reload',
    });
  });

  it('raises a toast when the session could not be remembered', () => {
    // The other half of round 462. `handleAuthSuccess` emits this when the
    // session write fails; without a listener the emit is a half-built feature,
    // which is exactly what `revfs:persist-failed` was for months.
    render(<PersistFailureNotice />);

    act((): void => { eventEmitter.emit('session:not-remembered', { username: 'alice' }); });

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({
      variant: 'destructive',
      title: 'This device could not remember your session',
    });
  });

  it('does not let a failing disk silence the session notice', () => {
    // Both notices share one cooldown map. Keyed together, a tree failing every
    // few seconds would swallow the one notice that is about signing in.
    render(<PersistFailureNotice />);

    act((): void => { eventEmitter.emit('revfs:persist-failed', { treeKey: 'tree-a' }); });
    act((): void => { eventEmitter.emit('session:not-remembered', { username: 'alice' }); });

    expect(toast).toHaveBeenCalledTimes(2);
  });

  it('does not repeat itself for a burst of failures', () => {
    render(<PersistFailureNotice />);

    act((): void => {
      for (let i: number = 0; i < 5; i += 1) {
        eventEmitter.emit('revfs:persist-failed', { treeKey: 'tree-a' });
      }
    });

    expect(toast).toHaveBeenCalledTimes(1);
  });
});
