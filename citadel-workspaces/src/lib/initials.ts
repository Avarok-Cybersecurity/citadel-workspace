/**
 * The initials for a name: first letter of the first and last words, or the
 * one letter of a single word, or "?" when there is nothing to take one from.
 *
 * One rule for every avatar fallback and workspace badge. There were three
 * copies that disagreed: a person named "Ada Byron Lovelace" was "AL" in the
 * member list and "AB" in a call tile, and a blank name was "?" in one and "??"
 * in the other.
 */
export function initialsOf(name: string): string {
  // Wire data reaches here typed as string and sometimes absent; every copy this replaces guarded it.
  if (!name) return '?';
  const parts: string[] = name.trim().split(/\s+/).filter(Boolean);
  const first: string | undefined = parts[0];
  const last: string | undefined = parts[parts.length - 1];
  if (first === undefined || last === undefined) return '?';
  return parts.length === 1 ? first.charAt(0).toUpperCase() : (first.charAt(0) + last.charAt(0)).toUpperCase();
}
