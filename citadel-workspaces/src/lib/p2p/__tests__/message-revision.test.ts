/**
 * P2P edit/delete. Before this, the adapter threw "P2P messaging does not
 * support message editing/deletion" — the ... menu had nothing to call.
 *
 * These cover the authorization rule, which is the part worth getting right: a
 * peer may revise their own message and not yours.
 */
import { describe, it, expect } from 'vitest';
import { applyEdit, applyDelete } from '../message-revision';
import type { P2PConversation, P2PMessage } from '../p2p-types';
import type { RevisionOutcome } from '@/lib/p2p/message-revision';

const ALICE: bigint = 1n;
const BOB: bigint = 2n;

function msg(id: string, senderCid: bigint, content: string): P2PMessage {
  return {
    id, content, senderCid, recipientCid: senderCid === ALICE ? BOB : ALICE,
    timestamp: 100, index: 0, status: 'delivered', message_type: 'text',
  } as P2PMessage;
}

function conversation(): P2PConversation {
  return {
    peerCid: BOB,
    messages: [msg('m1', ALICE, 'hello'), msg('m2', BOB, 'hi back')],
    unreadCount: 0,
    lastMessageIndex: 1,
  } as unknown as P2PConversation;
}

describe('applyEdit', () => {
  it('replaces the contents and stamps edited_at', () => {
    const c: P2PConversation = conversation();

    const outcome: RevisionOutcome = applyEdit(c, 'm1', 'hello there', 555, ALICE);

    expect(outcome.applied).toBe(true);
    expect(c.messages[0].content).toBe('hello there');
    expect(c.messages[0].edited_at).toBe(555);
  });

  it('refuses to edit a message the editor did not send', () => {
    const c: P2PConversation = conversation();

    const outcome: RevisionOutcome = applyEdit(c, 'm2', 'tampered', 555, ALICE);

    expect(outcome).toEqual({ applied: false, reason: 'not-sender' });
    expect(c.messages[1].content).toBe('hi back');
  });

  it('reports an unknown message rather than silently doing nothing', () => {
    const outcome: RevisionOutcome = applyEdit(conversation(), 'nope', 'x', 1, ALICE);

    expect(outcome).toEqual({ applied: false, reason: 'unknown-message' });
  });

  it('leaves other messages untouched', () => {
    const c: P2PConversation = conversation();

    applyEdit(c, 'm1', 'changed', 1, ALICE);

    expect(c.messages[1].content).toBe('hi back');
    expect(c.messages[1].edited_at).toBeUndefined();
  });
});

describe('applyDelete', () => {
  it('removes the message from the conversation', () => {
    const c: P2PConversation = conversation();

    const outcome: RevisionOutcome = applyDelete(c, 'm1', ALICE);

    expect(outcome.applied).toBe(true);
    expect(c.messages.map((m) => m.id)).toEqual(['m2']);
  });

  it('refuses to delete a message the deleter did not send', () => {
    const c: P2PConversation = conversation();

    const outcome: RevisionOutcome = applyDelete(c, 'm2', ALICE);

    expect(outcome).toEqual({ applied: false, reason: 'not-sender' });
    expect(c.messages).toHaveLength(2);
  });

  it('reports an unknown message', () => {
    const outcome: RevisionOutcome = applyDelete(conversation(), 'nope', ALICE);

    expect(outcome).toEqual({ applied: false, reason: 'unknown-message' });
  });

  it('returns the removed message so callers can report what went', () => {
    const outcome: RevisionOutcome = applyDelete(conversation(), 'm1', ALICE);

    expect(outcome.applied && outcome.message.content).toBe('hello');
  });
});
