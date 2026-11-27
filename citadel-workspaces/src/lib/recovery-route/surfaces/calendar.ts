/**
 * Ways out of a Calendar panel whose data could not be read (RECOVERY-DESIGN.md §1 item 9): the
 * panel says what and why, and reads it again on Try again, instead of ending there. An engine
 * that did not load cannot be read again in place, so that one reloads.
 */
import type { DeclaredPlan } from '../route';

export const CALENDAR_SURFACES = {
  'calendar.unreadable': { cause: 'environment', presentation: 'inline', primary: { kind: 'retry' }, alternatives: [] },
  'calendar.engine-failed': { cause: 'ours', presentation: 'inline', primary: { kind: 'reload' }, alternatives: [] },
} as const satisfies Record<string, DeclaredPlan>;
