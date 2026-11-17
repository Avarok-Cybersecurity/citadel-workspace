/** What encryption at rest says to the person, in one place: the switch, Settings, refusals, locks. */

export const AT_REST_LABEL: string = 'Encrypt on this device';

/** The switch's tooltip and the Settings entry: what it protects, and what it does not replace. */
export const AT_REST_EXPLANATION: string =
  'Protects the copies of your documents this browser stores, so someone holding only this browser\'s data cannot read them. It is not a substitute for full-disk encryption.';

export const AT_REST_REFUSED_UNREACHABLE: string =
  'Encryption was not turned on: the Citadel agent on this device did not answer. Nothing was changed; try again once it is running.';

export const AT_REST_REFUSED_LOCKED: string =
  'Encryption was not turned off: some copies on this device are locked and cannot be decrypted here. Remove them from the document first.';

/** A record this device holds but cannot open now. */
export const LOCKED_ON_DEVICE: string = 'Locked on this device';

export const LOCKED_SYNC_FROM_SERVER: string = 'Sync from server';
export const LOCKED_DISCARD: string = 'Discard';

/** Asked before a locked document's copies are removed; edits never sent are named when there are any. */
export function lockedRemovalQuestion(name: string, unsentEdits: boolean): string {
  const loss: string = unsentEdits ? ' Edits to it that were never sent are among them and will be lost.' : '';
  return `The copies of ${name} kept on this device are locked and cannot be opened here.${loss} Remove them?`;
}
