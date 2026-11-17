/**
 * Which user is signed in, rather than whether a workspace is on screen.
 *
 * `waitForWorkspaceLoaded` looks for sidebar labels, a workspace name, section
 * headers. Every one of those is present for ANY signed-in user, so a spec that
 * asks "can this account still log in?" by attempting a login and waiting for a
 * workspace gets `true` whenever a workspace appears — including when
 * ServerAutoConnect quietly reconnected somebody else's still-live session.
 *
 * `previous-sessions` does exactly that to check a deregistration was
 * permanent, with two other live sessions in the same browser. Its
 * `Deregister Permanent: FAIL` cannot be read as "the account survived" until
 * the assertion can name whose workspace it is looking at.
 *
 * The account menu button carries it: `Account menu for alice`, or
 * `Account menu for alice (workspace administrator)`.
 */

/** Names the TopBar shows when it does not yet know who is signed in. */
const PLACEHOLDERS: ReadonlySet<string> = new Set(['User', 'Loading...']);

/** The username in an account-menu aria-label, or null if it is not one. */
export function usernameFromAccountLabel(label: string | null): string | null {
  if (!label) return null;
  const match = /^Account menu for (.+?)(?: \(workspace administrator\))?$/.exec(label.trim());
  if (!match) return null;
  const username = match[1].trim();
  // Placeholders are the absence of an answer, not an account with that name.
  //
  // The TopBar falls back to the literal "User" when it knows no name, and
  // `user-service` seeds a profile with `username: 'Loading...'` while the real
  // one is fetched. CI caught the second: every login check reported
  //
  //   a workspace loaded, but for Loading... rather than prev_sess_c_…
  //
  // and concluded the account could not sign in — a false negative from this
  // helper rather than an answer about the account.
  return PLACEHOLDERS.has(username) || username === '' ? null : username;
}

/**
 * Who the page says is signed in, or null if it does not say.
 *
 * Reads the account-menu button rather than any workspace chrome, because the
 * chrome is identical for every user.
 */
export async function signedInAs(
  page: {
    locator: (selector: string) => {
      first: () => { getAttribute: (name: string) => Promise<string | null>; count: () => Promise<number> };
    };
    waitForTimeout: (ms: number) => Promise<void>;
  },
  timeoutMs: number = 10_000,
): Promise<string | null> {
  // Polled, because the name settles after the workspace renders: the profile
  // is fetched separately and the TopBar shows "Loading..." until it arrives.
  // Reading once produced a placeholder and a false "that is not the user".
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const button = page.locator('[data-testid="user-avatar-button"]').first();
    if ((await button.count()) > 0) {
      const name = usernameFromAccountLabel(await button.getAttribute('aria-label'));
      if (name !== null) return name;
    }
    if (Date.now() >= deadline) return null;
    await page.waitForTimeout(250);
  }
}
