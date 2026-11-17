/**
 * Whether an inbound operation actually took effect.
 *
 * `applyRemoteOp` returned the tree unchanged for every refusal — a missing
 * parent, a protected path, an occupied destination — and the caller
 * acknowledged `success: true` regardless. The sender then cleared the op from
 * its retry queue for something that never happened, leaving two trees
 * permanently divergent and both believing they were correct.
 *
 * `applied: true` means the intended end state now holds. That includes the one
 * idempotent case — an Mkdir for a directory that already exists has achieved
 * what it asked for. Every other early return could not do what it was asked and
 * says so, so the sender can retry it (bounded by MAX_OP_RETRIES) instead of
 * assuming it landed.
 *
 * Its own module because both `tree-sync` and `tree-relocation` return it, and
 * a shared type that lives in one of two peers invites an import cycle.
 */
import type { RevfsNode } from '@/types/revfs-types';

export interface RemoteOpOutcome {
  tree: RevfsNode;
  applied: boolean;
}

export const refused = (tree: RevfsNode): RemoteOpOutcome => ({ tree, applied: false });
export const applied = (tree: RevfsNode): RemoteOpOutcome => ({ tree, applied: true });
