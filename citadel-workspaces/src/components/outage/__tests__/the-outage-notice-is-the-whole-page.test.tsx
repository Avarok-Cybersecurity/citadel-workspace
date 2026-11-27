/**
 * The notice a failure puts in place of the workspace: copy and way out per cause. The words are
 * the owner's (decision 2026-11-27, REL-1127): "The error is on us — please check back soon" only
 * when the server is really down; offline says so and that it reconnects by itself, with the wait
 * wired; during a reconnect, that it is reconnecting.
 */
import { afterEach, describe, it, expect, vi, type Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ServiceUnavailable } from '../ServiceUnavailable';
import { PolicyChoice } from '@/components/sign-in/PolicyChoice';
import { KEY_POLICY_RECONNECT_NOTE } from '@/lib/sign-in/copy';
import { outage, type OutageKind } from '@/lib/reconnect/outage';

const OWNER_COPY: { readonly server: string; readonly offline: string; readonly reconnecting: string } = {
  server: 'The error is on us — please check back soon',
  offline: 'You’re offline. Citadel will reconnect automatically when your connection is back.',
  reconnecting: 'Reconnecting to your workspace…',
};

const setOnline = (online: boolean): void => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
  act((): void => { window.dispatchEvent(new Event(online ? 'online' : 'offline')); });
};

const title = (): string => screen.getByTestId('service-unavailable-title').textContent ?? '';

describe('the outage notice, per cause', () => {
  afterEach((): void => {
    cleanup();
    vi.restoreAllMocks();
    outage.set(null);
  });

  it('server down: the owner’s sentence, the code, and Try again runs the loader’s retry', () => {
    const retry: Mock<() => void> = vi.fn<() => void>();
    render(<ServiceUnavailable kind="server-unreachable" onRetry={retry} />);
    expect(title()).toBe(OWNER_COPY.server);
    expect(screen.getByTestId('service-unavailable-code').textContent).toBe('CW-SRV-UNREACHABLE');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('reconnecting: says so, never blames the server, and offers no reload over the reconnect', () => {
    const retry: Mock<() => void> = vi.fn<() => void>();
    render(<ServiceUnavailable kind="reconnect-slow" onRetry={retry} />);
    expect(title()).toBe(OWNER_COPY.reconnecting);
    expect(screen.getByTestId('service-unavailable').textContent).not.toContain(OWNER_COPY.server);
    expect(screen.getByTestId('service-unavailable-code').textContent).toBe('CW-LINK-SLOW');
    expect(screen.queryByRole('button', { name: /Reload|Try again/ })).toBeNull();
    expect(screen.getByTestId('service-unavailable').textContent).not.toMatch(/\bat \w+ \(|Error:/);
  });

  it('offline: says so for every kind, never the server’s sentence', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    for (const kind of ['reconnect-slow', 'server-unreachable', 'workspace-timeout'] as const satisfies readonly OutageKind[]) {
      render(<ServiceUnavailable kind={kind} onRetry={(): void => undefined} />);
      expect(title()).toBe(OWNER_COPY.offline);
      expect(screen.getByTestId('service-unavailable').textContent).not.toContain(OWNER_COPY.server);
      cleanup();
    }
  });

  it('offline: back online, a lost session goes on by itself and the copy follows the cause', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const retry: Mock<() => void> = vi.fn<() => void>();
    render(<ServiceUnavailable kind="server-unreachable" onRetry={retry} />);
    expect(retry).not.toHaveBeenCalled();
    setOnline(true);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(title()).toBe(OWNER_COPY.server);
  });

  it('offline during a reconnect: back online, the agent’s reconnect carries on, nothing reloads', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const retry: Mock<() => void> = vi.fn<() => void>();
    render(<ServiceUnavailable kind="reconnect-slow" onRetry={retry} />);
    setOnline(true);
    expect(retry).not.toHaveBeenCalled();
    expect(title()).toBe(OWNER_COPY.reconnecting);
  });

  it('offline: past the deadline, Try again is offered by hand', () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      const retry: Mock<() => void> = vi.fn<() => void>();
      render(<ServiceUnavailable kind="workspace-timeout" onRetry={retry} />);
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
      act((): void => { vi.advanceTimersByTime(120_000); });
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(retry).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('choosing a policy that asks for a key', () => {
  const choice = (value: 'Password' | 'PasswordAndKey' | 'KeyOnly'): void => {
    render(<PolicyChoice id="t" value={value} options={['Password', 'PasswordAndKey', 'KeyOnly']} onChange={(): void => undefined} disabled={false} />);
  };

  it('says a dropped connection will ask for a sign-in again', () => {
    for (const policy of ['PasswordAndKey', 'KeyOnly'] as const) {
      choice(policy);
      expect(screen.getByTestId('t-policy-reconnect-note').textContent).toBe(KEY_POLICY_RECONNECT_NOTE);
      document.body.innerHTML = '';
    }
  });

  // The control: under the password alone the agent does reconnect by itself, so nothing is said.
  it('says nothing of it under the password alone', () => {
    choice('Password');
    expect(screen.queryByTestId('t-policy-reconnect-note')).toBeNull();
  });
});
