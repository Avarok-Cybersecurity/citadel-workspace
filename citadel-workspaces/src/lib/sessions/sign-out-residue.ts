/**
 * What "fully logged out" has to mean on this device.
 *
 * Sign-out removed the stored session and the tab's selection, said *"You have
 * been fully logged out"*, and left behind:
 *
 *   peer-first-seen:<cid>          one key per peer you have ever spoken to
 *   citadel:file-transfers         file names, sizes and peer CIDs of every
 *                                  transfer, in both directions
 *   citadel:file-transfer-settings per-peer settings, keyed by peer CID
 *
 * All in localStorage, all readable by anyone who opens devtools on that
 * machine afterwards. On a product whose premise is that conversations are
 * private, telling someone they are fully logged out while the browser still
 * holds a list of who they talked to and what they exchanged is the same class
 * of claim as a hedge offered where the answer is known — a sentence the
 * storage contradicts.
 *
 * Deliberately NOT removed:
 *
 *   citadel:appearance-settings    a device preference, not an identity. Font
 *   citadel:privacy-settings       size and privacy choices resetting on
 *                                  sign-out would be a surprise, and privacy
 *                                  defaults are the safer values anyway.
 *   citadel_recent_servers         a feature the user can see and manage in the
 *                                  UI. Silently emptying a visible list is a
 *                                  different bug from clearing invisible
 *                                  residue.
 *   citadel:diagnostics            a debugging opt-in the user set themselves.
 *
 * The split is the point: residue the user cannot see goes, state the user
 * chose stays.
 */

/** Exact keys removed on sign-out. */
export const RESIDUE_KEYS: readonly string[] = [
  'citadel:file-transfers',
  'citadel:file-transfer-settings',
];

/** Key prefixes removed on sign-out, one key per peer. */
export const RESIDUE_PREFIXES: readonly string[] = ['peer-first-seen:'];

/**
 * The keys to remove, given what storage currently holds.
 *
 * Pure and given the key list, so the decision can be tested without a
 * browser — and so the "kept" set is asserted rather than assumed.
 */
export function residueKeys(existing: readonly string[]): string[] {
  return existing.filter(
    (key) =>
      RESIDUE_KEYS.includes(key) || RESIDUE_PREFIXES.some((prefix) => key.startsWith(prefix)),
  );
}

/**
 * Remove this device's record of who the account talked to.
 *
 * Best-effort by design: sign-out has already happened by the time this runs,
 * and a storage error must not leave the user staring at a modal. It throws
 * nothing.
 */
export function clearSignOutResidue(): void {
  try {
    const keys: string[] = [];
    for (let i: number = 0; i < localStorage.length; i += 1) {
      const key: string | null = localStorage.key(i);
      if (key !== null) keys.push(key);
    }
    for (const key of residueKeys(keys)) {
      localStorage.removeItem(key);
    }
  } catch {
    // Storage unavailable or blocked. Nothing here is worth failing a sign-out.
  }
}
