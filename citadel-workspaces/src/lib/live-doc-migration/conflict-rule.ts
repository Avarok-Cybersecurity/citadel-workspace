/**
 * What a device does when it learns a peer's migration of the same chat document: the creator
 * wins, and a conflict is always reported, never resolved silently.
 *
 * Same origin (the same Yjs state vector) means the same snapshot bytes, so there is nothing to
 * resolve. Different origins mean the two devices migrated different Yjs states. The creator's
 * migration is the document; a non-creator keeps its own as a read-only conflicted copy, adopts
 * the creator's, and lists the edits only it had in its loss report. Non-creators may edit
 * before hearing from the creator (owner decision), so two non-creators that differ both wait
 * for the creator rather than either winning.
 */

/** Which side created the chat document. Neither: both sides are non-creators (a third party made it). */
export type CreatorSide = 'local' | 'peer' | 'neither';

export interface ConflictInput {
  /** This device's migration origin (migration-identity.ts). */
  readonly localOrigin: string;
  /** The peer's, or null when the peer has not said (it has not migrated, or runs an older build). */
  readonly peerOrigin: string | null;
  readonly creator: CreatorSide;
}

export type ConflictResolution =
  /** Nothing to compare yet: keep this device's migration. */
  | { readonly kind: 'keep-own'; readonly reason: 'peer-unknown' }
  /** Byte-identical snapshots: merging them is a no-op. */
  | { readonly kind: 'identical' }
  /** This device is the creator: its migration stands; the peer adopts it. */
  | { readonly kind: 'creator-keeps' }
  /** The peer is the creator: keep this migration as a conflicted copy, adopt the creator's, report the lost edits. */
  | { readonly kind: 'adopt-creator' }
  /** Neither side is the creator: keep this migration, reported as conflicted until the creator's arrives. */
  | { readonly kind: 'await-creator' };

export function resolveMigrationConflict({ localOrigin, peerOrigin, creator }: ConflictInput): ConflictResolution {
  if (peerOrigin === null) return { kind: 'keep-own', reason: 'peer-unknown' };
  if (peerOrigin === localOrigin) return { kind: 'identical' };
  switch (creator) {
    case 'local':
      return { kind: 'creator-keeps' };
    case 'peer':
      return { kind: 'adopt-creator' };
    case 'neither':
      return { kind: 'await-creator' };
  }
}

/** Whether a resolution is a conflict the person must be told about. */
export function isReportedConflict(resolution: ConflictResolution): boolean {
  return resolution.kind === 'adopt-creator' || resolution.kind === 'await-creator' || resolution.kind === 'creator-keeps';
}
