/**
 * Which accounts this device knows, keyed by (username, server), and which of them
 * belong to a given server. The sign-in form scopes its rows by this, and refuses
 * a typed username that is known only on another server.
 *
 * An account was identified by its username alone: the agent's account list was a
 * username -> host map, and the form's rows were bare names, so `alice` on two
 * workspaces was one row and one map entry, with the second server lost.
 */
import { describe, it, expect } from 'vitest';
import { accountsOnServer, checkTypedAccount, knownAccounts, offeredRows, type KnownAccount } from '../known-accounts';

const A: string = 'bench.work.avarok.net';
const B: string = 'acme.work.avarok.net';

const known: KnownAccount[] = knownAccounts({
  agent: [{ username: 'alice', server: A }, { username: 'alice', server: B }],
  stored: [{ username: 'bob', serverAddress: `wss://${B}/` }, { username: 'carol', serverAddress: '' }],
  hints: [{ username: 'dave', tenant: A }],
  device: ['erin'],
});

describe('the accounts this device knows', () => {
  it('keeps one entry per (username, server), however the server was written', () => {
    expect(known).toEqual([
      { username: 'alice', server: B }, { username: 'alice', server: A },
      { username: 'bob', server: B }, { username: 'carol', server: null },
      { username: 'dave', server: A }, { username: 'erin', server: null },
    ]);
  });

  it('drops an unplaced copy of a name another source places', () => {
    const merged: KnownAccount[] = knownAccounts({ agent: [{ username: 'bob', server: B }], stored: [], hints: [], device: ['bob'] });
    expect(merged).toEqual([{ username: 'bob', server: B }]);
  });

  it('answers which belong to a server, never an unplaced one', () => {
    expect(accountsOnServer(known, `wss://${A}/`).map((a: KnownAccount) => a.username)).toEqual(['alice', 'dave']);
    expect(accountsOnServer(known, 'nowhere.example')).toEqual([]);
  });
});

describe('a typed username against the server being signed in to', () => {
  it('is fine on its own server, unknown, or with no server chosen', () => {
    expect(checkTypedAccount(known, 'dave', A)).toEqual({ kind: 'fine' });
    expect(checkTypedAccount(known, 'zed', A)).toEqual({ kind: 'fine' });
    expect(checkTypedAccount(known, 'bob', null)).toEqual({ kind: 'fine' });
    expect(checkTypedAccount(known, 'alice', B)).toEqual({ kind: 'fine' });
  });

  it('is another server\'s account when it is known only there', () => {
    expect(checkTypedAccount(known, ' bob ', A)).toEqual({ kind: 'elsewhere', username: 'bob', servers: [B] });
    expect(checkTypedAccount(known, 'dave', B)).toEqual({ kind: 'elsewhere', username: 'dave', servers: [A] });
  });

  it('is not judged when this device does not know where it is', () => {
    expect(checkTypedAccount(known, 'carol', A)).toEqual({ kind: 'fine' });
  });
});

describe('the passkey rows under the username', () => {
  const hints: { username: string; tenant: string }[] = [{ username: 'alice', tenant: A }, { username: 'dave', tenant: A }];
  it('name each account by its server', () => {
    expect(offeredRows(['alice', 'dave', 'erin'], hints, ['erin'], known, null)).toEqual([
      { username: 'alice', server: A }, { username: 'dave', server: A }, { username: 'erin', server: null },
    ]);
  });

  it('show only the server being signed in to', () => {
    expect(offeredRows(['alice', 'dave', 'erin'], hints, ['erin'], known, B)).toEqual([]);
    expect(offeredRows(['alice', 'dave'], hints, [], known, A).map((r: KnownAccount) => r.username)).toEqual(['alice', 'dave']);
  });

  it('place an old passkey by where the account is known to be', () => {
    expect(offeredRows(['alice'], [], ['alice'], known, null)).toEqual([{ username: 'alice', server: B }, { username: 'alice', server: A }]);
  });
});
