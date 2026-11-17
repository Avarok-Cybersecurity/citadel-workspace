// @vitest-environment node
/**
 * Two devices that migrated different Yjs states of one chat document: the creator's wins, the
 * non-creator keeps its own as a read-only conflicted copy, and the edits only it had are
 * counted against the creator's state vector and reported, never dropped silently.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { decode as cborDecode } from 'cbor-x';
import { MigrationRunner } from '../runner';
import { applyPeerMigration, type PeerMigration, type PeerMigrationOutcome } from '../peer-migration';
import { conflictLosses, decodeConflict, editsMissingFrom, type ConflictRecord } from '../conflict-record';
import type { MigrationMarker } from '../marker';
import { FakeLocalDb, type DbCall } from './fake-local-db';
import { chatYDoc, echoMapper, loaderOf, storeOriginal, STARTER_KIT_SAMPLE } from './fixtures';

const CREATOR: bigint = 1n;
const OTHER: bigint = 2n;
const DOC: string = 'shared-doc';
const keys: { readonly marker: string; readonly snapshot: string; readonly copy: string; readonly conflict: string } = { marker: `cdoc_migrated_${DOC}`, snapshot: `cdoc_snapshot_${DOC}`, copy: `cdoc_conflicted_${DOC}`, conflict: `cdoc_conflict_${DOC}` };
const EXTRA: string = 'extra!';

/** The creator's state, and the non-creator's: the same plus six characters only it typed. */
interface States { readonly creator: Y.Doc; readonly other: Y.Doc }
interface Device { readonly db: FakeLocalDb; readonly runner: MigrationRunner }

function states(): States {
  const creator: Y.Doc = chatYDoc(STARTER_KIT_SAMPLE, 'Plan');
  const other: Y.Doc = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(creator));
  const paragraph: Y.XmlElement = other.getXmlFragment('default').get(1) as Y.XmlElement;
  (paragraph.get(0) as Y.XmlText).insert(0, EXTRA);
  return { creator, other };
}

async function migratedOn(account: bigint, doc: Y.Doc): Promise<Device> {
  const db: FakeLocalDb = new FakeLocalDb();
  storeOriginal(db, DOC, doc, { holder: account, peer: account === CREATOR ? OTHER : CREATOR }, 'Plan');
  const runner: MigrationRunner = new MigrationRunner({ db, accountCid: account, loadMapper: loaderOf(echoMapper) });
  expect((await runner.migrateIfNeeded(DOC)).kind).toBe('migrated');
  return { db, runner };
}

async function announced(runner: MigrationRunner, doc: Y.Doc): Promise<PeerMigration> {
  const own: { readonly marker: MigrationMarker; readonly snapshot: Uint8Array } | null = await runner.readMigrated(DOC);
  if (own === null) throw new Error('not migrated');
  return { origin: own.marker.originYjsSvHash, stateVector: Y.encodeStateVector(doc), client: own.marker.client, snapshot: own.snapshot, reportJson: own.marker.reportJson };
}

const writes = (db: FakeLocalDb): string[] => db.calls.filter((c: DbCall): boolean => c.op === 'set').map((c: DbCall): string => c.key);

describe('a non-creator adopts the creator’s migration', () => {
  it('keeps its own as the conflicted copy, adopts the creator’s, and reports the six characters only it had', async () => {
    const { creator, other }: States = states();
    const a: Device = await migratedOn(CREATOR, creator);
    const b: Device = await migratedOn(OTHER, other);
    const ownSnapshot: number[] | undefined = b.db.peek(OTHER, keys.snapshot);
    const ownMarker: number[] | undefined = b.db.peek(OTHER, keys.marker);

    const outcome: PeerMigrationOutcome = await applyPeerMigration(b.runner, b.db, DOC, await announced(a.runner, creator), 'peer');
    expect(outcome).toMatchObject({ kind: 'resolved', resolution: { kind: 'adopt-creator' } });
    expect(b.db.peek(OTHER, keys.snapshot)).toEqual(a.db.peek(CREATOR, keys.snapshot));
    expect(b.db.peek(OTHER, keys.marker)).toEqual(a.db.peek(CREATOR, keys.marker));
    const copy: { marker: Uint8Array; snapshot: Uint8Array } = cborDecode(Uint8Array.from(b.db.peek(OTHER, keys.copy) ?? [])) as { marker: Uint8Array; snapshot: Uint8Array };
    expect(Array.from(copy.snapshot)).toEqual(ownSnapshot);
    expect(Array.from(copy.marker)).toEqual(ownMarker);

    const conflict: ConflictRecord = decodeConflict(Uint8Array.from(b.db.peek(OTHER, keys.conflict) ?? []));
    expect(conflict.lostEdits).toEqual([{ client: other.clientID, missing: EXTRA.length }]);
    expect(conflictLosses(conflict)).toMatchObject([{ kind: 'counted', count: EXTRA.length, severity: 'major' }]);
    expect(await b.runner.readConflict(DOC)).toEqual(conflict);
  });

  it('applying it again is a no-op: the marker now carries the creator’s origin', async () => {
    const { creator, other }: States = states();
    const a: Device = await migratedOn(CREATOR, creator);
    const b: Device = await migratedOn(OTHER, other);
    const peer: PeerMigration = await announced(a.runner, creator);
    await applyPeerMigration(b.runner, b.db, DOC, peer, 'peer');
    const before: number = writes(b.db).length;
    expect(await applyPeerMigration(b.runner, b.db, DOC, peer, 'peer')).toMatchObject({ resolution: { kind: 'identical' } });
    expect(writes(b.db)).toHaveLength(before);
  });

  it('a crash before the adopted marker reruns without overwriting the conflicted copy', async () => {
    const { creator, other }: States = states();
    const a: Device = await migratedOn(CREATOR, creator);
    const b: Device = await migratedOn(OTHER, other);
    const ownSnapshot: number[] | undefined = b.db.peek(OTHER, keys.snapshot);
    const peer: PeerMigration = await announced(a.runner, creator);
    b.db.failOnce('set', keys.marker, new Error('the tab closed'));
    await expect(applyPeerMigration(b.runner, b.db, DOC, peer, 'peer')).rejects.toThrow('the tab closed');
    await applyPeerMigration(b.runner, b.db, DOC, peer, 'peer');
    const copy: { snapshot: Uint8Array } = cborDecode(Uint8Array.from(b.db.peek(OTHER, keys.copy) ?? [])) as { snapshot: Uint8Array };
    expect(Array.from(copy.snapshot)).toEqual(ownSnapshot);
    expect(b.db.peek(OTHER, keys.marker)).toEqual(a.db.peek(CREATOR, keys.marker));
  });

  it('the creator keeps its own and records the conflict, writing nothing else', async () => {
    const { creator, other }: States = states();
    const a: Device = await migratedOn(CREATOR, creator);
    const b: Device = await migratedOn(OTHER, other);
    const snapshot: number[] | undefined = a.db.peek(CREATOR, keys.snapshot);
    const before: number = writes(a.db).length;
    const outcome: PeerMigrationOutcome = await applyPeerMigration(a.runner, a.db, DOC, await announced(b.runner, other), 'local');
    expect(outcome).toMatchObject({ resolution: { kind: 'creator-keeps' }, conflict: { lostEdits: [] } });
    expect(writes(a.db).slice(before)).toEqual([keys.conflict]);
    expect(a.db.peek(CREATOR, keys.snapshot)).toEqual(snapshot);
  });

  it('two devices with the same state resolve as identical and write nothing', async () => {
    const { creator }: States = states();
    const a: Device = await migratedOn(CREATOR, creator);
    const b: Device = await migratedOn(OTHER, creator);
    expect(b.db.peek(OTHER, keys.snapshot)).toEqual(a.db.peek(CREATOR, keys.snapshot));
    const before: number = writes(b.db).length;
    expect(await applyPeerMigration(b.runner, b.db, DOC, await announced(a.runner, creator), 'peer')).toMatchObject({ resolution: { kind: 'identical' } });
    expect(writes(b.db)).toHaveLength(before);
  });

  it('refuses an origin that is not the hash of the state vector sent with it', async () => {
    const { creator, other }: States = states();
    const a: Device = await migratedOn(CREATOR, creator);
    const b: Device = await migratedOn(OTHER, other);
    const lying: PeerMigration = { ...(await announced(a.runner, creator)), stateVector: Y.encodeStateVector(other) };
    await expect(applyPeerMigration(b.runner, b.db, DOC, lying, 'peer')).rejects.toThrow(/not the hash/);
  });

  it('says so when this device has not migrated the document yet', async () => {
    const { creator }: States = states();
    const a: Device = await migratedOn(CREATOR, creator);
    const db: FakeLocalDb = new FakeLocalDb();
    const runner: MigrationRunner = new MigrationRunner({ db, accountCid: OTHER, loadMapper: loaderOf(echoMapper) });
    expect(await applyPeerMigration(runner, db, DOC, await announced(a.runner, creator), 'peer')).toEqual({ kind: 'not-migrated-here' });
  });
});

describe('edits counted against the creator’s state vector', () => {
  it('counts per client only what the creator lacks', () => {
    // encodeStateVector of a Map: the same layout Yjs writes for a document's state vector.
    const sv = (entries: Array<[number, number]>): Uint8Array => Y.encodeStateVector(new Map(entries));
    expect(editsMissingFrom(sv([[1, 10], [2, 4]]), sv([[1, 10], [2, 1]]))).toEqual([{ client: 2, missing: 3 }]);
    expect(editsMissingFrom(sv([[3, 5]]), sv([]))).toEqual([{ client: 3, missing: 5 }]);
    expect(editsMissingFrom(sv([[1, 2]]), sv([[1, 9]]))).toEqual([]);
  });
});
