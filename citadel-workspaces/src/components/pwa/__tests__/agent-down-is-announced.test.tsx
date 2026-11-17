/**
 * `healthCheckService` polls every 10 seconds and emitted `service-health` to
 * ZERO listeners — so the app knew the local agent was unreachable and told
 * nobody. The user met it as scattered per-operation failures, or as silence.
 *
 * The agent runs on localhost, so it can be dead while the device is perfectly
 * online: `useOnlineStatus` cannot see this, and the offline banner — whose own
 * docstring says an installed PWA has no browser chrome to reveal a problem —
 * did not cover it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { eventEmitter } from '@/lib/event-emitter';
import { OfflineBanner } from '../OfflineBanner';

vi.mock('@/hooks/use-online-status', () => ({
  useOnlineStatus: (): { isOnline: boolean; justReconnected: boolean; } => ({ isOnline: true, justReconnected: false }),
}));

const announceHealth = (isHealthy: boolean): void =>
  act(() => { eventEmitter.emit('service-health', { isHealthy, lastCheck: Date.now() }); });

describe('the agent-down banner', () => {
  beforeEach(() => { announceHealth(true); });

  it('shows nothing while the agent is reachable', () => {
    render(<OfflineBanner />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('announces an unreachable agent even though the device is online', () => {
    render(<OfflineBanner />);
    announceHealth(false);

    const banner: HTMLElement = screen.getByRole('status');
    expect(banner).toHaveTextContent(/agent/i);
    // Polite, not assertive: an ambient condition, not a response to an action.
    expect(banner).toHaveAttribute('aria-live', 'polite');
  });

  it('is not labelled as the reassuring banner', () => {
    render(<OfflineBanner />);
    announceHealth(false);

    // `agentDown` implies the device is online, so this state used to carry
    // data-testid="reconnected-banner" -- the green "back online" name on the
    // red "your agent is unreachable" state.
    expect(screen.getByTestId('agent-down-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('reconnected-banner')).toBeNull();
  });

  it('clears itself when the agent comes back', () => {
    render(<OfflineBanner />);
    announceHealth(false);
    expect(screen.getByRole('status')).toBeInTheDocument();

    announceHealth(true);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('starts optimistic, so a slow first poll does not flash a warning', () => {
    // The first poll can be a full interval away; opening with a red banner
    // that resolves itself trains people to ignore it.
    render(<OfflineBanner />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
