/**
 * Ways out of failures that belong to no one feature: the app crashing, its boot failing, a load
 * that read as "nothing here", a panel that could not be read.
 */
import type { DeclaredPlan } from '../route';

export const GENERAL_SURFACES = {
  /** The top-level boundary caught a render crash. */
  'app.crash': { cause: 'ours', presentation: 'page', primary: { kind: 'reload' }, alternatives: [] },
  /** main.tsx could not start React; rendered before React exists (dom-fallback.ts). */
  'app.boot-failed': { cause: 'ours', presentation: 'page', primary: { kind: 'reload' }, alternatives: [] },
  /** A panel's data could not be read: try again in place, without reopening anything. */
  'panel.unreadable': { cause: 'ours', presentation: 'inline', primary: { kind: 'retry' }, alternatives: [] },
  /** A list's load failed: shown instead of an empty list, which would be untrue. */
  'list.load-failed': { cause: 'ours', presentation: 'inline', primary: { kind: 'retry' }, alternatives: [] },
  /** An operation the person asked for failed on our side or the server's. */
  'action.failed': { cause: 'ours', presentation: 'toast', primary: { kind: 'retry' }, alternatives: [] },
} as const satisfies Record<string, DeclaredPlan>;
