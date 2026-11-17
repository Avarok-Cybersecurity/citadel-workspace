/**
 * Saying what actually happened to a file-manager operation.
 *
 * A peer operation has two halves. The local tree is changed and persisted
 * immediately; the peer is told separately and may not answer. `sendAndAwaitAck`
 * reports that second half, and every layer above it used to be `Promise<void>`,
 * so the handlers announced "Renamed", "Deleted", "Pasted" on the strength of
 * the local half alone -- for peers that never heard of the change.
 *
 * The unacknowledged case is NOT a failure: the operation is queued and retried
 * up to MAX_OP_RETRIES, and the local half is durable. Calling it "Failed"
 * would send the user looking for damage that is not there. It is also not a
 * success worth a tick, because the thing they were doing -- putting a file
 * where their peer can see it -- has not happened yet.
 *
 * The wording lives here rather than at each call site so all six operations
 * say it the same way.
 */
import { toast } from 'sonner';

export function reportDelivery(acknowledged: boolean, done: string): void {
  if (acknowledged) {
    toast.success(done);
    return;
  }
  toast.error('Not confirmed by the peer yet', {
    description: `${done} on this device. Your peer has not acknowledged it; it will be retried automatically.`,
  });
}
