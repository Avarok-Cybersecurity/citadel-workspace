/**
 * A connection request is titled with the person's name when the roster knows it.
 *
 * Measured live: the card read "bob0924 wants to connect" although the workspace
 * roster calls him "Bob Brown" everywhere else.
 */
import { describe, it, expect } from 'vitest';
import { peerRegistrationNotification } from '../peer-registration-notification';
import { recordMemberNames } from '@/lib/member-names';

const noop = (): void => {};
const card = (peerUsername: string): { title: string; content: string } =>
  peerRegistrationNotification({ peerUsername, peerCid: '1', requestId: 'r', onAccept: noop, onDecline: noop, onCardClick: noop });

describe('a connection-request notification', () => {
  it('uses the roster name in the title and keeps the handle below it', () => {
    recordMemberNames([{ id: 'bob0924', displayName: 'Bob Brown' }]);
    expect(card('bob0924')).toMatchObject({ title: 'Bob Brown wants to connect', content: '@bob0924' });
  });

  it('falls back to the handle for someone the roster does not know', () => {
    expect(card('stranger42').title).toBe('stranger42 wants to connect');
  });
});
