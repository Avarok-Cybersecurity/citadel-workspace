/**
 * Acting on a peer's migration of the same chat document (conflict-rule.ts decides; this
 * writes). The creator's migration wins: a non-creator keeps its own migrated replica as a
 * read-only conflicted copy, adopts the creator's snapshot and marker, and records the Yjs
 * edits only it had, so its loss report lists them.
 *
 * Crash-safe in order: the conflicted copy first and only once (a rerun never overwrites it
 * with the creator's bytes), then the conflict record, the creator's snapshot, and last the
 * marker. Once the marker carries the creator's origin, a rerun resolves as identical.
 */
import { readStoredDocument } from '@/lib/live-document-store/stored-reads';
import type { StoredDocument } from '@/lib/live-document-store/types';
import { encode as cborEncode } from 'cbor-x';
import { AccountMigrationStore, migrationKeys, type MigrationLocalDb } from './account-store';
import { encodeMarker, MARKER_VERSION, type MigrationMarker } from './marker';
import { resolveMigrationConflict, type ConflictResolution, type CreatorSide } from './conflict-rule';
import { CONFLICT_VERSION, editsMissingFrom, encodeConflict, type ConflictRecord, type MissingEdits } from './conflict-record';
import { sha256Hex } from './migration-identity';
import { decodeYjsState } from './yjs-walker';
import * as Y from 'yjs';
import type { MigrationRunner } from './runner';

/** What a peer says about its migration; `snapshot`, `client` and `reportJson` are needed only to adopt it. */
export interface PeerMigration {
  readonly origin: string;
  /** The Yjs state vector the peer migrated from (its origin is this vector's hash). */
  readonly stateVector: Uint8Array;
  readonly client: bigint;
  readonly snapshot: Uint8Array;
  readonly reportJson: string;
}

export type PeerMigrationOutcome =
  | { readonly kind: 'not-migrated-here' }
  | { readonly kind: 'resolved'; readonly resolution: ConflictResolution; readonly conflict: ConflictRecord | null };

async function localStateVector(db: MigrationLocalDb, docId: string): Promise<Uint8Array> {
  const original: StoredDocument | null = await readStoredDocument(db, docId);
  if (original === null) throw new Error(`the original of ${docId} is not on this device, so its own edits cannot be counted`);
  const doc: Y.Doc = decodeYjsState(Uint8Array.from(original.state));
  try {
    return Y.encodeStateVector(doc);
  } finally {
    doc.destroy();
  }
}

export async function applyPeerMigration(
  runner: MigrationRunner, db: MigrationLocalDb, docId: string, peer: PeerMigration, creator: CreatorSide,
): Promise<PeerMigrationOutcome> {
  if ((await sha256Hex(peer.stateVector)) !== peer.origin) throw new Error('the peer’s migration origin is not the hash of its state vector');
  const local: MigrationMarker | null = await runner.readMarker(docId);
  if (local === null) return { kind: 'not-migrated-here' };
  const resolution: ConflictResolution = resolveMigrationConflict({ localOrigin: local.originYjsSvHash, peerOrigin: peer.origin, creator });
  if (resolution.kind === 'keep-own' || resolution.kind === 'identical') return { kind: 'resolved', resolution, conflict: null };

  const store: AccountMigrationStore = new AccountMigrationStore(db, runner.accountCid);
  const keys: ReturnType<typeof migrationKeys> = migrationKeys(docId);
  const lostEdits: MissingEdits[] = resolution.kind === 'adopt-creator' ? editsMissingFrom(await localStateVector(db, docId), peer.stateVector) : [];
  const conflict: ConflictRecord = { v: CONFLICT_VERSION, resolution: resolution.kind, localOrigin: local.originYjsSvHash, peerOrigin: peer.origin, lostEdits };

  if (resolution.kind === 'adopt-creator') {
    if ((await store.get(keys.conflictedCopy)) === null) {
      const own: { readonly marker: MigrationMarker; readonly snapshot: Uint8Array } | null = await runner.readMigrated(docId);
      if (own === null) throw new Error(`the migration of ${docId} vanished while a conflict was being resolved`);
      await store.set(keys.conflictedCopy, Uint8Array.from(cborEncode({ marker: encodeMarker(own.marker), snapshot: own.snapshot })));
    }
    await store.set(keys.conflict, encodeConflict(conflict));
    await store.set(keys.snapshot, peer.snapshot);
    const adopted: MigrationMarker = {
      v: MARKER_VERSION, originYjsSvHash: peer.origin, client: peer.client, snapshotSha256: await sha256Hex(peer.snapshot), reportJson: peer.reportJson,
    };
    await store.set(keys.marker, encodeMarker(adopted));
  } else {
    await store.set(keys.conflict, encodeConflict(conflict));
  }
  return { kind: 'resolved', resolution, conflict };
}
