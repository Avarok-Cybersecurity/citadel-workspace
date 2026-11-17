/**
 * A connection-request card names the person, never a CID.
 *
 * Seen live: the card read "mia0924 wants to connect / CID: 165819323455...".
 */
import { describe, it, expect } from 'vitest';
import { peerRegistrationNotification } from '../peer-registration-notification';

describe('peerRegistrationNotification', () => {
  const card: ReturnType<typeof peerRegistrationNotification> = peerRegistrationNotification({
    peerUsername: 'mia0924', peerCid: '16581932345518588362', requestId: 'r1',
    onAccept: (): void => {}, onDecline: (): void => {}, onCardClick: (): void => {},
  });

  it('shows the handle in the body', () => {
    expect(card.content).toBe('@mia0924');
  });

  it('never shows the CID anywhere the reader sees', () => {
    expect(`${card.title} ${card.content}`).not.toMatch(/\d{12}/);
  });
});
