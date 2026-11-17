import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * The intent dialog must not open on top of the dialog explaining why nothing
 * works yet.
 *
 * On the hosted UI this is the FIRST-RUN state rather than an edge case. The
 * page is served from work.avarok.net; the agent runs on the visitor's own
 * machine; until they install it, `wss://local.avarok.net:12345` refuses.
 * Verified against production: clicking "Create Account" put the intent dialog
 * on screen underneath `ConnectionRetryModal`, while `OfflineBanner` said the
 * same thing across the top. Three notices for one condition, two of them
 * modal, each with its own focus trap.
 *
 * `ConnectionRetryModal` is the one that must win — it alone carries the agent
 * download links and the command to run it.
 *
 * The two directions are pinned separately on purpose. "Does not open while
 * unreachable" alone would pass for a hook that never opens at all, which is
 * the failure this whole feature is; "opens when healthy" alone would pass for
 * the stacking behaviour that shipped.
 *
 * WHAT THIS DOES NOT GUARANTEE. `useServiceHealth` starts optimistic and only
 * learns otherwise from a `service-health` event, which `healthCheckService`
 * emits on a 10-second poll. So a click in the first seconds of a page load can
 * still open the dialog before the first poll reports. The third test is the
 * one that covers that window: the dialog CLOSES when health arrives, rather
 * than staying up under the retry modal. Closing the window entirely would mean
 * driving this from the connection-retry state itself, which lives in
 * `useConnectionHandler` inside WorkspaceApp and is not reachable from Landing
 * without new plumbing. Stated here rather than implied, because a guard whose
 * reach is assumed wider than it is stops anyone looking again.
 */
const health: { isHealthy: boolean } = { isHealthy: true };
vi.mock('@/hooks/use-service-health', () => ({
  useServiceHealth: (): { isHealthy: boolean } => ({ isHealthy: health.isHealthy }),
}));

// Production, so `isOnboardingEnabled()` is true — the dialog is a prod-only
// feature and a dev-defaulted gate would make every assertion here vacuous.
vi.mock('@/lib/debug-config', () => ({
  isOnboardingEnabled: (): boolean => true,
  debugLog: (): void => {},
}));

vi.mock('@/lib/workspace-init-prompt', () => ({
  suppressInitPrompt: (): boolean => true,
}));

import { useOnboardingIntent } from '../useOnboardingIntent';

describe('the intent dialog and the unreachable agent', () => {
  beforeEach(() => {
    health.isHealthy = true;
  });

  it('opens when the agent is reachable', () => {
    const beginWizard: ReturnType<typeof vi.fn> = vi.fn();
    const { result } = renderHook(() => useOnboardingIntent(beginWizard, vi.fn()));

    act(() => result.current.request());

    expect(result.current.open).toBe(true);
    // The wizard waits for an answer; it is not started alongside the question.
    expect(beginWizard).not.toHaveBeenCalled();
  });

  it('does not open while the agent is unreachable', () => {
    health.isHealthy = false;
    const beginWizard: ReturnType<typeof vi.fn> = vi.fn();
    const { result } = renderHook(() => useOnboardingIntent(beginWizard, vi.fn()));

    act(() => result.current.request());

    expect(result.current.open).toBe(false);
    // And does NOT fall through to the wizard, which would open on a connection
    // that cannot complete, on top of the dialog explaining why.
    expect(beginWizard).not.toHaveBeenCalled();
  });

  it('closes an open dialog when the agent goes away', () => {
    const beginWizard: ReturnType<typeof vi.fn> = vi.fn();
    const { result, rerender } = renderHook(() => useOnboardingIntent(beginWizard, vi.fn()));

    act(() => result.current.request());
    expect(result.current.open).toBe(true);

    health.isHealthy = false;
    rerender();

    expect(result.current.open).toBe(false);
  });

  it('still runs the wizard after an answer', () => {
    const beginWizard: ReturnType<typeof vi.fn> = vi.fn();
    const { result } = renderHook(() => useOnboardingIntent(beginWizard, vi.fn()));

    act(() => result.current.request());
    act(() => result.current.resolve('member'));

    expect(result.current.open).toBe(false);
    expect(beginWizard).toHaveBeenCalledTimes(1);
  });
});
