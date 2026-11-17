/** heldForAnotherServer: the account a registration of `typed` on `server` would overwrite. */
import { describe, expect, it } from 'vitest';
import { heldForAnotherServer, type KnownAccount } from '../known-accounts';

const ACCOUNTS: KnownAccount[] = [
  { username: 'alice', server: 'bench.work.avarok.net' },
  { username: 'bob', server: 'citadel.example.com:12349' },
  { username: 'carol', server: null },
];

describe('a username held for another server', () => {
  it('is the account on the other server', () => {
    expect(heldForAnotherServer(ACCOUNTS, ' alice ', 'acme.work.avarok.net')).toEqual(ACCOUNTS[0]);
  });
  it('is nothing on the same server, however it is written', () => {
    expect(heldForAnotherServer(ACCOUNTS, 'alice', 'wss://bench.work.avarok.net/')).toBeNull();
    expect(heldForAnotherServer(ACCOUNTS, 'bob', 'citadel.example.com:12349')).toBeNull();
  });
  it('is nothing for an unknown name, an unplaced account, or nothing typed', () => {
    expect(heldForAnotherServer(ACCOUNTS, 'dave', 'acme.work.avarok.net')).toBeNull();
    expect(heldForAnotherServer(ACCOUNTS, 'carol', 'acme.work.avarok.net')).toBeNull();
    expect(heldForAnotherServer(ACCOUNTS, ' ', 'acme.work.avarok.net')).toBeNull();
  });
});
