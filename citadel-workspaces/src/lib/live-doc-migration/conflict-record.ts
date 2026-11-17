/**
 * What a migration conflict leaves behind, `cdoc_conflict_<id>`: whose migration won, and the
 * Yjs edits only this device had, counted against the creator's Yjs state vector. Shown in the
 * loss report as a major loss, because it is content the adopted document does not have.
 */
import * as Y from 'yjs';
import { encode as cborEncode, decode as cborDecode } from 'cbor-x';
import type { ConversionLoss } from '@/lib/cdoc/editor/file-formats';
import type { ConflictResolution } from './conflict-rule';
import { LOST_EDITS_LABEL, LOST_EDITS_PART, LOST_EDITS_WHAT } from './migration-copy';

export const CONFLICT_VERSION: 1 = 1;

/** Edits by one Yjs client that the creator's state does not contain. */
export interface MissingEdits {
  readonly client: number;
  /** Yjs clock units (one per inserted character or embedded item, deleted ones included). */
  readonly missing: number;
}

export interface ConflictRecord {
  readonly v: typeof CONFLICT_VERSION;
  /** 'held-apart': the creator is the peer, whose copy cannot be adopted over the chat (held-apart.ts). */
  readonly resolution: Exclude<ConflictResolution['kind'], 'keep-own' | 'identical'> | 'held-apart';
  readonly localOrigin: string;
  /** Null when the peer's copy was never moved (it opened as a new document). */
  readonly peerOrigin: string | null;
  /** Empty unless this device adopted the creator's migration. */
  readonly lostEdits: readonly MissingEdits[];
}

/** Per client, how far `local` is ahead of `creator`: the edits the creator never saw. */
export function editsMissingFrom(localStateVector: Uint8Array, creatorStateVector: Uint8Array): MissingEdits[] {
  const creator: Map<number, number> = Y.decodeStateVector(creatorStateVector);
  const out: MissingEdits[] = [];
  for (const [client, clock] of Y.decodeStateVector(localStateVector)) {
    const missing: number = clock - (creator.get(client) ?? 0);
    if (missing > 0) out.push({ client, missing });
  }
  return out.sort((a: MissingEdits, b: MissingEdits): number => a.client - b.client);
}

export function lostEditCount(record: ConflictRecord): number {
  return record.lostEdits.reduce((sum: number, e: MissingEdits): number => sum + e.missing, 0);
}

/** The conflict's entry in the loss report; none when nothing of this device's was left out. */
export function conflictLosses(record: ConflictRecord): ConversionLoss[] {
  const count: number = lostEditCount(record);
  if (count === 0) return [];
  return [{ kind: 'counted', part: LOST_EDITS_PART, what: LOST_EDITS_WHAT, count, severity: 'major', label: LOST_EDITS_LABEL }];
}

export function encodeConflict(record: ConflictRecord): Uint8Array {
  return Uint8Array.from(cborEncode(record));
}

const RESOLUTIONS: readonly ConflictRecord['resolution'][] = ['creator-keeps', 'adopt-creator', 'await-creator', 'held-apart'];

const isMissingEdits = (value: unknown): value is MissingEdits =>
  typeof value === 'object' && value !== null && Number.isSafeInteger((value as MissingEdits).client) && Number.isSafeInteger((value as MissingEdits).missing) && (value as MissingEdits).missing > 0;

export function decodeConflict(bytes: Uint8Array): ConflictRecord {
  const value: unknown = cborDecode(bytes);
  if (typeof value !== 'object' || value === null) throw new Error('unreadable migration conflict: not a record');
  const f: Record<string, unknown> = value as Record<string, unknown>;
  const resolution: ConflictRecord['resolution'] | undefined = RESOLUTIONS.find((r: ConflictRecord['resolution']): boolean => r === f.resolution);
  if (f.v !== CONFLICT_VERSION || resolution === undefined || typeof f.localOrigin !== 'string' || (f.peerOrigin !== null && typeof f.peerOrigin !== 'string')
    || !Array.isArray(f.lostEdits) || !f.lostEdits.every(isMissingEdits)) {
    throw new Error('unreadable migration conflict');
  }
  return { v: CONFLICT_VERSION, resolution, localOrigin: f.localOrigin, peerOrigin: f.peerOrigin, lostEdits: f.lostEdits };
}
