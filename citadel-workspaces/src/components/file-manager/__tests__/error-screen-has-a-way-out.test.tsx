/**
 * The file manager's error screen was a terminal state.
 *
 * `FileManagerContent` swaps the whole browser for `ErrorScreen` on any tree
 * failure, and the screen rendered an icon, a heading and the raw error -- no
 * control of any kind. The hook has always exposed `refresh`; the screen just
 * never offered it. So one timed-out fetch on a flaky link (the tree request
 * carries a 30s budget) painted a permanent dead end for a transient blip, and
 * the only way out was to navigate away and come back.
 */

import { describe, it, expect, vi  } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorScreen } from '../FileManagerStatusScreens';

describe('file manager error screen', () => {
  it('offers a control that re-fetches the tree', async () => {
    const onRetry: ReturnType<typeof vi.fn> = vi.fn();
    render(<ErrorScreen error="Request timed out" onRetry={onRetry} />);

    const button: HTMLElement = screen.getByRole('button');
    await userEvent.click(button);

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('still shows what went wrong', () => {
    render(<ErrorScreen error="Request timed out" onRetry={vi.fn()} />);
    expect(screen.getByText('Request timed out')).toBeInTheDocument();
  });

  it('says something when the error is empty', () => {
    render(<ErrorScreen error={null} onRetry={vi.fn()} />);
    // A blank line under "File System Error" reads as a rendering bug.
    expect(screen.getByText(/Failed to load tree/)).toBeInTheDocument();
  });
});
