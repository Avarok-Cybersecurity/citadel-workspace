/**
 * The ceremony a fake challenge names, in the agent's wire shape, and the rule
 * the SDK applies to the key that answers it (citadel_user SecurityKeyCeremony).
 */
import { toBase64Url } from '@/lib/passkey/bytes';
import type { SecurityKeyCeremony } from 'citadel-workspace-client-ts';

/** The relying party the fake server names in every challenge, as the hosted one does. */
export const FAKE_RP_ID: string = 'work.avarok.net';

/** The ceremony a challenge names, in the agent's wire shape. */
export type Ceremony = SecurityKeyCeremony;

const idOf = (bytes: number[]): string => toBase64Url(Uint8Array.from(bytes));

/** The SDK's rule: an allowed key when authenticating, a new non-empty one when registering. */
export function accepts(ceremony: Ceremony, credentialId: number[]): boolean {
  const id: string = idOf(credentialId);
  if ('Authenticate' in ceremony) return ceremony.Authenticate.credential_ids.some((a: number[]) => idOf(a) === id);
  return credentialId.length > 0 && !ceremony.Register.exclude_credential_ids.some((e: number[]) => idOf(e) === id);
}
