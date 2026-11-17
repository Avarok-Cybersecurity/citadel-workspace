/**
 * The boundary is MOUNTED, not merely correct.
 *
 * AppErrorBoundary has its own tests, and every one of them would still pass if
 * someone deleted `<AppErrorBoundary>` from App.tsx — they render the component
 * directly. That is the gap this closes: a render error is thrown from a real
 * route, through the real App tree, and the recovery UI has to appear.
 *
 * A white screen is the worst outcome a render error can produce, and it is the
 * one nobody notices until a user reports "it just went blank".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// The landing route throws on render. Mocked before App is imported so the
// route actually mounts this instead of the real page.
vi.mock('@/pages/Landing', () => ({
  default: (): never => {
    throw new Error('forced render failure');
  },
}));

// Nothing here should reach the network; these providers are heavy and their
// behaviour is not what is under test.
vi.mock('@/components/pwa/PwaUpdatePrompt', () => ({ PwaUpdatePrompt: (): null => null }));
vi.mock('@/components/pwa/OfflineBanner', () => ({ OfflineBanner: (): null => null }));

import App from '../../App';

describe('App error boundary wiring', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // React logs caught render errors; the noise is expected here and would
    // otherwise drown the run.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('catches a route that throws and offers a way out', () => {
    render(<App />);

    // The recovery affordance, not just "something rendered": a boundary that
    // catches and shows a dead end is barely better than the blank page.
    expect(screen.getByRole('button', { name: /reload workspace/i })).toBeInTheDocument();
  });

  it('does not leave a blank page', () => {
    const { container } = render(<App />);
    expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });
});
