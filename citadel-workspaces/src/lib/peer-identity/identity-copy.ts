/**
 * What a peer's identity is called wherever it is shown: the mark in the chat header, the
 * safety-number dialog and the changed-key screen. One copy, so they cannot disagree.
 */
import type { PeerIdentityView } from './wire';

export type IdentityMarkKind = 'verified' | 'unverified' | 'changed';

/** The mark a view earns: a waiting key outranks everything, then a pinned key. */
export function identityMarkOf(view: PeerIdentityView): IdentityMarkKind {
  if (view.pending !== null) return 'changed';
  return view.pinned !== null ? 'verified' : 'unverified';
}

export const IDENTITY_COPY: {
  readonly mark: Readonly<Record<IdentityMarkKind, string>>;
  readonly markHint: Readonly<Record<IdentityMarkKind, string>>;
  readonly safetyTitle: (peer: string) => string;
  readonly safetyHowTo: (peer: string) => string;
  readonly noOwnKey: string;
  readonly noPeerKey: (peer: string) => string;
  readonly yourKey: string;
  readonly theirKey: (peer: string) => string;
  readonly changedTitle: (peer: string) => string;
  readonly changedBody: (peer: string) => string;
  readonly previousKey: string;
  readonly newKey: string;
  readonly accept: string;
  readonly cancel: string;
  readonly acceptFailed: string;
} = {
  mark: { verified: 'Verified', unverified: 'Unverified', changed: 'Key changed' },
  markHint: {
    verified: 'Signed by the key you have for this person. Show the safety number',
    unverified: 'Not signed by an identity key. Show why',
    changed: 'This person signed with a different key. Review it',
  },
  safetyTitle: (peer: string): string => `Safety number with ${peer}`,
  safetyHowTo: (peer: string): string =>
    `Compare these lines with ${peer}, in person or on a call. If both of you see the same two lines, nobody in between can read or change what you send each other.`,
  noOwnKey: 'Your account has no identity key, so this conversation cannot be verified. It is still encrypted.',
  noPeerKey: (peer: string): string =>
    `${peer} has not signed a connection with an identity key yet. Their app may be older, or their account may have none. The conversation is still encrypted.`,
  yourKey: 'Your key',
  theirKey: (peer: string): string => `${peer}'s key`,
  changedTitle: (peer: string): string => `${peer}'s key changed`,
  changedBody: (peer: string): string =>
    `${peer} connected with a different identity key. That happens when they set up a new device or restored their account, and also when someone is pretending to be them. Nothing is sent until you decide. Check the new key with ${peer} in person or on a call before you accept it.`,
  previousKey: 'Key you had',
  newKey: 'New key',
  accept: 'Accept new key',
  cancel: 'Cancel',
  acceptFailed: 'The new key was not accepted',
};
