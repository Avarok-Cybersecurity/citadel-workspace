/**
 * A server password the server does not share is named as that, not as a crypto fault.
 *
 * Measured live: a new owner, told by the intent dialog they would need their claim code,
 * pasted it into the connect step's only password field -- the Citadel pre-shared key --
 * and registration failed with "Something went wrong: Rekey update error: Encryption
 * failure", in a toast gone two seconds later.
 */
import { describe, it, expect } from 'vitest';
import { serverPasswordMismatchMessage } from '../server-password-error';

const MEASURED: string = 'Rekey update error: Encryption failure';

describe('a registration that sent a server password', () => {
  it('names the server password when the handshake could not decrypt', () => {
    const message: string | null = serverPasswordMismatchMessage(MEASURED, true);
    expect(message).toMatch(/server password/i);
    expect(message).toMatch(/claim code/i);
    expect(message).not.toMatch(/rekey|encryption failure/i);
  });

  it('says nothing when no server password was sent: then it is not the cause', () => {
    expect(serverPasswordMismatchMessage(MEASURED, false)).toBeNull();
  });

  it('leaves unrelated failures to the general mapping', () => {
    expect(serverPasswordMismatchMessage('Username bob already exists!', true)).toBeNull();
  });
});
