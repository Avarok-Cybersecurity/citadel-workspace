// @vitest-environment node
/**
 * The background sweep over the device-wide index: bounded work per tick, yielding to the UI
 * between ticks, one bad document reported without holding back the rest, and an unreadable
 * index reported as such, never as "no documents".
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { MigrationRunner, type MigrationOutcome } from '../runner';
import { sweepLiveDocuments, type SweepResult } from '../sweep';
import { FakeLocalDb, timedOut, type DbCall } from './fake-local-db';
import { chatYDoc, echoMapper, loaderOf, storeIndex, storeOriginal, STARTER_KIT_SAMPLE } from './fixtures';
import type { MapperLoader } from '../mapper-port';

const ME: bigint = 11n;
const PEER: bigint = 12n;
const SAMPLE: Y.Doc = chatYDoc(STARTER_KIT_SAMPLE, 'Plan');
const IDS: string[] = ['a', 'b', 'c', 'd', 'e'];

function device(): FakeLocalDb {
  const db: FakeLocalDb = new FakeLocalDb();
  for (const id of IDS) storeOriginal(db, id, SAMPLE, { holder: ME, peer: PEER }, id);
  storeIndex(db, IDS);
  return db;
}

interface Run { readonly result: SweepResult; readonly yields: number }

async function sweep(db: FakeLocalDb, perTick: number, loadMapper: MapperLoader = loaderOf(echoMapper), signal: AbortSignal = new AbortController().signal): Promise<Run> {
  let yields: number = 0;
  const runner: MigrationRunner = new MigrationRunner({ db, accountCid: ME, loadMapper });
  const result: SweepResult = await sweepLiveDocuments(db, runner, { perTick, yieldToUi: async (): Promise<void> => { yields += 1; }, signal });
  return { result, yields };
}

const kinds = (result: SweepResult): string[] => (result.kind === 'swept' ? [...result.outcomes.values()].map((o: MigrationOutcome): string => o.kind) : []);

describe('the migration sweep', () => {
  it('migrates every document on the index, yielding between ticks of `perTick` documents', async () => {
    const { result, yields }: Run = await sweep(device(), 2);
    expect(result).toMatchObject({ kind: 'swept', stopped: 'done' });
    expect(kinds(result)).toEqual(['migrated', 'migrated', 'migrated', 'migrated', 'migrated']);
    expect(yields).toBe(2);
  });

  it('a second sweep migrates nothing again', async () => {
    const db: FakeLocalDb = device();
    await sweep(db, 5);
    const writes: number = db.calls.filter((c: DbCall): boolean => c.op === 'set').length;
    const { result }: Run = await sweep(db, 5);
    expect(kinds(result)).toEqual(IDS.map((): string => 'already'));
    expect(db.calls.filter((c: DbCall): boolean => c.op === 'set')).toHaveLength(writes);
  });

  it('reports a document whose original could not be read and carries on with the rest', async () => {
    const db: FakeLocalDb = device();
    db.failOnce('get', 'live_doc_c', timedOut());
    const { result }: Run = await sweep(db, 1);
    expect(kinds(result)).toEqual(['migrated', 'migrated', 'failed', 'migrated', 'migrated']);
  });

  it('an unreadable index is reported, and nothing is migrated', async () => {
    const db: FakeLocalDb = device();
    db.failOnce('get', 'live_doc_index', timedOut());
    const { result }: Run = await sweep(db, 1);
    expect(result).toEqual({ kind: 'index-unreadable', message: 'LocalDB request timed out after 5000ms' });
    expect(db.calls.filter((c: DbCall): boolean => c.op === 'set')).toEqual([]);
  });

  it('control: no index on this device is an empty sweep, not an error', async () => {
    const { result }: Run = await sweep(new FakeLocalDb(), 1);
    expect(result).toMatchObject({ kind: 'swept', stopped: 'done' });
    expect(kinds(result)).toEqual([]);
  });

  it('stops at the first document when the engine has no mapper: every other would answer the same', async () => {
    const { result }: Run = await sweep(device(), 1, loaderOf(null));
    expect(result).toMatchObject({ kind: 'swept', stopped: 'mapper-unavailable' });
    expect(kinds(result)).toEqual(['mapper-unavailable']);
  });

  it('stops between documents once aborted', async () => {
    const controller: AbortController = new AbortController();
    const db: FakeLocalDb = device();
    let yields: number = 0;
    const runner: MigrationRunner = new MigrationRunner({ db, accountCid: ME, loadMapper: loaderOf(echoMapper) });
    const result: SweepResult = await sweepLiveDocuments(db, runner, {
      perTick: 2, signal: controller.signal,
      yieldToUi: async (): Promise<void> => { yields += 1; controller.abort(); },
    });
    expect(result).toMatchObject({ kind: 'swept', stopped: 'aborted' });
    expect(kinds(result)).toEqual(['migrated', 'migrated']);
    expect(yields).toBe(1);
  });

  it('refuses a tick that would do no work', async () => {
    await expect(sweep(device(), 0)).rejects.toThrow(/at least 1/);
  });
});
