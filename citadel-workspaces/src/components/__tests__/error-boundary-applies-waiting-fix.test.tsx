/**
 * Drives the real boundary: the helper being correct is worthless if the button
 * does not call it. Reinstating `onReload={() => window.location.reload()}`
 * leaves tsc and every helper test green — only this one moves.
 */
import { describe, it, expect, vi, beforeEach, afterEach  } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppErrorBoundary } from '../AppErrorBoundary';
import type { UserEvent } from '@testing-library/user-event';

const originalSW: ReturnType<typeof Object.getOwnPropertyDescriptor> = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

function Boom(): JSX.Element {
  throw new Error('render crashed');
}

describe('AppErrorBoundary recovery', () => {
  const postMessage: ReturnType<typeof vi.fn> = vi.fn();
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    postMessage.mockClear();
    // React logs the caught error; that is expected here, not a failure.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: () => Promise.resolve({ waiting: { postMessage } }),
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
  });

  afterEach(() => {
    consoleError.mockRestore();
    if (originalSW) Object.defineProperty(navigator, 'serviceWorker', originalSW);
  });

  it('hands control to a waiting fixed build before reloading', async () => {
    const user: UserEvent = userEvent.setup();
    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    );

    await user.click(screen.getByRole('button', { name: /reload workspace/i }));

    // Without this the user loops on the crashing build for ever: a same-tab
    // reload leaves the old worker serving the old shell.
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' }));
  });
});
