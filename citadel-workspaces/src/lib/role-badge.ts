/**
 * The one place a role badge decides how it looks.
 *
 * There were two of these — getRoleColor in the sidebar and getRoleBadgeClass in
 * user search — and only one got fixed when the fill/foreground pairing bug was
 * found. The other kept handing shadcn's Badge a fill with no matching text
 * colour, so the default `text-primary-foreground` (white) landed on
 * `bg-primary-accent` at 2.86:1 and on `bg-success` at 2.59:1 in dark, and on
 * near-white fills in light. Fixing the instance rather than the class is what
 * left it standing; one exported helper is what stops it recurring.
 *
 * Rank is shown as visual WEIGHT — solid, outlined-brand, outlined-neutral,
 * plain — because every pair in that sequence is one the AA suite checks.
 * primary-accent is the accent TEXT token, so it appears as text and as a
 * border, never as a fill carrying text.
 *
 * Colour is never the only signal: the badge states the role in words, and the
 * rows that use it also carry a role icon.
 */
const ROLE_BADGE: Record<string, string> = {
  owner: 'bg-primary text-primary-foreground border border-transparent',
  admin: 'bg-transparent text-primary-accent border border-primary-accent/60',
  member: 'bg-transparent text-muted-foreground border border-border',
  guest: 'bg-transparent text-muted-foreground border border-transparent',
};

const FALLBACK: "bg-transparent text-muted-foreground border border-border" = 'bg-transparent text-muted-foreground border border-border';

/** Classes for a role badge. Unknown or absent roles read as a plain member. */
export function roleBadgeClass(role?: string | null): string {
  if (!role) return FALLBACK;
  return ROLE_BADGE[role.toLowerCase()] ?? FALLBACK;
}
