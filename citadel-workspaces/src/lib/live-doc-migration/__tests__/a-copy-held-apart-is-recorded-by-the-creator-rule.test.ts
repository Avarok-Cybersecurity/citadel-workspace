// @vitest-environment node
/**
 * When the chat holds this account's moved copy apart from the peer's (they were moved from
 * different originals), what is recorded follows the creator rule: the creator keeps its copy
 * as the document; a non-creator cannot adopt the creator's (no snapshot crosses the chat), so
 * it records that the two are held apart. Recorded for this account only, read back by the
 * banner; a copy never moved here records nothing.
 */
import { describe, expect, it } from 'vitest';
import { MigrationRunner } from '../runner';
import { recordHeldApart } from '../held-apart';
import { decodeConflict, type ConflictRecord } from '../conflict-record';
import { CONFLICT_NOTES } from '../migration-copy';
import { FakeLocalDb } from './fake-local-db';
import { chatYDoc, echoMapper, loaderOf, storeOriginal, STARTER_KIT_SAMPLE } from './fixtures';

const ALICE: bigint = 41n;
const BOB: bigint = 42n;
const DOC: string = 'doc-apart';
const THEIRS: string = 'f'.repeat(64);

async function movedOn(db: FakeLocalDb): Promise<MigrationRunner> {
  storeOriginal(db, DOC, chatYDoc(STARTER_KIT_SAMPLE, 'Plan'), { holder: ALICE, peer: BOB }, 'Plan');
  const runner: MigrationRunner = new MigrationRunner({ db, accountCid: ALICE, loadMapper: loaderOf(echoMapper) });
  expect((await runner.migrateIfNeeded(DOC)).kind).toBe('migrated');
  return runner;
}

describe('a moved copy held apart from the peer\'s', () => {
  it('is recorded as the creator\'s to keep when this account made the document, and as held apart when the peer did', async () => {
    for (const [creator, resolution] of [['local', 'creator-keeps'], ['peer', 'held-apart']] as const) {
      const db: FakeLocalDb = new FakeLocalDb();
      const runner: MigrationRunner = await movedOn(db);
      const recorded: ConflictRecord | null = await recordHeldApart(runner, db, DOC, THEIRS, creator);
      expect(recorded).toMatchObject({ resolution, peerOrigin: THEIRS, lostEdits: [] });
      const stored: number[] | undefined = db.peek(ALICE, `cdoc_conflict_${DOC}`);
      expect(stored && decodeConflict(Uint8Array.from(stored))).toEqual(recorded);
      expect(await runner.readConflict(DOC)).toEqual(recorded);
      expect(CONFLICT_NOTES[resolution]).toMatch(creator === 'local' ? /Yours stays the document/ : /Theirs is the document/);
    }
  });

  it('records a peer copy that was never moved (no origin) as well', async () => {
    const db: FakeLocalDb = new FakeLocalDb();
    const recorded: ConflictRecord | null = await recordHeldApart(await movedOn(db), db, DOC, null, 'peer');
    expect(recorded?.peerOrigin).toBeNull();
    expect(decodeConflict(Uint8Array.from(db.peek(ALICE, `cdoc_conflict_${DOC}`) ?? []))).toEqual(recorded);
  });

  it('records nothing for a document this account never moved', async () => {
    const db: FakeLocalDb = new FakeLocalDb();
    const runner: MigrationRunner = new MigrationRunner({ db, accountCid: ALICE, loadMapper: loaderOf(echoMapper) });
    expect(await recordHeldApart(runner, db, DOC, THEIRS, 'peer')).toBeNull();
    expect(db.peek(ALICE, `cdoc_conflict_${DOC}`)).toBeUndefined();
  });
});
