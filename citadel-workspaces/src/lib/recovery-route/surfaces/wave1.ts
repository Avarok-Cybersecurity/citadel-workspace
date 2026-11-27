/**
 * The first migration wave (RECOVERY-DESIGN.md §1.4): the dead ends that blocked people hardest.
 */
import type { DeclaredPlan } from '../route';

export const WAVE1_SURFACES = {
  /** A call that failed: call again, instead of a title and a detail with nothing to press. */
  'call.failed': { cause: 'environment', presentation: 'inline', primary: { kind: 'retry' }, alternatives: [] },
  /** The calling runtime did not load: the toast said "Reload the page" with no reload. */
  'call.system-unavailable': { cause: 'ours', presentation: 'toast', primary: { kind: 'reload' }, alternatives: [] },
  /** A peer has not offered remote storage: ask them, rather than a button that only toasted. */
  'files.remote-storage-off.peer': { cause: 'peer', presentation: 'modal', primary: { kind: 'contact-member', about: 'storage-peer' }, alternatives: [] },
  /** The server does not offer remote storage: an admin can turn it on. */
  'files.remote-storage-off.server': { cause: 'policy', presentation: 'modal', primary: { kind: 'ask-admin', request: 'remote-storage' }, alternatives: [] },
  /** Registration failed: say why and offer the attempt again, not only Dismiss. */
  'join.registration-failed': { cause: 'ours', presentation: 'modal', primary: { kind: 'retry' }, alternatives: [] },
} as const satisfies Record<string, DeclaredPlan>;
