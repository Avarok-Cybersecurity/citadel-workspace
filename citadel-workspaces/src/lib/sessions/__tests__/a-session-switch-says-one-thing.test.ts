/**
 * Resuming a session says one thing at a time.
 *
 * Seen on the live bench, resuming bob0924 from the landing page's
 * previous-sessions bar: "Connected! Now viewing bob0924" and "Reconnecting...
 * Loading bob0924" on screen together. The progress toast was never replaced,
 * only joined, and it was styled as a success while still in progress.
 *
 * Sonner replaces a toast whose id it already shows, so the fix is that every
 * notice of one switch carries one id. Asserted on the ids the flows actually
 * raise, for both paths that switch sessions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToastOptions } from '@/hooks/use-toast';

// Everything mocked below is I/O this sequence performs -- the agent claim,
// IndexedDB selection, WASM messaging, BroadcastChannel presence -- and none
// of it decides what the user is told, which is the rule under test.
const claim: { status: string } = { status: 'claimed' };
vi.mock('../claim-session', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return { ...actual, claimSessionForThisTab: async (): Promise<unknown> => claim };
});
vi.mock('@/lib/connection', async (importOriginal: () => Promise<typeof import('@/lib/connection')>) => {
  const real: typeof import('@/lib/connection') = await importOriginal();
  const { doubleOf } = await import('@/test/singleton-double');
  return {
    ...real,
    connectionManager: doubleOf(real.connectionManager, {
      setActiveSessionIndex: (async (): Promise<void> => {}) as never,
      getStoredSessions: ((): unknown => ({ sessions: [] })) as never,
    }),
  };
});
vi.mock('@/lib/tab-context', () => ({ setSelectedUser: async (): Promise<void> => {} }));
vi.mock('@/lib/start-messaging', () => ({ startMessagingForSession: async (): Promise<void> => {} }));
vi.mock('@/lib/multi-instance', () => ({
  instanceManager: { setCid: (): void => {} },
  instanceChannel: { announcePresence: (): void => {} },
}));
vi.mock('@/lib/post-auth-setup', () => ({ postAuthSetup: async (): Promise<void> => {} }));
vi.mock('../last-accessed', () => ({ markLastAccessed: (): void => {} }));

const { switchToSession } = await import('../switch-to-session');
const { redirectToExistingSession } = await import('@/components/login-session-redirect');

const BOB: { cid: bigint; username: string; server_address: string; workspaceName: string; storedSessionIndex: number } = {
  cid: 42n, username: 'bob0924', server_address: 'bench', workspaceName: 'bob0924', storedSessionIndex: -1,
};

async function raisedBy(run: (toast: (opts: ToastOptions) => unknown) => Promise<void>): Promise<ToastOptions[]> {
  const raised: ToastOptions[] = [];
  await run((opts: ToastOptions): unknown => { raised.push(opts); return undefined; });
  return raised;
}

type Flow = (toast: (opts: ToastOptions) => unknown) => Promise<void>;

const flows: Array<[string, Flow]> = [
  // confirm/signInAs are the takeover path's (#59), which none of these cases reach.
  ['the previous-sessions bar', (toast): Promise<void> => switchToSession(BOB, {
    navigate: (): void => {}, toast, confirm: async (): Promise<boolean> => false, signInAs: (): void => {}, signInAgain: (): void => {},
  })],
  ['the login redirect', (toast): Promise<void> => redirectToExistingSession(BOB, { toast, onNext: (): void => {} })],
];

describe.each(flows)('switching sessions from %s', (_where: string, run: Flow): void => {
  beforeEach((): void => { claim.status = 'claimed'; });

  it('replaces its progress notice with the outcome instead of adding a second', async () => {
    const raised: ToastOptions[] = await raisedBy(run);
    expect(raised.map((t) => t.title)).toEqual(['Reconnecting...', 'Connected!']);
    expect(raised[0].id).toBeDefined();
    expect(new Set(raised.map((t) => t.id)).size).toBe(1);
  });

  it('does not dress the notice that is still working as a success', async () => {
    const [progress]: ToastOptions[] = await raisedBy(run);
    expect(progress.variant).not.toBe('success');
  });

  it('replaces it with the refusal when another tab holds the session', async () => {
    claim.status = 'owned-by-another-tab';
    const raised: ToastOptions[] = await raisedBy(run);
    expect(raised).toHaveLength(2);
    expect(raised[1].title).toBe('Already Open Elsewhere');
    expect(raised[0].id).toBeDefined();
    expect(raised[1].id).toBe(raised[0].id);
  });
});
