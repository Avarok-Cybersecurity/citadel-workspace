import { describe, expect, it } from 'vitest';
import { getErrorTitle, getUserFriendlyErrorMessage } from '../error-messages';
import { readableSdkError } from '../sdk-error-text';

/**
 * The ConnectFailure message the agent sends when the login form asks for a
 * security level above the account's registered one, captured from an agent
 * test against the SDK at fb7f1fd (register at Standard, connect at Extreme).
 */
const SDK_SAYS: string =
  "The session security level Extreme exceeds this account's registered level Standard. " +
  'Log in at Standard or lower, or register an account at the higher level';
const CONNECT_FAILURE: string =
  'Unable to proceed past session zero-state. Stopping session: NetworkError { code: ' +
  'SessionSecurityExceedsRegistration (169), origin: "/Users/x/.cargo/git/checkouts/' +
  'citadel-protocol/fb7f1fd/citadel_proto/src/proto/session.rs:912", message: "' +
  SDK_SAYS +
  '" }';

describe('an SDK refusal is not a network error', () => {
  it('shows the sentence the SDK wrote, not "check your internet connection"', () => {
    const shown: string = getUserFriendlyErrorMessage(new Error(CONNECT_FAILURE));
    expect(shown).not.toMatch(/internet connection/i);
    expect(shown).toContain(SDK_SAYS);
  });

  it('is not titled a network error', () => {
    expect(getErrorTitle(new Error(CONNECT_FAILURE))).not.toBe('Network Error');
  });

  it('unescapes quotes inside the SDK message', () => {
    expect(readableSdkError('x: NetworkError { code: Generic (0), origin: "a", message: "say \\"hi\\"" }'))
      .toBe('say "hi"');
  });

  it('leaves text without the SDK structure unchanged', () => {
    expect(readableSdkError('Invalid password')).toBe('Invalid password');
  });

  it("still reads the browser's own fetch failure as a network error", () => {
    expect(getUserFriendlyErrorMessage('NetworkError when attempting to fetch resource.'))
      .toBe('Network error. Please check your internet connection.');
  });
});
