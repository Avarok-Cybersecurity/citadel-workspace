/**
 * `maxRetries` bounds the machine's patience, not the person's.
 *
 * "Retry Now" was disabled by `attempt >= maxRetries`. With the default budget
 * of 10 and a 2s doubling backoff capped at 300s, those attempts span roughly
 * 18 minutes -- so a laptop asleep past that woke into a modal whose Retry
 * button refused to retry, on a connection that was by then very likely fine.
 * Cancel was the only enabled control, and a reload the only real way out.
 *
 * Enabling the button is only half of it. `useRetry.retry` keeps incrementing
 * `attempt` and refuses once it passes `maxRetries`, so a button wired to it
 * works exactly once more and is then dead again -- which is why the test below
 * presses twice. Past the budget the press starts a fresh series instead.
 */

import { describe, it, expect, vi, beforeEach  } from 'vitest';
import { render, screen, waitFor , type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectionRetryModal } from '../ConnectionRetryModal';

vi.mock('@/lib/websocket-service', () => ({
  websocketService: { reset: vi.fn(), init: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@/hooks/use-toast', () => ({
  useToast: (): { toast: ReturnType<typeof vi.fn> } => ({ toast: vi.fn() }),
}));

const onRetry: ReturnType<typeof vi.fn> = vi.fn();

function renderExhausted(): RenderResult {
  // maxRetries=1 so the very first failure spends the whole budget -- the same
  // state a real user reaches after ten, without waiting out the backoff.
  return render(
    <ConnectionRetryModal
      isOpen
      onClose={vi.fn()}
      onRetry={onRetry}
      maxRetries={1}
    />,
  );
}

describe('manual retry after the automatic budget is spent', () => {
  beforeEach(() => {
    onRetry.mockReset();
    onRetry.mockRejectedValue(new Error('still down'));
  });

  it('leaves Retry Now enabled', async () => {
    renderExhausted();
    await screen.findByText(/Failed to reconnect after 1 attempts/);

    expect(screen.getByRole('button', { name: /Retry Now/i })).toBeEnabled();
  });

  it('actually retries when pressed', async () => {
    renderExhausted();
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
    await screen.findByText(/Failed to reconnect after 1 attempts/);

    await userEvent.click(screen.getByRole('button', { name: /Retry Now/i }));
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(2));

    // Twice, deliberately. Continuing the spent series works once and then
    // refuses, so a single press cannot tell a real fix from a button that
    // merely looks enabled.
    await userEvent.click(screen.getByRole('button', { name: /Retry Now/i }));
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(3));
  });

  it('closes on a retry that succeeds', async () => {
    const onClose: ReturnType<typeof vi.fn> = vi.fn();
    render(
      <ConnectionRetryModal isOpen onClose={onClose} onRetry={onRetry} maxRetries={1} />,
    );
    await screen.findByText(/Failed to reconnect after 1 attempts/);

    onRetry.mockResolvedValue(true);
    await userEvent.click(screen.getByRole('button', { name: /Retry Now/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
