/**
 * What the page says about a session's resume credential: what lets the agent bring a dropped
 * connection back without the account's password or a security-key touch, for the time the
 * user chose for this device.
 */

/** Why a session that held one could not come back. Each asks for a sign-in, for its own reason. */
export const RESUME_ENDED_COPY: {
  readonly resume_credential_expired: (server: string) => string;
  readonly resume_credential_revoked: (server: string) => string;
} = {
  resume_credential_expired: (server: string): string =>
    `The time this device stays signed in to ${server} has run out. Sign in again to continue.`,
  resume_credential_revoked: (server: string): string =>
    `The way this account signs in to ${server} has changed (its password, its sign-in method or its security keys), so this device was signed out. Sign in again to continue.`,
};

/** Said the moment the time runs out, while the session is still connected. */
export const RESUME_EXPIRED_TOAST: {
  readonly id: (cid: bigint) => string;
  readonly title: string;
  readonly description: (server: string) => string;
  readonly action: string;
} = {
  id: (cid: bigint): string => `resume-expired-${cid.toString()}`,
  title: 'Sign in again to stay connected',
  description: (server: string): string =>
    `The time this device stays signed in to ${server} has run out. You are still connected, but the next dropped connection will ask you to sign in.`,
  action: 'Sign in',
};
