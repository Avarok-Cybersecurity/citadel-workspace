/**
 * Offline is a STATE, not an event — the banner has to persist while it holds.
 * Nothing in the app reported connectivity before this: navigator.onLine was
 * read only by PwaUpdatePrompt, to skip update checks.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { OfflineBanner } from '../OfflineBanner';
import { RECONNECTED_NOTICE_MS } from '@/hooks/use-online-status';

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

function fireConnectivity(event: 'online' | 'offline'): void {
  act(() => { window.dispatchEvent(new Event(event)); });
}

describe('OfflineBanner', () => {
  beforeEach(() => { setOnline(true); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders nothing while online', () => {
    const { container } = render(<OfflineBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('appears when the connection drops', () => {
    render(<OfflineBanner />);

    setOnline(false);
    fireConnectivity('offline');

    expect(screen.getByTestId('offline-banner')).toBeInTheDocument();
    expect(screen.getByText(/offline/i)).toBeInTheDocument();
  });

  it('shows immediately when the app STARTS offline, with no event to hear', () => {
    // A PWA can be launched from the home screen with no connection. The
    // 'offline' event only fires on a transition, so reading navigator.onLine
    // up front is the only way this case is caught.
    setOnline(false);

    render(<OfflineBanner />);

    expect(screen.getByTestId('offline-banner')).toBeInTheDocument();
  });

  it('confirms recovery rather than just vanishing', () => {
    setOnline(false);
    render(<OfflineBanner />);
    expect(screen.getByTestId('offline-banner')).toBeInTheDocument();

    setOnline(true);
    fireConnectivity('online');

    expect(screen.getByTestId('reconnected-banner')).toBeInTheDocument();
    expect(screen.getByText(/back online/i)).toBeInTheDocument();
  });

  it('retires the recovery notice on its own', () => {
    setOnline(false);
    render(<OfflineBanner />);
    setOnline(true);
    fireConnectivity('online');

    act(() => { vi.advanceTimersByTime(RECONNECTED_NOTICE_MS + 50); });

    expect(screen.queryByTestId('reconnected-banner')).not.toBeInTheDocument();
  });

  it('goes back to offline if the connection flaps before the notice retires', () => {
    setOnline(false);
    render(<OfflineBanner />);
    setOnline(true);
    fireConnectivity('online');

    setOnline(false);
    fireConnectivity('offline');

    expect(screen.getByTestId('offline-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('reconnected-banner')).not.toBeInTheDocument();
  });

  it('announces politely, so it is heard without interrupting', () => {
    setOnline(false);
    render(<OfflineBanner />);

    const banner: HTMLElement = screen.getByTestId('offline-banner');
    expect(banner).toHaveAttribute('role', 'status');
    expect(banner).toHaveAttribute('aria-live', 'polite');
  });
});
