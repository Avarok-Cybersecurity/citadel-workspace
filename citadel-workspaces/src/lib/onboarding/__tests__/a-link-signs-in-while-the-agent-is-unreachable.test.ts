/**
 * An account link opens sign-in with its username even while the agent cannot be reached.
 *
 * Found live (2026-09-29): the menu bar's "Log in" opens the installed web app with
 * `web+citadel://open?account=<name>`. On a fresh window Brave first asks "Access other apps
 * and services on this device" -- the permission the page needs to reach the agent -- and
 * until it is answered the session query never returns. The link waited on it with no
 * deadline, so the sign-in form never opened with the name; the user pressed Sign In
 * themselves and got an empty form.
 *
 * Real: the decision. The agent's answer and the deadline are the page's I/O boundary,
 * resolved by hand here, so the order of events is exact.
 */
import { describe, it, expect } from 'vitest';
import { openAccountLink, type AccountLinkIO, type LinkableSession } from '../open-account-link';
import type { AccountLink } from '../account-link';

interface Session extends LinkableSession { cid: bigint }

interface Controlled {
  io: AccountLinkIO<Session>;
  answer: (sessions: Session[]) => void;
  passDeadline: () => void;
  switched: Session[];
  loginFor: string[];
}

function controlled(): Controlled {
  let answer: (sessions: Session[]) => void = () => undefined;
  let passDeadline: () => void = () => undefined;
  const switched: Session[] = [];
  const loginFor: string[] = [];
  const answered: Promise<{ ok: boolean; sessions: readonly Session[] }> = new Promise((resolve) => {
    answer = (sessions: Session[]): void => resolve({ ok: true, sessions });
  });
  const deadline: Promise<void> = new Promise((resolve) => { passDeadline = (): void => resolve(); });
  return {
    answer: (s: Session[]): void => answer(s),
    passDeadline: (): void => passDeadline(),
    switched,
    loginFor,
    io: {
      listSessions: () => answered,
      signInDeadline: () => deadline,
      switchTo: async (session: Session): Promise<void> => { switched.push(session); },
      login: (username: string): void => { loginFor.push(username); },
    },
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const bench: AccountLink = { username: 'bench' };
const live: Session = { cid: 7n, username: 'bench', server_address: 'mac2.work.avarok.net' };

describe('an account link while the agent is unreachable', () => {
  it('opens sign-in with the username once the deadline passes, without an answer', async () => {
    const c: Controlled = controlled();
    void openAccountLink(bench, c.io);
    await flush();
    expect(c.loginFor, 'nothing yet: the agent may still answer in time').toEqual([]);

    c.passDeadline();
    await flush();
    expect(c.loginFor).toEqual(['bench']);
  });

  it('switches when a late answer shows the session live, and signs in only once', async () => {
    const c: Controlled = controlled();
    const done: Promise<unknown> = openAccountLink(bench, c.io);
    c.passDeadline();
    await flush();
    c.answer([live]);
    await done;
    expect(c.loginFor).toEqual(['bench']);
    expect(c.switched).toEqual([live]);
  });

  it('does not sign in twice when a late answer has no live session', async () => {
    const c: Controlled = controlled();
    const done: Promise<unknown> = openAccountLink(bench, c.io);
    c.passDeadline();
    await flush();
    c.answer([]);
    await done;
    expect(c.loginFor).toEqual(['bench']);
    expect(c.switched).toEqual([]);
  });

  it('an answer inside the deadline behaves as before: switch, no sign-in', async () => {
    const c: Controlled = controlled();
    const done: Promise<unknown> = openAccountLink(bench, c.io);
    c.answer([live]);
    await done;
    c.passDeadline();
    await flush();
    expect(c.switched).toEqual([live]);
    expect(c.loginFor).toEqual([]);
  });
});
