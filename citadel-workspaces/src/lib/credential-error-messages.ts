/**
 * "Who you are" failures: the credential and account-existence branches.
 *
 * Extracted from error-messages.ts, which passed the 250-line limit as these
 * grew. They belong together for a reason beyond length: all four are answers
 * to the same question -- is this person who they say they are, and does this
 * machine know them -- and all four have been wrong in the same way, matching a
 * string the SDK does not actually send. Their comments are the record of that
 * and travel with them.
 *
 * Returns `null` when nothing here applies, so the caller keeps its ordering:
 * these are consulted at exactly the point they used to sit.
 *
 * A SIBLING FILE, not `error-messages/credentials.ts`. A directory beside a file
 * of the same name shadows it in module resolution, so the directory becomes
 * dead code that still reads as live -- which is what
 * `no-module-is-shadowed-by-a-file.test.ts` caught when this was first put
 * there.
 */
export function credentialErrorMessage(errorMessage: string): string | null {
  // The SDK's actual wording, captured from the live server:
  //
  //   Authentication Error  Something went wrong: Invalid username or password
  //
  // "Invalid username or password" does not contain "invalid password", so the
  // branch below never fired for the product's single most common failure. That
  // branch already carries a comment about being unreachable once -- the needles
  // were lowercase while the SDK emits a capital I -- and the fix corrected the
  // CASE without checking the WORDING. Same bug, one layer along, and invisible
  // for the same reason: the app still says something, so nothing looks broken.
  //
  // Deliberately does not claim it was the password. The SDK conflates the two
  // on purpose -- telling an attacker which half was right is how you turn a
  // login form into a username oracle -- so the message must not undo that.
  if (/invalid username or password|invalid credentials/i.test(errorMessage)) {
    return 'That username and password did not match. Check both and try again.';
  }

  if (/invalid password|wrong password|password mismatch|incorrect password/i.test(errorMessage)) {
    return 'Incorrect password. Please check your password and try again.';
  }

  // "Client does not exist" is LOCAL, and saying otherwise sends people to
  // create a second identity for an account that is perfectly intact.
  //
  // Measured: signing in as a real, registered account from a fresh agent
  // (`--data-dir` pointed somewhere new, which is what a new machine or a
  // reinstall looks like) answers
  //
  //   ConnectFailure { message: "Client does not exist" }
  //
  // ...from the SDK's own account manager, before the server is consulted at
  // all. A Citadel account is not a row on a server: the client holds its CID
  // and key material, and the agent keeps them under --data-dir. Lose that
  // directory and the account cannot be signed into from that machine, however
  // healthy it is on the server.
  //
  // The generic branch below claimed "No account found with that username on
  // this server", which is false in the one place it matters and whose advice --
  // "register a new account" -- is not reversible: the user gets a NEW CID, and
  // their peers' registrations still point at the old one.
  if (/client does not exist/i.test(errorMessage)) {
    return (
      'This machine has no account by that name. Citadel keeps your account in the agent\'s ' +
      'data directory (--data-dir), not only on the server, so signing in needs the machine ' +
      'you registered on. If you registered elsewhere, or started the agent with a different ' +
      '--data-dir, use that one. Registering again would create a separate account.'
    );
  }

  if (/does not exist|not registered|no user|account not found/i.test(errorMessage)) {
    return 'No account found with that username on this server. Please check your username or register a new account.';
  }

  return null;
}
