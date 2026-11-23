/**
 * `citadel.session`'s host rules (citadel-session-abi §1 "Rules"), as a table: each row one call
 * against a fresh table holding one open session to `a.example`, beside its control.
 */
import { describe, expect, it } from 'vitest';
import { LIMIT_SESSION_BYTES, LIMIT_SESSION_RATE } from '../../sdk/generated/AbiConstants';
import type { SessionState } from '../../sdk/generated/SessionState';
import type { Refused } from '../ports';
import { SESSION_INVALID, SessionRules, type OpenDecision, type SessionGrant } from '../session-rules';

// The manifest's values, chosen small so the limits are reached in a few calls.
const GRANT: SessionGrant = { servers: ['a.example', 'b.example:8443'], limits: { max_msg_bytes: 4, max_msgs_per_s: 2 } };
const OPEN: SessionState = { session: 7, cid: 99n, state: 'connected' };

function held(): SessionRules {
  const rules: SessionRules = new SessionRules(GRANT);
  rules.opened('a.example', OPEN, 0);
  return rules;
}

const body = (n: number): Uint8Array => new Uint8Array(n);

describe('opening', () => {
  it.each<[string, string, OpenDecision['kind']]>([
    ['a server the manifest does not name', 'c.example', 'refused'],
    ['a server named with a scheme', 'https://a.example', 'refused'],
    ['the server already open', 'a.example', 'existing'],
    ['control: a named server not open yet', 'b.example:8443', 'dial'],
  ])('%s', (_name: string, server: string, kind: OpenDecision['kind']) => {
    expect(held().open(server).kind).toBe(kind);
  });

  it('an unnamed server is ungranted; the open one comes back as it is', () => {
    expect(held().open('c.example')).toEqual({ kind: 'refused', refused: 'ungranted' });
    expect(held().open('a.example')).toEqual({ kind: 'existing', state: OPEN });
  });

  it('a closed session is opened again (control: while open it is returned)', () => {
    const rules: SessionRules = held();
    expect(rules.changed(7, { closed: { reason: 'server_gone' } })).toBe(true);
    expect(rules.open('a.example').kind).toBe('dial');
  });
});

describe('sending and closing', () => {
  it.each<[string, (r: SessionRules) => Refused | null, Refused | null]>([
    ['control: a body within max_msg_bytes', (r: SessionRules): Refused | null => r.send(7, body(4), 0), null],
    ['a body over max_msg_bytes', (r: SessionRules): Refused | null => r.send(7, body(5), 0), { limit: LIMIT_SESSION_BYTES }],
    ['a session never opened', (r: SessionRules): Refused | null => r.send(8, body(1), 0), SESSION_INVALID],
    ['a close of a session never opened', (r: SessionRules): Refused | null => r.close(8), SESSION_INVALID],
    ['control: a close of the open session', (r: SessionRules): Refused | null => r.close(7), null],
  ])('%s', (_name: string, call: (r: SessionRules) => Refused | null, expected: Refused | null) => {
    expect(call(held())).toEqual(expected);
  });

  it('a closed session takes no send and no second close', () => {
    const rules: SessionRules = held();
    expect(rules.close(7)).toBeNull();
    expect(rules.send(7, body(1), 0)).toEqual(SESSION_INVALID);
    expect(rules.close(7)).toEqual(SESSION_INVALID);
    expect(rules.openSessions()).toEqual([]);
  });

  it('the rate is a bucket with a burst of the limit, refilled over a second; a refused body takes no token', () => {
    const rules: SessionRules = held();
    expect(rules.send(7, body(5), 0)).toEqual({ limit: LIMIT_SESSION_BYTES });
    expect(rules.send(7, body(1), 0)).toBeNull();
    expect(rules.send(7, body(1), 0)).toBeNull();
    expect(rules.send(7, body(1), 0)).toEqual({ limit: LIMIT_SESSION_RATE });
    expect(rules.send(7, body(1), 499)).toEqual({ limit: LIMIT_SESSION_RATE });
    expect(rules.send(7, body(1), 500)).toBeNull();
  });

  it('a message is heard only on a session this table holds open', () => {
    const rules: SessionRules = held();
    expect(rules.hears(7)).toBe(true);
    expect(rules.hears(8)).toBe(false);
    expect(rules.changed(8, 'connected')).toBe(false);
    rules.close(7);
    expect(rules.hears(7)).toBe(false);
  });
});
