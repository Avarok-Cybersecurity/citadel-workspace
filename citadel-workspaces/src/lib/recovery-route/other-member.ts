/**
 * The only way to name a member a route waits on or writes to. A wait on yourself is a bug (the
 * owner of a topic waiting for "the member who started it" to open the app, REL-1127 CAL-SOLO):
 * `null` here makes the surface report it instead of rendering a wait that never ends.
 */
import type { OtherMember } from './binding';

export function otherMember(cid: bigint, self: bigint, name: string | null): OtherMember | null {
  if (cid === self) return null;
  return { cid, name } as OtherMember;
}
