/**
 * Which workspace a sign-in's human check is bound to, in order: the host the
 * agent recorded for the account, else this device's one hint for that name,
 * else the workspace the page is served from. Pure; no doubles.
 */
import { describe, expect, it } from 'vitest';
import { accountWorkspace } from '../useAccountServer';
import type { SignInHint } from '@/lib/sign-in';

const hint = (tenant: string): SignInHint => ({ tenant, cid: 7n, username: 'alice', keyFirst: true });
const agent: ReadonlyMap<string, string> = new Map([['alice', 'acme.work.avarok.net']]);
const none: ReadonlyMap<string, string> = new Map<string, string>();
const PAGE: 'page.work.avarok.net' = 'page.work.avarok.net';

describe('the workspace a check is bound to', () => {
  it('is the agent\'s record first', () => {
    expect(accountWorkspace('alice', agent, [hint('other.work.avarok.net')], PAGE)).toBe('acme.work.avarok.net');
  });
  it('then this device\'s hint', () => {
    expect(accountWorkspace('alice', none, [hint('bench.work.avarok.net')], PAGE)).toBe('bench.work.avarok.net');
  });
  it('then the page\'s own workspace', () => {
    expect(accountWorkspace('alice', none, [], PAGE)).toBe(PAGE);
  });
  it('is not guessed between two hints for one name; the page decides, or nobody does', () => {
    const two: SignInHint[] = [hint('a.work.avarok.net'), hint('b.work.avarok.net')];
    expect(accountWorkspace('alice', none, two, PAGE)).toBe(PAGE);
    expect(accountWorkspace('alice', none, two, undefined)).toBeUndefined();
  });
  it('is nothing before an account is named', () => {
    expect(accountWorkspace('  ', none, [], PAGE)).toBeUndefined();
  });
});
