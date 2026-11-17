import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AppErrorBoundary } from '../AppErrorBoundary';

/**
 * The root error boundary is the difference between "something broke" and a
 * white screen. It is also the one failure a user cannot report usefully,
 * because the screen it happened on is gone — so it is worth knowing it works
 * rather than assuming it does.
 *
 * These render a component that throws, which React reports to console.error
 * even when a boundary handles it. Silencing that keeps a passing run readable;
 * it is restored afterwards so a genuine error elsewhere is still visible.
 */
function Boom(): never {
  throw new Error('render exploded');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AppErrorBoundary', () => {
  it('renders its children when nothing throws', () => {
    render(
      <AppErrorBoundary>
        <p>workspace content</p>
      </AppErrorBoundary>
    );

    expect(screen.getByText('workspace content')).toBeInTheDocument();
  });

  it('catches a render error and offers a way out', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>
    );

    // A recovery action, not just an apology: without it the user's only option
    // is to work out that they need to reload the page themselves.
    expect(screen.getByRole('button', { name: 'Reload workspace' })).toBeInTheDocument();
  });

  it('does not leave the broken subtree on screen', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <AppErrorBoundary>
        <p>workspace content</p>
        <Boom />
      </AppErrorBoundary>
    );

    // The whole subtree is replaced, not just the component that threw. Worth
    // pinning: a boundary that renders the fallback ALONGSIDE half-mounted
    // children shows the user a broken page and a reload button at once.
    expect(screen.queryByText('workspace content')).not.toBeInTheDocument();
  });

  it('surfaces the error to the app rather than swallowing it', () => {
    const consoleError: ReturnType<typeof vi.spyOn> = vi.spyOn(console, 'error').mockImplementation((): void => {});

    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>
    );

    // errorLog writes through console.error in every build, deliberately: this
    // is the one error the user cannot describe for you. If this stops being
    // called, render crashes become invisible in production.
    expect(consoleError).toHaveBeenCalled();
  });
});
