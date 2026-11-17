/**
 * What an account the server signed out is called on screen. One copy of each
 * string, read by Manage Accounts, the landing notice and their tests.
 */
export const SIGNED_OUT_COPY: Readonly<{ status: string; signIn: string }> = {
  status: 'Signed out by the server — sign in again',
  signIn: 'Sign in',
};

/** The landing page's one-line notice for `usernames`, which is never empty. */
export function signedOutNotice(usernames: readonly string[]): string {
  const who: string = usernames.length === 1 ? usernames[0] : `${usernames.length} accounts (${usernames.join(', ')})`;
  return `${who} ${usernames.length === 1 ? 'was' : 'were'} signed out by the server. Sign in again from Manage Accounts.`;
}
