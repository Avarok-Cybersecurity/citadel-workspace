/**
 * What to call a person: the workspace roster first.
 *
 * The top bar, the switcher and the chat each had their own answer. Registration
 * saved the full name on the stored session, so a freshly registered tab said
 * "Alice Chen"; after a reload or a password sign-in the stored session had no
 * full name and every surface said "alice0924", or nothing. The roster is the
 * one record every sign-in path loads, and it carries the name the person chose.
 */
import { isPlaceholderName } from '@/lib/peer-display';
import { memberDisplayName } from '@/lib/member-names';
import type { User } from '@/types/workspace-entities';

/**
 * The roster's name for `username`, or undefined when it has none better than
 * the username. The live roster first (it is React state, so a surface reading
 * it re-renders when it lands), then every name member-names.ts has learnt from
 * any `Members` response -- a room roster, or a workspace roster since replaced.
 */
export function rosterDisplayName(members: Record<string, User>, username: string | undefined): string | undefined {
  if (!username) return undefined;
  const member: User | undefined = Object.values(members).find(
    (m: User) => m.username === username || m.id === username,
  );
  const name: string | undefined = member?.displayName?.trim() || memberDisplayName(username);
  return name && name !== username && !isPlaceholderName(name) ? name : undefined;
}

/** The signed-in person: the roster, then the saved full name, then the username. */
export function selfDisplayName(
  members: Record<string, User>,
  identity: { username?: string; fullName?: string },
): string | undefined {
  const saved: string | undefined = identity.fullName?.trim() || undefined;
  return rosterDisplayName(members, identity.username) ?? saved ?? identity.username;
}
