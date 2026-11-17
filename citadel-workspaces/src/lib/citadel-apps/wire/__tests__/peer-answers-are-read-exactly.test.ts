/**
 * The per-member P2P and topic answers are read exactly: each of the four as the kernel sends it,
 * a `None` group key as the wasm client hands it over (undefined), and anything with a field too
 * many, too few or of the wrong type as not an answer at all.
 */
import { describe, expect, it } from 'vitest';
import type { IhttpFrom, PeerConsent } from 'citadel-workspace-client-ts';
import { readPeerAnswer } from '../apps-peer-answer';

const CONSENT: PeerConsent = { serve: true, call: false, topics: true, at_ms: 5n };
const FROM: IhttpFrom = { username: 'alice', cid: 9n, app_id: 'net.avarok.compute-pool', install_id: 'i' };

describe('peer answers are read exactly', () => {
  it('reads each of the four', () => {
    expect(readPeerAnswer({ PeerConsentForMe: { install_id: 'i', consent: CONSENT } })).toEqual({ kind: 'peer-consent', installId: 'i', consent: CONSENT });
    expect(readPeerAnswer({ PeerBlockedForMe: { install_id: 'i', username: 'mallory', blocked: true } })).toEqual({ kind: 'peer-blocked', installId: 'i', username: 'mallory', blocked: true });
    expect(readPeerAnswer({ PeerAuthorized: { install_id: 'i', peer: FROM, direction: { Serve: { routes_digest: 'd' } }, until_ms: 60_000n } })).toEqual({ kind: 'peer-authorized', installId: 'i', peer: FROM, direction: { Serve: { routes_digest: 'd' } }, untilMs: 60_000n });
    expect(readPeerAnswer({ TopicGroup: { install_id: 'i', topic: 'pool', group_key: '5:9' } })).toEqual({ kind: 'topic-group', installId: 'i', topic: 'pool', groupKey: '5:9' });
    expect(readPeerAnswer({ TopicGroup: { install_id: 'i', topic: 'pool', group_key: undefined } })).toEqual({ kind: 'topic-group', installId: 'i', topic: 'pool', groupKey: null });
  });

  it('refuses a near miss', () => {
    expect(readPeerAnswer({ PeerConsentForMe: { install_id: 'i', consent: { ...CONSENT, at_ms: 5 } } })).toBeNull();
    expect(readPeerAnswer({ PeerAuthorized: { install_id: 'i', peer: { ...FROM, extra: 1 }, direction: 'Call', until_ms: 1n } })).toBeNull();
    expect(readPeerAnswer({ PeerAuthorized: { install_id: 'i', peer: FROM, direction: 'Sideways', until_ms: 1n } })).toBeNull();
    expect(readPeerAnswer({ PeerBlockedForMe: { install_id: 'i', username: 'm' } })).toBeNull();
  });
});
