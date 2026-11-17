/**
 * Switching to an account the agent no longer holds opens its sign-in, in words.
 *
 * Reported by the owner: clicking another account in the top bar said
 * "Session 14197768845630597388 not found" and nothing else. The agent answers
 * that (connection_management_claim.rs) for a CID it holds no session for --
 * signed out, deleted in another window, or ended by an agent restart -- and the
 * switch passed it through `describeFailure` into a "Connection Failed" toast.
 *
 * Mocked: the agent's ClaimSession answer (the I/O under test's boundary), and the
 * selection I/O a successful claim would go on to run.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h: { refusal: string } = vi.hoisted((): { refusal: string } => ({ refusal: '' }));

vi.mock('@/lib/websocket-service', () => ({
  websocketService: { claimSession: vi.fn(async (): Promise<void> => { throw new Error(h.refusal); }) },
}));
vi.mock('@/lib/tab-context', () => ({ setSelectedUser: vi.fn(async (): Promise<void> => {}) }));
vi.mock('@/lib/post-auth-setup', () => ({ postAuthSetup: vi.fn(async (): Promise<void> => {}) }));
vi.mock('@/lib/start-messaging', () => ({ startMessagingForSession: vi.fn(async (): Promise<void> => {}) }));

import { switchToSession, type SwitchCallbacks, type SwitchTarget } from '../switch-to-session';
import type { SignedOutSignIn } from '../sign-in-request';
import type { ToastOptions } from '@/hooks/use-toast';

const CID: bigint = 14197768845630597388n;
const target: SwitchTarget = {
  cid: CID, username: 'alice', server_address: 'wss://bench.work.avarok.net/', workspaceName: 'Bench', storedSessionIndex: -1,
};

interface Seen { toasts: ToastOptions[]; signIns: SignedOutSignIn[]; navigated: string[] }

async function switchWith(refusal: string): Promise<Seen> {
  h.refusal = refusal;
  const seen: Seen = { toasts: [], signIns: [], navigated: [] };
  const callbacks: SwitchCallbacks = {
    navigate: (path: string): void => { seen.navigated.push(path); },
    toast: (opts: ToastOptions): void => { seen.toasts.push(opts); },
    confirm: async (): Promise<boolean> => false,
    signInAs: (): void => {},
    signInAgain: (request: SignedOutSignIn): void => { seen.signIns.push(request); },
  };
  await switchToSession(target, callbacks);
  return seen;
}

const shown = (seen: Seen): string => seen.toasts.map((t: ToastOptions) => `${t.title} ${t.description ?? ''}`).join('\n');

beforeEach(() => { h.refusal = ''; });

describe('switching to an account the agent does not hold', () => {
  it('opens its sign-in with the username and server, and a reason in plain words', async () => {
    const seen: Seen = await switchWith(`Session ${CID} not found`);
    expect(seen.signIns).toEqual([{
      kind: 'signed-out', username: 'alice', server: 'bench.work.avarok.net',
      notice: 'alice on bench.work.avarok.net is signed out. Enter the password to sign in again.',
    }]);
    expect(seen.navigated).toEqual([]);
  });

  it('never shows the raw refusal or the CID', async () => {
    const seen: Seen = await switchWith(`Session ${CID} not found`);
    expect(shown(seen)).not.toMatch(/not found/);
    expect(shown(seen)).not.toContain(CID.toString());
    expect(seen.toasts.some((t: ToastOptions) => t.variant === 'destructive')).toBe(false);
  });

  it('treats a session the agent ended while answering the same way', async () => {
    const seen: Seen = await switchWith(`Session ${CID} is not claimable: no SDK session`);
    expect(seen.signIns.map((r: SignedOutSignIn) => r.username)).toEqual(['alice']);
  });

  it('still reports any other failure as a failure, with no sign-in', async () => {
    const seen: Seen = await switchWith('The agent did not answer in time');
    expect(seen.signIns).toEqual([]);
    expect(seen.toasts.at(-1)).toMatchObject({ variant: 'destructive', description: 'The agent did not answer in time' });
  });
});
