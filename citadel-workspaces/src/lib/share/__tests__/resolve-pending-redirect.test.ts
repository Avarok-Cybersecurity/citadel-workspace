/**
 * Every post-sign-in path goes through `resolvePendingRedirectWith`: a resolved target is
 * navigated to only after it passes the target rules again, and everything else is the one
 * "isn't available" answer. The deps are the I/O boundary (storage, session, wire, router, toast),
 * passed in rather than mocked.
 */
import { describe, expect, it, vi } from 'vitest';
import type { PendingRedirect } from '../pending-redirect';
import { resolvePendingRedirectWith, UNAVAILABLE_COPY, type RedirectDeps } from '../resolve-pending-redirect';
import type { ResolveOutcome } from '@/lib/workspace-service/secure-links-operations';

const PENDING: PendingRedirect = { token: 't'.repeat(43), server: 'work.example.com' };

type TestDeps = RedirectDeps & { navigated: string[]; refused: string[] };

function deps(over: Partial<RedirectDeps> & { answer?: ResolveOutcome }): TestDeps {
  let pending: PendingRedirect | null = PENDING;
  const navigated: string[] = [];
  const refused: string[] = [];
  return {
    navigated, refused,
    peek: (): PendingRedirect | null => pending,
    take: (): PendingRedirect | null => { const p: PendingRedirect | null = pending; pending = null; return p; },
    ready: (): boolean => true,
    sessionServer: async (): Promise<string | null> => 'work.example.com',
    resolve: async (): Promise<ResolveOutcome> => over.answer ?? { kind: 'unavailable' },
    navigate: (path: string): void => { navigated.push(path); },
    unavailable: (detail: string): void => { refused.push(detail); },
    ...over,
  };
}

describe('resolving the link a visitor signed in with', () => {
  it('navigates to the target the server resolved', async () => {
    const d: TestDeps = deps({ answer: { kind: 'resolved', target: '/workspace?nodeId=n-1' } });
    await resolvePendingRedirectWith(d, '/workspace');
    expect(d.navigated).toEqual(['/workspace?nodeId=n-1']);
    expect(d.refused).toEqual([]);
  });

  it('is opened once: a second success path finds nothing and goes to its fallback', async () => {
    const resolve: (token: string) => Promise<ResolveOutcome> = vi.fn<(token: string) => Promise<ResolveOutcome>>(async (): Promise<ResolveOutcome> => ({ kind: 'resolved', target: '/messages' }));
    const d: TestDeps = deps({ resolve });
    await resolvePendingRedirectWith(d, '/workspace');
    await resolvePendingRedirectWith(d, '/workspace');
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(d.navigated).toEqual(['/messages', '/workspace']);
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['another origin', 'https://evil.example/workspace'],
    ['protocol-relative', '//evil.example/workspace'],
    ['backslash host', '/\\evil.example'],
    ['an unknown route', '/settings'],
  ])('refuses a resolved %s target and goes to the workspace', async (_name: string, target: string) => {
    const d: TestDeps = deps({ answer: { kind: 'resolved', target } });
    await resolvePendingRedirectWith(d, '/workspace');
    expect(d.navigated).toEqual(['/workspace']);
    expect(d.refused).toEqual([UNAVAILABLE_COPY.generic]);
  });

  it('says unavailable for LinkUnavailable and for a failed request', async () => {
    const a: TestDeps = deps({ answer: { kind: 'unavailable' } });
    await resolvePendingRedirectWith(a, '/workspace');
    const b: TestDeps = deps({ resolve: async () => { throw new Error('timeout'); } });
    await resolvePendingRedirectWith(b, '/workspace');
    expect([a.refused, b.refused]).toEqual([[UNAVAILABLE_COPY.generic], [UNAVAILABLE_COPY.generic]]);
  });

  it('does not send a link to a session on another server', async () => {
    const resolve: (token: string) => Promise<ResolveOutcome> = vi.fn<(token: string) => Promise<ResolveOutcome>>(async (): Promise<ResolveOutcome> => ({ kind: 'resolved', target: '/messages' }));
    const d: TestDeps = deps({ resolve, sessionServer: async () => 'other.example.com' });
    await resolvePendingRedirectWith(d, '/workspace');
    expect(resolve).not.toHaveBeenCalled();
    expect(d.refused).toEqual([UNAVAILABLE_COPY.otherServer('work.example.com')]);
  });

  it('leaves the link waiting while the session is not ready, for the loader to open', async () => {
    const d: TestDeps = deps({ ready: () => false });
    await resolvePendingRedirectWith(d, '/workspace');
    expect(d.navigated).toEqual(['/workspace']);
    expect(d.peek()).toEqual(PENDING);
  });

  it('from the loader (no fallback) stays put when there is nothing to open', async () => {
    const d: TestDeps = deps({ peek: () => null, take: () => null });
    await resolvePendingRedirectWith(d, null);
    expect(d.navigated).toEqual([]);
  });
});
