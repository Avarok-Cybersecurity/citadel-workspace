/**
 * What a reload does to a transfer that was still moving. Pure.
 *
 * A reload ended every such transfer with "Interrupted when the page reloaded.
 * Ask them to send it again." -- on the SENDER's own bubble too, which told
 * them to ask themselves. But the page is not where a transfer lives. The agent
 * is a separate process and keeps the session across a reload, so an offer it
 * sent is still waiting for its answer, and bytes it was moving are still
 * moving; its ticks name the request that started them (tick_updater.rs) and
 * reach whichever page is attached. The page had only forgotten that name.
 *
 * So, in order of preference:
 *   - reattach: the agent holds the transfer, and we kept the request id its
 *     ticks carry (or, for an offer we have not answered, the object_id Accept
 *     names). Nothing is sent again.
 *   - resend: the agent never confirmed a send (it was still being staged), and
 *     this browser kept the bytes. It goes again by itself, under the same
 *     transfer id, when the peer can be reached (send-queue-hold.ts).
 *   - lost: nothing to reattach to and nothing kept. The sender is told so, in
 *     plain words, and offered a one-click resend; the receiver is told the
 *     download stopped. Nobody is told to ask anybody.
 */
import type { FileTransfer } from './types';

export type ReloadRecovery = 'reattach' | 'resend' | 'lost';

/** The sender's bubble, when nothing was kept to send again. */
export const LOST_SEND_REASON: string =
  'The page reloaded before this file was sent, and this browser could not keep a copy to send it again by itself.';

/** The receiver's bubble, when the download cannot be followed any more. */
export const LOST_RECEPTION_REASON: string = 'The download stopped when the page reloaded.';

/** The recipient's bubble, for an offer whose answer can no longer be given here. */
export const LOST_OFFER_REASON: string = 'This offer arrived before the page reloaded and can no longer be answered here.';

/** How a transfer that was moving (not terminal, not held) comes back. */
export function reloadRecovery(t: Pick<FileTransfer, 'isIncoming' | 'state' | 'tickRequestId' | 'objectId' | 'bytesKept'>): ReloadRecovery {
  if (t.isIncoming) {
    // An unanswered offer needs its object_id; one we accepted, its stream's id.
    const handle: string | undefined = t.state === 'pending' ? t.objectId : t.tickRequestId;
    return handle !== undefined ? 'reattach' : 'lost';
  }
  if (t.state !== 'preparing' && t.tickRequestId !== undefined) return 'reattach';
  return t.bytesKept === true ? 'resend' : 'lost';
}
