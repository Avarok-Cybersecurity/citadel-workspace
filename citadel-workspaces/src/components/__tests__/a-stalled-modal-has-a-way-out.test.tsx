/**
 * An operation that hangs must not trap the app behind a full-screen overlay.
 *
 * `LoadingModal` has an `onCancel` prop, a Cancel button that renders on it, and
 * an Escape handler that uses it. No caller ever passed one. So a sign-out or a
 * connect that stalled showed "This is taking longer than expected" after sixty
 * seconds and then nothing at all: a `fixed inset-0 z-[100]` overlay with no
 * control on it, and no way back to the app except reloading the page — which
 * abandons the request anyway, and every unsaved thing with it.
 *
 * The escape appears once there is something to escape FROM: an error, or a
 * wait that has already outlasted its budget. Not beside a spinner that is
 * working, where it would invite people to abandon something about to succeed.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DisconnectLoadingModal } from '../LoadingModalConfigs';

afterEach((): void => { cleanup(); vi.useRealTimers(); });

function show(
  status: 'disconnecting' | 'error',
  onCancel: (() => void) | undefined,
): void {
  render(
    <DisconnectLoadingModal
      open
      status={status}
      workspaceName="Root"
      errorMessage={status === 'error' ? 'it failed' : undefined}
      onCancel={onCancel}
    />,
  );
}

describe('a modal over a stalled operation', () => {
  it('offers nothing while the wait is still within budget', () => {
    show('disconnecting', vi.fn());
    expect(screen.queryByTestId('loading-modal-dismiss')).not.toBeInTheDocument();
  });

  it('offers a way out once the wait has outlasted its budget', async (): Promise<void> => {
    vi.useFakeTimers();
    const onCancel: ReturnType<typeof vi.fn> = vi.fn();
    show('disconnecting', onCancel);

    await act(async (): Promise<void> => { vi.advanceTimersByTime(61_000); });

    const dismiss: HTMLElement = screen.getByTestId('loading-modal-dismiss');
    // And says what dismissing does, because it cannot stop what is in flight.
    expect(screen.getByText(/keeps running/i)).toBeInTheDocument();

    vi.useRealTimers();
    await userEvent.click(dismiss);
    expect(onCancel).toHaveBeenCalled();
  });

  it('offers a way out of a failure immediately', () => {
    show('error', vi.fn());
    expect(screen.getByTestId('loading-modal-dismiss')).toBeInTheDocument();
  });

  it('offers nothing when the caller supplied no way out', () => {
    // The guard that made this dead: no handler, no button. The three callers
    // now pass one; this pins that the component is honest when they do not.
    show('error', undefined);
    expect(screen.queryByTestId('loading-modal-dismiss')).not.toBeInTheDocument();
  });
});
