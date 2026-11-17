/**
 * The app's HeldEditsIO (leave-held-edits.ts): the account's records on this device, this
 * tab's link, a share-style sync of each document (lib/document-sync-requests.ts).
 */
import { documentsWithHeldEdits, type DocumentPlace } from '@/lib/document-replica-cache';
import { requestDocumentSync } from '@/lib/document-sync-requests';
import { reconnectingTo } from '@/lib/reconnect/server-reconnect';
import { mayLeaveHeldEdits, type HeldEditsIO } from './leave-held-edits';
import type { HeldEditsPrompt } from './leave-held-edits-prompt';

export type Confirm = (prompt: HeldEditsPrompt) => Promise<boolean>;

/**
 * For signing `account` out. `thisTabsAccount`: the tab is signed in as it, so its edits can
 * be sent from here; another account's session (the sessions strip) can only be asked about.
 */
export function heldEditsIO(account: bigint, thisTabsAccount: boolean, confirm: Confirm): HeldEditsIO {
  return {
    held: (): Promise<readonly DocumentPlace[]> => documentsWithHeldEdits(account),
    canSync: (): boolean => thisTabsAccount && reconnectingTo.get() === null,
    sync: (place: DocumentPlace): Promise<void> => requestDocumentSync(place),
    confirm,
  };
}

export function mayLeaveAccountHeldEdits(account: bigint, thisTabsAccount: boolean, confirm: Confirm): Promise<boolean> {
  return mayLeaveHeldEdits(heldEditsIO(account, thisTabsAccount, confirm));
}
