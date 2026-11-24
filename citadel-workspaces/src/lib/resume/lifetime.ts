/**
 * How long this device stays signed in across dropped connections: the lifetime each sign-in
 * asks the workspace for (`resume_lifetime_s`), chosen here from a few presets and kept in this
 * browser. The workspace grants no more than its own maximum, whatever is asked.
 *
 * One place reads and writes it, so the settings row and the sign-in can never disagree.
 */

/** The presets, in seconds: an hour, a working day, a day, a week. */
export const RESUME_LIFETIME_CHOICES: readonly [3600, 28800, 86400, 604800] = [3600, 28800, 86400, 604800];

export type ResumeLifetime = (typeof RESUME_LIFETIME_CHOICES)[number];

/**
 * What a device that has never chosen asks for. A product decision (2026-11-23), not a
 * convenience: a working day, so a shared or lost computer is signed out by the next morning.
 */
export const INITIAL_RESUME_LIFETIME: ResumeLifetime = 28800;

export const RESUME_LIFETIME_COPY: Readonly<Record<ResumeLifetime, { label: string; detail: string }>> = {
  3600: { label: '1 hour', detail: 'For a computer you share or do not trust.' },
  28800: { label: '8 hours', detail: 'A working day.' },
  86400: { label: '24 hours', detail: 'Sign in once a day.' },
  604800: { label: '7 days', detail: 'For a computer only you use.' },
};

export const STAY_SIGNED_IN_COPY: { readonly heading: string; readonly intro: string; readonly appliesFrom: string; readonly groupLabel: string } = {
  heading: 'Stay signed in on this device',
  intro: 'If your connection to a workspace drops, Citadel signs you back in without your password or security key for this long after you sign in. After that it asks you to sign in again.',
  appliesFrom: 'A change applies from your next sign-in. A workspace may allow less than you choose. Changing your password, sign-in method or security keys signs every device out.',
  groupLabel: 'How long this device stays signed in',
};

const STORAGE_KEY: 'citadel:stay-signed-in-seconds' = 'citadel:stay-signed-in-seconds';

/** The preset `stored` names, or the initial one for anything else (nothing stored, or damage). */
export function resumeLifetimeOf(stored: string | null): ResumeLifetime {
  const seconds: number = Number(stored);
  const known: ResumeLifetime | undefined = RESUME_LIFETIME_CHOICES.find((choice: ResumeLifetime): boolean => choice === seconds);
  return known ?? INITIAL_RESUME_LIFETIME;
}

export function loadResumeLifetime(): ResumeLifetime {
  try {
    return resumeLifetimeOf(localStorage.getItem(STORAGE_KEY));
  } catch {
    // Storage that cannot be read (a private window) must not stop a sign-in.
    return INITIAL_RESUME_LIFETIME;
  }
}

export function saveResumeLifetime(lifetime: ResumeLifetime): void {
  localStorage.setItem(STORAGE_KEY, String(lifetime));
}
