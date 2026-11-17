/**
 * The string a rejected workspace master password actually produces.
 *
 * Measured against a real deployment today. The owner of the server entered a
 * password, and what came back was:
 *
 *   Something went wrong: Failed to update workspace: Invalid workspace master
 *   access password
 *
 * They did not read that as "wrong password" -- they described the screen as
 * having flickered -- and went looking for the secret again in the wrong file.
 *
 * A branch for this existed. It matched
 * `/invalid workspace password|workspace master password/i`, and the server's
 * wording at the only line that answers `UpdateWorkspace` is "Invalid workspace
 * master ACCESS password", which contains neither needle. So the case looked
 * handled and could not fire.
 *
 * The three literals below are copied from
 * citadel-workspace-server-kernel/src/handlers/domain/server_ops/
 * async_domain_server_ops.rs (:1058, :1247, :1323), wrapped the way the client
 * receives them.
 */
import { describe, it, expect } from 'vitest';
import { getUserFriendlyErrorMessage, getErrorTitle } from '../error-messages';

/** As the server sends it, and as the modal's rejection wraps it. */
const FROM_UPDATE_WORKSPACE: string =
  'Failed to update workspace: Invalid workspace master access password';

const EVERY_SERVER_WORDING: readonly string[] = [
  FROM_UPDATE_WORKSPACE,
  'Invalid workspace master access password',
  'Invalid workspace master password',
  // The shorter historical wording the old needle was written for. It must keep
  // working: replacing a matcher is not an excuse to drop what it did match.
  'Invalid workspace password',
];

describe('a rejected workspace master password', () => {
  for (const raw of EVERY_SERVER_WORDING) {
    it(`is a sentence, not a dump, for "${raw.slice(0, 40)}"`, () => {
      const message: string = getUserFriendlyErrorMessage(raw);
      expect(message).not.toMatch(/something went wrong/i);
      // The raw server text must not survive into it.
      expect(message).not.toMatch(/Failed to update workspace/i);
    });

    it(`names where the password lives, for "${raw.slice(0, 40)}"`, () => {
      // The whole point. Somebody who deployed the server hours ago has no
      // reason to connect "workspace password" to a variable in their own
      // environment file, and the person who hit this went and found a
      // different secret entirely.
      const message: string = getUserFriendlyErrorMessage(raw);
      expect(message).toContain('WORKSPACE_MASTER_PASSWORD');
    });

    it(`distinguishes it from the account password, for "${raw.slice(0, 40)}"`, () => {
      // They chose one of those minutes earlier in the join wizard. Two
      // password prompts in five minutes, and nothing said they differ.
      const message: string = getUserFriendlyErrorMessage(raw);
      expect(message).toMatch(/account password/i);
    });
  }

  it('says only that the password was wrong', () => {
    // Not whether this workspace exists, whether somebody already claimed it,
    // or whether anyone else has tried. The server discloses none of that on a
    // bad password, and a friendlier client message must not undo that.
    const message: string = getUserFriendlyErrorMessage(FROM_UPDATE_WORKSPACE);
    expect(message).not.toMatch(/already (claimed|initiali[sz]ed|has an admin)/i);
    expect(message).not.toMatch(/no such workspace|does not exist|not found/i);
  });

  it('tells somebody who is not the operator whom to ask', () => {
    const message: string = getUserFriendlyErrorMessage(FROM_UPDATE_WORKSPACE);
    expect(message).toMatch(/ask the person who did|deployed this server/i);
  });

  it('is titled for the password that was wrong, not the account', () => {
    // "Authentication Error" was what this got, because the string contains
    // "password" -- and it points at the account the user had just created
    // successfully, which is the one thing that was not the problem.
    expect(getErrorTitle(FROM_UPDATE_WORKSPACE)).toBe('Wrong Workspace Password');
  });

  it('does not claim every workspace failure is a bad password', () => {
    // The matcher is deliberately anchored on "invalid workspace ... password".
    // A broader needle -- "workspace" and "password" anywhere in the string --
    // would swallow unrelated failures and tell people to go hunting for an
    // environment variable that has nothing to do with what went wrong.
    const unrelated: string = getUserFriendlyErrorMessage(
      'Failed to update workspace: the workspace server rejected the password change',
    );
    expect(unrelated).not.toContain('WORKSPACE_MASTER_PASSWORD');
  });
});
