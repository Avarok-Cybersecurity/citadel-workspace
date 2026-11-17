/**
 * The landing page says which accounts the server signed out while no page was open.
 *
 * The agent keeps a give-up in GetSessions' `signed_out` until the account signs
 * in again. Before, such an account just vanished and nothing said why.
 *
 * MOCKS, and why: `@/lib/connection` is the agent's WebSocket, which a unit test
 * does not have; its GetSessions answer is the input under test. The hook, the
 * copy and the notice are the real code.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ActiveSessionsResult } from '@/lib/connection/queries';
import type { SignedOutAccount } from '@/types/session-types';

const agent: { answer: ActiveSessionsResult; answered: number } = vi.hoisted(() => ({
  answer: { ok: true, sessions: [], signedOut: [] } as ActiveSessionsResult,
  answered: 0,
}));
vi.mock('@/lib/connection', () => ({
  connectionManager: {
    waitForReady: async (): Promise<void> => {},
    getActiveSessionsResult: async (): Promise<ActiveSessionsResult> => { agent.answered++; return agent.answer; },
  },
}));

import { SignedOutNotice } from '../SignedOutNotice';
import { signedOutNotice } from '../signed-out-copy';

const alice: SignedOutAccount = { cid: 7n, username: 'alice', reason: 'CID not registered to this node' };
const bob: SignedOutAccount = { cid: 9n, username: 'bob', reason: 'no answer from the server in 600s' };

afterEach(cleanup);

describe('the landing page’s signed-out notice', () => {
  it('names the one account the server signed out', async (): Promise<void> => {
    agent.answer = { ok: true, sessions: [], signedOut: [alice] };
    render(<SignedOutNotice />);
    const notice: HTMLElement = await screen.findByTestId('signed-out-notice');
    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.textContent).toBe(signedOutNotice(['alice']));
    expect(notice.textContent).toContain('alice was signed out by the server');
  });

  it('names several', async (): Promise<void> => {
    agent.answer = { ok: true, sessions: [], signedOut: [alice, bob] };
    render(<SignedOutNotice />);
    expect((await screen.findByTestId('signed-out-notice')).textContent).toContain('2 accounts (alice, bob) were signed out');
  });

  it.each<[string, ActiveSessionsResult]>([
    ['nobody was signed out', { ok: true, sessions: [], signedOut: [] }],
    // The failed answer carries a name so that reading it anyway would show.
    ['the agent could not be asked', { ok: false, sessions: [], signedOut: [alice] }],
  ])('says nothing when %s', async (_why: string, answer: ActiveSessionsResult): Promise<void> => {
    agent.answer = answer;
    agent.answered = 0;
    render(<SignedOutNotice />);
    // Absence proves nothing until the agent has answered and React has rendered it.
    await vi.waitFor((): void => { expect(agent.answered).toBe(1); });
    await act(async (): Promise<void> => {});
    expect(screen.queryByTestId('signed-out-notice')).toBeNull();
  });
});
