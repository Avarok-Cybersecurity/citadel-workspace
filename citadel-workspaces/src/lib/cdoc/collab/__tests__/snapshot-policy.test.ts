/**
 * A snapshot is stored when the server's compaction hint asks, or after the configured number
 * of local updates, only while the replica is exactly the log's prefix, and never on a timer.
 * Real replicas; the log starts from one shared base at seq 1 (doubles/real-replicas.ts).
 */
import { describe, expect, it } from 'vitest';
import type { EditorSession } from '../../editor/editor-session';
import type { CachedDocument, DocumentCache } from '../ports';
import { ALICE, BOB, newDocument, openTab, type Tab } from './doubles/harness';
import { memoryDevice } from './doubles/memory-device';
import { realReplicas, snapshotText, typeInto } from './doubles/real-replicas';
import type { ScriptedKernel } from './doubles/scripted-kernel';

type RealTab = Tab<EditorSession>;
type Stored = { readonly cid: bigint; readonly request: { StoreSnapshot: { upto_seq: bigint } } };

const uptos = (kernel: ScriptedKernel): bigint[] => kernel.sentOf('StoreSnapshot').map((r: Stored): bigint => r.request.StoreSnapshot.upto_seq);

async function writer(overrides: Parameters<typeof newDocument>[0], config: Parameters<typeof openTab>[3]): Promise<{ kernel: ScriptedKernel; clock: Awaited<ReturnType<typeof newDocument>>['clock']; alice: RealTab }> {
  const { kernel, clock } = await newDocument(overrides);
  const alice: RealTab = openTab(kernel, clock, ALICE, config, realReplicas(), null);
  await alice.session.open();
  await kernel.settle([alice.session]);
  return { kernel, clock, alice };
}

describe('snapshot policy', () => {
  it('stores one after the configured number of local updates, covering exactly what is acknowledged', async () => {
    const { kernel, alice } = await writer({}, { snapshotAfterLocalUpdates: 3 });
    await typeInto(alice.replica(), 'ab');
    await kernel.settle([alice.session]);
    expect(uptos(kernel)).toEqual([]);

    await typeInto(alice.replica(), 'c');
    await kernel.settle([alice.session]);
    expect(uptos(kernel)).toEqual([4n]);
    expect(kernel.log.snapshotUpto).toBe(4n);
    expect(kernel.log.held).toBe(0);
  });

  it('with no local count configured, stores one only when the server asks', async () => {
    const { kernel, alice } = await writer({ snapshotMinUpdates: 4n }, { snapshotAfterLocalUpdates: null });
    await typeInto(alice.replica(), 'abc');
    await kernel.settle([alice.session]);
    expect(uptos(kernel)).toEqual([]);

    await typeInto(alice.replica(), 'd');
    await kernel.settle([alice.session]);
    expect(uptos(kernel)).toEqual([5n]);
  });

  it('never stores one on a timer', async () => {
    const { kernel, clock, alice } = await writer({}, { snapshotAfterLocalUpdates: null });
    await typeInto(alice.replica(), 'abc');
    await kernel.settle([alice.session]);
    for (let minute: number = 0; minute < 60; minute += 1) {
      clock.advance(60_000);
      await kernel.settle([alice.session]);
    }
    expect(uptos(kernel)).toEqual([]);
  });

  it('waits while a peer\'s update is past a gap, then covers it', async () => {
    const { kernel, clock } = await newDocument({});
    const alice: RealTab = openTab(kernel, clock, ALICE, { snapshotAfterLocalUpdates: 3 }, realReplicas(), null);
    const bob: RealTab = openTab(kernel, clock, BOB, {}, realReplicas(), null);
    await alice.session.open();
    await bob.session.open();
    await kernel.settle([alice.session, bob.session]);
    await typeInto(alice.replica(), 'z');
    await kernel.settle([alice.session, bob.session]);
    kernel.dropPushesTo(ALICE, 1);
    await typeInto(bob.replica(), 'x');
    await typeInto(alice.replica(), 'ab');
    await kernel.settle([alice.session, bob.session]);
    expect(uptos(kernel)).toEqual([5n]);
    expect(alice.problems).toEqual([]);
  });

  it('saves the stored snapshot to the local cache, and a later open starts from it', async () => {
    const { kernel, clock } = await newDocument({});
    const saved: Map<string, CachedDocument> = new Map<string, CachedDocument>();
    const cache: DocumentCache = memoryDevice({
      load: (nodeId: string): Promise<CachedDocument | null> => Promise.resolve(saved.get(nodeId) ?? null),
      save: (nodeId: string, document: CachedDocument): Promise<void> => { saved.set(nodeId, document); return Promise.resolve(); },
      forget: (nodeId: string): Promise<void> => { saved.delete(nodeId); return Promise.resolve(); },
    }).cache;
    const alice: RealTab = openTab(kernel, clock, ALICE, { snapshotAfterLocalUpdates: 2 }, realReplicas(), cache);
    await alice.session.open();
    await kernel.settle([alice.session]);
    await typeInto(alice.replica(), 'ab');
    await kernel.settle([alice.session]);
    await typeInto(alice.replica(), 'c');
    await kernel.settle([alice.session]);
    expect([...saved.values()].map((d: CachedDocument): bigint => d.seq)).toEqual([3n]);

    const again: RealTab = openTab(kernel, clock, ALICE, {}, realReplicas(), cache);
    await again.session.open();
    await kernel.settle([again.session]);
    expect('snapshot' in again.sources[0]).toBe(true);
    expect(kernel.sentOf('Pull').at(-1)?.request.Pull.since_seq).toBe(3n);
    expect(await snapshotText(again.replica())).toContain('abc');
  });

  it('reports a cache it cannot read, and pulls the document whole', async () => {
    const { kernel, clock } = await newDocument({});
    // The base copy is broken; the device's edits are not (that is local-edits' to test).
    const broken: DocumentCache = memoryDevice({
      load: (): Promise<CachedDocument | null> => Promise.reject(new Error('storage unavailable')),
      save: (): Promise<void> => Promise.reject(new Error('storage unavailable')),
      forget: (): Promise<void> => Promise.reject(new Error('storage unavailable')),
    }).cache;
    const alice: RealTab = openTab(kernel, clock, ALICE, { snapshotAfterLocalUpdates: 1 }, realReplicas(), broken);
    await alice.session.open();
    await kernel.settle([alice.session]);
    await typeInto(alice.replica(), 'a');
    await kernel.settle([alice.session]);
    expect(kernel.sentOf('Pull').map((r: { request: { Pull: { since_seq: bigint } } }): bigint => r.request.Pull.since_seq)).toEqual([0n]);
    expect(alice.problems.map((p) => p.problem)).toEqual([
      expect.objectContaining({ kind: 'cacheFailed', operation: 'read' }),
      expect.objectContaining({ kind: 'cacheFailed', operation: 'write' }),
    ]);
  });
});
