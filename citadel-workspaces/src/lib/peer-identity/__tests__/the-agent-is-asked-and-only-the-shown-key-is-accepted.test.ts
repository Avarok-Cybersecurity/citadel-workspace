/**
 * The peer-identity requests through the real request path (requests.ts over requestResponse).
 * The socket is the one stand-in: a sender that records each request and answers as the agent
 * does, on the app's event emitter.
 *
 * Also the wire reads: a key change addressed by cid, the safety number both ends read the same,
 * and the mark a view earns.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { registerConversationSender } from '@/lib/agent-conversations/sender';
import { eventEmitter } from '@/lib/event-emitter';
import { acceptPeerIdentityKey, getPeerIdentity } from '../requests';
import { peerKeyChangeOf, safetyNumberOf, type PeerIdentityView } from '../wire';
import { identityMarkOf } from '../identity-copy';

const ME: bigint = 11n;
const BOB: bigint = 22n;
const MINE: string = 'aaaa-bbbb-cccc-dddd';
const THEIRS: string = 'mmmm-nnnn-pppp-qqqq';
const NEW_KEY: string = 'wwww-xxxx-yyyy-zzzz';

const asked: Array<Record<string, unknown>> = [];
let answer: (variant: string, body: Record<string, unknown>) => void = () => {};
const respond = (variant: string, body: Record<string, unknown>): void => { eventEmitter.emit('websocket-message', { [variant]: body }); };

beforeEach(() => {
  asked.length = 0;
  registerConversationSender(async (request: Record<string, unknown>): Promise<void> => {
    asked.push(request);
    const [variant, body] = Object.entries(request)[0] as [string, Record<string, unknown>];
    queueMicrotask(() => answer(variant, body));
  });
});

describe('asking the agent about a peer', () => {
  it('sends the pair and reads both fingerprints, an absent one as absent', async () => {
    answer = (_v: string, body: Record<string, unknown>): void => respond('PeerIdentity', {
      cid: ME, peer_cid: BOB, own_fingerprint: MINE, peer_fingerprint: THEIRS, pending_fingerprint: undefined, request_id: body.request_id,
    });
    const view: PeerIdentityView = await getPeerIdentity(ME, BOB);
    expect(asked).toEqual([{ GetPeerIdentity: { request_id: expect.any(String), cid: ME, peer_cid: BOB } }]);
    expect(view).toEqual({ own: MINE, pinned: THEIRS, pending: null });
  });

  it('accepts exactly the fingerprint it is given, and reports the agent\'s refusal', async () => {
    answer = (_v: string, body: Record<string, unknown>): void => respond('PeerIdentityFailure', {
      cid: ME, peer_cid: BOB, message: 'the waiting key is wwww-xxxx-yyyy-zzzz, not the one accepted', request_id: body.request_id,
    });
    await expect(acceptPeerIdentityKey(ME, BOB, THEIRS)).rejects.toThrow('not the one accepted');
    expect(asked).toEqual([{ AcceptPeerIdentityKey: { request_id: expect.any(String), cid: ME, peer_cid: BOB, fingerprint: THEIRS } }]);

    answer = (_v: string, body: Record<string, unknown>): void => respond('PeerIdentityKeyAccepted', {
      cid: ME, peer_cid: BOB, fingerprint: body.fingerprint, request_id: body.request_id,
    });
    expect(await acceptPeerIdentityKey(ME, BOB, NEW_KEY)).toBe(NEW_KEY);
  });

  it('does not take another request\'s answer', async () => {
    answer = (_v: string, body: Record<string, unknown>): void => {
      respond('PeerIdentity', { cid: ME, peer_cid: BOB, own_fingerprint: 'x', peer_fingerprint: 'y', pending_fingerprint: null, request_id: 'someone-else' });
      respond('PeerIdentity', { cid: ME, peer_cid: BOB, own_fingerprint: MINE, peer_fingerprint: null, pending_fingerprint: null, request_id: body.request_id });
    };
    expect(await getPeerIdentity(ME, BOB)).toEqual({ own: MINE, pinned: null, pending: null });
  });
});

describe('the wire reads', () => {
  it('reads a key change only when it names both keys and the pair', () => {
    const change: Record<string, unknown> = { cid: ME, peer_cid: BOB, pinned_fingerprint: THEIRS, presented_fingerprint: NEW_KEY, request_id: null };
    expect(peerKeyChangeOf({ PeerIdentityKeyChangedNotification: change })).toEqual({ cid: ME, peerCid: BOB, pinned: THEIRS, presented: NEW_KEY });
    expect(peerKeyChangeOf({ PeerIdentityKeyChangedNotification: { ...change, presented_fingerprint: '' } })).toBeNull();
    expect(peerKeyChangeOf({ PeerIdentityKeyChangedNotification: { ...change, cid: '11' } })).toBeNull();
    expect(peerKeyChangeOf({ PeerConnectFailure: change })).toBeNull();
  });

  it('gives both ends the same safety number, and none without both keys', () => {
    const mine: PeerIdentityView = { own: MINE, pinned: THEIRS, pending: null };
    const theirs: PeerIdentityView = { own: THEIRS, pinned: MINE, pending: null };
    expect(safetyNumberOf(mine)).toEqual(safetyNumberOf(theirs));
    expect(safetyNumberOf({ own: null, pinned: THEIRS, pending: null })).toBeNull();
    expect(safetyNumberOf({ own: MINE, pinned: null, pending: null })).toBeNull();
  });

  it('marks a waiting key over a pinned one, and a peer with no key unverified', () => {
    expect(identityMarkOf({ own: MINE, pinned: THEIRS, pending: NEW_KEY })).toBe('changed');
    expect(identityMarkOf({ own: MINE, pinned: THEIRS, pending: null })).toBe('verified');
    expect(identityMarkOf({ own: null, pinned: null, pending: null })).toBe('unverified');
  });
});
