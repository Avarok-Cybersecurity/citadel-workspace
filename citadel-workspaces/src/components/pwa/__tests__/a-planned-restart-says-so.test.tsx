/**
 * The server announces its own restarts, and nobody was listening.
 *
 * `ServerShutdown` is a distinct response variant carrying an operator message
 * and a drain window, and the response handler emits `server:shutdown` with
 * both. Its own comment says why the variant exists — "Distinct from `Error` so
 * the UI can show a reconnect notice rather than a red toast on a planned
 * restart" — and nothing in the app listened for it. The announcement was
 * thrown away, and the user got the same generic connection failure a crash
 * would have given them.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/react';
import { OfflineBanner } from '../OfflineBanner';
import { eventEmitter } from '@/lib/event-emitter';
import {
  shutdownNotice,
  noticeStillApplies,
  type ServerShutdown,
} from '@/lib/server-shutdown-notice';

vi.mock('@/hooks/use-online-status', () => ({
  useOnlineStatus: (): { isOnline: boolean; justReconnected: boolean } => ({
    isOnline: true,
    justReconnected: false,
  }),
}));
vi.mock('@/hooks/use-service-health', () => ({
  useServiceHealth: (): { isHealthy: boolean } => ({ isHealthy: true }),
}));

afterEach((): void => { cleanup(); vi.useRealTimers(); });

describe('shutdownNotice', () => {
  it('uses the operator’s own words when there are any', () => {
    expect(shutdownNotice({ message: 'Deploying v2.', drainSeconds: 12 })).toBe(
      'Deploying v2. It should be back in about 12 seconds.',
    );
  });

  it('says something useful when there are none', () => {
    expect(shutdownNotice({ message: '   ', drainSeconds: 1 })).toBe(
      'The server is restarting. It should be back in about 1 second.',
    );
  });

  it('never reports a sub-second drain as zero seconds', () => {
    expect(shutdownNotice({ message: '', drainSeconds: 0 })).toContain('back in a moment');
  });
});

describe('noticeStillApplies', () => {
  it('holds through the drain window and a grace period', () => {
    const shutdown: ServerShutdown = { message: '', drainSeconds: 10 };
    expect(noticeStillApplies(shutdown, 0, 30_000)).toBe(true);
  });

  it('stops explaining a restart that never came back', () => {
    // Two minutes on, "it should be back shortly" is telling somebody to keep
    // waiting for something that is not coming.
    const shutdown: ServerShutdown = { message: '', drainSeconds: 10 };
    expect(noticeStillApplies(shutdown, 0, 120_000)).toBe(false);
  });
});

describe('the banner', () => {
  it('shows nothing while the server is healthy', () => {
    render(<OfflineBanner />);
    expect(screen.queryByTestId('server-restarting-banner')).not.toBeInTheDocument();
  });

  it('explains a planned restart when the server announces one', async (): Promise<void> => {
    render(<OfflineBanner />);

    act((): void => {
      eventEmitter.emit('server:shutdown', { message: 'Deploying v2.', drainSeconds: 5 });
    });

    const banner: HTMLElement = await screen.findByTestId('server-restarting-banner');
    expect(banner).toHaveTextContent('Deploying v2.');
    expect(banner).toHaveTextContent('back in about 5 seconds');
  });

  it('takes the notice down when the connection returns', async (): Promise<void> => {
    render(<OfflineBanner />);
    act((): void => {
      eventEmitter.emit('server:shutdown', { message: '', drainSeconds: 5 });
    });
    await screen.findByTestId('server-restarting-banner');

    act((): void => { eventEmitter.emit('on-ws-connection-success', {}); });

    await waitFor((): void => {
      expect(screen.queryByTestId('server-restarting-banner')).not.toBeInTheDocument();
    });
  });
});
