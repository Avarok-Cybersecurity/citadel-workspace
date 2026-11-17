/**
 * The per-member P2P requests (apps-peer-operations.ts): each takes only an answer naming what it
 * asked about, peer and direction alike (the fake refuses to hand over any other, which reads as no answer); AuthorizePeer's refusal is a no that keeps its reason for the page's log; a TopicGroup the kernel would not answer is
 * told apart from one no member has claimed. Answers are scripted into the fake kernel, read by
 * the production reader.
 */
import { describe, expect, it } from 'vitest';
import type { IhttpFrom } from 'citadel-workspace-client-ts';
import { FakeAppsKernel } from '@/test/apps-kernel-fake';
import { authorizePeer, setPeerConsentForMe, topicGroup } from '../apps-peer-operations';

const kernel = (...answers: unknown[]): FakeAppsKernel => {
  const k: FakeAppsKernel = new FakeAppsKernel({ me: 'alice', visible: [], hidden: [], installs: [], permissions: new Set(), disabled: new Set() });
  k.scripted.push(...answers);
  return k;
};
const BOB: IhttpFrom = { username: 'bob', cid: 7n, app_id: 'a', install_id: 'i-2' };

describe('the per-member P2P requests', () => {
  it('AuthorizePeer: the kernel’s stamp, or a plain no on its refusal', async () => {
    expect(await authorizePeer(kernel({ PeerAuthorized: { install_id: 'i-1', peer: BOB, direction: 'Call', until_ms: 5n } }), 'i-1', 7n, 'Call'))
      .toEqual({ ok: true, peer: BOB, untilMs: 5n });
    expect(await authorizePeer(kernel({ Refused: 'NoHost' }), 'i-1', 7n, 'Call')).toEqual({ ok: false, why: 'NoHost' });
    expect(await authorizePeer(kernel({ Refused: { Limit: 'peer_checks' } }), 'i-1', 7n, 'Call')).toEqual({ ok: false, why: '{"Limit":"peer_checks"}' });
  });

  it('an answer about another peer, install or direction is not ours', async () => {
    expect(await authorizePeer(kernel({ PeerAuthorized: { install_id: 'i-1', peer: { ...BOB, cid: 8n }, direction: 'Call', until_ms: 5n } }), 'i-1', 7n, 'Call')).toEqual({ ok: false, why: 'NoAnswer' });
    // The kernel's word on another direction is not this one's: a topic stamp must never pass as leave to serve.
    const topicStamp: unknown = { PeerAuthorized: { install_id: 'i-1', peer: BOB, direction: { Topic: { topic: 'pool' } }, until_ms: 5n } };
    expect(await authorizePeer(kernel(topicStamp), 'i-1', 7n, { Serve: { routes_digest: 'd' } })).toEqual({ ok: false, why: 'NoAnswer' });
    expect(await authorizePeer(kernel(topicStamp), 'i-1', 7n, { Topic: { topic: 'pool' } })).toEqual({ ok: true, peer: BOB, untilMs: 5n });
    expect(await setPeerConsentForMe(kernel({ PeerConsentForMe: { install_id: 'i-9', consent: { serve: true, call: false, topics: false, at_ms: 1n } } }), 'i-1', { serve: true, call: false, topics: false }))
      .toEqual({ ok: false, refusal: 'NoAnswer' });
  });

  it('TopicGroup: a held group, none held, or refused', async () => {
    const t = (groupKey: string | null): { TopicGroup: Record<string, unknown> } => ({ TopicGroup: { install_id: 'i-1', topic: 'pool', group_key: groupKey } });
    expect(await topicGroup(kernel(t('5:9')), 'i-1', 'pool', null)).toBe('5:9');
    expect(await topicGroup(kernel(t(null)), 'i-1', 'pool', null)).toBeNull();
    expect(await topicGroup(kernel({ Refused: 'NoHost' }), 'i-1', 'pool', null)).toBe('refused');
  });
});
