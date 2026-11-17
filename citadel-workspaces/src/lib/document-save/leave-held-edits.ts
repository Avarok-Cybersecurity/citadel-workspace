/**
 * Asking before a sign-out deletes edits that exist only on this device. Signing out removes
 * every document record the account has here (no decrypted copy outlives it), so edits not
 * yet sent go too. When this tab can reach the server, sending them first is offered; what is
 * still held after that (or with no way to send it) is deleted only on an explicit yes.
 *
 * The one seam for that decision (an owner choice still open): the callers ask
 * `mayLeaveHeldEdits` and act on its answer; the wording is leave-held-edits-prompt.ts.
 */
import type { DocumentPlace } from '@/lib/document-replica-cache';
import { discardHeldEditsPrompt, syncHeldEditsPrompt, type HeldEditsPrompt } from './leave-held-edits-prompt';

export interface HeldEditsIO {
  /** The documents the account has edits held of here: pages, and documents shared in a node's chat. */
  held(): Promise<readonly DocumentPlace[]>;
  /** Whether this tab can send them now (signed in as that account, link up); false for another account's session. */
  canSync(): boolean;
  sync(place: DocumentPlace): Promise<void>;
  confirm(prompt: HeldEditsPrompt): Promise<boolean>;
}

/** True when the sign-out may go ahead: nothing held, everything sent, or deleting it confirmed. */
export async function mayLeaveHeldEdits(io: HeldEditsIO): Promise<boolean> {
  let held: readonly DocumentPlace[] = await io.held();
  if (held.length === 0) return true;
  if (io.canSync() && (await io.confirm(syncHeldEditsPrompt(held.length)))) {
    // Each document is tried; one that fails stays held and is asked about below.
    await Promise.allSettled(held.map((place: DocumentPlace): Promise<void> => io.sync(place)));
    held = await io.held();
    if (held.length === 0) return true;
  }
  return io.confirm(discardHeldEditsPrompt(held.length));
}
