import { describe, it, expect } from 'vitest';
import { openAccountLink, type AccountLinkIO, type LinkableSession } from '../open-account-link';
import type { AccountLink } from '../account-link';

/**
 * The flow behind an account link, with the agent's session list and the two
 * outcomes recorded rather than mocked: `io` is the page's I/O boundary, and
 * the decision between switching and signing in is the production code under
 * test.
 */
interface Session extends LinkableSession { cid: bigint }

interface Recorder {
  io: AccountLinkIO<Session>;
  switched: Session[];
  loginFor: string[];
  scopes: (string | null)[];
}

function record(ok: boolean, sessions: Session[]): Recorder {
  const switched: Session[] = [];
  const loginFor: string[] = [];
  const scopes: (string | null)[] = [];
  return {
    switched,
    loginFor,
    scopes,
    io: {
      listSessions: async () => ({ ok, sessions }),
      // These cases are about the answer, which is immediate; the deadline never passes.
      signInDeadline: (): Promise<void> => new Promise<void>(() => undefined),
      switchTo: async (session: Session): Promise<void> => { switched.push(session); },
      login: (username: string, server: string | null): void => { loginFor.push(username); scopes.push(server); },
    },
  };
}

const alice: Session = { cid: 11n, username: 'alice', server_address: 'citadel.example.com:12400' };
const aliceTenant: Session = { cid: 12n, username: 'alice', server_address: 'acme.work.avarok.net' };
const bob: Session = { cid: 21n, username: 'bob', server_address: 'citadel.example.com:12400' };

async function open(link: AccountLink, rec: Recorder): Promise<void> {
  await openAccountLink(link, rec.io);
}

describe('opening an account link', () => {
  it("scopes its sign-in to the link's server, and to none when the link names none", async () => {
    const named: Recorder = record(true, [bob]);
    await open({ username: 'alice', server: 'acme.work.avarok.net' }, named);
    expect(named.scopes).toEqual(['acme.work.avarok.net']);
    const bare: Recorder = record(true, [bob]);
    await open({ username: 'alice' }, bare);
    expect(bare.scopes).toEqual([null]);
  });

  it('switches to the live session the link names', async () => {
    const rec: Recorder = record(true, [bob, alice]);
    await open({ username: 'alice' }, rec);
    expect(rec.switched).toEqual([alice]);
    expect(rec.loginFor).toEqual([]);
  });

  it('matches the server when given, with the assumed port', async () => {
    const rec: Recorder = record(true, [alice, aliceTenant]);
    await open({ username: 'alice', server: 'CITADEL.example.com' }, rec);
    expect(rec.switched).toEqual([alice]);
  });

  it('opens sign-in pre-filled when no session matches', async () => {
    const rec: Recorder = record(true, [bob]);
    await open({ username: 'alice' }, rec);
    expect(rec.switched).toEqual([]);
    expect(rec.loginFor).toEqual(['alice']);
  });

  it('does not switch across servers', async () => {
    const rec: Recorder = record(true, [alice]);
    await open({ username: 'alice', server: 'other.example.com' }, rec);
    expect(rec.switched).toEqual([]);
    expect(rec.loginFor).toEqual(['alice']);
  });

  it('does not guess between two sessions with the same username', async () => {
    const rec: Recorder = record(true, [alice, aliceTenant]);
    await open({ username: 'alice' }, rec);
    expect(rec.switched).toEqual([]);
    expect(rec.loginFor).toEqual(['alice']);
  });

  it('never switches on an unanswered session query', async () => {
    const rec: Recorder = record(false, [alice]);
    await open({ username: 'alice' }, rec);
    expect(rec.switched).toEqual([]);
    expect(rec.loginFor).toEqual(['alice']);
  });

  // As the agent actually reports a hosted session: the RESOLVED edge address, which every
  // hosted workspace shares, plus the host as typed. Seen live: the link to carol's workspace
  // opened sign-in although her session was up, because only server_address was compared.
  it('matches a hosted workspace by the host the agent recorded, not the edge it resolved to', async () => {
    const carolHosted: Session = { cid: 31n, username: 'carol', server_address: '104.21.48.73:443', server_host: 'bench.work.avarok.net' };
    const carolElsewhere: Session = { cid: 32n, username: 'carol', server_address: '104.21.48.73:443', server_host: 'acme.work.avarok.net' };
    const rec: Recorder = record(true, [carolElsewhere, carolHosted]);
    await open({ username: 'carol', server: 'bench.work.avarok.net' }, rec);
    expect(rec.switched).toEqual([carolHosted]);
    expect(rec.loginFor).toEqual([]);
  });
});
