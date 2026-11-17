/**
 * Why a sign-in form is opening for an account, and what it is told.
 *
 * Two different situations reached the same `signInAs(username)`: an account live
 * in another browser window (offered "open here too", or moved with the password),
 * and an account the agent no longer holds at all (signed out, deleted elsewhere,
 * or ended by an agent restart). The second was sent to the first's flow -- whose
 * attach the agent refuses with "Session <cid> not found" -- or, from the switcher,
 * claimed by a stale CID with the same raw refusal as the only explanation.
 */
import { dialledHost } from './same-server';

export type SignInRequest =
  /** Live on another localhost connection: join it here, or move it with the password. */
  | { readonly kind: 'held-elsewhere'; readonly username: string }
  /** The agent holds no session for it: only a sign-in brings it back. */
  | {
    readonly kind: 'signed-out'; readonly username: string; readonly notice: string;
    /** The server it is on, from the stored record or the agent; null when neither says. The sign-in is scoped to it. */
    readonly server: string | null;
  };

export type SignedOutSignIn = Extract<SignInRequest, { kind: 'signed-out' }>;

export function heldElsewhereSignIn(username: string): SignInRequest {
  return { kind: 'held-elsewhere', username };
}

/**
 * Sign-in for an account the agent does not hold. `serverAddress` is the stored
 * record's or the agent's, never a guess: an empty one (older records) is left out
 * of the notice rather than filled in.
 */
export function signedOutSignIn(username: string, serverAddress: string): SignedOutSignIn {
  const server: string | null = serverAddress.trim() === '' ? null : dialledHost(serverAddress);
  const where: string = server === null ? '' : ` on ${server}`;
  return {
    kind: 'signed-out',
    username,
    server,
    notice: `${username}${where} is signed out. Enter the password to sign in again.`,
  };
}
