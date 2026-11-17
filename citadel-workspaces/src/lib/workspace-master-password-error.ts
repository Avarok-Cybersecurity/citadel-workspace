/**
 * "That password was not right", for the one password nobody is told about.
 *
 * A sibling module rather than another branch in error-messages.ts, for the
 * reason credential-error-messages.ts already gives: that file sits at its
 * 250-line cap, and this explanation is longer than the code it explains.
 *
 * THE SERVER HAS TWO WORDINGS, AND THE BRANCH THIS REPLACES MATCHED ONE.
 * From citadel-workspace-server-kernel/src/handlers/domain/server_ops/
 * async_domain_server_ops.rs:
 *
 *   :1058          "Invalid workspace master password"
 *   :1247, :1323   "Invalid workspace master access password"
 *
 * The old needle was `/invalid workspace password|workspace master password/i`.
 * "Invalid workspace master ACCESS password" contains neither -- "master access
 * password" is not "master password" -- and :1247 is the one `UpdateWorkspace`
 * raises, which is the only request the initialization modal ever sends. So the
 * branch existed, read as correct, and could not fire on the single path that
 * reaches it. Precisely the failure mode recorded twice already in
 * error-messages.ts and once more in credential-error-messages.ts: a matcher
 * written from a remembered string rather than the emitted one.
 *
 * What the owner of a fresh deployment saw instead, verified today:
 *
 *   Something went wrong: Failed to update workspace: Invalid workspace master
 *   access password
 *
 * They did not read that as a rejected password. They described it as the
 * screen flickering, went looking for the secret again, and found a different
 * one.
 *
 * SO THE MESSAGE NAMES WHERE THE PASSWORD LIVES. The person being asked has,
 * minutes earlier, chosen a password of their own, and nothing so far has told
 * them these are different secrets. Naming `WORKSPACE_MASTER_PASSWORD` is the
 * difference between "try again" and knowing which file to open.
 *
 * It names the VARIABLE, never a value. Nothing here may quote, echo or log the
 * password itself -- see secrets-never-reach-logs.test.ts.
 *
 * And it reveals nothing else. Not whether this workspace exists, not whether
 * somebody has already claimed it, not whether anyone else has tried. The
 * server discloses none of that on a bad password and neither does this.
 */

/** The wordings the server actually emits, plus the shorter historical one. */
const WRONG_MASTER_PASSWORD: RegExp = /invalid workspace (?:master (?:access )?)?password/i;

export const WRONG_MASTER_PASSWORD_TITLE: string = 'Wrong Workspace Password';

/** Returns `null` when this is not that failure, so the caller keeps its order. */
export function workspaceMasterPasswordError(errorMessage: string): string | null {
  if (!WRONG_MASTER_PASSWORD.test(errorMessage)) return null;

  return (
    'That is not the workspace master password. It is not the account password ' +
    'you chose when you registered: it is a separate secret, set by whoever ' +
    'deployed this server as WORKSPACE_MASTER_PASSWORD in the server\'s ' +
    'environment, usually a .env file beside it. If you did not deploy this ' +
    'server, ask the person who did.'
  );
}

/** Whether `getErrorTitle` should say so, without duplicating the pattern. */
export function isWrongMasterPassword(errorMessage: string): boolean {
  return WRONG_MASTER_PASSWORD.test(errorMessage);
}
