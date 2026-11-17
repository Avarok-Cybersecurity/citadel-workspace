/** What a chat's document pane says when a document opens other than as a live canvas, in one place. */
import type { FailedStage } from '@/lib/live-doc-migration/runner';

/** Why a stage failed, as a clause: "… could not be moved to the new editor: <clause>." ('load': opened). */
const STAGES: { readonly [K in FailedStage | 'open' | 'load']: string } = {
  'read-marker': 'this device’s record of the move could not be read',
  'read-original': 'the original could not be read from this device',
  walk: 'the original could not be read as a document',
  map: 'the new editor could not convert it',
  write: 'the moved copy could not be saved on this device',
  open: 'the moved copy on this device could not be opened',
  load: 'the editor did not load',
};

export type UnmovedReason =
  | { readonly kind: 'not-stored' }
  | { readonly kind: 'not-owned' }
  | { readonly kind: 'no-converter' }
  | { readonly kind: 'failed'; readonly stage: FailedStage | 'open' | 'load'; readonly message: string }
  | { readonly kind: 'no-account' };

export interface UnmovedCopy {
  readonly heading: string;
  readonly body: string;
}

export const ORIGINAL_KEPT: string = 'The original is kept, unchanged, and can be read here.';

export function unmovedCopy(reason: UnmovedReason, title: string, peerName: string): UnmovedCopy {
  switch (reason.kind) {
    case 'not-stored':
      return {
        heading: 'This document is not on this device',
        body: `“${title}” was made in the earlier chat editor and was never opened on this device, so there is nothing here to move to the new editor. ${peerName} still has their copy.`,
      };
    case 'not-owned':
      return {
        heading: 'This document belongs to another account',
        body: `The copy of “${title}” on this device belongs to another account signed in here, so it is not opened for this one.`,
      };
    case 'no-converter':
      return {
        heading: 'This document cannot be moved yet',
        body: `“${title}” was made in the earlier chat editor, and this version of the app cannot move it to the new editor. ${ORIGINAL_KEPT}`,
      };
    case 'failed':
      if (reason.stage === 'load') {
        return { heading: 'This document could not be opened', body: `“${title}” could not be opened: ${STAGES.load} (${reason.message}).` };
      }
      return {
        heading: 'This document could not be moved',
        body: `“${title}” could not be moved to the new editor: ${STAGES[reason.stage]} (${reason.message}). ${ORIGINAL_KEPT}`,
      };
    case 'no-account':
      return {
        heading: 'This document cannot open yet',
        body: 'Documents open once your session has finished signing in.',
      };
  }
}

/** Whether the pane offers the original for a reason: never another account's, never with nothing to read it with. */
export function offersOriginal(reason: UnmovedReason): boolean {
  return reason.kind === 'no-converter' || (reason.kind === 'failed' && reason.stage !== 'load');
}
