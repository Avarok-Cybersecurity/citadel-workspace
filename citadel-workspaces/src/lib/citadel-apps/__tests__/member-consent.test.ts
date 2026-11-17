/**
 * Each member allows P2P and topics for themselves, even when the installer granted them
 * (owner decision OD4). The pure core: which planes a member is asked about, what is in force
 * for them, the answer sent when one plane changes, and the per-install block list.
 */
import { describe, expect, it } from 'vitest';
import type { Capability, PeerConsent } from 'citadel-workspace-client-ts';
import { blockableUsername, blockedAfter, consentWith, effectiveForMember, memberAsks, memberNoteFor, needsMemberPrompt, type MemberAsk } from '../consent-model';
import { PEER_METADATA_DISCLOSURE } from '../capability-copy';

const GRANTED: Capability[] = ['storage.user', 'ihttp.serve', 'ihttp.call', 'ihttp.p2p.serve', 'ihttp.p2p.call', 'group.topic.subscribe', 'group.topic.publish'];
const consent = (serve: boolean, call: boolean, topics: boolean): PeerConsent => ({ serve, call, topics, at_ms: 1n });

describe('what a member is asked', () => {
  it('one question per granted plane, unanswered until they answer (control: a plane not granted is not asked)', () => {
    const asks: MemberAsk[] = memberAsks(GRANTED, null);
    expect(asks.map((a: MemberAsk) => [a.plane, a.allowed])).toEqual([['serve', null], ['call', null], ['topics', null]]);
    expect(needsMemberPrompt(asks)).toBe(true);
    expect(memberAsks(['storage.user', 'ihttp.p2p.call'], null).map((a: MemberAsk) => a.plane)).toEqual(['call']);
    expect(memberAsks(['storage.user', 'ihttp.serve'], null)).toEqual([]);
  });

  it('the P2P questions say what the server sees; the topic question does not need to', () => {
    const asks: MemberAsk[] = memberAsks(GRANTED, null);
    expect(asks.find((a: MemberAsk) => a.plane === 'serve')?.disclosure).toBe(PEER_METADATA_DISCLOSURE);
    expect(PEER_METADATA_DISCLOSURE).toMatch(/who connects to whom, when, and how much/);
    expect(asks.find((a: MemberAsk) => a.plane === 'topics')?.disclosure).toBeNull();
  });

  it('a member who answered is not asked again, whatever they said; one who only blocked someone still is', () => {
    expect(needsMemberPrompt(memberAsks(GRANTED, consent(false, false, false)))).toBe(false);
    expect(needsMemberPrompt(memberAsks(GRANTED, { serve: false, call: false, topics: false, at_ms: 0n }))).toBe(true);
  });

  it('the installer is told each member is asked too, with the metadata line under P2P only', () => {
    expect(memberNoteFor('ihttp.p2p.serve')).toContain(PEER_METADATA_DISCLOSURE);
    expect(memberNoteFor('group.topic.publish')).toBe('Each member is also asked, and can turn it off for themselves.');
    expect(memberNoteFor('ihttp.serve')).toBeNull();
  });
});

describe('what is in force for a member', () => {
  it('a plane they did not allow is withheld; relay and storage are untouched', () => {
    expect(effectiveForMember(GRANTED, consent(true, false, false), false)).toEqual(['storage.user', 'ihttp.serve', 'ihttp.call', 'ihttp.p2p.serve']);
    expect(effectiveForMember(GRANTED, null, false)).toEqual(['storage.user', 'ihttp.serve', 'ihttp.call']);
    expect(effectiveForMember(GRANTED, consent(true, true, true), false)).toEqual(GRANTED);
  });

  it('turned off for me holds nothing', () => {
    expect(effectiveForMember(GRANTED, consent(true, true, true), true)).toEqual([]);
  });
});

describe('changing one answer', () => {
  it('sends all three, the unanswered ones as not allowed', () => {
    expect(consentWith(null, 'call', true)).toEqual({ serve: false, call: true, topics: false });
    expect(consentWith(consent(true, true, true), 'serve', false)).toEqual({ serve: false, call: true, topics: true });
  });
});

describe('the block list', () => {
  it('holds each username once, sorted, and unblocking removes it', () => {
    expect(blockedAfter(['carol'], 'alice', true)).toEqual(['alice', 'carol']);
    expect(blockedAfter(['alice', 'carol'], 'alice', true)).toEqual(['alice', 'carol']);
    expect(blockedAfter(['alice', 'carol'], 'alice', false)).toEqual(['carol']);
  });

  it('takes a real username and nothing else', () => {
    expect(blockableUsername('  bob ')).toBe('bob');
    expect(blockableUsername('')).toBeNull();
    expect(blockableUsername('two words')).toBeNull();
    expect(blockableUsername('x'.repeat(65))).toBeNull();
  });
});
