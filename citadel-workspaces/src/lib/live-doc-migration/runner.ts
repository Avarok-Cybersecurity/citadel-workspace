/**
 * Migrates one chat document, once per device and account: original (cid 0, read only) ->
 * walker -> mapper -> snapshot, then the marker.
 *
 * The order is the idempotency. The marker is written AFTER the snapshot, so a marker always
 * names a stored snapshot; a crash between the two leaves no marker, and the rerun derives the
 * same client id from the same state and writes the same bytes again. A failed read anywhere
 * aborts this document's migration with the stage that failed: an unreadable original is never
 * "no original", and an unreadable marker is never "not migrated".
 */
import { readStoredDocument } from '@/lib/live-document-store/stored-reads';
import type { StoredDocument } from '@/lib/live-document-store/types';
import { readConversionReport } from '@/lib/cdoc/conversion-report';
import { AccountMigrationStore, migrationKeys, type MigrationLocalDb } from './account-store';
import { decodeMarker, encodeMarker, MARKER_VERSION, type MigrationMarker } from './marker';
import { migrationIdentity, sha256Hex, type MigrationIdentity } from './migration-identity';
import { documentOwnership, type Ownership } from './ownership';
import { walkYjsState, type WalkedDocument } from './yjs-walker';
import type { MappedSnapshot, MapperLoader, MigrationMapper } from './mapper-port';
import { decodeConflict, type ConflictRecord } from './conflict-record';

export type FailedStage = 'read-marker' | 'read-original' | 'walk' | 'map' | 'write';

export type MigrationOutcome =
  | { readonly kind: 'migrated'; readonly marker: MigrationMarker; readonly title: string }
  | { readonly kind: 'already'; readonly marker: MigrationMarker }
  /** The agent says this device holds no such document (the key is absent). */
  | { readonly kind: 'no-original' }
  | { readonly kind: 'not-owned'; readonly reason: string }
  /** This build's engine has no StarterKit mapper: nothing written, migrated once one ships. */
  | { readonly kind: 'mapper-unavailable' }
  | { readonly kind: 'failed'; readonly stage: FailedStage; readonly message: string };

export interface MigrationDeps {
  readonly db: MigrationLocalDb;
  readonly accountCid: bigint;
  readonly loadMapper: MapperLoader;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

type Step<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly outcome: MigrationOutcome };

async function step<T>(stage: FailedStage, run: () => Promise<T> | T): Promise<Step<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, outcome: { kind: 'failed', stage, message: messageOf(error) } };
  }
}

export class MigrationRunner {
  private readonly store: AccountMigrationStore;
  private readonly inFlight: Map<string, Promise<MigrationOutcome>> = new Map();

  constructor(private readonly deps: MigrationDeps) {
    this.store = new AccountMigrationStore(deps.db, deps.accountCid);
  }

  get accountCid(): bigint {
    return this.store.accountCid;
  }

  /** Single-flight per document: the lazy open and the sweep share one run. */
  migrateIfNeeded(docId: string): Promise<MigrationOutcome> {
    const running: Promise<MigrationOutcome> | undefined = this.inFlight.get(docId);
    if (running) return running;
    const run: Promise<MigrationOutcome> = this.migrate(docId).finally((): void => {
      this.inFlight.delete(docId);
    });
    this.inFlight.set(docId, run);
    return run;
  }

  /** The stored marker, or null when this account has not migrated the document. */
  async readMarker(docId: string): Promise<MigrationMarker | null> {
    const bytes: Uint8Array | null = await this.store.get(migrationKeys(docId).marker);
    return bytes === null ? null : decodeMarker(bytes);
  }

  /** The migrated snapshot the marker names, checked against the marker's hash; null when not migrated. */
  async readMigrated(docId: string): Promise<{ readonly marker: MigrationMarker; readonly snapshot: Uint8Array } | null> {
    const marker: MigrationMarker | null = await this.readMarker(docId);
    if (marker === null) return null;
    const snapshot: Uint8Array | null = await this.store.get(migrationKeys(docId).snapshot);
    if (snapshot === null) throw new Error(`the migration marker of ${docId} names a snapshot that is not stored`);
    if ((await sha256Hex(snapshot)) !== marker.snapshotSha256) throw new Error(`the stored snapshot of ${docId} is not the one its marker names`);
    return { marker, snapshot };
  }

  /** The conflict this account recorded for the document, or null when there was none. */
  async readConflict(docId: string): Promise<ConflictRecord | null> {
    const bytes: Uint8Array | null = await this.store.get(migrationKeys(docId).conflict);
    return bytes === null ? null : decodeConflict(bytes);
  }

  /**
   * The original, walked, for "Show original": null when this device holds none; refused for
   * a document of another account. A failed read is rethrown, never null.
   */
  async readOriginal(docId: string): Promise<{ readonly walked: WalkedDocument; readonly title: string } | null> {
    const stored: StoredDocument | null = await readStoredDocument(this.deps.db, docId);
    if (stored === null) return null;
    const ownership: Ownership = documentOwnership(stored.metadata, this.store.accountCid);
    if (ownership.kind === 'not-owned') throw new Error(ownership.reason);
    return { walked: walkYjsState(Uint8Array.from(stored.state)), title: stored.metadata.title };
  }

  private async migrate(docId: string): Promise<MigrationOutcome> {
    const marked: Step<MigrationMarker | null> = await step('read-marker', () => this.readMarker(docId));
    if (!marked.ok) return marked.outcome;
    if (marked.value !== null) return { kind: 'already', marker: marked.value };

    const original: Step<StoredDocument | null> = await step('read-original', () => readStoredDocument(this.deps.db, docId));
    if (!original.ok) return original.outcome;
    if (original.value === null) return { kind: 'no-original' };
    const ownership: Ownership = documentOwnership(original.value.metadata, this.store.accountCid);
    if (ownership.kind === 'not-owned') return { kind: 'not-owned', reason: ownership.reason };

    const stored: StoredDocument = original.value;
    const walked: Step<WalkedDocument> = await step('walk', () => walkYjsState(Uint8Array.from(stored.state)));
    if (!walked.ok) return walked.outcome;
    const identity: Step<MigrationIdentity> = await step('walk', () => migrationIdentity(docId, walked.value.stateVector));
    if (!identity.ok) return identity.outcome;

    const mapper: Step<MigrationMapper | null> = await step('map', () => this.deps.loadMapper());
    if (!mapper.ok) return mapper.outcome;
    if (mapper.value === null) return { kind: 'mapper-unavailable' };
    const engine: MigrationMapper = mapper.value;
    const mapped: Step<MappedSnapshot> = await step('map', (): MappedSnapshot => {
      const result: MappedSnapshot = engine.toSnapshot(JSON.stringify(walked.value.pm), identity.value.client);
      const { report, problems } = JSON.parse(result.reportJson) as { report: unknown; problems: unknown };
      readConversionReport(report, problems);
      return result;
    });
    if (!mapped.ok) return mapped.outcome;

    const marker: MigrationMarker = {
      v: MARKER_VERSION,
      originYjsSvHash: identity.value.origin,
      client: identity.value.client,
      snapshotSha256: await sha256Hex(mapped.value.snapshot),
      reportJson: mapped.value.reportJson,
    };
    const keys: ReturnType<typeof migrationKeys> = migrationKeys(docId);
    const written: Step<void> = await step('write', async (): Promise<void> => {
      await this.store.set(keys.snapshot, mapped.value.snapshot);
      await this.store.set(keys.marker, encodeMarker(marker));
    });
    if (!written.ok) return written.outcome;
    return { kind: 'migrated', marker, title: walked.value.title ?? stored.metadata.title };
  }
}
