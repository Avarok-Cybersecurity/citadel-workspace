import { describe, it, expect } from 'vitest';
import { getUserFriendlyErrorMessage, getErrorTitle } from '../error-messages';

describe('the most common failure of all: a bad username or password', () => {
  /**
   * Captured from the live server, signing in with the wrong password:
   *
   *   Authentication Error  Something went wrong: Invalid username or password
   *
   * "Invalid username or password" contains none of the needles the password
   * branch used, so the product's most common error reached the user with a
   * "Something went wrong:" prefix. That branch already carried a note about
   * having been unreachable once -- lowercase needles against a capitalised SDK
   * string -- and the fix corrected the case without checking the wording.
   */
  it('is a sentence, not a "Something went wrong" dump', () => {
    const msg: string = getUserFriendlyErrorMessage('Invalid username or password');
    expect(msg).not.toMatch(/something went wrong/i);
    expect(msg).toMatch(/username and password/i);
  });

  it('does not say WHICH half was wrong', () => {
    // The SDK conflates them deliberately. Naming the wrong half turns a login
    // form into a username oracle, so a "friendlier" message here would be a
    // security regression.
    const msg: string = getUserFriendlyErrorMessage('Invalid username or password');
    expect(msg).not.toMatch(/incorrect password|wrong password|no account/i);
  });

  it('still says "password" for an error that really is only the password', () => {
    const msg: string = getUserFriendlyErrorMessage('Invalid password');
    expect(msg).toMatch(/incorrect password/i);
  });
});

describe('a mistyped server address is explained, not dumped', () => {
  /**
   * The agent resolves the server address and answers a failure with one of two
   * strings (register.rs). Measured against the live deployment, a name that
   * does not resolve reached the screen as:
   *
   *   Something went wrong: could not resolve no-such-host.avarok.net:12400:
   *   failed to lookup address information: nodename nor servname provided, or
   *   not known
   *
   * ...on a visitor's first attempt to join. Its two neighbours -- a host with
   * nothing listening, and a missing port -- already produced a sentence a
   * person can act on, which is what made this one stand out.
   */
  for (const raw of [
    'could not resolve no-such-host.example.com:12400: failed to lookup address information: nodename nor servname provided, or not known',
    'no-such-host.example.com:12400 resolved to no addresses',
  ]) {
    it(`explains ${raw.slice(0, 28)}...`, () => {
      const msg: string = getUserFriendlyErrorMessage(raw);
      expect(msg).toMatch(/typo/i);
      expect(msg).toMatch(/citadel\.example\.com/);
      // The raw system text must not survive into it.
      expect(msg).not.toMatch(/lookup address information|nodename|Something went wrong/i);
    });
  }

  it('leaves a reachable-but-dead host on its own message', () => {
    // The neighbouring case must keep its own wording; this branch is about
    // an address that does not resolve, not one that refuses.
    const msg: string = getUserFriendlyErrorMessage('Connection refused');
    expect(msg).toMatch(/ensure the server is running/i);
  });
});

describe('a missing LOCAL account is not reported as a missing server account', () => {
  /**
   * `ConnectFailure { message: "Client does not exist" }` is what the SDK's own
   * account manager answers when this machine holds no account by that name. It
   * is decided before the server is consulted, and it says nothing whatever
   * about the server.
   *
   * Measured against the live deployment: a real, registered account signed in
   * from a fresh agent `--data-dir` -- a new machine, or a reinstall -- got
   * exactly that, and the UI told the user "No account found with that username
   * on this server. Please check your username or register a new account."
   *
   * Both halves of that are wrong in the way that matters. The account is
   * intact on the server, and registering again is not a retry: it mints a NEW
   * CID while every peer's registration still points at the old one. The user
   * would follow the instruction and quietly split their identity in two.
   */
  it('names the machine, not the server', () => {
    const msg: string = getUserFriendlyErrorMessage('Client does not exist');
    expect(msg).toMatch(/machine/i);
    expect(msg).toMatch(/data.directory|--data-dir/i);
    // The claim that must not be made.
    expect(msg).not.toMatch(/on this server/i);
  });

  it('does not tell them to register, which would split their identity', () => {
    const msg: string = getUserFriendlyErrorMessage('Client does not exist');
    expect(msg).not.toMatch(/register a new account/i);
    // ...while still saying what registering again would COST, so the option is
    // informed rather than hidden.
    expect(msg).toMatch(/separate account/i);
  });

  it('still reports a genuinely unknown username the old way', () => {
    // The generic branch must survive: this one is about a different failure.
    const msg: string = getUserFriendlyErrorMessage('User is not registered');
    expect(msg).toMatch(/on this server/i);
  });
});

describe('getUserFriendlyErrorMessage', () => {
  it('handles WebSocket connection failures', () => {
    const msg: string = getUserFriendlyErrorMessage('WebSocket connection failed');
    expect(msg).toContain('Citadel agent');
    // Not "check your internet connection". This socket is same-origin /ws to
    // the local agent, so that advice sends the user somewhere that cannot
    // help — and real network loss is already handled by OfflineBanner.
    expect(msg.toLowerCase()).not.toContain('internet');
  });

  it('handles WASM client init failure', () => {
    const msg: string = getUserFriendlyErrorMessage('Failed to initialize WASM client');
    expect(msg).toContain('Citadel agent');
    expect(msg.toLowerCase()).not.toContain('internet');
  });

  it('handles handshake closed', () => {
    const msg: string = getUserFriendlyErrorMessage('Connection closed before receiving a handshake');
    expect(msg).toContain('not responding');
  });

  it('handles session already connected', () => {
    // The workspace server's own refusal. It means the SERVER still holds a
    // session for the account, not that another window here has it, and the
    // copy used to claim the latter and offer a takeover nothing performed.
    const msg: string = getUserFriendlyErrorMessage(
      'Session Already Connected, or, is in the process of disconnection and an earlier connection attempt beat this connection. Not allowing this connection',
    );
    expect(msg).toContain('workspace server still has this account signed in');
    expect(msg).not.toMatch(/another window or tab|take over/);
  });

  it('handles timeout', () => {
    const msg: string = getUserFriendlyErrorMessage('Request timed out');
    expect(msg).toContain('timed out');
  });

  it('handles invalid credentials', () => {
    const msg: string = getUserFriendlyErrorMessage('Invalid credentials');
    expect(msg).toContain('Invalid username or password');
  });

  it('handles user not found', () => {
    const msg: string = getUserFriendlyErrorMessage('User not found');
    expect(msg).toContain('No account found');
  });

  it('handles user already exists', () => {
    const msg: string = getUserFriendlyErrorMessage('User already exists');
    expect(msg).toContain('already exists');
  });

  it('handles workspace not found', () => {
    const msg: string = getUserFriendlyErrorMessage('Workspace not found');
    expect(msg).toContain('could not be found');
  });

  it('handles connection refused', () => {
    const msg: string = getUserFriendlyErrorMessage('Connection refused (ECONNREFUSED)');
    expect(msg).toContain('Could not reach');
  });

  it('handles Error objects', () => {
    const msg: string = getUserFriendlyErrorMessage(new Error('WebSocket connection failed'));
    expect(msg).toContain('Citadel agent');
  });

  it('returns cleaned message for unknown short errors', () => {
    const msg: string = getUserFriendlyErrorMessage('Something weird happened');
    expect(msg).toContain('Something went wrong');
    expect(msg).toContain('Something weird happened');
  });

  it('returns generic message for very long unknown errors', () => {
    const longMsg: string = 'x'.repeat(300);
    const msg: string = getUserFriendlyErrorMessage(longMsg);
    expect(msg).toContain('unexpected error');
  });

  it('maps the SDK\'s real duplicate-username message, not just the literal', () => {
    // Captured verbatim from the live toast. The mapping used to test for
    // 'User already exists', which this does not contain, so the friendliest
    // message in the file was unreachable for the case it was written for.
    expect(getUserFriendlyErrorMessage('Username bob_1787715650505 already exists!')).toMatch(
      /already exists.*choose a different username/i,
    );
    // The older phrasing must keep working.
    expect(getUserFriendlyErrorMessage('User already exists')).toMatch(
      /already exists.*choose a different username/i,
    );
    // Unrelated "already exists" errors must NOT be reported as a username clash.
    expect(getUserFriendlyErrorMessage('Workspace already exists')).not.toMatch(
      /choose a different username/i,
    );
  });
});

describe('getErrorTitle', () => {
  it('returns Connection Error for WebSocket issues', () => {
    expect(getErrorTitle('WebSocket broke')).toBe('Connection Error');
    expect(getErrorTitle('ECONNREFUSED')).toBe('Connection Error');
  });

  it('returns Authentication Error for credential issues', () => {
    expect(getErrorTitle('password mismatch')).toBe('Authentication Error');
    expect(getErrorTitle('Invalid Password')).toBe('Authentication Error');
  });

  it('returns Workspace Error for workspace issues', () => {
    expect(getErrorTitle('Workspace init failed')).toBe('Workspace Error');
  });

  it('returns Network Error for network issues', () => {
    expect(getErrorTitle('NetworkError')).toBe('Network Error');
  });

  it('returns Request Timeout for timeouts', () => {
    expect(getErrorTitle('Request timeout')).toBe('Request Timeout');
  });

  it('returns Account Not Found for missing accounts', () => {
    expect(getErrorTitle('User not found')).toBe('Account Not Found');
    expect(getErrorTitle('not registered')).toBe('Account Not Found');
  });

  it('returns generic Error for unknown messages', () => {
    expect(getErrorTitle('Something unexpected')).toBe('Error');
  });

  it('handles Error objects', () => {
    expect(getErrorTitle(new Error('Connection refused'))).toBe('Connection Error');
  });
  it('titles a duplicate username instead of the bare "Error" fallback', () => {
    expect(getErrorTitle('Username bob_1787715650505 already exists!')).toBe('Username Taken');
  });
});

describe('credential errors are matched regardless of case', () => {
  // The SDK emits `#[form = "Invalid password"]` with a capital I
  // (citadel_io/src/error/code.rs). These branches were all-lowercase
  // `.includes()` needles, and `.includes()` is case-sensitive — so the branch
  // handling the product's most common error could never fire, and a mistyped
  // password fell through to "Something went wrong: Invalid password".
  it.each([
    'Invalid password',
    'invalid password',
    'Login failure: Invalid password',
  ])('maps %j to the friendly message', (raw) => {
    expect(getUserFriendlyErrorMessage(raw)).toBe(
      'Incorrect password. Please check your password and try again.',
    );
  });

  it('maps the SDK capitalisation of a missing account', () => {
    expect(getUserFriendlyErrorMessage('Account Does Not Exist')).toContain('No account found');
  });

  it('still leaves unrelated errors to the fallback', () => {
    // Guards against a matcher so loose it swallows everything.
    expect(getUserFriendlyErrorMessage('Disk quota exceeded')).not.toContain('Incorrect password');
  });
});

describe('an error that is neither a string nor an Error', () => {
  it('never becomes "[object Object]" in front of a user', () => {
    // Login, registration and workspace initialization each narrowed with
    // `err instanceof Error ? err : String(err)` before calling this, and the
    // revfs and websocket layers both reject with a structured payload. That
    // string matched no branch, was not jargon and was under 200 characters,
    // so it reached the user through the passthrough.
    const shown: string = getUserFriendlyErrorMessage({ code: 5, detail: 'x' });

    expect(shown).not.toContain('[object Object]');
  });

  it('still recognises a known failure carried on a payload', () => {
    // The positive control: normalising must not cost the mapping. Without
    // this, returning a constant would satisfy the test above.
    expect(getUserFriendlyErrorMessage({ message: 'Invalid credentials' })).toMatch(
      /invalid username or password/i,
    );
  });

  it('titles it without [object Object] either', () => {
    expect(getErrorTitle({ code: 5 })).not.toContain('[object Object]');
  });
});

/**
 * The registration timeout.
 *
 * `useJoinRegistration.ts` rejects with "Registration timed out after 30
 * seconds" and surfaces it at line ~214 as
 * `toast({ title: getErrorTitle(e), description: getUserFriendlyErrorMessage(e) })`.
 * Both mappers fell through to the generic timeout branch, whose advice is
 * "check your network" — and the network is the one place the fault is not.
 * The page reached the agent on this machine; what timed out is the agent's
 * attempt to reach the workspace server at the address the user just typed.
 *
 * work.avarok.net showed exactly this to every new user for weeks while the
 * real cause was a DNS lookup the page's own CSP refused.
 */
describe('a registration that times out', () => {
  const err: Error = new Error('Registration timed out after 30 seconds');

  it('names the server, not the user\'s network', () => {
    const message: string = getUserFriendlyErrorMessage(err);
    expect(message).toMatch(/workspace server did not answer/i);
    expect(message).not.toMatch(/your network/i);
  });

  it('says what a valid address looks like, since that is what to check', () => {
    expect(getUserFriendlyErrorMessage(err)).toMatch(/citadel\.example\.com/);
  });

  it('allows that the address may be right and the server down', () => {
    expect(getUserFriendlyErrorMessage(err)).toMatch(/may be down or unreachable/i);
  });

  it('titles it by what happened, not by whose clock ran out', () => {
    expect(getErrorTitle(err)).toBe('Server Did Not Answer');
  });

  it('leaves other timeouts on the generic branch', () => {
    // Narrow, deliberately: a rekey or a peer-connect timeout is NOT a wrong
    // server address, and must not be given advice about one.
    const other: Error = new Error('Peer connect timeout');
    expect(getUserFriendlyErrorMessage(other)).toMatch(/check your network/i);
    expect(getErrorTitle(other)).toBe('Request Timeout');
  });
});

/**
 * The string users ACTUALLY get when the address is live but not a workspace
 * server. Found by pointing a real browser at a TCP listener that accepts and
 * never speaks: the SDK surfaces "Socket deadline has elapsed", and it reached
 * the user raw, under a bare "Error" title. The unit tests above, written from
 * the client-side timeout string, were green throughout.
 */
describe('a server that accepts the connection and then says nothing', () => {
  // The string the SDK ACTUALLY sends. What users saw was
  // "Socket deadline has elapsed" -- the cleaner below had stripped the
  // embedded "error:" out of the middle of it, inventing a sentence that
  // exists nowhere in the system. Matchers written from the rendered text
  // could therefore never match the real input.
  const err: Error = new Error('Socket error: deadline has elapsed');

  it('is explained rather than surfaced raw', () => {
    const message: string = getUserFriendlyErrorMessage(err);
    expect(message).not.toMatch(/socket deadline/i);
    expect(message).toMatch(/workspace server did not answer/i);
  });

  it('points at the address, which is the thing to check', () => {
    expect(getUserFriendlyErrorMessage(err)).toMatch(/citadel\.example\.com/);
  });

  it('gets a title that says what happened, not a bare "Error"', () => {
    expect(getErrorTitle(err)).toBe('Server Did Not Answer');
  });
});


/**
 * The cleaner must not edit the middle of a message.
 *
 * The strip was unanchored, so "Socket error: deadline has
 * elapsed" reached the screen as "Socket deadline has elapsed". Nobody can
 * search the codebase, or the SDK, for a sentence the UI invented -- and a
 * matcher written from it cannot fire, because the value being tested still
 * has the words the display removed.
 */
describe('cleaning a raw error for display', () => {
  it('strips only a LEADING "Error:" prefix', () => {
    expect(getUserFriendlyErrorMessage(new Error('Error: something odd happened')))
      .toBe('Something went wrong: something odd happened');
  });

  it('leaves "error:" inside the sentence alone', () => {
    // Deliberately a string with no other branch match, so this measures the
    // cleaner and not some earlier rule.
    const shown: string = getUserFriendlyErrorMessage(new Error('Widget error: bolt missing'));
    expect(shown).toBe('Something went wrong: Widget error: bolt missing');
    expect(shown).not.toBe('Something went wrong: Widget bolt missing');
  });
});

/**
 * The address field's placeholder must show the port.
 *
 * The field takes `host:port`; the agent has nowhere to connect without one.
 * The placeholder read `workspace.example.com`, teaching the exact mistake that
 * costs a 30-second wait and — before round 713 — the advice "check your
 * network". Asserted here, beside the message that has to clean up after it,
 * so the example in the hint and the example in the error cannot drift apart.
 */
describe('the address example shown to a new user', () => {
  it('matches the one the failure message gives', async () => {
    const source: string = await import('node:fs').then((fs) =>
      fs.readFileSync('src/components/ServerConnect.tsx', 'utf8'));
    const placeholder: RegExpMatchArray | null = source.match(/placeholder="([^"]*example[^"]*)"/);
    expect(placeholder, 'ServerConnect must still have an example address placeholder').not.toBeNull();
    const shown: string = placeholder![1];
    // No longer "must include a port": the port is assumed when absent, so the
    // placeholder shows the simplest thing that works. What still matters is
    // that the hint and the failure message name the SAME example -- a user
    // who copies one and is corrected by the other has been told two things.
    expect(shown, 'the placeholder must not be empty').not.toBe('');
    expect(
      getUserFriendlyErrorMessage(new Error('Socket error: deadline has elapsed')),
      'the error message must name the same example as the placeholder',
    ).toContain(shown);
  });
});
