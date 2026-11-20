/**
 * A page running an old precached shell renders 404 for a route only the newer build has (/sign-in,
 * the first time it shipped). When that newer build is waiting, the not-found page takes it at
 * once instead of waiting for the person to find the banner's Reload; it does so once per path, and
 * never for `stale`. Negative control: removing the hook from NotFound fails the first test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NotFound from '@/pages/NotFound';
import { clearDeployNoticeForTests, offerDeployNotice } from '@/lib/pwa/deploy-notice';
import { RELOADED_FOR_KEY } from '@/pages/use-newer-build-for-unknown-route';

function show(path: string): void {
  render(<MemoryRouter initialEntries={[path]}><NotFound /></MemoryRouter>);
}

beforeEach(() => { clearDeployNoticeForTests(); sessionStorage.clear(); });
afterEach(() => { cleanup(); clearDeployNoticeForTests(); });

describe('the not-found page and a newer build', () => {
  it('takes a waiting update at once', () => {
    const accept: () => void = vi.fn<() => void>();
    show('/sign-in');
    act(() => offerDeployNotice({ reason: 'waiting', accept }));
    expect(accept).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(RELOADED_FOR_KEY)).toBe('/sign-in');
  });

  it('takes one that was already offered when the page rendered', () => {
    const accept: () => void = vi.fn<() => void>();
    offerDeployNotice({ reason: 'deployed', accept });
    show('/sign-in');
    expect(accept).toHaveBeenCalledOnce();
  });

  it('does not reload a second time for the same path, so a real 404 cannot loop', () => {
    sessionStorage.setItem(RELOADED_FOR_KEY, '/sign-in');
    const accept: () => void = vi.fn<() => void>();
    offerDeployNotice({ reason: 'waiting', accept });
    show('/sign-in');
    expect(accept).not.toHaveBeenCalled();
  });

  it('leaves a stale notice to the banner', () => {
    const accept: () => void = vi.fn<() => void>();
    offerDeployNotice({ reason: 'stale', accept });
    show('/sign-in');
    expect(accept).not.toHaveBeenCalled();
  });

  it('does nothing when no newer build exists', () => {
    show('/sign-in');
    expect(sessionStorage.getItem(RELOADED_FOR_KEY)).toBeNull();
  });
});
