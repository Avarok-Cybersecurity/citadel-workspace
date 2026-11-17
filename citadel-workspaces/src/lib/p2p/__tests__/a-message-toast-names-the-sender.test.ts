/**
 * A message from someone the roster knows is announced by their name.
 *
 * Live 10-02: "New message from Peer D7U2E0" beside a sidebar conversation
 * reading "Thomas Braun". A conversation opened by an inbound message carries
 * no username yet, and the toast read only the conversation. The roster -- the
 * same lookup calls and group messages use -- knew the name all along.
 */
import { describe, it, expect } from 'vitest';
import { notifyMessageArrived, type ArrivalNotice } from '../message-arrival-notification';
import { recordMemberNames, recordPeerUsernames } from '@/lib/member-names';
import type { P2PMessage } from '../p2p-types';

const CID: bigint = 9101112131415n;

function titleFor(conversationUsername: string | undefined): string {
  let title: string = '';
  const config: ArrivalNotice = {
    shouldShowNotification: (): boolean => true,
    getConversations: () => new Map([[CID, { peerUsername: conversationUsername }]]) as unknown as ReturnType<ArrivalNotice['getConversations']>,
    addNotification: ((t: string): void => { title = t; }) as unknown as ArrivalNotice['addNotification'],
  };
  notifyMessageArrived(config, CID, { id: 'm1', content: "I'm good!" } as P2PMessage);
  return title;
}

describe('a message notification title', () => {
  it("uses the roster's name when the conversation has none", () => {
    recordPeerUsernames([{ cid: CID, username: 'tbraun0927' }]);
    recordMemberNames([{ id: 'tbraun0927', displayName: 'Thomas Braun' }]);
    expect(titleFor(undefined)).toBe('New message from Thomas Braun');
  });

  it("still prefers the conversation's own username when it has one", () => {
    expect(titleFor('alice0927')).toBe('New message from alice0927');
  });
});
