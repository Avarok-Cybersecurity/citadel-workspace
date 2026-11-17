/**
 * Raising a loading flag introduces the opposite failure if it can never be
 * lowered: `WorkspaceService.listX()` resolves when the request is SENT, so a
 * response that never arrives leaves the flag raised and the surface spinning
 * forever. The deadline makes the UI fall back to the empty state — a statement
 * the user can act on — instead.
 */
import { describe, it, expect, vi, afterEach  } from 'vitest';
import {
  armLoadingDeadline,
  cancelLoadingDeadline,
  LOADING_DEADLINE_MS,
} from '../loading-flag-timeout';

afterEach(() => vi.useRealTimers());

describe('loading deadline', () => {
  it('fires when the response never arrives', () => {
    vi.useFakeTimers();
    const expired: ReturnType<typeof vi.fn> = vi.fn();

    armLoadingDeadline('nodes', expired);
    vi.advanceTimersByTime(LOADING_DEADLINE_MS + 1);

    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('does not fire once the response arrives', () => {
    vi.useFakeTimers();
    const expired: ReturnType<typeof vi.fn> = vi.fn();

    armLoadingDeadline('nodes', expired);
    cancelLoadingDeadline('nodes');
    vi.advanceTimersByTime(LOADING_DEADLINE_MS * 2);

    expect(expired).not.toHaveBeenCalled();
  });

  it('keeps separate surfaces independent', () => {
    vi.useFakeTimers();
    const nodesExpired: ReturnType<typeof vi.fn> = vi.fn();
    const membersExpired: ReturnType<typeof vi.fn> = vi.fn();

    armLoadingDeadline('nodes', nodesExpired);
    armLoadingDeadline('members', membersExpired);
    cancelLoadingDeadline('members');
    vi.advanceTimersByTime(LOADING_DEADLINE_MS + 1);

    // A members response arriving must not cancel the tree's deadline.
    expect(nodesExpired).toHaveBeenCalledTimes(1);
    expect(membersExpired).not.toHaveBeenCalled();
  });

  it('re-arming replaces the previous deadline rather than stacking', () => {
    vi.useFakeTimers();
    const expired: ReturnType<typeof vi.fn> = vi.fn();

    armLoadingDeadline('nodes', expired);
    armLoadingDeadline('nodes', expired);
    vi.advanceTimersByTime(LOADING_DEADLINE_MS * 3);

    expect(expired).toHaveBeenCalledTimes(1);
  });
});
