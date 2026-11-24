/**
 * A link for the account's sign-in itself ("sign in again", once a session's resume
 * credential has run out) reaches the sign-in form even while that session is live: the
 * session is signed out first. Any other link to a live account switches to it, as before.
 *
 * Control: drop the `sign-in` branch from `openAccountLink`, and the link switches to the
 * live session and no form opens.
 */
import { describe, expect, it } from 'vitest';
import { openAccountLink, type AccountLinkIO, type LinkableSession } from '../open-account-link';
import { accountLinkPath, parseAccountLink, type AccountLink } from '../account-link';

interface Session extends LinkableSession { cid: bigint }
const live: Session = { cid: 11n, username: 'alice', server_address: 'acme.example', server_host: null };

async function open(link: AccountLink, sessions: Session[]): Promise<string[]> {
  const did: string[] = [];
  const io: AccountLinkIO<Session> = {
    listSessions: async () => ({ ok: true, sessions }),
    signInDeadline: (): Promise<void> => new Promise<void>(() => undefined),
    switchTo: async (session: Session): Promise<void> => { did.push(`switch ${session.cid}`); },
    endSession: async (session: Session): Promise<void> => { did.push(`end ${session.cid}`); },
    login: (username: string, server: string | null): void => { did.push(`login ${username} ${server}`); },
  };
  await openAccountLink(link, io);
  return did;
}

describe('a link that asks for the account’s sign-in', () => {
  const again: AccountLink = { username: 'alice', server: 'acme.example', open: { kind: 'sign-in' } };

  it('signs the live session out, then opens the form for that account', async () => {
    expect(await open(again, [live])).toEqual(['end 11', 'login alice acme.example']);
  });

  it('just opens the form when the account is not signed in', async () => {
    expect(await open(again, [])).toEqual(['login alice acme.example']);
  });

  it('is the only link that does: any other switches to the live session', async () => {
    expect(await open({ username: 'alice', server: 'acme.example' }, [live])).toEqual(['switch 11']);
    expect(await open({ username: 'alice', server: 'acme.example', open: { kind: 'requests' } }, [live])).toEqual(['switch 11']);
  });

  it('round-trips through the landing page’s own parser', () => {
    const path: string = accountLinkPath(again);
    expect(parseAccountLink(new URLSearchParams(path.slice(2)))).toEqual(again);
    expect(accountLinkPath({ username: 'alice', server: 'acme.example' })).not.toContain('open=');
  });
});
