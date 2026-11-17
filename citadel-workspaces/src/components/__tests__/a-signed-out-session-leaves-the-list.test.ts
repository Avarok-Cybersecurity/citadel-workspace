/**
 * A session the user has just signed out must leave the strip, whatever the
 * re-query says afterwards.
 *
 * `loadActiveSessions` re-reads the internal service and, when that query is
 * not answered, keeps the list it had. That is deliberate and right: a timeout
 * is not the answer "no sessions", and CIDs are permanent, so a stale strip
 * beats an empty one that makes the user sign in again.
 *
 * It is wrong for the one row the user just removed. CI's previous-sessions run
 * caught it:
 *
 *     Deregistered successfully
 *     Deregister success: true
 *     prev_sess_c_… still in navbar: true
 *
 * The modal reached "ready", so the reload ran to completion — and it logged
 * nothing, which `loadActiveSessions` only does on the unanswered path. The
 * list it kept was the list containing the account that had just been deleted.
 *
 * There is no test file for `signOutSession` at all; it was extracted into its
 * own module to be testable and the tests never followed.
 */
import { describe, it, expect, vi } from 'vitest';
import { signOutSession, type SignOutIO, type SignOutResult } from '../sign-out-session';

const CID: bigint = 4242n;

vi.mock('@/lib/sessions/claim-session', () => ({
  claimSessionForThisTab: vi.fn(async () => ({ ok: true })),
}));

function io(overrides: Partial<SignOutIO> = {}): SignOutIO & { forgotten: bigint[]; order: string[] } {
  const forgotten: bigint[] = [];
  const order: string[] = [];
  return {
    markUserDisconnected: vi.fn(async (): Promise<void> => {}),
    currentWasmCid: (): string | null => null,
    stopWasm: vi.fn(),
    deregister: vi.fn(async (): Promise<void> => {}),
    disconnect: vi.fn(async (): Promise<void> => {}),
    invalidateSessionCache: vi.fn(),
    removeSession: vi.fn(async (): Promise<void> => {}),
    forget: (cid: bigint): void => { forgotten.push(cid); order.push('forget'); },
    reload: vi.fn(async (): Promise<void> => { order.push('reload'); }),
    forgotten,
    order,
    ...overrides,
  };
}

const TARGET: { cid: bigint; username: string; serverAddress: string } = {
  cid: CID,
  username: 'prev_sess_c',
  serverAddress: '127.0.0.1:12349',
};

describe('signing a session out', () => {
  it('drops the row even when the reload never answers', async () => {
    // The reload resolving without having learnt anything is exactly what
    // `loadActiveSessions` does on its unanswered path: it returns, quietly,
    // leaving the previous list in place.
    const effects: ReturnType<typeof io> = io({ reload: vi.fn(async (): Promise<void> => {}) });

    const result: SignOutResult = await signOutSession(effects, TARGET, 'deregister', () => {});

    expect(result.status).toBe('done');
    expect(effects.forgotten).toEqual([CID]);
  });

  it('drops it for a plain disconnect too, not only a deregister', async () => {
    const effects: ReturnType<typeof io> = io();

    await signOutSession(effects, TARGET, 'disconnect', () => {});

    expect(effects.forgotten).toEqual([CID]);
    expect(effects.disconnect).toHaveBeenCalledWith(CID);
    expect(effects.deregister).not.toHaveBeenCalled();
  });

  it('does NOT drop it when the request itself failed', async () => {
    // The negative control, and the one that matters: forgetting a row whose
    // removal was refused would show the user a session that is still live and
    // still theirs, with no way back to it.
    const effects: ReturnType<typeof io> = io({
      deregister: vi.fn(async (): Promise<never> => {
        throw new Error('The server refused to deregister this account');
      }),
    });

    const result: SignOutResult = await signOutSession(effects, TARGET, 'deregister', () => {});

    expect(result.status).toBe('failed');
    expect(effects.forgotten).toEqual([]);
  });

  it('does not reach the request at all without a CID', async () => {
    const effects: ReturnType<typeof io> = io();

    const result: SignOutResult = await signOutSession(
      effects,
      { ...TARGET, cid: undefined },
      'deregister',
      () => {},
    );

    expect(result.status).toBe('refused');
    expect(effects.deregister).not.toHaveBeenCalled();
    expect(effects.forgotten).toEqual([]);
  });
});

describe('the order of the removal and the reload', () => {
  it('forgets AFTER reloading, so the reload cannot put the row back', async () => {
    // It forgot first, and the reload undid it: `reload` asks the internal
    // service for the session list, and a list fetched a moment after a
    // deregistration can still contain the session just removed. CI showed
    // `Deregister success: true` followed by `still in navbar: true`.
    const effects: ReturnType<typeof io> = io();

    await signOutSession(effects, TARGET, 'deregister', () => {});

    expect(effects.order).toEqual(['reload', 'forget']);
  });
});
