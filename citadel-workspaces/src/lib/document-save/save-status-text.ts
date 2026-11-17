/**
 * What the title bar says for each SaveStatus: the one place the wording lives. `label` is the
 * state in a few words (shown as text for every state but the quiet ones, and always the
 * indicator's accessible name); `short` is what a phone-width title bar has room to draw (null:
 * the icon alone); `detail` is what it means and what to do, on hover, focus and a tap.
 */
import type { SaveStatus } from './save-status';
import { LOCKED_ON_DEVICE } from '@/lib/at-rest/at-rest-copy';

export interface SaveStatusWords {
  readonly label: string;
  readonly short: string | null;
  readonly detail: string;
}

export const SAVE_STATUS_TEXT: Readonly<Record<SaveStatus, SaveStatusWords>> = {
  saved: { label: 'All changes saved', short: null, detail: 'Every change you have made is saved.' },
  saving: { label: 'Saving…', short: null, detail: 'Your latest changes are being saved.' },
  offline: { label: 'Offline', short: 'Offline', detail: 'Changes are kept on this device and will sync when you\'re back online.' },
  savedToDevice: { label: 'Saved to this device', short: null, detail: 'AutoSave is off: changes stay on this device until you press Save.' },
  unsavedOnDevice: { label: 'Not saved to this device', short: 'Not saved', detail: 'This device could not keep a copy of your latest changes. Closing the page now loses them.' },
  refused: { label: 'Not saved', short: 'Not saved', detail: 'The server did not accept your latest changes. They are kept on this device.' },
  locked: { label: LOCKED_ON_DEVICE, short: 'Locked', detail: 'Copies of this document kept on this device are sealed and cannot be opened here.' },
};

/** The action offered when this device's copy could not be written: write it again. */
export const RETRY_DEVICE_WRITE_TEXT: string = 'Try again';

/** A request the server will take later keeps being refused: nothing is wrong, and it is retried. */
export const SENDING_PAUSED_TEXT: string = 'Sending paused, retrying…';
