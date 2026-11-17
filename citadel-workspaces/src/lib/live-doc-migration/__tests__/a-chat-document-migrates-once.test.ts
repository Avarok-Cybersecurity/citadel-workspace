// @vitest-environment node
/**
 * The runner end to end over LocalDB (the one fake, fake-local-db.ts): real stored documents,
 * the real walker and identity, the real account store and marker codec. The mapper is the
 * deterministic stand-in until the engine's StarterKit importer is vendored.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { MigrationRunner, type MigrationOutcome } from '../runner';
import { decodeMarker, type MigrationMarker } from '../marker';
import { migrationIdentity } from '../migration-identity';
import { FakeLocalDb, timedOut, type DbCall } from './fake-local-db';
import { chatYDoc, echoMapper, loaderOf, storeOriginal, STARTER_KIT_SAMPLE, type Participants } from './fixtures';
import type { MapperLoader, MigrationMapper } from '../mapper-port';

const ALICE: bigint = 9_007_199_254_740_993n; // above 2^53: a cid that only survives as a bigint
const BOB: bigint = 22n;
const CAROL: bigint = 33n;
const CHAT: Participants = { holder: ALICE, peer: BOB };
const DOC: string = 'doc-1';
const MARKER: string = `cdoc_migrated_${DOC}`;
const SNAPSHOT: string = `cdoc_snapshot_${DOC}`;

/** One Yjs state for every device in this file: "the same document" means the same state bytes. */
const SAMPLE: Y.Doc = chatYDoc(STARTER_KIT_SAMPLE, 'Plan');

function deviceWith(docId: string = DOC): FakeLocalDb {
  const db: FakeLocalDb = new FakeLocalDb();
  storeOriginal(db, docId, SAMPLE, CHAT, 'Plan (metadata)');
  return db;
}

const runnerOn = (db: FakeLocalDb, account: bigint = ALICE, loadMapper: MapperLoader = loaderOf(echoMapper)): MigrationRunner =>
  new MigrationRunner({ db, accountCid: account, loadMapper });

const writes = (db: FakeLocalDb): DbCall[] => db.calls.filter((c: DbCall): boolean => c.op === 'set');

describe('a chat document migrates once per account', () => {
  it('stores the snapshot, then the marker, under the account’s cid', async () => {
    const db: FakeLocalDb = deviceWith();
    const outcome: MigrationOutcome = await runnerOn(db).migrateIfNeeded(DOC);
    expect(outcome.kind).toBe('migrated');
    expect(writes(db).map((c: DbCall): string => c.key)).toEqual([SNAPSHOT, MARKER]);
    const marker: MigrationMarker = decodeMarker(Uint8Array.from(db.peek(ALICE, MARKER) ?? []));
    const stored: { state: number[] } = JSON.parse(new TextDecoder().decode(Uint8Array.from(db.peek(0n, `live_doc_${DOC}`) ?? []))) as { state: number[] };
    const ydoc: Y.Doc = new Y.Doc();
    Y.applyUpdate(ydoc, Uint8Array.from(stored.state));
    const expected: { origin: string; client: bigint } = await migrationIdentity(DOC, Y.encodeStateVector(ydoc));
    expect(marker.originYjsSvHash).toBe(expected.origin);
    expect(marker.client).toBe(expected.client);
    expect(outcome.kind === 'migrated' && outcome.title).toBe('Plan');
  });

  it('run twice: one snapshot, and the marker is not touched again', async () => {
    const db: FakeLocalDb = deviceWith();
    const runner: MigrationRunner = runnerOn(db);
    await runner.migrateIfNeeded(DOC);
    const marker: number[] | undefined = db.peek(ALICE, MARKER);
    const second: MigrationOutcome = await runner.migrateIfNeeded(DOC);
    expect(second.kind).toBe('already');
    expect(writes(db)).toHaveLength(2);
    expect(db.peek(ALICE, MARKER)).toEqual(marker);
    // A fresh runner (a reload) reads the marker too.
    expect((await runnerOn(db).migrateIfNeeded(DOC)).kind).toBe('already');
    expect(writes(db)).toHaveLength(2);
  });

  it('two calls at once (the open and the sweep) share one run', async () => {
    const db: FakeLocalDb = deviceWith();
    const runner: MigrationRunner = runnerOn(db);
    const [a, b]: MigrationOutcome[] = await Promise.all([runner.migrateIfNeeded(DOC), runner.migrateIfNeeded(DOC)]);
    expect(a).toBe(b);
    expect(writes(db)).toHaveLength(2);
  });

  it('a crash between the snapshot and the marker reruns to the same bytes', async () => {
    const crashed: FakeLocalDb = deviceWith();
    crashed.failOnce('set', MARKER, new Error('the tab closed'));
    const first: MigrationOutcome = await runnerOn(crashed).migrateIfNeeded(DOC);
    expect(first).toMatchObject({ kind: 'failed', stage: 'write' });
    expect(crashed.peek(ALICE, MARKER)).toBeUndefined();
    const snapshotBeforeRerun: number[] | undefined = crashed.peek(ALICE, SNAPSHOT);
    expect(snapshotBeforeRerun).toBeDefined();

    expect((await runnerOn(crashed).migrateIfNeeded(DOC)).kind).toBe('migrated');
    const clean: FakeLocalDb = deviceWith();
    await runnerOn(clean).migrateIfNeeded(DOC);
    expect(crashed.peek(ALICE, SNAPSHOT)).toEqual(snapshotBeforeRerun);
    expect(crashed.peek(ALICE, SNAPSHOT)).toEqual(clean.peek(ALICE, SNAPSHOT));
    expect(crashed.peek(ALICE, MARKER)).toEqual(clean.peek(ALICE, MARKER));
  });

  it('leaves the originals byte-identical, and never writes under cid 0', async () => {
    const db: FakeLocalDb = deviceWith();
    const before: Map<string, string> = db.dump(0n);
    await runnerOn(db).migrateIfNeeded(DOC);
    expect(db.dump(0n)).toEqual(before);
    expect(writes(db).every((c: DbCall): boolean => c.cid === ALICE)).toBe(true);
    expect(writes(db).some((c: DbCall): boolean => c.cid === 0n)).toBe(false);
  });

  it('refuses to run for cid 0, where only the device-wide originals live', () => {
    expect(() => runnerOn(deviceWith(), 0n)).toThrow(/cid 0/);
  });
});

describe('a failed read is never "nothing there"', () => {
  it('a failed read of the original aborts this document and says so, writing nothing', async () => {
    const db: FakeLocalDb = deviceWith();
    db.failOnce('get', `live_doc_${DOC}`, timedOut());
    const outcome: MigrationOutcome = await runnerOn(db).migrateIfNeeded(DOC);
    expect(outcome).toEqual({ kind: 'failed', stage: 'read-original', message: 'LocalDB request timed out after 5000ms' });
    expect(writes(db)).toEqual([]);
  });

  it('control: an original the agent says is absent is "no original"', async () => {
    expect(await runnerOn(new FakeLocalDb()).migrateIfNeeded(DOC)).toEqual({ kind: 'no-original' });
  });

  it('a failed marker read aborts before the original is even read', async () => {
    const db: FakeLocalDb = deviceWith();
    db.failOnce('get', MARKER, timedOut());
    expect(await runnerOn(db).migrateIfNeeded(DOC)).toMatchObject({ kind: 'failed', stage: 'read-marker' });
    expect(db.calls.map((c: DbCall): string => c.key)).toEqual([MARKER]);
  });

  it('an unreadable marker is an error, not a reason to migrate again', async () => {
    const db: FakeLocalDb = deviceWith();
    db.seed(ALICE, MARKER, [0xff, 0x00, 0x13]);
    expect(await runnerOn(db).migrateIfNeeded(DOC)).toMatchObject({ kind: 'failed', stage: 'read-marker' });
    expect(writes(db)).toEqual([]);
  });

  it('a stored snapshot that is not the marker’s is refused when read back', async () => {
    const db: FakeLocalDb = deviceWith();
    const runner: MigrationRunner = runnerOn(db);
    await runner.migrateIfNeeded(DOC);
    expect((await runner.readMigrated(DOC))?.snapshot.length).toBeGreaterThan(0);
    db.seed(ALICE, SNAPSHOT, [1, 2, 3]);
    await expect(runner.readMigrated(DOC)).rejects.toThrow(/not the one its marker names/);
  });
});

describe('a document belongs to the accounts of its chat', () => {
  it('the account that holds it and its peer may migrate it; a third account may not', async () => {
    expect((await runnerOn(deviceWith(), ALICE).migrateIfNeeded(DOC)).kind).toBe('migrated');
    expect((await runnerOn(deviceWith(), BOB).migrateIfNeeded(DOC)).kind).toBe('migrated');
    const db: FakeLocalDb = deviceWith();
    expect((await runnerOn(db, CAROL).migrateIfNeeded(DOC)).kind).toBe('not-owned');
    expect(writes(db)).toEqual([]);
    await expect(runnerOn(db, CAROL).readOriginal(DOC)).rejects.toThrow(/another account/);
  });

  it('each account keeps its own migration, under its own cid', async () => {
    const db: FakeLocalDb = deviceWith();
    await runnerOn(db, ALICE).migrateIfNeeded(DOC);
    await runnerOn(db, BOB).migrateIfNeeded(DOC);
    expect(db.peek(ALICE, MARKER)).toEqual(db.peek(BOB, MARKER));
    expect(db.peek(CAROL, MARKER)).toBeUndefined();
  });
});

describe('the mapper', () => {
  it('absent from this build: nothing is written and the next run tries again', async () => {
    const db: FakeLocalDb = deviceWith();
    expect(await runnerOn(db, ALICE, loaderOf(null)).migrateIfNeeded(DOC)).toEqual({ kind: 'mapper-unavailable' });
    expect(writes(db)).toEqual([]);
    expect((await runnerOn(db).migrateIfNeeded(DOC)).kind).toBe('migrated');
  });

  it('failing, or answering a report this side cannot read: reported, nothing written', async () => {
    const throwing: MigrationMapper = { ...echoMapper, toSnapshot: (): never => { throw new Error('unsupported node: table'); } };
    const unreadable: MigrationMapper = { ...echoMapper, toSnapshot: () => ({ snapshot: new Uint8Array([1]), reportJson: '{"report":{},"problems":[]}' }) };
    for (const mapper of [throwing, unreadable]) {
      const db: FakeLocalDb = deviceWith();
      expect(await runnerOn(db, ALICE, loaderOf(mapper)).migrateIfNeeded(DOC)).toMatchObject({ kind: 'failed', stage: 'map' });
      expect(writes(db)).toEqual([]);
    }
  });
});
