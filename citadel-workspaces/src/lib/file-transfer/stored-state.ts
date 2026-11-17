/**
 * A transfer's state as the agent's conversation store holds it, and back. Pure.
 *
 * The store's `TransferState` is the agent's enum (citadel-internal-service-types
 * conversation.rs), which every installed agent must parse: it has no 'queued' or
 * 'preparing', and still has the retired 'uploading' and 'staged'. Those two
 * browser-only states are what the transfer record shows; the stored entry says
 * 'pending' for them, which an agent of any version reads. The record is the
 * authority on state whenever it exists (transfer-view.ts).
 */
import type { FileTransferState } from '@/types/messaging-layer';
import type { P2PMessage } from '@/lib/p2p/p2p-types';

export type StoredTransferState = NonNullable<P2PMessage['transfer_state']>;

export function toStoredState(state: FileTransferState): StoredTransferState {
  switch (state) {
    case 'queued':
    case 'preparing':
      return 'pending';
    default:
      return state;
  }
}

/** An entry from an older page or agent: a retired state is an offer that can no longer be answered. */
export function fromStoredState(state: StoredTransferState): FileTransferState {
  switch (state) {
    case 'uploading':
    case 'staged':
      return 'expired';
    default:
      return state;
  }
}
